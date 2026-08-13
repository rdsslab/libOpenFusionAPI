import { buildErrorPayload } from "../errorPayload.js";

// Cubre los errores que escapan de runHandler (pre-validación, caché, contexto). Comparte
// el mismo contrato que `replyException`: `{ error, trace_id }` y, solo cuando el autor lo
// marcó con $_EXCEPTION_({ ..., data: { public } }), también `data`.
export function mapOperationalError(error, request) {
  const trace_id = request?.headers?.["ofapi-trace-id"] || "";

  if (error?.name === "AbortError") {
    return {
      statusCode: 504,
      payload: { error: "Operation timed out", trace_id },
    };
  }

  if (typeof error === "string") {
    return {
      statusCode: 500,
      payload: { error, trace_id },
    };
  }

  if (error?.statusCode && Number.isInteger(error.statusCode)) {
    return {
      statusCode: error.statusCode,
      payload: buildErrorPayload(
        error.message || "Internal Server Error",
        trace_id,
        error,
      ),
    };
  }

  return {
    statusCode: 500,
    payload: buildErrorPayload(
      error?.message || "Internal Server Error",
      trace_id,
      error,
    ),
  };
}
