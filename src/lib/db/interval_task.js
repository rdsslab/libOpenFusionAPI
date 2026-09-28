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
import {
  getExposedEnvironmentsList,
  isExposureConfigured,
  MANAGED_ENVIRONMENTS,
} from "../server/envExposure.js";
// Se reutiliza el saneo de `concurrency.js` en vez de duplicarlo: la regla es la misma
// —un entero >= 1, y un valor que no vale cae al de por defecto y no a 1— y dos
// interpretaciones distintas de "el limite" en el mismo repo es como se cuelan.
import { normalizarLimite } from "./concurrency.js";

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

/**
 * Forma de un `idtask` de la era UUID.
 *
 * Existe por el restore: un backup tomado antes de la migración trae `idtask`
 * enteros, y consultar `WHERE idtask = 1` sobre una columna `uuid` no devuelve
 * vacío — en PostgreSQL es `ERROR 22P02 invalid input syntax for type uuid`, que
 * aborta la sentencia. Como `restoreIntervalTasks` acumula las promesas y las
 * espera al final, una sola fila inválida tumba el restore entero. Por eso el
 * filtro va ANTES de cualquier `findByPk`, no en el `catch`.
 */
export const UUID_TASK_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {*} valor
 * @returns {boolean} si el valor tiene forma de `idtask` de la era UUID
 */
export function esUUIDTask(valor) {
  return UUID_TASK_RE.test(String(valor ?? ""));
}

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
  // Turning the backoff off is a request to go back to the normal cadence, so the
  // `next_run` that the last failure pushed into the future is recomputed too.
  // Without this, a task that had drifted to +30 min would keep waiting 30 min
  // after the user had explicitly said "do not slow me down".
  "backoff_enabled",
];

/**
 * `IntervalTask.upsert(data)` construye la instancia con `Model.build()`, así que los campos
 * ausentes del payload no se conservan: se reescriben con el default del modelo. Sin este
 * merge, actualizar una tarea enviando sólo `{idtask, note}` devolvía `interval` a 300 y
 * apagaba la tarea. Un UPDATE es por tanto parcial: sólo se tocan las claves presentes,
 * distinguiendo `undefined` (no enviada, se conserva) de `null` (enviada vacía, se limpia).
 *
 * `idtask` es UUID (`models.js`). Con una PK autoincremental, un id declarado por el
 * llamador era un riesgo —podía pisar la fila de otra app— y por eso se rechazaba
 * siempre. Un UUID no tiene ese problema, así que el alta con id declarado se habilita
 * solo para el camino interno (`permitirIdDeclarado`), que es el que necesita que seed
 * y backup conserven la identidad que traen.
 *
 * @param {object} data
 * @param {{permitirIdDeclarado?: boolean}} [opciones] `permitirIdDeclarado` hace que un
 *   `idtask` UUID que no existe sea un alta en vez de un 404. Solo para seed y restore.
 * @returns {Promise<{result: object, created: boolean, previous: object|null}>}
 */
