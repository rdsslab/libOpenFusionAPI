/**
 * @file errorPayload.js
 * @description Qué parte de un error controlado puede salir en la respuesta HTTP.
 *
 * El `data` de `$_EXCEPTION_` nació como contexto de log —hay endpoints que meten ahí el
 * body entero o las variables de aplicación— así que devolverlo entero al cliente
 * filtraría credenciales. Por eso la exposición es explícita: solo viaja lo que el autor
 * puso en `data.public`, marcado en el objeto lanzado con `PUBLIC_ERROR_DATA`.
 *
 * Como la marca solo la escriben `jsException` y `ofapi.throw`, un error nativo de
 * Sequelize, undici o Mongo nunca la lleva y no puede filtrar SQL, DSN ni stacks.
 *
 * Módulo sin dependencias a propósito: lo usan tanto el sandbox (functionVars) como las
 * dos capas de respuesta (handler/utils y runtime/ErrorMapper).
 */

/** Nombre del campo interno que transporta el detalle público. */
export const PUBLIC_ERROR_DATA = "__public_data";

/** Tope del detalle público, en caracteres del JSON serializado. */
const MAX_PUBLIC_DATA_CHARS = 10240;

/**
 * Recorta el detalle público para que un error no devuelva megabytes.
 * @param {any} value
 * @returns {any} el valor original, o un marcador con el fragmento inicial
 */
export function truncatePublicErrorData(value) {
  if (value === undefined || value === null) return value;

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    return { truncated: true, note: "public error data is not serializable" };
  }

  if (!serialized || serialized.length <= MAX_PUBLIC_DATA_CHARS) return value;

  return {
    truncated: true,
    size: serialized.length,
    preview: serialized.slice(0, MAX_PUBLIC_DATA_CHARS),
  };
}

/**
 * Detalle publicable de un error, ya recortado.
 * @param {any} error
 * @returns {any} `undefined` si el error no trae detalle público
 */
export function getPublicErrorData(error) {
  if (!error || typeof error !== "object") return undefined;

  return truncatePublicErrorData(error[PUBLIC_ERROR_DATA]);
}

/**
 * Cuerpo de una respuesta de error: `{ error, trace_id }` y, solo cuando el autor lo pidió
 * explícitamente, `data`.
 *
 * @param {string} message
 * @param {string} trace_id
 * @param {any} error el error original, del que se extrae el detalle público
 * @returns {{error: string, trace_id: string, data?: any}}
 */
export function buildErrorPayload(message, trace_id, error) {
  const payload = { error: message, trace_id };
  const publicData = getPublicErrorData(error);

  if (publicData !== undefined) payload.data = publicData;

  return payload;
}
