import { Op } from "sequelize";
import Sequelize from "sequelize";
import { IntervalTask, Application, Endpoint } from "./models.js";
import {
  TASK_STATUS,
  computeNextRun,
  computeBackoffNextRun,
  shouldDisableForFailures,
  validateCron,
} from "../timer/schedule.js";

/**
 * Columnas de estado observado del scheduler. Las escribe el worker, nunca el usuario:
 * `enabled`, `interval` o `cron` son intención y estas columnas son diagnóstico.
 * Espejo de BOT_RUNTIME_ATTRIBUTES en `bot.js`. Se ignoran al hacer upsert y se descartan
 * al restaurar un backup: restaurar un `status: 1` (running) dejaría la tarea colgada hasta
 * que la libere el reaper, y un `failed_attempts` cercano al tope la deshabilitaría al
 * primer fallo.
 */
export const INTERVAL_TASK_RUNTIME_ATTRIBUTES = [
  "status",
  "failed_attempts",
  "last_run",
  "next_run",
  "last_exec_time",
  "last_response",
];

/** Campos cuyo cambio invalida el `next_run` ya calculado. */
const SCHEDULE_FIELDS = [
  "interval",
  "schedule_mode",
  "cron",
  "timezone",
  "window_start",
  "window_end",
  "window_days",
  "datestart",
];

/**
 * `IntervalTask.upsert(data)` construye la instancia con `Model.build()`, así que los campos
 * ausentes del payload no se conservan: se reescriben con el default del modelo. Sin este
 * merge, actualizar una tarea enviando sólo `{idtask, note}` devolvía `interval` a 300 y
 * apagaba la tarea. Un UPDATE es por tanto parcial: sólo se tocan las claves presentes,
 * distinguiendo `undefined` (no enviada, se conserva) de `null` (enviada vacía, se limpia).
 */
export const upsertIntervalTask = async (data) => {
  try {
    let payload = { ...data };
    let previous = null;

    if (payload.idtask !== undefined && payload.idtask !== null) {
      previous = await getIntervalTaskById(payload.idtask);

      if (!previous) {
        // Sin esto Sequelize insertaría una fila con el idtask forzado, pisando el
        // autoincremental y, en una BD ajena, la tarea de otra app.
        const error = new Error(
          `Interval task ${payload.idtask} does not exist. Omit 'idtask' to create a new task.`,
        );
        error.code = "INTERVAL_TASK_NOT_FOUND";
        throw error;
      }

      const stored = previous.get({ plain: true });

      for (const field of INTERVAL_TASK_RUNTIME_ATTRIBUTES) delete payload[field];

      // `params` se reemplaza entero a propósito: un merge profundo haría imposible borrar
      // una clave del payload que viaja al endpoint.
      const merged = { ...stored };
      for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined) merged[key] = value;
      }

      // Si cambió la programación, el next_run guardado ya no corresponde a nada: se
      // recalcula para que el cambio surta efecto sin esperar al ciclo viejo.
      const scheduleChanged = SCHEDULE_FIELDS.some(
        (field) => payload[field] !== undefined && payload[field] !== stored[field],
      );

      if (scheduleChanged) {
        merged.next_run = computeNextRun(merged, { from: new Date(), anchor: null });
      }

      payload = merged;
    }

    if (payload.schedule_mode === "cron") {
      if (!payload.cron) {
        const error = new Error("cron is required when schedule_mode is 'cron'");
        error.code = "INVALID_TASK_SCHEDULE";
        throw error;
      }

      const check = validateCron(payload.cron, payload.timezone);
      if (!check.valid) {
        const error = new Error(`Invalid cron expression: ${check.error}`);
        error.code = "INVALID_TASK_SCHEDULE";
        throw error;
      }
    }

    const [result, created] = await IntervalTask.upsert(payload, {
      returning: true,
    });
    return { result, created };
  } catch (error) {
    // El idtask inexistente es un error de entrada, no una falla: se propaga como 404 sin
    // ensuciar el log con un stack.
    if (
      error?.code !== "INTERVAL_TASK_NOT_FOUND" &&
      error?.code !== "INVALID_TASK_SCHEDULE"
    ) {
      console.error("Error retrieving:", error, data);
    }
    throw error; // c4ca4238-a0b9-2382-0dcc-509a6f75849b
  }
};

/**
 * Los campos JSON se leen con `raw: true`, que salta el getter del modelo: en los
 * dialectos donde el JSON se guarda como TEXT (sqlite, mssql) llegan como cadena. Sin
 * esto el worker recibía `params` como string y nunca enviaba los datos al endpoint.
 */
function parseJSONField(value, fallback = {}) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

// READ
export const getIntervalTaskById = async (idtask) => {
  try {
    const task = await IntervalTask.findByPk(idtask);
    return task;
  } catch (error) {
    console.error("Error retrieving user:", error);
    throw error;
  }
};

