import {
  getHandlerExecutionContext,
  replyException,
  sendHandlerResponse,
} from "./utils.js";

const VALID_DATA_TYPES = new Set(["object", "array", "boolean", "string", "number", "null"]);

/**
 * Validates that fnresult has the expected shape: { code: number, data: any }
 * Equivalent to the previous Zod schema — zero external dependencies.
 */
function validateFnResult(result) {
  if (result === null || typeof result !== "object") {
    return { success: false, error: "Function result must be an object" };
  }
  if (typeof result.code !== "number") {
    return { success: false, error: `'code' must be a number, got: ${typeof result.code}` };
  }
  const dataType = result.data === null ? "null" : Array.isArray(result.data) ? "array" : typeof result.data;
  if (!VALID_DATA_TYPES.has(dataType)) {
    return { success: false, error: `'data' has unsupported type: ${dataType}` };
  }
  return { success: true };
}

export const customFunction = async (context) => {
  const { request, reply, method, server_data } = getHandlerExecutionContext(context);
  const trace_id = request?.headers?.["ofapi-trace-id"] || "";
  try {
    // Validación de función
    if (typeof method.Fn !== "function") {
      const msg = `URL: ${request.url} - Function '${method.code}' not found.`;
      console.error(msg);
      reply.code(500).send({ error: msg, trace_id });
      return;
    }

    // Obtener datos seguros del request
    const body =
      typeof request.body === "object" && request.body !== null
        ? { ...request.body }
        : null;

    const query =
      typeof request.query === "object" && request.query !== null
        ? { ...request.query }
        : null;

    const user_data = body && Object.keys(body).length > 0 ? body : query || {};

    // Ejecutar función con timeout seguro. Respect endpoint timeout when provided.
    const parsedTimeoutSec = Number(method?.timeout);
    const timeoutMs = Number.isFinite(parsedTimeoutSec) && parsedTimeoutSec > 0
      ? parsedTimeoutSec * 1000
      : 1000 * 60 * 5;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let fnresult;
    try {
      fnresult = await method.Fn({
        request: request,
        user_data,
        reply: reply,
        server_data: server_data,
        signal: controller.signal,
      });
    } catch (err) {
      // Verificar abort PRIMERO para que el timeout no quede enmascarado
      // por un error propio de la función que ocurra casi simultáneamente
      if (controller.signal.aborted) {
        throw new Error(`Execution timeout (${Math.floor(timeoutMs / 1000)} sec exceeded)`);
      }
      console.error("Function execution error:", err);
      throw err;
    } finally {
      clearTimeout(timer);
    }

    // Validar salida
    const parsed = validateFnResult(fnresult);
    if (!parsed.success) {
      console.error("Response validation errors:", parsed.error);
      reply.code(500).send({ error: parsed.error, trace_id });
      return;
    }

    // Respuesta válida
    sendHandlerResponse(reply, {
      statusCode: fnresult.code || 200,
      data: fnresult.data,
      headers: fnresult.headers,
    });
  } catch (err) {
    replyException(request, reply, err);
  }
};
