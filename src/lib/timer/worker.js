import { parentPort } from "worker_threads";
import { createLogEntriesBulk } from "../db/log.js";
import { LogBuffer } from "./logBuffer.js";
import {
  getIntervalTaskProcess,
  getNextIntervalTaskRun,
  updateIntervalTaskStatus,
  reapStaleRunningTasks,
  rescheduleIntervalTask,
  LOTE_TAREAS_POR_DEFECTO,
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
  debeDrenarLote,
} from "./schedule.js";
import { getResponseOutcome } from "./responseOutcome.js";
import { limiteDesdeEntorno } from "../db/concurrency.js";

import { performance } from "perf_hooks";
import { getSystemToken } from "../server/auth.js";
import { URLAutoEnvironment } from "../server/functionVars.js";

const fetchOFAPI = new URLAutoEnvironment({ environment: "no_env" });
/** Tareas que este worker tiene en vuelo ahora mismo. */
const running = new Set();

/**
 * Controladores de aborto de las corridas en vuelo, por idtask.
 *
 * `running` solo sabe que una corrida está viva en este worker; esto además permite
 * abortarla. El idtask es la clave porque el worker tiene una sola corrida por tarea
 * en vuelo (`running` es un Set).
 *
 * La entrada existe únicamente mientras el fetch está pendiente: se registra justo
 * antes de llamar y se borra en cuanto la llamada resuelve o rechaza. Si llega una
 * orden de stop con la entrada ya borrada, la corrida no está en vuelo: terminó y está
 * escribiendo su resultado, y abortarla no significaría nada.
 *
 * @type {Map<string, import("node:worker_threads").AbortController>}
 */
const runAbort = new Map();

/**
 * idtask de las corridas que se abortan POR ORDEN DEL OPERADOR
 * (`stop_interval_task_run`). Distingue en el `catch` un aborto pedido de un timeout
 * propio: un aborto del operador queda registrado como estado ABORTED y no se castiga
 * con backoff, mientras que un timeout es TIMEOUT y sí.
 */
const abortedByOperator = new Set();

/**
 * Verbos que el cliente saliente implementa. Deliberadamente explícita: listar lo que
 * este worker NO puede hacer es la información que evita que alguien configure una
 * tarea que va a fallar en cada corrida. `endpoint_upsert` admite HEAD y OPTIONS, así
 * que un endpoint con esos verbos puede existir y ser el destino de una tarea.
 */
const SUPPORTED_TASK_VERBS = ["get", "post", "put", "patch", "delete", "query"];

/** Evita que un ciclo lento haga que se solapen los ticks del `setInterval`. */
let tickInProgress = false;
let tickTimer = null;
let wakePending = false;
let shuttingDown = false;

/**
 * Cuántas tareas vencidas se traen en un viaje.
 *
 * **No es un tope de ejecuciones.** El worker lanza todas las que le traiga: cada tarea
 * va a su propio destino y muchas veces a una base de datos distinta, así que acotar
 * cuántas arrancan a la vez las retrasaría, que es justo lo que no se quiere. Lo acotado
 * es el trabajo por ciclo, y lo que no cabe entra en el siguiente, que sale de
 * inmediato en vez de al sonar el próximo vencimiento (`debeDrenarLote`).
 *
 * El valor se lee del entorno porque depende del despliegue: con 200 tareas vencidas a
 * la vez el lote rara vez se llena, y con miles el drenaje encadena ciclos seguidos.
 */
const LOTE_TAREAS = limiteDesdeEntorno("OFAPI_TASK_BATCH_SIZE", LOTE_TAREAS_POR_DEFECTO);

/**
 * Cuántos ciclos seguidos pueden encadenarse sin dormir.
 *
 * El drenaje ya se detiene solo cuando un ciclo no avanza —`debeDrenarLote`— y cada
 * lanzamiento saca una tarea del conjunto elegible. Este tope está para el caso que eso
 * no cubre: un lote que se llena **solo** de tareas cuya transición de estado falla una
 * y otra vez, que se releen igual porque su `next_run` no se movió. Sin tope, ese
 * ciclo pediría las mismas 200 tareas sin parar, y no por tener muchas sino por no
 * avanzar con ninguna.
 *
 * Con 200 y lotes de 200 son 40 000 lanzamientos antes de parar, muy por encima de lo
 * que necesita un drenaje legítimo, y por debajo de lo que se nota como un bucle.
 */
