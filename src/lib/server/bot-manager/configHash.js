/**
 * Hash de configuración de los workers de bots (ver manager.js).
 *
 * El hash decide cuándo un bot en ejecución debe reiniciarse. Solo deben afectar al
 * hash las entradas que cambian el comportamiento del bot: el `token` resuelto, el
 * `code` y las variables de aplicación con las que el código realmente corre.
 *
 * Las AppVars de cursor/dedup son estado en ejecución, NO configuración:
 * `$_VAR_ADMIN_ALERT_CURSOR`, `$_VAR_GROUP_APP_CURSORS`,
 * `$_VAR_GROUP_APP_CHANGES_CURSOR`, … Las escriben las tareas de intervalo internas en
 * cada escaneo. Antes, un bump de valor en cualquiera de ellas cambiaba el hash en cada
 * ciclo de 10 s y reiniciaba el bot con `drop_pending_updates: true`, descartando en
 * silencio mensajes de los usuarios (p. ej. un `/start` enviado justo en esa ventana)
 * y arrastrando a los bots con su reintento de arranque cada pocos minutos.
 */

import crypto from "node:crypto";

/** Sufijos que identifican las variables de cursor/estado interno (deduplicación). */
const RUNTIME_STATE_VAR_SUFFIXES = ["_CURSOR", "_CURSORS"];

/**
 * True cuando el nombre de la AppVar corresponde a un cursor de estado interno que se
 * actualiza fuera de banda y no forma parte de la configuración del bot.
 *
 * @param {string} name
 * @returns {boolean}
 */
export const isRuntimeStateVar = (name) => {
  if (typeof name !== "string" || name.length === 0) return false;
  const upper = name.toUpperCase();
  return RUNTIME_STATE_VAR_SUFFIXES.some((suffix) => upper.endsWith(suffix));
};

/**
 * Copia el objeto de variables quitando las de estado en el primer nivel, y también
 * dentro del objeto agrupado `$_APP_VARS_` que expone el sandbox.
 *
 * @param {Object} obj
 * @returns {Object}
 */
const stripRuntimeStateVars = (obj) => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  // Claves ordenadas: la fila de vars puede llegar de la BBDD sin orden garantizado y el
  // hash debe ser idéntico aunque el orden de iteración cambie entre ciclos.
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    const value = obj[key];
    if (key === "$_APP_VARS_" && value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = stripRuntimeStateVars(value);
      continue;
    }
    if (isRuntimeStateVar(key)) continue;
    out[key] = value;
  }
  return out;
};

/**
 * Calcula el hash de configuración de un bot. Cada variable de estado que cambie su
 * valor no altera el hash; un cambio de `token`, `code` o de una AppVar de configuración
 * sí lo hace y provoca el reinicio del worker.
 *
 * @param {{token: string, code: string, app_env_vars: Object}} input
 * @returns {string}
 */
export const buildBotConfigHash = ({ token, code, app_env_vars }) => {
  const config = JSON.stringify({
    token,
    code,
    app_env_vars: stripRuntimeStateVars(app_env_vars || {}),
  });
  return crypto.createHash("sha256").update(config).digest("hex");
};