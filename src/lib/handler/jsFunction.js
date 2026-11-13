import { functionsVars } from "../server/functionVars.js";
import {
  getHandlerExecutionContext,
  replyException,
  resolveSuccessStatus,
  sendHandlerResponse,
  warnIfRedirectWithoutLocation,
} from "./utils.js";
import {
  acquireEndpointLock,
  releaseEndpointLock,
} from "../db/endpoint_lock.js";

export const jsFunction = async (context) => {
  const { request, reply, method } = getHandlerExecutionContext(context);
  try {

    // --------------------------------------------------
    // 1) Obtener contexto de ejecución
    // --------------------------------------------------
    let fnVars = functionsVars(request, reply, method.environment);

    // --------------------------------------------------
    // 2) Extraer token de aborto y crear signal unificado
    // --------------------------------------------------
    const abortToken = request.headers?.['x-ofapi-abort-token'] || null;
    
    // Crear AbortController para esta ejecución.
    const abortController = new AbortController();
    const abortSignal = abortController.abortSignal;

    // Si el cliente cierra la conexión, abortar la ejecución
    if (request.raw && typeof request.raw.on === 'function') {
      request.raw.on('close', () => {
        if (!abortSignal.aborted) {
          console.log('[jsFunction] Client disconnected, aborting execution');
          abortController.abort(new Error('Client disconnected'));
        }
      });
    }

    // Exponer en fnVars para que handlers lo reciban
    fnVars.abortSignal = abortSignal;
    fnVars.abortToken = abortToken;

    // --------------------------------------------------
    // H4: Lock exclusivo por endpoint para llamadas directas
    // --------------------------------------------------
    // Si el endpoint tiene `exclusive: true`, cualquier llamada (GUI Tester, MCP,
    // cliente HTTP directo) debe adquirir el lock antes de ejecutarse. Las
    // IntervalTasks programadas ya están protegidas por `locked_until` en el worker.
    let endpointLockId = null;
    if (method.exclusive) {
      const lockResult = await acquireEndpointLock(
        method.idendpoint,
        300, // TTL: 5 minutos de lease
        "manual"
      );
      if (!lockResult.success) {
        return sendHandlerResponse(reply, {
          statusCode: 409,
          data: {
            success: false,
            reason: lockResult.reason || "ENDPOINT_LOCKED",
            message: lockResult.message || `El endpoint ${method.idendpoint} tiene un lock exclusivo vigente.`,
          },
        });
      }
      endpointLockId = lockResult.idlock;
    }

    // --------------------------------------------------
    // 3) Validar VM compilada del endpoint
    // --------------------------------------------------
    if (!method.jsFn) {
      throw new Error("Function 'jsFn' is not compiled in cache.");
    }

    // --------------------------------------------------
    // 4) Ejecutar código dentro de la VM con abortSignal
    // --------------------------------------------------
    let fnresult;
    try {
      fnresult = await method.jsFn(fnVars, abortSignal);
    } finally {
      // Liberar el lock de endpoint si se adquirió
      if (endpointLockId) {
        await releaseEndpointLock(method.idendpoint).catch((err) => {
          console.error("[jsFunction] Error releasing endpoint lock:", err);
        });
      }
    }

    // El endpoint puede pedir otro código de éxito con `$_RETURN_STATUS_` (201 al
    // crear, 202 al encolar, 204 al borrar, 302 al redirigir).
    const { statusCode, sendsBody } = resolveSuccessStatus(fnresult.statusCode, {
      endpoint: method.resource || method.idendpoint,
    });

    warnIfRedirectWithoutLocation(statusCode, fnresult.headers, {
      endpoint: method.resource || method.idendpoint,
    });

    sendHandlerResponse(reply, {
      statusCode,
      data: sendsBody ? fnresult.data : null,
      headers: fnresult.headers,
    });
  } catch (error) {
    replyException(request, reply, error);
  }
};