export const getAllIntervalTasks = async () => {
  try {
    const tasks = await IntervalTask.findAll();
    return tasks;
  } catch (error) {
    console.error("Error retrieving:", error);
    throw error;
  }
};

export const getIntervalTask = async (filter = {}) => {
  try {
    let results = await IntervalTask.findAll({
      attributes: [
        "idtask",
        "iduser",
        "idendpoint",
        ["enabled", "task_enabled"],
        "interval",
        "datestart",
        "dateend",
        "next_run",
        "last_run",
        "params",
        "exec_time_limit",
        "failed_attempts",
        "status",
        "last_exec_time",
        "last_response",
        "note",
        "allow_concurrent",
        "idkey",
        "schedule_mode",
        "cron",
        "timezone",
        "window_start",
        "window_end",
        "window_days",
        "max_failed_attempts",
        "history_limit",
      ],
      where: filter.tasks, // 🔹 Agregado el filtro aquí
      include: [
        {
          model: Endpoint,
          attributes: [
            ["idendpoint", "idendpoint"],
            ["enabled", "endpoint_enabled"],
            ["method", "method"],
            ["resource", "resource"],
            ["environment", "environment"],
            ["access", "access"],
          ],
          where: filter.endpoint, // 🔹 Agregado el filtro aquí
          required: true,
          include: [
            {
              model: Application,
              attributes: [
                ["idapp", "idapp"],
                ["app", "app"],
                ["enabled", "app_enabled"],
              ],
              required: true,
              where: filter.app, // 🔹 Agregado el filtro aquí
            },
          ],
        },
      ],
      raw: true,
      //nest: true,
    });

    results = results.map((item) => {
      let new_item = {
        idapp: item["ofapi_endpoint.ofapi_application.idapp"],
        app: item["ofapi_endpoint.ofapi_application.app"],
        app_enabled: item["ofapi_endpoint.ofapi_application.app_enabled"],

        idendpoint: item["ofapi_endpoint.idendpoint"],
        endpoint_enabled: item["ofapi_endpoint.endpoint_enabled"],
        method: item["ofapi_endpoint.method"],
        resource: item["ofapi_endpoint.resource"],
        environment: item["ofapi_endpoint.environment"],
        access: item["ofapi_endpoint.access"],

        idtask: item.idtask,
        iduser: item.iduser,
        task_enabled: item.task_enabled,
        interval: item.interval,
        datestart: item.datestart,
        dateend: item.dateend,
        next_run: item.next_run,
        last_run: item.last_run,
        params: parseJSONField(item.params),
        exec_time_limit: item.exec_time_limit,
        failed_attempts: item.failed_attempts,
        status: item.status,
        last_exec_time: item.last_exec_time,
        last_response: parseJSONField(item.last_response, null),
        note: item.note,

        allow_concurrent: item.allow_concurrent,
        idkey: item.idkey,
        schedule_mode: item.schedule_mode,
        cron: item.cron,
        timezone: item.timezone,
        window_start: item.window_start,
        window_end: item.window_end,
        window_days: item.window_days,
        max_failed_attempts: item.max_failed_attempts,
        history_limit: item.history_limit,
      };

      new_item.url = `/api/${new_item.app}${new_item.resource}/${new_item.environment}`;

      return new_item;
    });

    return results;
  } catch (error) {
    console.error("Error al obtener interval tasks con detalles:", error);
    throw error;
  }
};

export const getIntervalTaskProcess = async () => {
  const now = new Date();

  let filter = {
    endpoint: { enabled: true },
    app: { enabled: true },
    tasks: {
      enabled: true,
      // `datestart <= now` y `dateend >= now` descartaban en silencio las tareas con esas
      // fechas en NULL: en SQL una comparación contra NULL nunca es verdadera, aunque
      // ambas columnas son opcionales y se documentan como "omitir para no acotar".
      [Op.and]: [
        {
          [Op.or]: [
            { datestart: { [Op.lte]: now } },
            { datestart: { [Op.is]: null } },
          ],
        },
        {
          [Op.or]: [
            { dateend: { [Op.gte]: now } },
            { dateend: { [Op.is]: null } },
          ],
        },
        {
          [Op.or]: [
            { next_run: { [Op.lte]: now } },
            { next_run: { [Op.is]: null } },
          ],
        },
        // El tope de fallos dejó de ser 3 fijo: cada tarea define el suyo.
        Sequelize.where(
          Sequelize.col("failed_attempts"),
          Op.lt,
          Sequelize.col("max_failed_attempts"),
        ),
      ],
    },
  };

  return await getIntervalTask(filter);
};

/**
 * Próximo vencimiento de una tarea elegible. El worker lo usa para dormir hasta ese
 * instante en vez de consultar la base de datos con una frecuencia fija.
 */
