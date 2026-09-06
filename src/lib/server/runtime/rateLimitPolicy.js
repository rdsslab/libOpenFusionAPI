/**
 * @file rateLimitPolicy.js
 * @description Clasificación de intentos de autenticación fallidos y cálculo de
 * lockout. Módulo puro, idéntico en espíritu a `bot-manager/failurePolicy.js`:
 * no toca BBDD ni hooks, de modo que se puede probar en aislamiento
 * (ver dev/test/rate_limit_policy_test.js).
 *
 * Un request 401 sobre un endpoint con `access > 0` cuenta como "posible ataque":
 * fuerza bruta sobre el inicio de sesión. Tras una racha de fallos consecutivos de
 * la misma IP (y, si se conoce, el mismo usuario), la entrada entra en lockout con
 * backoff exponencial. Mientras está bloqueada, el preValidation responde 429 con
 * `Retry-After` evitando llegar siquiera a comparar las credenciales.
 */

/** Máximo de fallos consecutivos admitidos antes del primer lockout. */
export const AUTH_MAX_FAILURES_DEFAULT = 5;

/** Base del backoff exponencial del lockout (milisegundos). */
export const AUTH_LOCKOUT_BASE_MS_DEFAULT = 5 * 1000;

/** Techo del backoff exponencial del lockout (24 h). */
export const AUTH_LOCKOUT_MAX_MS_DEFAULT = 24 * 60 * 60 * 1000;

/** Ancho de la ventana deslizante para contar fallos (milisegundos). */
export const AUTH_WINDOW_MS_DEFAULT = 10 * 60 * 1000;

/** Borrado de entradas inactivas para no crecer indefinidamente en memoria. */
export const AUTH_PRUNING_AGE_MS_DEFAULT = 24 * 60 * 60 * 1000;

/** Segundos que se anuncian por defecto en `Retry-After`. */
export const RETRY_AFTER_DEFAULT_SECONDS = 30;

/**
 * Normaliza el número de fallos admitidos leyéndolo de una env var.
 * @param {string|number|undefined} raw
 * @param {number} fallback
 */
export function parsePositiveInt(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/**
 * Backoff exponencial puro (sin jitter) para el lockout.
 *
 * @param {number} consecutiveFailures número de fallos consecutivos ya registrados
 * @param {{baseMs?: number, maxMs?: number}} [opts]
 * @returns {number} milisegundos de duración del bloqueo
 */
export function lockoutDurationMs(
  consecutiveFailures,
  { baseMs = AUTH_LOCKOUT_BASE_MS_DEFAULT, maxMs = AUTH_LOCKOUT_MAX_MS_DEFAULT } = {}
) {
  const n = Math.max(1, Math.floor(Number(consecutiveFailures) || 1));
  const exponent = Math.min(n - 1, 32); // evita Infinity en rachas largas
  return Math.min(maxMs, baseMs * Math.pow(2, exponent));
}

/**
 * Determina si la entrada lleva demasiado tiempo sin actividad como para seguir
 * manteniéndola en memoria. Útil para el pruning periódico.
 *
 * @param {{lastAt: number}} entry
 * @param {number} nowMs
 * @param {number} maxAgeMs
 */
export function isEntryExpired(entry, nowMs, maxAgeMs) {
  return nowMs - entry.lastAt > maxAgeMs;
}

/**
 * Extrae el nombre de usuario de un header de autorización Basic.
 *
 * @param {object} request request de Fastify
 * @returns {string|undefined} username o undefined si no hay credenciales Basic
 */
export function getBasicUsernameFromRequest(request) {
  const header = request?.headers?.authorization;
  if (typeof header !== "string" || !header.startsWith("Basic ")) {
    return undefined;
  }

  try {
    const encoded = header.slice("Basic ".length).trim();
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const index = decoded.indexOf(":");
    if (index >= 0) {
      return decoded.slice(0, index);
    }
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}