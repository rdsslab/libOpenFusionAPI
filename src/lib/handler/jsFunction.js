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
    // 2) Validar VM compilada del endpoint
    // --------------------------------------------------
    if (!method.jsFn) {
      throw new Error("Function 'jsFn' is not compiled in cache.");
    }

    // --------------------------------------------------
    // 3) Ejecutar código dentro de la VM
    // --------------------------------------------------
    let fnresult = await method.jsFn(fnVars);

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
