import { parentPort } from "worker_threads";
import { createLogEntriesBulk } from "../db/log.js";
import { LogBuffer } from "./logBuffer.js";
import {
  getIntervalTaskProcess,
  getNextIntervalTaskRun,
  updateIntervalTaskStatus,
  reapStaleRunningTasks,
  rescheduleIntervalTask,
} from "../db/interval_task.js";
import {
  createIntervalTaskRun,
  pruneIntervalTaskRuns,
} from "../db/interval_task_run.js";
import { getApiKeyById } from "../db/apikey.js";
import {
  TASK_STATUS,
  computeSchedulerDelay,
  isWithinWindow,
} from "./schedule.js";

import { performance } from "perf_hooks";
import { URLAutoEnvironment } from "../server/functionVars.js";

const fetchOFAPI = new URLAutoEnvironment({ environment: "no_env" });
/** Tareas que este worker tiene en vuelo ahora mismo. */
const running = new Set();

/** Evita que un ciclo lento haga que se solapen los ticks del `setInterval`. */
let tickInProgress = false;
let tickTimer = null;
let wakePending = false;
let shuttingDown = false;

/** Cache de ApiKeys por idkey: evita una consulta por ejecución. */
const API_KEY_CACHE_TTL_MS = 60000;
const apiKeyCache = new Map();

export const logBuffer = new LogBuffer({
  flushFn: createLogEntriesBulk,
  flushIntervalMs: 10000, // cada 10s
  maxBatchSize: 100, // ajusta según tu DB
  maxBufferSize: 200, // límite de seguridad
});

// Escuchar mensajes desde el hilo principal
parentPort.on("message", (data) => {
  try {
    const data_json = JSON.parse(data);

    switch (data_json.action) {
      case "pushLog":
        logBuffer.push(data_json.data);
        break;

      case "wake":
        scheduleTick(0);
        break;

      case "shutdown":
        shutdown();
        break;

      default:
        console.log("***** Accion no determinada *****", data);
        break;
    }
  } catch (error) {
    console.error("Error en worker:", error, data);
  }
});

/**
 * Publica el estado de una ejecución hacia el hilo principal, que lo reenvía por
 * websocket a los clientes conectados (ver timer/tasks.js e index.js).
 */
function emitTaskEvent(payload) {
  try {
    parentPort.postMessage(
      JSON.stringify({ action: "intervalTaskEvent", data: payload }),
    );
  } catch (error) {
    // Un fallo publicando el evento no debe afectar a la ejecución de la tarea.
  }
}

/**
 * Token con el que se autentica la llamada al endpoint.
 *
 * - Endpoints de la app `system`: el token de sistema que ya crea el arranque
 *   (`CreateOpenFusionAPIToken`), único que `check_auth_Bearer` acepta para esa app.
 * - Resto de apps: el token de la ApiKey configurada en la tarea, que es la vía que la
 *   política de autorización ya admite (compara `apikey.idapp` con el de la app).
 *
 * @returns {Promise<string|null>}
 */
async function resolveAuthToken(task) {
  if (task.app === "system") {
    return process.env.USER_OPENFUSIONAPI_TOKEN || null;
  }

  if (!task.idkey) return null;

  const cached = apiKeyCache.get(String(task.idkey));
  if (cached && cached.expires > Date.now()) return cached.token;

  try {
    const apiKey = await getApiKeyById(task.idkey);
    if (!apiKey || !apiKey.enabled || !apiKey.token) return null;

    const now = new Date();
    if (apiKey.startAt && new Date(apiKey.startAt) > now) return null;
    if (apiKey.endAt && new Date(apiKey.endAt) < now) return null;

    apiKeyCache.set(String(task.idkey), {
      token: apiKey.token,
      expires: Date.now() + API_KEY_CACHE_TTL_MS,
    });

    return apiKey.token;
  } catch (error) {
    console.error("Error resolving api key for task", task.idtask, error);
    return null;
  }
}

