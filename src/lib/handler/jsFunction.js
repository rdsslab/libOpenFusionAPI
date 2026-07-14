import { functionsVars } from "../server/functionVars.js";
import {
  getHandlerExecutionContext,
  replyException,
  sendHandlerResponse,
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

    sendHandlerResponse(reply, {
      statusCode: 200,
      data: fnresult.data,
      headers: fnresult.headers,
    });
  } catch (error) {
    replyException(request, reply, error);
  }
};
