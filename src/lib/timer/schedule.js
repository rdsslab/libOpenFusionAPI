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
import { DateTime } from "luxon";

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

/** Cuántos disparos de cron se prueban antes de rendirse al buscar uno dentro de la ventana. */
const MAX_CRON_LOOKAHEAD = 500;

/** Intervalo mínimo aceptable, para no entrar en un bucle de milisegundos. */
const MIN_INTERVAL_SECONDS = 1;

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
  const delay = Math.min(base * Math.pow(2, attempts - 1), MAX_BACKOFF_SECONDS);

  return nextWindowStart(task, new Date(from.getTime() + delay * 1000));
}

/**
 * ¿La tarea agotó sus reintentos y debe deshabilitarse?
 * @param {object} task
 * @param {number} failedAttempts
 * @returns {boolean}
 */
export function shouldDisableForFailures(task, failedAttempts) {
  const max = Number(task?.max_failed_attempts);
  const limit = Number.isFinite(max) && max > 0 ? max : 10;
  return Number(failedAttempts) >= limit;
}

/**
 * Valida una expresión cron.
 * @returns {{valid: boolean, error?: string}}
 */
export function validateCron(expression, timezone) {
  try {
    CronExpressionParser.parse(expression, { tz: timezone || undefined });
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error?.message || String(error) };
  }
}