/**
 * Traduce `params` a los argumentos de uFetch.
 *
 * Forma actual: `{ data: {...}, headers: {...} }`. `data` se entrega tal cual a uFetch,
 * que ya decide si viaja como query string (GET/HEAD/DELETE) o como cuerpo.
 * Forma heredada: cualquier otro objeto se sigue enviando entero como `data`, para no
 * romper las tareas ya configuradas.
 */
function buildRequestOptions(task) {
  let raw = task.params;

  // En sqlite/mssql el JSON viaja como texto; el DAO ya lo normaliza, pero el worker no
  // depende de ello para no volver a enviar una cadena como payload.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (error) {
      raw = {};
    }
  }

  const params =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  const hasData = Object.prototype.hasOwnProperty.call(params, "data");
  const hasHeaders =
    Object.prototype.hasOwnProperty.call(params, "headers") &&
    params.headers &&
    typeof params.headers === "object";

  return {
    data: hasData ? params.data : hasHeaders ? undefined : params,
    headers: hasHeaders ? params.headers : undefined,
  };
}

/** ¿El error corresponde a la petición abortada por superar `exec_time_limit`? */
function isTimeoutError(error) {
  if (!error) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  return /timed out|timeout/i.test(error.message || "");
}

/**
 * Cierra una ejecución: actualiza la tarea, deja la fila en el historial y publica el
 * evento en vivo.
 */
async function finishTask(task, outcome) {
  const {
    status,
    result,
    duration_ms = 0,
    http_status = null,
    error = null,
    started_at,
  } = outcome;

  await updateIntervalTaskStatus(task.idtask, status, result, duration_ms);

  const historyLimit = Number(task.history_limit);
  if (Number.isFinite(historyLimit) && historyLimit > 0) {
    await createIntervalTaskRun({
      idtask: task.idtask,
      started_at,
      finished_at: new Date(),
      duration_ms,
      status,
      http_status,
      error,
      response: result,
    });
    await pruneIntervalTaskRuns(task.idtask, historyLimit);
  }

  emitTaskEvent({
    idtask: task.idtask,
    idapp: task.idapp,
    app: task.app,
    url: task.url,
    status,
    started_at,
    duration_ms,
    http_status,
    error,
  });
}

async function runFetchTask(task) {
  const started_at = new Date();
  const start = performance.now();

  emitTaskEvent({
    idtask: task.idtask,
    idapp: task.idapp,
    app: task.app,
    url: task.url,
    status: TASK_STATUS.RUNNING,
    started_at,
  });

  try {
    if (!task.method || !task.url) {
      await finishTask(task, {
        status: TASK_STATUS.ERROR,
        result: { error: "Not url or method", task: task },
        started_at,
        error: "Not url or method",
      });
      return;
    }

    const token = await resolveAuthToken(task);

    // Sin token la llamada devolvería un 401 opaco que se repetiría hasta agotar los
    // reintentos: es más útil registrar el motivo real.
    if (!token && Number(task.access) > 0) {
      await finishTask(task, {
        status: TASK_STATUS.ERROR,
        result: {
          error:
            "Missing credentials: assign an enabled ApiKey (idkey) to this task",
          access: task.access,
        },
        started_at,
        error: "Missing credentials (idkey)",
      });
      return;
    }

    const { data, headers } = buildRequestOptions(task);
    const timeout = Number(task.exec_time_limit || 30) * 1000;

    const uF = fetchOFAPI.create(task.url, false);
    if (token) uF.setBearerAuthorization(token);

    const resp_task = await uF[task.method.toLowerCase()]({
      data,
      headers,
      timeout,
    });

    const duration_ms = performance.now() - start;

    if (resp_task.status === 200) {
      const contentType = resp_task.headers.get("Content-Type") || "?";
      let responseData;
      if (contentType.includes("json")) {
        responseData = await resp_task.json();
      } else {
        responseData = await resp_task.text();
      }

      await finishTask(task, {
        status: TASK_STATUS.DONE,
        result: responseData,
        duration_ms,
        http_status: resp_task.status,
        started_at,
      });
    } else {
      // Una credencial revocada devuelve 401/403: se descarta la cache para que el
      // siguiente ciclo relea la ApiKey en vez de reintentar con la caducada.
      if (
        (resp_task.status === 401 || resp_task.status === 403) &&
        task.idkey
      ) {
        apiKeyCache.delete(String(task.idkey));
      }

      await finishTask(task, {
        status: TASK_STATUS.ERROR,
        result: { status: resp_task.status, error: resp_task.statusText },
        duration_ms,
        http_status: resp_task.status,
        started_at,
        error: `HTTP ${resp_task.status} ${resp_task.statusText || ""}`.trim(),
      });
    }
  } catch (error) {
    const duration_ms = performance.now() - start;
    const timedOut = isTimeoutError(error);

    if (!timedOut) console.error("Error:", error);

    await finishTask(task, {
      status: timedOut ? TASK_STATUS.TIMEOUT : TASK_STATUS.ERROR,
      result: {
        error: timedOut
          ? `Execution exceeded exec_time_limit (${task.exec_time_limit}s)`
          : error.message,
      },
      duration_ms,
      started_at,
      error: error.message,
    });
  }
}

