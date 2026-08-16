import {
  getIntervalTask,
  upsertIntervalTask,
  deleteIntervalTask,
  runNowIntervalTask,
  resetIntervalTaskAttempts,
} from "../../../../../db/interval_task.js";
import { getIntervalTaskRuns } from "../../../../../db/interval_task_run.js";
import { validateCron } from "../../../../../timer/schedule.js";
import { readIntervalTaskSkill } from "../../../../intervalTaskDocs.js";

function wakeIntervalTaskWorker(params) {
  params?.reply?.openfusionapi?.server?.TasksInterval?.wake?.();
}

export async function fnGetIntervalTasksByIdApp(params) {
  let r = { code: 200, data: undefined };
  try {
    r.data = await getIntervalTask({
      app: { idapp: params.request.query.idapp },
    });
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnUpsertIntervalTask(params) {
  let r = { data: undefined, code: 204 };
  try {
    const body = params.request.body || {};

    // `idendpoint` sólo es obligatorio al crear: en un UPDATE parcial se conserva el de la
    // fila. No puede expresarse en el json_schema porque el normalizador de MCP descarta
    // `if`/`then`, así que la condición vive aquí.
    if (body.idtask === undefined || body.idtask === null) {
      if (!body.idendpoint) {
        r.data = {
          error: "idendpoint is required to create an interval task",
          code: "MISSING_IDENDPOINT",
        };
        r.code = 400;
        return r;
      }
    }

    // Una expresión cron inválida dejaría la tarea sin próxima ejecución y sin ningún
    // aviso: se rechaza al guardar, no al ejecutar.
    if (body.schedule_mode === "cron") {
      if (!body.cron) {
        r.data = { error: "cron is required when schedule_mode is 'cron'" };
        r.code = 400;
        return r;
      }

      const check = validateCron(body.cron, body.timezone);
      if (!check.valid) {
        r.data = { error: `Invalid cron expression: ${check.error}` };
        r.code = 400;
        return r;
      }
    }

    r.data = await upsertIntervalTask(body);
    r.code = 200;
    wakeIntervalTaskWorker(params);
  } catch (error) {
    if (error?.code === "INVALID_TASK_SCHEDULE") {
      r.data = { error: error.message, code: error.code };
      r.code = 400;
      return r;
    }

    if (error?.code === "INTERVAL_TASK_NOT_FOUND") {
      r.data = { error: error.message, code: error.code };
      r.code = 404;
      return r;
    }

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetIntervalTaskSkill(params) {
  let r = { code: 204, data: undefined };
  try {
    r.data = await readIntervalTaskSkill();
    r.code = 200;
  } catch (error) {
    console.error("[fnGetIntervalTaskSkill] error:", error);
    r.data = { error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

export async function fnGetIntervalTaskRuns(params) {
  let r = { code: 200, data: undefined };
  try {
    const query = params.request.query || {};
    r.data = await getIntervalTaskRuns(query.idtask, { limit: query.limit });
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnRunIntervalTaskNow(params) {
  let r = { code: 200, data: undefined };
  try {
    const body = params.request.body || {};
    const result = await runNowIntervalTask(body.idtask);

    r.data = result;
    r.code = result.success ? 200 : 400;
    if (result.success) wakeIntervalTaskWorker(params);
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnResetIntervalTaskAttempts(params) {
  let r = { code: 200, data: undefined };
  try {
    const body = params.request.body || {};
    const result = await resetIntervalTaskAttempts(body.idtask);

    r.data = result;
    r.code = result.success ? 200 : 400;
    if (result.success) wakeIntervalTaskWorker(params);
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fndeleteIntervalTask(params) {
  let r = { code: 204, data: undefined };
  try {
    // El body es `{ idtask }` con un id o un array de ids. Antes se pasaba el
    // body entero como valor del `where`, lo que obligaba a enviar el id pelado
    // y hacía imposible declarar un json_schema de objeto para la tool MCP.
    // Se acepta el body crudo como respaldo para los clientes HTTP antiguos.
    const body = params.request.body;
    const idtask =
      body && typeof body === "object" && !Array.isArray(body) ? body.idtask : body;

    r.data = await deleteIntervalTask(idtask);
    r.code = 200;
    if (r.data) wakeIntervalTaskWorker(params);
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}
