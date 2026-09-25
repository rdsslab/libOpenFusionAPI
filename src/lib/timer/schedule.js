/**
 * @file schedule.js
 * @description Cálculo de la próxima ejecución de una `IntervalTask`.
 *
 * Antes `next_run` se calculaba como `now + interval` en el momento de arrancar la
 * tarea, así que cada ciclo se desplazaba por el retraso del tick (10 s) más lo que
 * hubiera tardado la ejecución anterior: un "cada 300 s" se convertía en la práctica en
 * "cada 300 s + deriva acumulada". Aquí el horario se ancla al planificado, no al reloj
 * del momento.
 *
 * Módulo puro: no toca base de datos ni red, así que se puede probar aislado.
 */

import { CronExpressionParser } from "cron-parser";
import { DateTime, IANAZone } from "luxon";

/** Estados de una tarea, compartidos por el worker, el DAO y el GUI. */
export const TASK_STATUS = {
  WAITING: 0,
  RUNNING: 1,
  DONE: 2,
  ERROR: 3,
  TIMEOUT: 4,
};

/** Tope del backoff exponencial: no esperar más de una hora entre reintentos. */
const MAX_BACKOFF_SECONDS = 3600;

/**
 * Tope de fallos consecutivos cuando la tarea no define `max_failed_attempts`.
 * Debe coincidir con el `defaultValue` de la columna en `models.js` y con
 * `default_max_failed_attempts` en `docs/interval_tasks/manifest.json`.
 */
const MAX_FAILED_ATTEMPTS_DEFAULT = 10;

/**
 * Tope duro de `max_backoff_seconds` por tarea (30 días). Solo existe para atrapar
 * erratas: un valor disparatado produciría un `next_run` tan lejano que la tarea
 * parece borrada. Deliberadamente NO se usa `MAX_SCHEDULER_DELAY_MS`, que es el
 * intervalo de sondeo del worker (60 s) y nada tiene que ver con la separación
 * entre reintentos.
 */
const HARD_MAX_BACKOFF_SECONDS = 30 * 24 * 3600;

/** Cuántos disparos de cron se prueban antes de rendirse al buscar uno dentro de la ventana. */
const MAX_CRON_LOOKAHEAD = 500;

/** Intervalo mínimo aceptable, para no entrar en un bucle de milisegundos. */
const MIN_INTERVAL_SECONDS = 1;

/** Límites del heartbeat adaptativo del worker. */
export const MIN_SCHEDULER_DELAY_MS = 250;
export const MAX_SCHEDULER_DELAY_MS = 60000;

/**
 * Espera hasta el próximo vencimiento, acotada para detectar cambios externos y tareas
 * abandonadas aunque ninguna operación de esta instancia despierte al worker.
 */
export function computeSchedulerDelay(nextRun, now = new Date()) {
  if (!nextRun) return MAX_SCHEDULER_DELAY_MS;

  const target = new Date(nextRun);
  if (Number.isNaN(target.getTime())) return MIN_SCHEDULER_DELAY_MS;

  return Math.min(
    MAX_SCHEDULER_DELAY_MS,
    Math.max(MIN_SCHEDULER_DELAY_MS, target.getTime() - now.getTime()),
  );
}

/**
 * Segundos de intervalo saneados de una tarea.
 * @param {object} task
 * @returns {number}
 */
export function getIntervalSeconds(task) {
  const seconds = Number(task?.interval);
  return Number.isFinite(seconds) && seconds >= MIN_INTERVAL_SECONDS
    ? Math.floor(seconds)
    : 300;
}

/** @returns {boolean} true si la tarea se planifica por expresión cron. */
export function isCronTask(task) {
  return task?.schedule_mode === "cron" && !!task?.cron;
}

/**
 * Convierte `"HH:MM"` en minutos desde medianoche.
 * @returns {number|null} null si el valor no es válido
 */