const MAX_DRENAJES_CONSECUTIVOS = 200;

let drenajesConsecutivos = 0;

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

      case "abortRun": {
        // Stop selectivo de una corrida en vuelo (`stop_interval_task_run`). Solo puede
        // abortar la que este worker tiene pendiente: `runAbort` guarda el controller
        // mientras el fetch no resuelve. El ack es sincero: `stopped` dice si había una
        // corrida que abortar, no si el operador la pidió.
        const idtask = String(data_json.idtask ?? "");
        const entry = runAbort.get(idtask);

        if (!entry) {
          parentPort.postMessage(
            JSON.stringify({
              action: "abortRunResult",
              idtask,
              stopped: false,
              reason: "NOT_RUNNING",
            }),
          );
          break;
        }

        abortedByOperator.add(idtask);
        entry.abort();
        parentPort.postMessage(
          JSON.stringify({ action: "abortRunResult", idtask, stopped: true }),
        );
        break;
      }

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
 * - Endpoints de la app `system`: el token de sistema emitido en memoria
 *   (`getSystemToken`), único que `check_auth_Bearer` acepta para esa app.
 * - Resto de apps: el token de la ApiKey configurada en la tarea, que es la vía que la
 *   política de autorización ya admite (compara `apikey.idapp` con el de la app).
 *
 * @returns {Promise<string|null>}
 */
async function resolveAuthToken(task) {
  if (task.app === "system") {
    return getSystemToken() || null;
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

  const transition = await updateIntervalTaskStatus(
    task.idtask,
    status,
    result,
    duration_ms,
  );

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
    ...(transition?.runtime || {}),
  });
}

