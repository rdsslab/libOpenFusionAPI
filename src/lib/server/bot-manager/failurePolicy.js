/**
 * @file failurePolicy.js
 * @description Política de fallos y reintentos de los bots. Módulo puro: no toca BBDD,
 * ni workers, ni el EventEmitter del manager, de modo que se puede probar en aislamiento
 * (ver dev/test/bot_failure_policy_test.js).
 *
 * Principio de diseño: `enabled` es la INTENCIÓN del usuario y el sistema no la pisa por
 * un problema operativo. Un fallo recuperable (red, DNS, 429, 5xx del proveedor) nunca
 * deshabilita: se reintenta con backoff exponencial y jitter, y si la racha se alarga el
 * bot pasa a cuarentena, donde se lo sigue sondeando cada 15/30/60 minutos INDEFINIDAMENTE.
 * Ese sondeo es lo que permite que un bot se recupere solo cuando vuelve la red, sin que
 * nadie tenga que re-habilitarlo a mano.
 *
 * Solo un fallo permanente (token revocado, código que no compila) deshabilita la fila:
 * ahí reintentar es desperdicio puro y hace falta que alguien corrija la causa.
 */

/** Clases de fallo. */
export const FAILURE_CLASS = Object.freeze({
  /** No se arregla solo: hace falta corregir token o código. */
  PERMANENT: "PERMANENT",
  /** Se arregla solo cuando el entorno se recupera. Nunca deshabilita. */
  TRANSIENT: "TRANSIENT",
  /** No clasificado. Se trata como transitorio, pero escala a cuarentena más rápido. */
  UNKNOWN: "UNKNOWN",
});

/** Estados de runtime persistidos en `ofapi_bot.runtime_status`. */
export const RUNTIME_STATUS = Object.freeze({
  STOPPED: "STOPPED",
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  BACKOFF: "BACKOFF",
  QUARANTINED: "QUARANTINED",
  DISABLED_ERROR: "DISABLED_ERROR",
});

/** Niveles de backoff. */
export const BACKOFF_TIER = Object.freeze({
  FAST: "FAST",
  QUARANTINE: "QUARANTINE",
});

// ────────────────────────────────────────────────────────────
// Constantes de política
// ────────────────────────────────────────────────────────────

/** Fallos permanentes consecutivos antes de escribir `enabled = false`. */
export const PERMANENT_DISABLE_ATTEMPTS = 3;

/** Fallos recuperables consecutivos antes de pasar a cuarentena (sondeo lento). */
export const QUARANTINE_AFTER_ATTEMPTS = 8;

/** Un fallo sin clasificar escala a cuarentena antes: no reintentamos en caliente algo que no entendemos. */
export const QUARANTINE_AFTER_ATTEMPTS_UNKNOWN = 4;

/**
 * Tiempo que un bot debe permanecer arriba para considerar el arranque consolidado y
 * limpiar la racha de fallos. Sin esta ventana, un bot que arranca y muere a los 2
 * segundos en bucle resetea su historial en cada `STARTED` y nunca cruza ningún umbral:
 * el caso que más merece atención sería el único invisible. Es el mismo criterio que usa
 * Kubernetes para resetear el backoff de un CrashLoopBackOff.
 */
export const BOT_HEALTHY_AFTER_MS = 60 * 1000;

const FAST_BASE_MS = 10 * 1000;
const FAST_CAP_MS = 5 * 60 * 1000;
const QUARANTINE_BASE_MS = 15 * 60 * 1000;
const QUARANTINE_CAP_MS = 60 * 60 * 1000;

// ────────────────────────────────────────────────────────────
// Taxonomía de errores
// ────────────────────────────────────────────────────────────

/** Códigos de error de red de Node: el host o el DNS fallaron, no el bot. */
const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EADDRNOTAVAIL",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
]);

/** `errorType` reportados por el worker que nunca se arreglan reintentando. */
const PERMANENT_ERROR_TYPES = new Set([
  "INVALID_TOKEN",
  "INVALID_DATA",
  "CODE_ERROR",
  "FORBIDDEN",
]);

/** `errorType` reportados por el worker que se arreglan cuando el entorno se recupera. */
const TRANSIENT_ERROR_TYPES = new Set([
  "CONNECTION_ERROR",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
]);

/** Nombres de error de JS que indican código inválido, no un problema de entorno. */
const CODE_ERROR_NAMES = new Set(["SyntaxError", "ReferenceError"]);