/**
 * ¿Se puede lanzar esta tarea en este ciclo?
 * @returns {{run: boolean, reason?: string}}
 */
function canRun(task, now) {
  const allowConcurrent = !!task.allow_concurrent;

  if (running.has(String(task.idtask)) && !allowConcurrent) {
    return { run: false, reason: "already running in this worker" };
  }

  // El estado 1 puede venir de otro proceso o de una corrida abandonada; en ese caso la
  // libera `reapStaleRunningTasks` al superar `exec_time_limit`.
  if (task.status === TASK_STATUS.RUNNING && !allowConcurrent) {
    return { run: false, reason: "task marked as running" };
  }

  if (!isWithinWindow(task, now)) {
    return { run: false, reason: "outside execution window" };
  }

  return { run: true };
}

async function tick() {
  if (tickInProgress) {
    wakePending = true;
    return;
  }
  tickInProgress = true;

  try {
    await reapStaleRunningTasks();

    const app_tasks = await getIntervalTaskProcess();
    const now = new Date();

    for (const task of app_tasks) {
      const decision = canRun(task, now);

      if (!decision.run) {
        // Fuera de la ventana la tarea seguiría vencida en cada ciclo: se reprograma al
        // siguiente hueco válido en lugar de reevaluarla cada 10 s. No se toca el estado
        // ni el contador de fallos, que no tienen nada que ver con el horario.
        if (decision.reason === "outside execution window") {
          await rescheduleIntervalTask(task);
        }
        continue;
      }

      const key = String(task.idtask);
      running.add(key);

      updateIntervalTaskStatus(task.idtask, TASK_STATUS.RUNNING)
        .then(() => runFetchTask(task))
        .catch((error) => {
          console.error("Error running interval task", task.idtask, error);
        })
        .finally(() => {
          running.delete(key);
        });
    }
  } catch (error) {
    console.error("Error en el ciclo de interval tasks:", error);
  } finally {
    let nextDelay;
    try {
      const nextRun = await getNextIntervalTaskRun();
      nextDelay = computeSchedulerDelay(nextRun);
    } catch (error) {
      console.error("Error calculating next interval task wake-up:", error);
      nextDelay = computeSchedulerDelay(null);
    }

    tickInProgress = false;
    if (wakePending) {
      wakePending = false;
      scheduleTick(0);
    } else {
      scheduleTick(nextDelay);
    }
  }
}

function scheduleTick(delayMs) {
  if (shuttingDown) return;
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = setTimeout(() => {
    tickTimer = null;
    tick();
  }, Math.max(0, Number(delayMs) || 0));
}

scheduleTick(0);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (tickTimer) clearTimeout(tickTimer);

  try {
    await logBuffer.stop({ flush: true });
  } finally {
    process.exit(0);
  }
}

// Mantén el proceso vivo escuchando mensajes
parentPort.on("message", (msg) => {
  if (msg === "stop") {
    //process.exit(0)
    console.log("Worker parentPort STOP");
  }
});

process.on("SIGINT", async () => {
  await shutdown();
});
process.on("SIGTERM", async () => {
  await shutdown();
});
