import { createFunctionVM } from "../server/createFunctionVM.js";
import { functionsVars, listFunctionsVars } from "../server/functionVars.js";
import {
  getHandlerExecutionContext,
  replyException,
  sendHandlerResponse,
} from "./utils.js";

export const jsFunction = async (context) => {
  const { request, reply, method } = getHandlerExecutionContext(context);
  try {
    if (!method.jsFn) {
      throw new Error("Function 'jsFn' is not defined in the method configuration.");
    }
    
    // --------------------------------------------------
    // 1) Obtener contexto de ejecución
    // --------------------------------------------------
    let fnVars = functionsVars(request, reply, method.environment);
    
    // --------------------------------------------------
    // 2) Crear VM si no está cacheada
    // --------------------------------------------------
    if (!request.vmFunction) {
        const timeout = method.timeout 
            ? Number(method.timeout) * 1000 || 60000 
            : 60000;

        console.log("[DEBUG jsFunction] method.timeout:", method.timeout, "calculated timeout:", timeout);

        request.vmFunction = await createFunctionVM(
            method.code,
            fnVars,
            timeout
        );
    }

    // --------------------------------------------------
    // 3) Ejecutar código dentro de la VM
    // --------------------------------------------------
    let fnresult = await request.vmFunction(fnVars);
    //let fnresult = await method.jsFn(fnVars);

    sendHandlerResponse(reply, {
      statusCode: 200,
      data: fnresult.data,
      headers: fnresult.headers,
    });
  } catch (error) {
    replyException(request, reply, error);
  }
};