/**
 * Clasifica un fallo de bot para decidir si se reintenta o si hace falta intervención.
 *
 * Se apoya en varias señales porque ninguna basta sola: el `errorType` que calcula el
 * worker es la principal, pero un error puede llegar desde el crash del worker o desde
 * el `exit` sin haber pasado por esa clasificación.
 *
 * @param {Object} [errorInfo] payload de error tal como lo emite el worker o el manager
 * @param {string} [errorInfo.errorType]
 * @param {string} [errorInfo.name]      nombre del error JS original
 * @param {string} [errorInfo.code]      código de error de Node (`ECONNRESET`, ...)
 * @param {number} [errorInfo.status]    status HTTP del proveedor
 * @param {string} [errorInfo.message]
 * @returns {string} valor de FAILURE_CLASS
 */
export function classifyBotFailure(errorInfo) {
  const info = errorInfo || {};
  const errorType = info.errorType ? String(info.errorType) : "";

  if (PERMANENT_ERROR_TYPES.has(errorType)) return FAILURE_CLASS.PERMANENT;
  if (TRANSIENT_ERROR_TYPES.has(errorType)) return FAILURE_CLASS.TRANSIENT;

  const code = info.code ? String(info.code).toUpperCase() : "";
  if (NETWORK_ERROR_CODES.has(code)) return FAILURE_CLASS.TRANSIENT;

  const name = info.name ? String(info.name) : "";
  if (CODE_ERROR_NAMES.has(name)) return FAILURE_CLASS.PERMANENT;
  if (name === "HttpError" || name === "AbortError" || name === "TimeoutError") {
    return FAILURE_CLASS.TRANSIENT;
  }

  const status = Number(info.status);
  if (Number.isFinite(status)) {
    if (status === 401 || status === 403 || status === 404) return FAILURE_CLASS.PERMANENT;
    if (status === 429 || status >= 500) return FAILURE_CLASS.TRANSIENT;
  }

  const message = String(info.message || "");
  if (/did not define a valid \$BOT/i.test(message)) return FAILURE_CLASS.PERMANENT;
  if (/socket hang up|network|timed? ?out|getaddrinfo/i.test(message)) {
    return FAILURE_CLASS.TRANSIENT;
  }

  return FAILURE_CLASS.UNKNOWN;
}

/** Un fallo no permanente jamás deshabilita la fila. */
export function isRecoverable(failureClass) {
  return failureClass !== FAILURE_CLASS.PERMANENT;
}

/**
 * Intentos consecutivos tras los cuales una racha recuperable pasa a cuarentena.
 * @param {string} failureClass
 */
export function quarantineThresholdFor(failureClass) {
  return failureClass === FAILURE_CLASS.UNKNOWN
    ? QUARANTINE_AFTER_ATTEMPTS_UNKNOWN
    : QUARANTINE_AFTER_ATTEMPTS;
}

// ────────────────────────────────────────────────────────────
// Backoff
// ────────────────────────────────────────────────────────────

/**
 * Backoff exponencial con *equal jitter*: mitad fija + mitad aleatoria.
 *
 * El jitter no es cosmético. Con un array de esperas fijas, un corte de red compartido
 * sincroniza a todos los bots del host y los hace golpear la API del proveedor en el
 * mismo segundo, justo cuando el servicio se está recuperando. La mitad fija garantiza un
 * espaciado mínimo (a diferencia del *full jitter*, que puede devolver casi cero).
 *
 * @param {number} attempt número de intento consecutivo, empezando en 1
 * @param {string} [tier] valor de BACKOFF_TIER
 * @param {() => number} [random] inyectable para pruebas deterministas
 * @returns {number} milisegundos a esperar
 */
export function nextBackoffMs(attempt, tier = BACKOFF_TIER.FAST, random = Math.random) {
  const quarantine = tier === BACKOFF_TIER.QUARANTINE;
  const base = quarantine ? QUARANTINE_BASE_MS : FAST_BASE_MS;
  const cap = quarantine ? QUARANTINE_CAP_MS : FAST_CAP_MS;

  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  // El exponente se recorta antes de la potencia para no producir Infinity con rachas largas.
  const exponent = Math.min(n - 1, 32);
  const delay = Math.min(cap, base * Math.pow(2, exponent));
  const half = delay / 2;

  return Math.round(half + random() * half);
}

/** Techo del nivel rápido; el modo outage fija ahí la espera de todos los bots. */
export function maxFastBackoffMs() {
  return FAST_CAP_MS;
}