function parseHHMM(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Días permitidos como Set de 1..7 (1 = lunes, 7 = domingo, igual que luxon).
 * @returns {Set<number>|null} null si no hay restricción
 */
function parseWindowDays(value) {
  if (!value) return null;
  const days = String(value)
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  return days.length > 0 ? new Set(days) : null;
}

/** Zona horaria efectiva de la tarea (la del servidor si no se configuró ninguna). */
function zoneOf(task) {
  return task?.timezone || undefined;
}

function toDateTime(task, date) {
  const zone = zoneOf(task);
  return zone
    ? DateTime.fromJSDate(date, { zone })
    : DateTime.fromJSDate(date);
}

/**
 * ¿El instante cae dentro de la ventana horaria y los días permitidos de la tarea?
 * Una ventana con inicio mayor que el fin (p.ej. 22:00–06:00) cruza la medianoche.
 *
 * @param {object} task
 * @param {Date} [date]
 * @returns {boolean}
 */
export function isWithinWindow(task, date = new Date()) {
  const days = parseWindowDays(task?.window_days);
  const start = parseHHMM(task?.window_start);
  const end = parseHHMM(task?.window_end);

  if (!days && start === null && end === null) return true;

  const dt = toDateTime(task, date);
  if (days && !days.has(dt.weekday)) return false;
  if (start === null || end === null) return true;

  const minutes = dt.hour * 60 + dt.minute;

  if (start === end) return true;
  if (start < end) return minutes >= start && minutes < end;

  // Ventana que cruza medianoche.
  return minutes >= start || minutes < end;
}

/**
 * Primer instante válido de la ventana a partir de `from` (incluido).
 * Si no hay ventana configurada devuelve `from` tal cual.
 *
 * @param {object} task
 * @param {Date} from
 * @returns {Date}
 */
export function nextWindowStart(task, from) {
  if (isWithinWindow(task, from)) return from;

  const days = parseWindowDays(task?.window_days);
  const start = parseHHMM(task?.window_start);

  let dt = toDateTime(task, from);

  // Sin hora de inicio solo hay filtro por día: saltar al comienzo del próximo día válido.
  if (start === null) {
    for (let i = 0; i < 8; i++) {
      dt = dt.plus({ days: 1 }).startOf("day");
      if (!days || days.has(dt.weekday)) return dt.toJSDate();
    }
    return from;
  }

  let candidate = dt.startOf("day").plus({ minutes: start });
  if (candidate <= dt) candidate = candidate.plus({ days: 1 });

  // Como mucho una semana por delante: siempre hay un día válido en ese rango.
  for (let i = 0; i < 8; i++) {
    if (!days || days.has(candidate.weekday)) return candidate.toJSDate();
    candidate = candidate.plus({ days: 1 });
  }

  return candidate.toJSDate();
}

/**
 * Próximo disparo de la expresión cron posterior a `from`.
 * @returns {Date|null} null si la expresión no es válida
 */
function nextCronDate(task, from) {
  try {
    const interval = CronExpressionParser.parse(task.cron, {
      currentDate: from,
      tz: zoneOf(task),
    });
    return interval.next().toDate();
  } catch (error) {
    return null;
  }
}

/**
 * Próximo disparo de cron que además caiga dentro de la ventana.
 * Si ninguno de los `MAX_CRON_LOOKAHEAD` siguientes encaja, se conforma con el primero
 * posterior al inicio de la ventana.
 */
function nextCronDateInWindow(task, from) {
  try {
    const interval = CronExpressionParser.parse(task.cron, {
      currentDate: from,
      tz: zoneOf(task),
    });

    for (let i = 0; i < MAX_CRON_LOOKAHEAD; i++) {
      const candidate = interval.next().toDate();
      if (isWithinWindow(task, candidate)) return candidate;
    }
  } catch (error) {
    return null;
  }

  const windowStart = nextWindowStart(task, from);
  return nextCronDate(task, new Date(windowStart.getTime() - 1)) || windowStart;
}

/**
 * Distancia típica entre dos disparos de la tarea, en segundos. Para tareas cron se
 * mide el hueco entre los dos próximos disparos; sirve de base al backoff.
 */
function baseSpacingSeconds(task, from) {
  if (!isCronTask(task)) return getIntervalSeconds(task);

  try {
    const interval = CronExpressionParser.parse(task.cron, {
      currentDate: from,
      tz: zoneOf(task),
    });
    const first = interval.next().toDate();
    const second = interval.next().toDate();
    const seconds = Math.round((second - first) / 1000);
    return seconds > 0 ? seconds : 60;
  } catch (error) {
    return 60;
  }
}

/**
 * Próxima ejecución de la tarea.
 *
 * En modo `interval` el horario se ancla al previsto: se parte del `next_run` anterior
 * y se le suman intervalos completos hasta superar `from`, de modo que un retraso
 * puntual no corre toda la serie. Si no hay referencia previa (tarea nueva) se usa
 * `from + interval`.
 *
 * @param {object} task
 * @param {{from?: Date, anchor?: Date|string|null}} [options]
 * @returns {Date}
 */
export function computeNextRun(task, options = {}) {
  const from = options.from instanceof Date ? options.from : new Date();

  if (isCronTask(task)) {
    return nextCronDateInWindow(task, from) || nextWindowStart(task, from);
  }

  const intervalMs = getIntervalSeconds(task) * 1000;
  const anchorValue =
    options.anchor !== undefined ? options.anchor : task?.next_run;
  const anchor = anchorValue ? new Date(anchorValue) : null;

  let candidate;
  if (anchor && !Number.isNaN(anchor.getTime())) {
    const drift = from.getTime() - anchor.getTime();
    const steps = drift >= 0 ? Math.floor(drift / intervalMs) + 1 : 1;
    candidate = new Date(anchor.getTime() + steps * intervalMs);
  } else {
    candidate = new Date(from.getTime() + intervalMs);
  }

  return nextWindowStart(task, candidate);
}

/**
 * Próxima ejecución tras un fallo: espera creciente `base * 2^(fallos-1)` con tope de
 * una hora. Sustituye al comportamiento anterior, en el que la tarea simplemente dejaba
 * de programarse al tercer fallo.
 *
 * @param {object} task
 * @param {number} failedAttempts fallos consecutivos ya acumulados (incluido el actual)
 * @param {{from?: Date}} [options]
 * @returns {Date}
 */
export function computeBackoffNextRun(task, failedAttempts, options = {}) {
  const from = options.from instanceof Date ? options.from : new Date();
  const attempts = Math.max(1, Number(failedAttempts) || 1);
  const base = baseSpacingSeconds(task, from);

  // `backoff_enabled: false` mantiene el intervalo aunque la tarea falle. Por
  // defecto sigue activo, así que una tarea existente no cambia de comportamiento.
  // Sin esto, un chequeo de monitoreo de 2 min que falla 3 veces pasa a correr
  // cada 8 min, luego 16, luego 32… hasta 1 h: exactamente lo contrario de lo que
  // se quiere cuando el sistema observado está fallando.
  //
  // El salto es un intervalo base, NO cero: `nextWindowStart` sin ventana devuelve
  // el `from` tal cual, y programar la tarea para "ahora" justo después de un fallo
  // la convertiría en un bucle cerrado de reintentos. La ventana se sigue respetando
  // porque el candidate es ahora+intervalo, no ahora.
  if (isBackoffDisabled(task)) {
    return nextWindowStart(task, new Date(from.getTime() + base * 1000));
  }

  const ceiling = resolveMaxBackoffSeconds(task);
  const delay = Math.min(base * Math.pow(2, attempts - 1), ceiling);

  return nextWindowStart(task, new Date(from.getTime() + delay * 1000));
}

/**
 * `backoff_enabled` vale false solo si el usuario lo puso así de forma explícita.
 * `undefined` y `null` significan "no configurado" y mantienen el backoff, que es
 * el comportamiento previo.
 *
 * @param {object} task
 * @returns {boolean}
 */
function isBackoffDisabled(task) {
  const raw = task?.backoff_enabled;
  if (raw === undefined || raw === null) return false;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    return v === "false" || v === "0" || v === "no" || v === "off";
  }
  return raw === false;
}