export const getNextIntervalTaskRun = async () => {
  const now = new Date();
  const task = await IntervalTask.findOne({
    attributes: ["next_run"],
    where: {
      enabled: true,
      next_run: { [Op.not]: null },
      [Op.and]: [
        {
          [Op.or]: [
            { datestart: { [Op.lte]: now } },
            { datestart: { [Op.is]: null } },
          ],
        },
        {
          [Op.or]: [
            { dateend: { [Op.gte]: now } },
            { dateend: { [Op.is]: null } },
          ],
        },
        Sequelize.where(
          Sequelize.col("failed_attempts"),
          Op.lt,
          Sequelize.col("max_failed_attempts"),
        ),
      ],
    },
    include: [
      {
        model: Endpoint,
        attributes: [],
        where: { enabled: true },
        required: true,
        include: [
          {
            model: Application,
            attributes: [],
            where: { enabled: true },
            required: true,
          },
        ],
      },
    ],
    order: [["next_run", "ASC"]],
    raw: true,
  });

  return task?.next_run ? new Date(task.next_run) : null;
};

// DELETE
export const deleteIntervalTask = async (idtaskList) => {
  try {
    const deletedCount = await IntervalTask.destroy({
      where: {
        idtask: idtaskList,
      },
    });

    if (deletedCount > 0) {
      return true; // User deleted successfully
    }

    return false; // User not found
  } catch (error) {
    console.error("Error deleting idendpoint:", error);
    throw error;
  }
};

export const bulkCreateIntervalTask = (list_tasks) => {
  // Campos que se utilizarán para verificar duplicados (en este caso, todos excepto 'rowkey' y 'idendpoint')
  //const uniqueFields = ['idapp', 'namespace', 'name', 'version', 'environment', 'method'];
  // OJO: No se pudo tener un bulk upsert
  return IntervalTask.bulkCreate(list_tasks, {
    ignoreDuplicates: true,
    //updateOnDuplicate: uniqueFields
  });
};