async function runFetchTask(task, runningState = {}) {
  const started_at = runningState.last_run || new Date();
  const start = performance.now();
  const key = String(task.idtask);

  // Cada corrida empieza limpia: un aborto del operador pertenece a este fetch y no
  // puede arrastrarse a la siguiente ejecución de la misma tarea.
  abortedByOperator.delete(key);

  emitTaskEvent({
    idtask: task.idtask,
    idapp: task.idapp,
    app: task.app,
    url: task.url,
    status: TASK_STATUS.RUNNING,
    started_at,
    ...runningState,
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

    // El cliente saliente no implementa todos los verbos HTTP. `task.method` viene del
    // endpoint, y `endpoint_upsert` admite HEAD y OPTIONS, así que una tarea puede
    // apuntar a un endpoint cuyo verbo este cliente no tiene. Sin esta comprobación la
    // llamada fallaría con `uF[task.method.toLowerCase()] is not a function`, un mensaje
    // que no dice qué está mal ni qué verbos sí valen.
    const verb = String(task.method).toLowerCase();
    if (typeof uF[verb] !== "function") {
      await finishTask(task, {
        status: TASK_STATUS.ERROR,
        result: {
          error:
            `Unsupported method ${task.method} for an interval task. ` +
            `Supported: ${SUPPORTED_TASK_VERBS.join(", ")}.`,
          access: task.access,
        },
        started_at,
        error: `Unsupported method ${task.method} for an interval task`,
      });
      return;
    }

    // La corrida entra en vuelo: se registra el controller para que un stop selectivo
    // (`abortRun`) pueda cortar este fetch. La entrada se borra en cuanto la llamada
    // resuelve o rechaza —un stop que llegue después ya no tiene nada que abortar, la
    // corrida está cerrando y no en vuelo—.
    const controller = new AbortController();
    runAbort.set(key, controller);

    let resp_task;
    try {
      resp_task = await uF[verb]({
        data,
        headers,
        timeout,
        // uFetch solo reenvía `signal` como parte de `options` (la propiedad a nivel
        // raíz de la llamada se descarta: `get/post/...` destructurean url/data/headers/
        // options/body/timeout). Sin `options.signal`, un stop selectivo llamaba a
        // `controller.abort()` pero el fetch pendiente nunca se enteraba: la corrida
        // seguía hasta el `exec_time_limit` y se registraba TIMEOUT en vez de ABORTED —
        // el ack del worker llegaba con `stopped: true` aun sin haber cortado nada.
        options: { signal: controller.signal },
      });
    } finally {
      runAbort.delete(key);
    }

    const duration_ms = performance.now() - start;

    if (resp_task.status === 200) {
      const contentType = resp_task.headers.get("Content-Type") || "?";
      let responseData;
      if (contentType.includes("json")) {
        responseData = await resp_task.json();
      } else {
        responseData = await resp_task.text();
      }

      const outcome = getResponseOutcome(responseData);

      await finishTask(task, {
        status: outcome.success ? TASK_STATUS.DONE : TASK_STATUS.ERROR,
        result: responseData,
        duration_ms,
        http_status: resp_task.status,
        started_at,
        error: outcome.error,
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
    // Un aborto por stop selectivo llega como AbortError, igual que un timeout propio:
    // hay que distinguir quién cortó antes de decidir el estado. El operador queda como
    // ABORTED y sin castigo de backoff; el timeout como TIMEOUT con su reintento
    // creciente. Lo distingue `abortedByOperator`, que solo marca el `abortRun` real.
    const operatorAbort = abortedByOperator.has(key);
    const duration_ms = performance.now() - start;
    const timedOut = isTimeoutError(error);

    if (!timedOut && !operatorAbort) console.error("Error:", error);

    await finishTask(task, {
      status: operatorAbort
        ? TASK_STATUS.ABORTED
        : timedOut
          ? TASK_STATUS.TIMEOUT
          : TASK_STATUS.ERROR,
      result: operatorAbort
        ? { error: "Stopped by operator" }
        : timedOut
          ? { error: `Execution exceeded exec_time_limit (${task.exec_time_limit}s)` }
          : { error: error.message },
      duration_ms,
      started_at,
      error: operatorAbort ? "Stopped by operator" : error.message,
    });
  } finally {
    // El aborto del operador pertenece a esta corrida: se limpia siempre, corra bien o
    // mal, para que la siguiente ejecución de la misma tarea empiece limpia.
    abortedByOperator.delete(key);
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
  // Para el drenaje. `lanzadas` se cuenta al arrancar, de forma síncrona: contarlas en el
  // `then` de la transición no serviría, porque su `.then` corre después de que termine
  // el bucle y la decisión de drenar se toma ahí mismo.
  let lanzadas = 0;
  let reprogramadas = 0;
  let drena = false;

  try {
    await reapStaleRunningTasks();

    const app_tasks = await getIntervalTaskProcess({ limite: LOTE_TAREAS });
    const now = new Date();

    for (const task of app_tasks) {
      const decision = canRun(task, now);

      if (!decision.run) {
        // Fuera de la ventana la tarea seguiría vencida en cada ciclo: se reprograma al
        // siguiente hueco válido en lugar de reevaluarla cada 10 s. No se toca el estado
        // ni el contador de fallos, que no tienen nada que ver con el horario.
        if (decision.reason === "outside execution window") {
          if (await rescheduleIntervalTask(task)) reprogramadas++;
        }
        continue;
      }

      const key = String(task.idtask);
      running.add(key);
      lanzadas++;

      // La fila se pasa tal cual: el ciclo se la acaba de traer con el endpoint y la app
      // para decidir esto mismo, y releerla aquí era un viaje entero en el camino que
      // retarda el arranque de cada ejecución. Ver `updateIntervalTaskStatus`.
      updateIntervalTaskStatus(task.idtask, TASK_STATUS.RUNNING, undefined, undefined, task)
        .then((transition) => runFetchTask(task, transition?.runtime))
        .catch((error) => {
          console.error("Error running interval task", task.idtask, error);
        })
        .finally(() => {
          running.delete(key);
        });
    }

    drena =
      debeDrenarLote({
        llevo: app_tasks.length,
        limite: LOTE_TAREAS,
        lanzadas,
        reprogramadas,
      }) && drenajesConsecutivos < MAX_DRENAJES_CONSECUTIVOS;

    if (drenajesConsecutivos >= MAX_DRENAJES_CONSECUTIVOS) {
      console.warn(
        `[interval-tasks] se alcanzó el tope de ${MAX_DRENAJES_CONSECUTIVOS} drenajes seguidos sin ` +
          "dormir; el próximo ciclo esperará al vencimiento. Suele significar que el lote se llena " +
          "siempre de tareas que no avanzan, no que haya muchas tareas.",
      );
    }

    drenajesConsecutivos = drena ? drenajesConsecutivos + 1 : 0;
  } catch (error) {
    console.error("Error en el ciclo de interval tasks:", error);
    drenajesConsecutivos = 0;
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
    } else if (drena) {
      // Quedaban tareas y este ciclo avanzó: hay más, así que no se duerme. Las tareas
      // que no cupieron salen en este mismo instante, no al siguiente vencimiento.
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
