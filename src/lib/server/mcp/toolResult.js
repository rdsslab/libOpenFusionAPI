// toolResult.js
//
// Dos cosas que el servidor MCP necesita decidir antes de devolver el resultado de una
// tool y que antes se perdían:
//
//   1. Si la llamada es un error. `isError` es la única señal de fallo que un cliente MCP
//      conforme puede leer sin interpretar prosa, así que sin ella un 401, un 404 o un
//      500 llegaban al agente exactamente igual que un 200. Y el caso frecuente de
//      OpenFusionAPI es peor: muchos errores de negocio se responden con HTTP 200 y el
//      error dentro del cuerpo, de modo que el status por sí solo tampoco basta.
//
//   2. El código HTTP y el mimeType de la respuesta. Un content block solo admite `type`,
//      `text`, `annotations` y `_meta` (TextContentSchema del SDK), así que ponerlos en el
//      objeto los descartaba al validar la respuesta y el cliente se quedaba sin ninguna
//      pista del transporte. `_meta` es el sitio que la especificación reserva para eso.
//
// Son funciones puras a propósito: no dependen de `mcp.js` ni de ningún estado, para que
// se puedan probar directamente sin levantar un servidor ni una base de datos.

// Por encima el parseo costaría más de lo que aporta: un cuerpo enorme con status 200
// no es un error, y `status >= 400` ya lo habría marcado.
const MAX_ERROR_PROBE_CHARS = 1000000;

/**
 * ¿El cuerpo de una respuesta 200 es en realidad un error?
 *
 * Solo se mira si parece un objeto JSON: un cuerpo que empieza por `{` y parsea como
 * objeto, con clave `error` o con `success: false`. Un array JSON, un texto plano, un
 * HTML o un objeto que lleve `error` como dato (por ejemplo una fila de catálogo) no
 * cuentan como error.
 *
 * @param {string} text
 * @returns {boolean}
 */
export const bodyLooksLikeError = (text) => {
  const trimmed = typeof text === "string" ? text.trimStart() : "";
  if (!trimmed.startsWith("{") || trimmed.length > MAX_ERROR_PROBE_CHARS) return false;

  try {
    const payload = JSON.parse(trimmed);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    if (payload.success === false) return true;
    return Object.prototype.hasOwnProperty.call(payload, "error");
  } catch (_error) {
    return false;
  }
};

/**
 * Envuelve un cuerpo de respuesta en el resultado de tool que espera el SDK.
 *
 * El texto se devuelve intacto: el agente recibe exactamente la misma respuesta de antes
 * y, además, la señal (`isError`) y la metadata del transporte (`_meta`) que antes se
 * perdían. `isError` se puede forzar con el parámetro del mismo nombre para los casos en
 * que el resultado no viene de una llamada HTTP —una respuesta de usage, un informe de
 * validación— y aplicar el criterio automático sería un falso positivo.
 *
 * @param {object} params
 * @param {string} params.text cuerpo de la respuesta
 * @param {string} [params.mimeType] content-type de la respuesta
 * @param {number} [params.statusCode] código HTTP de la respuesta
 * @param {boolean} [params.isError] fuerza el valor en lugar de deducirlo
 */
export const buildToolResult = ({ text, mimeType, statusCode, isError } = {}) => {
  const body = typeof text === "string" ? text : String(text ?? "");
  const status = Number.isFinite(statusCode) ? statusCode : undefined;

  const meta = {};
  if (status !== undefined) meta.statusCode = status;
  if (mimeType) meta.mimeType = mimeType;

  return {
    content: [
      {
        type: "text",
        text: body,
        ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
      },
    ],
    isError: isError ?? ((status !== undefined && status >= 400) || bodyLooksLikeError(body)),
  };
};

// El prefijo de modo es una convención de la documentación de handlers: la descripción
// del endpoint empieza por `READ ONLY:` o `WRITE OPERATION:` y esa es la intención que el
// autor ya escribió. Se comprueba solo en la primera línea y con un patrón tolerante a
// mayúsculas y espacios, para no depender del formato exacto.
const READ_ONLY_DESCRIPTION_PREFIX = /^read\s+only\s*:/i;
const WRITE_OPERATION_DESCRIPTION_PREFIX = /^write\s+operation\s*:/i;

/**
 * Modo de operación de un endpoint: `read`, `write` o "" si no se puede determinar.
 *
 * `mcp.meta.operation_mode` manda cuando está declarado: es el campo estructurado y no
 * depende de la prosa. El prefijo de la descripción es el respaldo, porque la
 * documentación siempre lo ha pedido y el seed existente ya lo trae escrito.
 *
 * Antes el prefijo no influía en nada, así que todo endpoint sin `operation_mode` caía en
 * `destructiveHint: true` y 20 de las 25 tools de la app de demostración se anunciaban
 * como destructivas, incluidas lecturas puras. En un cliente que exige aprobación humana
 * para tools destructivas eso bloquea la app entera.
 *
 * @param {string|undefined} declaredMode valor de `mcp.operation_mode` o `mcp.meta.operation_mode`
 * @param {string|undefined} description descripción efectiva del endpoint
 * @returns {"read"|"write"|""}
 */
export const resolveOperationMode = (declaredMode, description) => {
  const declared = String(declaredMode ?? "").trim().toLowerCase();
  if (declared) return declared;

  const firstLine = String(description ?? "").split("\n")[0].trim();
  if (READ_ONLY_DESCRIPTION_PREFIX.test(firstLine)) return "read";
  if (WRITE_OPERATION_DESCRIPTION_PREFIX.test(firstLine)) return "write";
  return "";
};