export const updateIntervalTaskRun = async (idtask, status) => {
  try {
    const task = await IntervalTask.findOne({ where: { idtask } });

    if (!task) {
      throw new Error(`No se encontró la tarea con idtask: ${idtask}`);
    }

    const now = new Date();
    const nextRun = new Date(now.getTime() + task.interval * 1000); // Convertir interval de segundos a milisegundos

    await IntervalTask.update(
      {
        last_run: now,
        next_run: nextRun,
        status: status,
      },
      { where: { idtask } }
    );

    return {
      success: true,
      message: "La tarea fue actualizada correctamente.",
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export const updateIntervalTaskStatus = async (
  idtask,
  new_status,
  result,
  time_execution_ms
) => {
  try {
    // Se llama sin este argumento al marcar "en ejecución"; sin la guarda quedaba NaN.
    const exec_ms = Number.isFinite(Number(time_execution_ms))
      ? Math.floor(Number(time_execution_ms))
      : 0;

    const task = await IntervalTask.findOne({
      where: { idtask: idtask },
    });

    if (!task) {
      throw new Error(`No se encontró la tarea con idtask: ${idtask}`);
    }

    let data_update = {};

    const now = new Date();

    switch (new_status) {
      case TASK_STATUS.WAITING:
        // En espera
        data_update = {
          last_run: now,
          next_run: computeNextRun(task, { from: now }),
          status: new_status,
          failed_attempts: 0,
          last_response: null,
        };

        break;
      case TASK_STATUS.RUNNING:
        // En ejecución. `next_run` se ancla al horario previsto (ver schedule.js), de
        // modo que la duración de esta corrida no desplace toda la serie.
        data_update = {
          last_run: now,
          next_run: computeNextRun(task, { from: now }),
          status: new_status,
        };

        break;
      case TASK_STATUS.DONE:
        // Completado
        data_update = {
          last_response: result,
          failed_attempts: 0,
          last_exec_time: exec_ms,
          status: new_status,
        };

        // Si la ejecución duró más que el propio intervalo, el `next_run` calculado al
        // arrancar ya quedó en el pasado: se avanza al siguiente hueco futuro.
        if (task.next_run && new Date(task.next_run) <= now) {
          data_update.next_run = computeNextRun(task, { from: now });
        }

        break;
      case TASK_STATUS.ERROR:
      case TASK_STATUS.TIMEOUT: {
        // Error o timeout: reintento con espera creciente en vez de morir al tercer fallo.
        const failed_attempts = task.failed_attempts + 1;

        data_update = {
          last_response: result,
          failed_attempts,
          status: new_status,
          last_exec_time: exec_ms,
          next_run: computeBackoffNextRun(task, failed_attempts, { from: now }),
        };

        if (shouldDisableForFailures(task, failed_attempts)) {
          data_update.enabled = false;
          data_update.last_response = {
            ...(result && typeof result === "object" ? result : { error: result }),
            disabled_reason: `Deshabilitada tras ${failed_attempts} fallos consecutivos`,
          };
        }

        break;
      }
      default:
        break;
    }

    await IntervalTask.update(data_update, { where: { idtask } });

    return {
      success: true,
      message: "La tarea fue actualizada correctamente.",
      runtime: data_update,
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: error.message };
  }
};

/**
 * Libera las tareas que quedaron marcadas como "en ejecución" sin estarlo: el proceso
 * murió a media corrida o el fetch se colgó. Sin esto, `allow_concurrent = false` las
 * dejaría bloqueadas para siempre, porque el ciclo no vuelve a tomar una tarea en
 * estado 1.
 *
 * @param {number} [graceSeconds] margen sobre `exec_time_limit` antes de darla por muerta
 * @returns {Promise<number>} tareas liberadas
 */
export const reapStaleRunningTasks = async (graceSeconds = 30) => {
  try {
    const now = new Date();

    // Se filtra en JS porque comparar contra la columna `exec_time_limit` dentro de un
    // intervalo de fecha no es portable entre los dialectos que soporta el proyecto.
    const running = await IntervalTask.findAll({
      where: { status: TASK_STATUS.RUNNING },
    });

    let reaped = 0;

    for (const task of running) {
      const startedAt = task.last_run ? new Date(task.last_run) : null;
      if (!startedAt || Number.isNaN(startedAt.getTime())) continue;

      const limitMs =
        (Number(task.exec_time_limit || 30) + Number(graceSeconds || 0)) * 1000;

      if (now.getTime() - startedAt.getTime() <= limitMs) continue;

      const failed_attempts = task.failed_attempts + 1;
      const data_update = {
        status: TASK_STATUS.TIMEOUT,
        failed_attempts,
        last_response: {
          error: "Task abandoned: still running past exec_time_limit",
        },
        next_run: computeBackoffNextRun(task, failed_attempts, { from: now }),
      };

      if (shouldDisableForFailures(task, failed_attempts)) {
        data_update.enabled = false;
        data_update.last_response.disabled_reason = `Deshabilitada tras ${failed_attempts} fallos consecutivos`;
      }

      await IntervalTask.update(data_update, {
        where: { idtask: task.idtask },
      });
      reaped++;
    }

    return reaped;
  } catch (error) {
    console.error("Error reaping stale interval tasks:", error);
    return 0;
  }
};

/**
 * Reprograma la tarea al siguiente hueco válido sin ejecutarla ni tocar su contador de
 * fallos. Se usa cuando el ciclo la descarta por caer fuera de la ventana horaria: sin
 * esto seguiría vencida y se reevaluaría cada 10 s.
 *
 * @param {object} task fila (o proyección) de la tarea, con los campos de planificación
 */
export const rescheduleIntervalTask = async (task) => {
  try {
    await IntervalTask.update(
      { next_run: computeNextRun(task, { from: new Date() }) },
      { where: { idtask: task.idtask } },
    );
    return true;
  } catch (error) {
    console.error("Error rescheduling interval task:", error);
    return false;
  }
};

/**
 * Fuerza la ejecución de una tarea en el próximo ciclo del worker.
 * @param {number|string} idtask
 */
export const runNowIntervalTask = async (idtask) => {
  try {
    const task = await IntervalTask.findOne({ where: { idtask } });
    if (!task) {
      return { success: false, message: `No existe la tarea ${idtask}` };
    }

    if (task.status === TASK_STATUS.RUNNING && !task.allow_concurrent) {
      return {
        success: false,
        message: "La tarea está en ejecución y no permite concurrencia.",
      };
    }

    await IntervalTask.update(
      {
        next_run: new Date(),
        failed_attempts: 0,
        status: TASK_STATUS.WAITING,
      },
      { where: { idtask } },
    );

    return { success: true, message: "La tarea se ejecutará en el próximo ciclo." };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

/**
 * Reinicia el contador de fallos y reactiva la tarea si el backoff la deshabilitó.
 * @param {number|string} idtask
 */
export const resetIntervalTaskAttempts = async (idtask) => {
  try {
    const task = await IntervalTask.findOne({ where: { idtask } });
    if (!task) {
      return { success: false, message: `No existe la tarea ${idtask}` };
    }

    await IntervalTask.update(
      {
        failed_attempts: 0,
        enabled: true,
        status: TASK_STATUS.WAITING,
        next_run: computeNextRun(task, { from: new Date(), anchor: null }),
      },
      { where: { idtask } },
    );

    return { success: true, message: "Contador de fallos reiniciado." };
  } catch (error) {
    return { success: false, message: error.message };
  }
};
