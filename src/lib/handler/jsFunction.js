import { functionsVars } from "../server/functionVars.js";
import {
  getHandlerExecutionContext,
  replyException,
  resolveSuccessStatus,
  sendHandlerResponse,
  warnIfRedirectWithoutLocation,
} from "./utils.js";

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
    // Se pasa al VM (createFunctionVM) y a handlers vía fnVars.abortSignal.
    // Fuentes que pueden abortar:
    //   - VM timeout (interno al sandbox, createFunctionVM)
    //   - IntervalTask exec_time_limit (worker pasa abortToken via header)
    //   - Operador stop_interval_task_run (marca token en cache compartida)
    //   - Cliente cierra conexión HTTP (request.raw.on('close'))
    const abortController = new AbortController();
    const abortSignal = abortController.abortSignal;

    // Si el cliente cierra la conexión, abortar la ejecución
    // request.raw es el http.IncomingMessage de Node
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
    // 3) Validar VM compilada del endpoint
    // --------------------------------------------------
    if (!method.jsFn) {
      throw new Error("Function 'jsFn' is not compiled in cache.");
    }

    // --------------------------------------------------
    // 4) Ejecutar código dentro de la VM con abortSignal
    // --------------------------------------------------
    // createFunctionVM recibe abortSignal como segundo argumento y lo expone
    // en el sandbox como $_EXTERNAL_ABORT_SIGNAL_. $_ABORT_CHECK() chequea ambos.
    let fnresult = await method.jsFn(fnVars, abortSignal);

    // El endpoint puede pedir otro código de éxito con `$_RETURN_STATUS_` (201 al
    // crear, 202 al encolar, 204 al borrar, 302 al redirigir). Antes era 200 fijo,
    // así que un receptor de eventos no podía distinguir "se creó" de "todo era
    // duplicado". Un valor inválido degrada a 200 con un warning, no a un 500.
    const { statusCode, sendsBody } = resolveSuccessStatus(fnresult.statusCode, {
      endpoint: method.resource || method.idendpoint,
    });

    warnIfRedirectWithoutLocation(statusCode, fnresult.headers, {
      endpoint: method.resource || method.idendpoint,
    });

    sendHandlerResponse(reply, {
      statusCode,
      // 204 y 304 no llevan body: no es una preferencia del sandbox, es el protocolo.
      data: sendsBody ? fnresult.data : null,
      headers: fnresult.headers,
    });
  } catch (error) {
    replyException(request, reply, error);
  }
};
