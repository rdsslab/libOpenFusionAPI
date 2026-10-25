/**
 * Handler ASYNC_WRAPPER — Capa asíncrona sobre cualquier endpoint existente
 *
 * NO transforma el endpoint síncrono original. Recibe `idendpoint` + los
 * parámetros del endpoint base, crea un job asíncrono y responde inmediatamente
 * con `202 { requestId }`. El trabajo pesado se ejecuta en segundo plano
 * vía `AsyncTaskService` (worker_threads o proceso aislado).
 *
 * Importes importantes:
 * - El wrapper RECIBE `idendpoint` y los mismos parámetros que el endpoint base.
 * - Hereda `data_test`, `json_schema`, `custom_data.async`, `code`, etc. del endpoint base.
 * - Soporta cualquier tipo MIME (JSON, imagen, PDF, Excel, binarios).
 * - No toca el flujo síncrono existente (`EndpointRequestFlowService → runHandler`).
 */

import { getHandlerExecutionContext } from "./utils.js";
import { replyException, sendHandlerError } from "./utils.js";
import { asyncTaskService } from "../async/AsyncTaskService.js";
import { AsyncJob } from "../db/async_job.js";
import { Endpoint } from "../db/models.js";
import { buildFingerprint } from "../async/fingerprint.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Campos reservados del request que NO se pasan como parámetros al endpoint base.
 */
const RESERVED_ASYNC_KEYS = new Set([
  "idendpoint",
  "idapp",
  "environment",
  "async",
  "max_wait_ms",
  "ttl_ms",
  "max_consumes",
]);

export const asyncWrapperFunction = async (context) => {
  const { request, reply, method, endpoint } = getHandlerExecutionContext(context);

  try {
    // ------------------------------------------------------------------
    // 1. Obtener `idendpoint` y parámetros del endpoint base
    // ------------------------------------------------------------------
    const requestBody = request.body && typeof request.body === "object" ? request.body : {};
    const requestQuery = request.query && typeof request.query === "object" ? request.query : {};
    const data_request = { ...requestQuery, ...requestBody };

    const { idendpoint } = data_request;
    if (!idendpoint) {
      return sendHandlerError(reply, 400, "Se requiere `idendpoint` para invocar al wrapper async");
    }

    // 1a. Traer el endpoint base (referencia, no copia)
    const endpointBase = await Endpoint.findByPk(idendpoint);
    if (!endpointBase || !endpointBase.enabled) {
      return sendHandlerError(reply, 404, `Endpoint base no encontrado o deshabilitado: ${idendpoint}`);
    }

    const environment = data_request.environment || endpointBase.environment;
    const idapp = data_request.idapp || endpointBase.idapp;

    // 1b. HEREDAR metadatos del endpoint BASE (solo código, schema, data_test)
    //     La CONFIGURACIÓN ASYNC vive en el endpoint ASINCRÓNICO (wrapper),
    //     NO en el endpoint base. El endpoint base NO debe ser modificado.
    const jsonSchema = endpointBase.json_schema || {};
    const dataTest = endpointBase.data_test || null;

    // 1c. CONFIGURACIÓN ASYNC del endpoint ASINCRÓNICO (wrapper) que se está ejecutando
    //     No del endpoint base. El wrapper define ttl, consumos, notify_ws.
    const asyncConfig = (method.custom_data || {}).async || {};
    const ttl_ms = asyncConfig.ttl_ms ?? 3600000;
    const max_consumes = asyncConfig.max_consumes ?? 5;
    const notifyWs = asyncConfig.notify_ws ?? false;

    // ------------------------------------------------------------------
    // 2. Validar parámetros contra json_schema del endpoint base (entrada)
    // ------------------------------------------------------------------
    const endpointParams = {};
    for (const [key, value] of Object.entries(data_request)) {
      if (!RESERVED_ASYNC_KEYS.has(key)) {
        endpointParams[key] = value;
      }
    }

    // Validación mínima contra json_schema (si existe schema de entrada)
    if (jsonSchema?.in?.schema && typeof jsonSchema.in.schema === "object") {
      // Nota: aquí se podría usar ajv para validación estricta. Se deja como placeholder.
    }

    // ------------------------------------------------------------------
    // 3. Detectar duplicados por fingerprint (mismo idendpoint + params + env)
    // ------------------------------------------------------------------
    const fingerprint = buildFingerprint({
      idendpoint_base: idendpoint,
      query: request.query || {},
      body: request.body || {},
      env: environment,
    });

    const existingJob = await AsyncJob.findOne({
      where: {
        fingerprint,
        status: ["PENDING", "RUNNING"],
      },
    });

    if (existingJob) {
      // Idempotencia: devolver el requestId existente sin lanzar duplicado
      return reply.code(202).send({
        requestId: existingJob.id,
        status: existingJob.status,
        message: "Ya existe un job activo para estos parámetros",
        pollUrl: `/api/async/status/${existingJob.id}`,
        wsUrl: `/api/async/notify?requestId=${existingJob.id}`,
        ttl_remaining_ms: existingJob.expires_at ? Date.now() - new Date(existingJob.expires_at) : ttl_ms,
      });
    }

    // ------------------------------------------------------------------
    // 4. Crear el job asíncrono en estado PENDING
    // ------------------------------------------------------------------
    const requestId = uuidv4();

    const job = await AsyncJob.create({
      id: requestId,
      idendpoint_base: idendpoint,
      idendpoint_async: method.idendpoint,
      idapp,
      environment,
      params: { query: request.query || {}, body: request.body || {} },
      fingerprint,
      status: "PENDING",
      result: null,
      result_is_binary: false,
      content_type: "application/json",
      response_headers: null,
      consume_count: 0,
      max_consumes,
      ttl_ms,
      created_at: new Date(),
      expires_at: new Date(Date.now() + Number(ttl_ms)),
    });

    // ------------------------------------------------------------------
    // 5. Lanzar ejecución en segundo plano (no bloquea el reply)
    // ------------------------------------------------------------------
    AsyncTaskService.execute({
      requestId,
      endpointBase,
      endpointAsync: method,
      originalRequest: request,
      notifyWs,
    }).catch((err) => {
      // El error se maneja dentro de AsyncTaskService (marca FAILED + WS async_error)
      console.error(`[ASYNC_WRAPPER] Job ${requestId} falló durante ejecución:`, err);
    });

    // ------------------------------------------------------------------
    // 6. Responder inmediatamente al cliente (202 Accepted)
    // ------------------------------------------------------------------
    return reply.code(202).send({
      requestId,
      status: "PENDING",
      message: "Tarea iniciada en segundo plano. Consulte estado por GET /api/async/status/:id",
      pollUrl: `/api/async/status/${requestId}`,
      wsUrl: `/api/async/notify?requestId=${requestId}`,
      ttl_ms,
      max_consumes,
      notifyWs: asyncConfig.notify_ws ?? false,
      created_at: job.created_at,
      expires_at: job.expires_at,
      inherits: {
        idendpoint,
        data_test: dataTest ? true : false,
        json_schema: jsonSchema ? true : false,
      },
    });
  } catch (error) {
    return replyException(request, reply, error);
  }
};

export default { asyncWrapperFunction };