export const upsertIntervalTask = async (data, opciones = {}) => {
  const { permitirIdDeclarado = false } = opciones;

  try {
    let payload = { ...data };
    let previous = null;

    if (payload.idtask !== undefined && payload.idtask !== null) {
      previous = await getIntervalTaskById(payload.idtask);

      if (!previous) {
        if (permitirIdDeclarado) {
          // Camino interno (seed / restore del backup): el `idtask` que trae es la
          // identidad, y un UUID no puede colisionar con otra tarea, así que se honra
          // sin tocar `payload.idtask` y el `upsert()` de abajo lo inserta tal cual.
          // Un `idtask` entero es de un backup pre-UUID: no se busca —`WHERE idtask =
          // 1` sobre una columna uuid aborta con 22P02 en PostgreSQL y con eso caía el
          // restore entero— y tampoco se intenta insertar como UUID: se descarta y la
          // base asigna uno nuevo. La telemetría se descarta igual que en el merge:
          // si el alta trajera `status: running`, la tarea nacería colgada.
          for (const field of INTERVAL_TASK_RUNTIME_ATTRIBUTES) delete payload[field];
          if (!esUUIDTask(payload.idtask)) delete payload.idtask;
        } else {
          // Contrato público de `upsert_interval_task`: un `idtask` que no existe es
          // un 404, no un alta. Antes un entero inexistente también caía aquí; hoy un
          // entero no puede existir, pero se rechaza igual.
          const error = new Error(
            `Interval task ${payload.idtask} does not exist. Omit 'idtask' to create a new task.`,
          );
          error.code = "INTERVAL_TASK_NOT_FOUND";
          throw error;
        }
      } else {
        const stored = previous.get({ plain: true });

        for (const field of INTERVAL_TASK_RUNTIME_ATTRIBUTES) delete payload[field];

        // `params` se reemplaza entero a propósito: un merge profundo haría imposible borrar
        // una clave del payload que viaja al endpoint.
        const merged = { ...stored };
        for (const [key, value] of Object.entries(payload)) {
          if (value !== undefined) merged[key] = value;
        }

        // `idtask` no puede derivar por el merge: `stored` viene de buscar por
        // `payload.idtask`, así que ambos son el mismo valor por construcción. Esa es la
        // diferencia con la época en que la identidad era `(idendpoint, note)`: un update
        // podía arrastrar la fila equivocada. Hoy la identidad es un UUID que no se mueve.

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

    // Alta: sin `idtask`, con el UUID que asigne el modelo (`defaultValue: UUIDV4`), o
    // con un `idtask` declarado que ya se descartó por no ser de la era UUID. Eso no es
    // un `upsert`, es un alta, y `upsert()` no lo expresa en MSSQL: su `upsertQuery`
    // exige que la carga útil traiga la clave primaria o alguna única, y si no
    // encuentra ninguna responde "Primary Key or Unique key should be passed to upsert
    // query". `create()` dice exactamente lo mismo en los tres motores.
    if (payload.idtask === undefined || payload.idtask === null) {
      const creada = await IntervalTask.create(payload);
      return { result: creada, created: true, previous: null };
    }

    const [result, created] = await IntervalTask.upsert(payload, {
      returning: true,
    });
    return {
      result,
      created,
      previous: previous
        ? previous.get
          ? previous.get({ plain: true })
          : previous.toJSON()
        : null,
    };
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

/**
 * Tareas de intervalo con los datos de su endpoint y su app.
 *
 * `opciones.limite` acota cuantas filas se traen y `opciones.orden` fija en que orden.
 * Los dos van juntos a proposito: un `LIMIT` sin `ORDER BY` devuelve un subconjunto
 * arbitrario, y como el worker drena lotes seguidos (ver `debeDrenarLote`), dos lecturas
 * arbitrarias del mismo conjunto pueden devolver subconjuntos distintos y solapados. Sin
 * un orden fijo, el drenaje puede no terminar nunca.
 *
 * El listado de la API llama a esta funcion sin `opciones` y sigue devolviendo todo: el
 * limite es del planificador, no del contrato del endpoint.
 *
 * @param {object} [filter] subconjunto de tareas, endpoints y apps
 * @param {{limite?: number, orden?: Array}} [opciones]
 * @returns {Promise<object[]>}
 */
export const getIntervalTask = async (filter = {}, opciones = {}) => {
  try {
    const { limite, orden } = opciones;

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
        "backoff_enabled",
        "max_backoff_seconds",
        "history_limit",
      ],
      where: filter.tasks, // 🔹 Agregado el filtro aquí
      // El limite y el orden se anaden solo si los hay, para que la llamada sin
      // `opciones` genere exactamente la consulta de siempre.
      ...(Number.isInteger(limite) && limite > 0 ? { limit: limite } : {}),
      ...(Array.isArray(orden) && orden.length > 0 ? { order: orden } : {}),
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
        backoff_enabled: item.backoff_enabled,
        max_backoff_seconds: item.max_backoff_seconds,
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

/**
 * Filtro de entornos para tareas. Sin EXPOSE_*_API configurado no se filtra nada
 * (compatibilidad total, incluye entornos propios fuera de dev/qa/prd). Con exposición
 * configurada, solo se ejecutan las tareas de entornos expuestos; los entornos propios
 * (no gestionables por EXPOSE_*_API) siempre se permiten. Sin exención de la app system:
 * sus tareas son schedulers y correrlas en dos servidores espejo duplicaría ejecuciones.
 */
function buildTaskEnvironmentFilter() {
  if (!isExposureConfigured()) {
    return { enabled: true };
  }

  return {
    enabled: true,
    environment: {
      [Op.or]: [
        { [Op.in]: getExposedEnvironmentsList() },
        { [Op.notIn]: MANAGED_ENVIRONMENTS },
      ],
    },
  };
}

/**
 * Cuantas tareas vencidas se traen en un viaje.
 *
 * No es un tope de ejecucion: el worker lanza todas las que le traiga. Es un tope de
 * trabajo por ciclo, para que un despliegue con cientos de tareas vencidas a la vez no
 * se traiga el conjunto entero —con dos `JOIN` y 29 columnas de la tarea mas las del
 * endpoint y su app— en memoria, y no repita esa consulta cada 250 ms. Lo que no cabe en
 * el lote entra en el ciclo siguiente, que sale de inmediato: ninguna tarea espera (ver
 * `debeDrenarLote`).
 */
export const LOTE_TAREAS_POR_DEFECTO = 200;

/**
 * Tareas vencidas y elegibles, en el orden en que hay que tomarlas.
 *
 * El orden es `next_run` ascendente, con `idtask` como segundo criterio. La primera
 * parte es la que toca: la mas vencida primero. La segunda es la que hace el conjunto
 * **estable**, y sin ella el `LIMIT` devuelve filas distintas en cada lectura aunque no
 * haya cambiado nada, que es lo que dejaria el drenaje sin fin.
 *
 * @param {{limite?: number}} [opciones]
 * @returns {Promise<object[]>}
 */
export const getIntervalTaskProcess = async (opciones = {}) => {
  const now = new Date();
  const limite = normalizarLimite(opciones.limite, LOTE_TAREAS_POR_DEFECTO);

  let filter = {
    endpoint: buildTaskEnvironmentFilter(),
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
        //
        // `max_failed_attempts = 0` significa "nunca deshabilitar", así que en ese
        // caso la tarea sigue siendo elegible por cuantos fallos acumule. Sin esta
        // rama, el filtro `failed_attempts < max_failed_attempts` sería `n < 0`,
        // siempre falso, y una tarea con 0 no volvería a ejecutarse nunca: el 0
        // desactivaría la tarea entera en lugar de solo la auto-deshabilitación.
        //
        // Las dos condiciones van en un MISMO `Op.or`. Poner `Op.or` como elemento
        // suelto de este `Op.and` genera `(A AND (max=0) AND B)`, que deja fuera
        // toda tarea con max distinto de 0: el filtro parece funcionar pero solo
        // deja pasar los casos que ya no le interesan a nadie.
        Sequelize.or(
          { max_failed_attempts: 0 },
          Sequelize.where(
            Sequelize.col("failed_attempts"),
            Op.lt,
            Sequelize.col("max_failed_attempts"),
          ),
        ),
      ],
    },
  };

  return await getIntervalTask(filter, {
    limite,
    orden: [
      ["next_run", "ASC"],
      ["idtask", "ASC"],
    ],
  });
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
        // Misma rama que en getIntervalTaskProcess, y por el mismo motivo: con
        // `max_failed_attempts = 0` la tarea nunca se auto-deshabilita, así que debe
        // seguir contando como próxima vencimiento aunque lleve muchos fallos. Las dos
        // condiciones comparten un `Op.or` (ver la nota de getIntervalTaskProcess).
        Sequelize.or(
          { max_failed_attempts: 0 },
          Sequelize.where(
            Sequelize.col("failed_attempts"),
            Op.lt,
            Sequelize.col("max_failed_attempts"),
          ),
        ),
      ],
    },
    include: [
      {
        model: Endpoint,
        attributes: [],
        where: buildTaskEnvironmentFilter(),
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

/**
 * Calcula los campos a escribir para una transición de estado.
 *
 * @param {object} task la fila, ya leída
 * @param {number} new_status
 * @param {unknown} result
 * @param {number} exec_ms
 * @param {Date} now
 * @returns {object|null} `null` si el estado no significa nada que escribir
 */
const camposDeTransicion = (task, new_status, result, exec_ms, now) => {
  let data_update = {};

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
    case TASK_STATUS.ABORTED:
      // Detenida por orden del operador (`stop_interval_task_run`): la última ejecución
      // se cortó en vuelo. No es un fallo de la tarea —el operador la detuvo, no el
      // endpoint ni el timeout—, así que NO se incrementa `failed_attempts`, no hay
      // backoff y no puede deshabilitar la tarea. El horario sigue anclado al
      // planificado, igual que en un DONE.
      data_update = {
        last_response: result,
        last_exec_time: exec_ms,
        status: new_status,
      };

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
      // Un estado que no existe no significa ningún cambio. Antes caía en un
      // `IntervalTask.update({}, ...)`, que es un UPDATE sin nada que poner.
      return null;
  }

  return data_update;
};

/**
 * Aplica una transición de estado de una tarea.
 *
 * ## Por qué el quinto argumento
 *
 * El worker leía aquí la fila entera de la tarea, y la tenía **en la mano desde un
 * momento antes**: el ciclo se la había traído con dos `JOIN` para decidir si la lanzaba.
 * Volver a pedirla era un viaje entero para releer lo que ya estaba en memoria, y estaba
 * en el camino que retarda el arranque de cada ejecución. Con cientos de tareas
 * venciendo a la vez, esa lectura duplicada es la mitad de las sentencias del worker.
 *
 * Cuando quien llama pasa la fila, esta función hace **un** `UPDATE` y ni una lectura
 * más. Un `UPDATE` con sus propios valores ya es atómico, así que no hay nada que una
 * transacción aportaría ahí.
 *
 * ## Por qué el resto sí va en transacción
 *
 * Sin la fila, hay que leer para decidir: sobre todo en `ERROR` y `TIMEOUT`, donde se
 * incrementa `failed_attempts`. Leer y escribir son dos sentencias, y entre medias otra
 * puede cambiar la fila. Por eso van en una transacción, pidiendo el bloqueo de fila.
 *
 * El bloqueo solo es real donde el motor lo acepta: **Sequelize 6.37.8 declara
 * `supports.lock = false` en MSSQL**, así que allí la transacción sale sin pista de
 * bloqueo y el `SELECT` va pelado. En PostgreSQL se traduce a `FOR UPDATE`, y en SQLite
 * se ignora —que es lo correcto: hay un solo escritor. No se puede prometer el bloqueo
 * en MSSQL sin escribir SQL a mano con `WITH (UPDLOCK, ROWLOCK)`, y no compensa por una
 * fila que solo escribe su propia tarea.
 *
 * ## Lo que la transacción no arregla
 *
 * El reintento por bloqueo de `lock_retry.js` no actúa dentro de una transacción
 * explícita, a propósito: repetir una sentencia sobre una transacción ya abortada
 * falla por un motivo más raro que el original. Como cada tarea escribe su propia fila,
 * dos tareas no se pelean por ella, así que un 1205 aquí sería raro. Si se ve, el
 * `catch` lo devuelve como `success: false` y la tarea se reintenta en el ciclo
 * siguiente, que es lo correcto.
 *
 * @param {string} idtask
 * @param {number} new_status
 * @param {unknown} [result]
 * @param {number} [time_execution_ms]
 * @param {object|null} [tareaConocida] la fila, si quien llama ya la tiene
 * @returns {Promise<{success: boolean, message: string, runtime?: object}>}
 */
export const updateIntervalTaskStatus = async (
  idtask,
  new_status,
  result,
  time_execution_ms,
  tareaConocida = null
) => {
  try {
    // Se llama sin este argumento al marcar "en ejecución"; sin la guarda quedaba NaN.
    const exec_ms = Number.isFinite(Number(time_execution_ms))
      ? Math.floor(Number(time_execution_ms))
      : 0;

    const now = new Date();
    const exito = (runtime) => ({
      success: true,
      message: "La tarea fue actualizada correctamente.",
      runtime,
    });

    // Camino corto: quien llama ya tiene la fila. Un solo UPDATE y ninguna lectura.
    if (tareaConocida) {
      const data_update = camposDeTransicion(tareaConocida, new_status, result, exec_ms, now);

      if (!data_update) return exito({});

      await IntervalTask.update(data_update, { where: { idtask } });
      return exito(data_update);
    }

    // Camino con lectura: hace falta para decidir, así que lee y escribe en una sola
    // transacción pidiendo el bloqueo de fila. Ver la cabecera para lo que el bloqueo
    // significa en cada motor.
    return await IntervalTask.sequelize.transaction(async (t) => {
      const task = await IntervalTask.findOne({
        where: { idtask: idtask },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!task) {
        throw new Error(`No se encontró la tarea con idtask: ${idtask}`);
      }

      const data_update = camposDeTransicion(task, new_status, result, exec_ms, now);

      if (!data_update) return exito({});

      await IntervalTask.update(data_update, { where: { idtask }, transaction: t });

      return exito(data_update);
    });
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
 *
 * No reactiva una tarea deshabilitada, y no finge que sí. El worker solo toma
 * tareas con `enabled: true` (getIntervalTaskProcess), así que poner `next_run`
 * en una tarea apagada no la hace ejecutar: el ciclo entero no la verá. Antes esta
 * función devolvía `success: true` en ese caso, y un agente que siguiera el flujo
 * recomendado de la guía (crear sin `enabled: true`, forzar la ejecución, y recién
 * ahí habilitarla) se quedaba esperando un `get_interval_task_runs` que nunca
 * llegaba con ejecuciones.
 *
 * Se responde 409 con `reason: "TASK_DISABLED"` para que el rechazo sea legible
 * por máquina y no solo un texto. Para desbloquear una tarea apagada por el backoff
 * existe `reset_interval_task_attempts`, que sí la reactiva.
 *
 * @param {string} idtask
 * @returns {Promise<{success: boolean, message: string, code?: number, reason?: string}>}
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

    if (!task.enabled) {
      return {
        success: false,
        code: 409,
        reason: "TASK_DISABLED",
        message:
          "La tarea está deshabilitada y el worker no la ejecutará. " +
          "Habilítala con upsert_interval_task (enabled: true) o usa " +
          "reset_interval_task_attempts si el backoff la apagó.",
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
 * @param {string} idtask
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
