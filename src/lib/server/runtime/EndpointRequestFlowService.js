import { validateEndpointContext } from "./contracts.js";

export class EndpointRequestFlowService {
  constructor({
    serverApi,
    endpoints,
    runHandler,
    getIPFromRequest,
    emitEndpointEvent,
    errorMapper,
  }) {
    this.serverApi = serverApi;
    this.endpoints = endpoints;
    this.runHandler = runHandler;
    this.getIPFromRequest = getIPFromRequest;
    this.emitEndpointEvent = emitEndpointEvent;
    this.errorMapper = errorMapper;
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

      this.endpoints.saveLog(request, reply);

      let handler_param = request?.openfusionapi?.handler?.params || {};
      if (handler_param?.idendpoint && handler_param?.cache_time > 0) {
        this.endpoints.setCache(handler_param?.url_key, request, reply);
      }
      handler_param.statusCode = reply.statusCode;
      this.emitEndpointEvent("request_completed", handler_param);
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