/**
 * Tope del backoff para esta tarea: `max_backoff_seconds` si está definido y es
 * válido, y el tope global de 1 h en caso contrario.
 *
 * @param {object} task
 * @returns {number}
 */
function resolveMaxBackoffSeconds(task) {
  const raw = Number(task?.max_backoff_seconds);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(raw, HARD_MAX_BACKOFF_SECONDS);
  }
  return MAX_BACKOFF_SECONDS;
}

/**
 * ¿Hay incoherencia entre el presupuesto de la tarea y el timeout del endpoint?
 *
 * `exec_time_limit` es lo que el worker impone a la llamada HTTP y lo que usa el
 * reaper para liberar una tarea que quedó colgada. El `timeout` del endpoint lo
 * impone el propio endpoint, por dentro. Cuando `exec_time_limit >= timeout`, el
 * endpoint siempre responde primero: la tarea nunca llega a vencer por su cuenta,
 * y el reaper nunca entra, porque nunca hay una tarea colgada — solo un endpoint
 * que devolvió su propio 504.
 *
 * El efecto no es que la tarea falle: es que `exec_time_limit` aparenta ser la red
 * de seguridad que no es, y el síntoma que aparece es distinto del que se busca.
 * Quien lea `exec_time_limit: 300` pensando "esta tarea se corta a los 5 minutos"
 * no lo deduce del registro, porque el registro dice 504 del endpoint.
 *
 * Por eso es un aviso y no un rechazo: las dos configuraciones son legales y
 * útiles, solo se pide que sean coherentes. Un margen pequeño (el endpoint cortando
 * un poco antes) es normal y no se avisa.
 *
 * @param {object} task
 * @param {number|undefined|null} endpointTimeoutSeconds
 * @returns {string|null} mensaje de aviso, o null si no hay nada que avisar
 */
