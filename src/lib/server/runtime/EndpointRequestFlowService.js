import { validateEndpointContext } from "./contracts.js";

export class EndpointRequestFlowService {
  constructor({
    serverApi,
    endpoints,
    runHandler,
    getIPFromRequest,
    emitEndpointEvent,
    errorMapper,
    rateLimitService,
    getBasicUsernameFromRequest,
  }) {
    this.serverApi = serverApi;
    this.endpoints = endpoints;
    this.runHandler = runHandler;
    this.getIPFromRequest = getIPFromRequest;
    this.emitEndpointEvent = emitEndpointEvent;
    this.errorMapper = errorMapper;
    this.rateLimitService = rateLimitService;
    this.getBasicUsernameFromRequest = getBasicUsernameFromRequest;
  }

  replyMappedError(error, request, reply) {
    const mapped = this.errorMapper(error, request);
    if (!reply.openfusionapi) {
      reply.openfusionapi = {};
    }
    if (!reply.openfusionapi.lastResponse) {
      reply.openfusionapi.lastResponse = {};
    }
    reply.openfusionapi.lastResponse.exception =
      mapped?.payload?.error || error?.message || String(error);
    reply.openfusionapi.lastResponse.data = mapped?.payload;
    if (!reply.sent) {
      reply.code(mapped.statusCode).send(mapped.payload);
    }
  }

  onRequest(request) {
    request.startTime = process.hrtime();
  }

  /**
   * Registra un fallo de autenticación (401) en el rate limiter. Al cruzar el
   * umbral por primera vez emite un log de "posible ataque" con nivel 3.
   */
  trackAuthFailure(request, reply) {
    if (!this.rateLimitService || reply.statusCode !== 401) return;

    const ip = this.getIPFromRequest(request);
    const username = this.getBasicUsernameFromRequest(request);
    const result = this.rateLimitService.recordFailure(ip, username);

    if (!result.lockoutStarted) return;

    const handler_param = request?.openfusionapi?.handler?.params || {};
    const endpoint_info = {
      idapp: handler_param.idapp,
      idendpoint: handler_param.idendpoint,
      environment: handler_param.environment,
      resource: handler_param.resource,
      method: handler_param.method,
    };

    if (typeof this.endpoints.logPossibleAttack === "function") {
      this.endpoints.logPossibleAttack(request, reply, {
        reason: "auth_failure_threshold",
        ip: ip ?? null,
        username: username ?? null,
        failures: result.failures,
        retry_after_ms: result.retryAfterMs,
        endpoint: endpoint_info,
      });
    }
  }

  onResponse(request, reply) {
    if (request.method !== "OPTIONS") {
      const diff = process.hrtime(request.startTime);
      const timeTaken = Math.round(diff[0] * 1e3 + diff[1] * 1e-6);

      if (!reply.openfusionapi) {
        reply.openfusionapi = { lastResponse: { responseTime: timeTaken } };
      }

      if (!reply.openfusionapi.lastResponse) {
        reply.openfusionapi.lastResponse = { responseTime: timeTaken };
      }

      if (!reply.openfusionapi.lastResponse.responseTime) {
        reply.openfusionapi.lastResponse.responseTime = timeTaken;
      }

      this.trackAuthFailure(request, reply);
      this.endpoints.saveLog(request, reply);

      let handler_param = request?.openfusionapi?.handler?.params || {};
      if (handler_param?.idendpoint && handler_param?.cache_time > 0) {
        this.endpoints.setCache(handler_param?.url_key, request, reply);
      }

      this.emitEndpointEvent("request_completed", {
        idendpoint: handler_param.idendpoint,
        idapp: handler_param.idapp,
        app: handler_param.app,
        environment: handler_param.environment,
        resource: handler_param.resource,
        method: handler_param.method,
        title: handler_param.title,
        enabled: handler_param.enabled,
        statusCode: reply.statusCode,
        responseTime: reply.openfusionapi.lastResponse.responseTime,
      });
    }
  }

  async handleApiRequest(request, reply) {
    try {
      if (reply.sent) {
        return;
      }

      let handlerEndpoint = validateEndpointContext(request, reply);
      request.openfusionapi.ip_request = this.getIPFromRequest(request);

      if (!reply.openfusionapi) {
        reply.openfusionapi = {};
      }

      if (handlerEndpoint.params.handler == "JS") {
        reply.openfusionapi.server = this.serverApi;
      }

      let server_data = {};

      reply.openfusionapi.lastResponse = {
        hash_request: "0A0",
        data: undefined,
      };

      if (
        handlerEndpoint.params &&
        handlerEndpoint.params.app &&
        handlerEndpoint.params.app == "system"
      ) {
        if (handlerEndpoint.params.handler == "FUNCTION") {
          server_data.endpoint_class = this.endpoints;
        }
      }

      this.emitEndpointEvent("request_start", {
        idendpoint: handlerEndpoint.params?.idendpoint,
        idapp: handlerEndpoint.params?.idapp,
        url: request.url,
        method: request.method,
        app: handlerEndpoint.params?.app,
        environment: handlerEndpoint.params?.environment,
        endpoint: handlerEndpoint.params?.url_method,
      });

      if (
        handlerEndpoint.params &&
        handlerEndpoint.params.cache_time &&
        handlerEndpoint.params.cache_time > 0
      ) {
        let hash_request = this.endpoints.hash_request(
          request,
          handlerEndpoint.params.url_key,
        );

        reply.openfusionapi.lastResponse.hash_request = hash_request;
        request.openfusionapi.hash_request = hash_request;

        let data_cache = this.endpoints.cache.getPayload({
          app: handlerEndpoint.params.app,
          resource: handlerEndpoint.params.resource,
          env: handlerEndpoint.params.environment,
          method: request.method,
          hash: hash_request,
        });

        if (data_cache && data_cache.data) {
          reply.header("X-Cache", "HIT");
          reply.openfusionapi.lastResponse[hash_request] = data_cache.data;
          if (data_cache.headers) {
            const isMapLike = data_cache.headers instanceof Map;
            const isObjectLike = typeof data_cache.headers === "object" && data_cache.headers !== null;
            if (isMapLike) {
              for (const [key, value] of data_cache.headers) {
                if (key.toLowerCase() === "content-type") {
                  reply.type(value);
                } else {
                  reply.header(key, value);
                }
              }
            } else if (isObjectLike) {
              for (const [key, value] of Object.entries(data_cache.headers)) {
                if (key.toLowerCase() === "content-type") {
                  reply.type(value);
                } else {
                  reply.header(key, value);
                }
              }
            }
          }
          reply.code(200).send(data_cache.data);
        } else {
          reply.header("X-Cache", "MISS");
          await this.runHandler(request, reply, handlerEndpoint.params, server_data);
        }
      } else {
        await this.runHandler(request, reply, handlerEndpoint.params, server_data);
      }
    } catch (error) {
      this.replyMappedError(error, request, reply);
    }
  }
}