export function describeTaskTimeoutMismatch(task, endpointTimeoutSeconds) {
  const endpointTimeout = Number(endpointTimeoutSeconds);
  if (!Number.isFinite(endpointTimeout) || endpointTimeout <= 0) return null;

  const limit = Number(task?.exec_time_limit);
  if (!Number.isFinite(limit) || limit <= 0) return null;

  if (limit < endpointTimeout) return null;

  if (limit === endpointTimeout) {
    return (
      `exec_time_limit (${limit}s) equals the endpoint timeout (${endpointTimeout}s). ` +
      `Both timers will fire, and the endpoint's own 504 is what reaches the task history. ` +
      `Give the task a larger exec_time_limit so the two are distinguishable.`
    );
  }

  return (
    `exec_time_limit (${limit}s) is larger than the endpoint timeout (${endpointTimeout}s), ` +
    `so it can never be the one that stops a run: the endpoint aborts first and the task ` +
    `records a 504 rather than a timeout. Either lower exec_time_limit below ` +
    `${endpointTimeout}s, or raise the endpoint timeout above ${limit}s.`
  );
}

/**
 * ¿La tarea agotó sus reintentos y debe deshabilitarse?
 *
 * `max_failed_attempts: 0` significa explícitamente **nunca deshabilitar**, y es
 * lo que un usuario espera al escribir un 0. Antes caía en el valor por defecto
 * (10) por el `max > 0 ? max : 10`, de modo que un 0 devolvía el comportamiento
 * contrario al buscado y sin ningún aviso.
 *
 * La distinción entre "0 explícito" y "sin configurar" no se puede hacer con
 * `Number()` a secas: `Number(null)`, `Number("")` y `Number(undefined)` dan
 * `NaN` o `0`, y un `null` heredado de una base vieja se confundiría con un 0
 * pedido a propósito — dejando la tarea sin deshabilitarse nunca. Por eso se
 * mira el valor crudo antes de convertirlo.
 *
 * @param {object} task
 * @param {number} failedAttempts
 * @returns {boolean}
 */
export function shouldDisableForFailures(task, failedAttempts) {
  const raw = task?.max_failed_attempts;

  if (raw === undefined || raw === null || raw === "") {
    return Number(failedAttempts) >= MAX_FAILED_ATTEMPTS_DEFAULT;
  }

  const max = Number(raw);
  if (!Number.isFinite(max) || max < 0) {
    return Number(failedAttempts) >= MAX_FAILED_ATTEMPTS_DEFAULT;
  }

  if (max === 0) {
    return false;
  }

  return Number(failedAttempts) >= max;
}

/**
 * Valida una expresión cron.
 * @returns {{valid: boolean, error?: string}}
 */
export function validateCron(expression, timezone) {
  if (timezone && !IANAZone.isValidZone(timezone)) {
    return { valid: false, error: `Invalid IANA timezone: ${timezone}` };
  }

  try {
    CronExpressionParser.parse(expression, { tz: timezone || undefined });
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error?.message || String(error) };
  }
}
