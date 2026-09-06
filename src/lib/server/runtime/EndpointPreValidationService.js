export class EndpointPreValidationService {
  constructor({
    endpoints,
    getUUID,
    getURLParams,
    authService,
    authPolicy,
    errorMapper,
    rateLimitService,
    getIPFromRequest,
    getBasicUsernameFromRequest,
  }) {
    this.endpoints = endpoints;
    this.getUUID = getUUID;
    this.getURLParams = getURLParams;
    this.authService = authService;
    this.authPolicy = authPolicy;
    this.errorMapper = errorMapper;
    this.rateLimitService = rateLimitService;
    this.getIPFromRequest = getIPFromRequest;
    this.getBasicUsernameFromRequest = getBasicUsernameFromRequest;
  }

  ensureTraceId(request, reply) {
    if (!request.headers["ofapi-trace-id"]) {
      let trace_id = this.getUUID();
      request.headers["ofapi-trace-id"] = trace_id;
      reply.header("ofapi-trace-id", trace_id);
      return trace_id;
    }

    reply.header("ofapi-trace-id", request.headers["ofapi-trace-id"]);
    return request.headers["ofapi-trace-id"];
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

  /**
   * Aplica el rate limit de intentos fallidos de autenticación. Si la IP (o
   * IP+usuario) está en lockout, responde 429 con `Retry-After` y registra el
   * evento como "posible ataque".
   * @returns {boolean} true si la solicitud fue bloqueada
   */
  applyRateLimit(request, reply) {
    if (!this.rateLimitService) return false;

    const ip = this.getIPFromRequest(request);
    const username = this.getBasicUsernameFromRequest(request);
    const { blocked, retryAfterMs } = this.rateLimitService.isBlocked(ip, username);

    if (!blocked) return false;

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(retryAfterMs / 1000)
    );

    if (!reply.openfusionapi) {
      reply.openfusionapi = {};
    }
    if (!reply.openfusionapi.lastResponse) {
      reply.openfusionapi.lastResponse = {};
    }
    reply.openfusionapi.lastResponse.exception = {
      type: "posible_ataque",
      reason: "auth_rate_limit",
      ip,
      username: username ?? null,
    };

    reply.header("Retry-After", retryAfterSeconds);
    reply.code(429).send({
      error: "Too many failed attempts. Please retry later.",
      retry_after_seconds: retryAfterSeconds,
      url: request.url,
    });

    if (typeof this.endpoints.logPossibleAttack === "function") {
      this.endpoints.logPossibleAttack(request, reply, {
        reason: "auth_rate_limit",
        ip: ip ?? null,
        username: username ?? null,
        retry_after_seconds: retryAfterSeconds,
      });
    }

    return true;
  }

  async preValidation(request, reply) {
    try {
      const user_agent = request.headers["user-agent"];

      if (!request.ws && (!user_agent || user_agent.length === 0)) {
        reply.code(403).send({ error: "Fail" });
        return;
      }

      this.ensureTraceId(request, reply);

      let request_path_params = this.getURLParams(request.url, request.method);
      
      // Si la solicitud NO es una ruta de API, permite que continúe el procesamiento normal
      if (!request_path_params || !request_path_params.url_key) {
        return;
      }

      let cache_endpoint = await this.endpoints.getEndpoint(request_path_params);

      if (!cache_endpoint || !cache_endpoint.handler) {
        reply.code(404).send({ error: "Endpoint not found", url: request.url });
        return;
      }

      let handlerEndpoint = cache_endpoint.handler;
      request.openfusionapi = { handler: handlerEndpoint };

      // Bloqueo por fallos de autenticación repetidos (fuerza bruta). Se aplica una
      // vez resuelto el endpoint para poder registrar idapp/idendpoint en el log del
      // ataque, pero antes de validar credenciales para no gastar más intentos.
      if (this.applyRateLimit(request, reply)) {
        return;
      }

      if (handlerEndpoint?.params?.enabled) {
        if (!this.authPolicy({ request, reply, handlerEndpoint })) {
          reply.code(403).send({ error: "Auth policy denied", url: request.url });
          return;
        }

        await this.authService.check_auth(handlerEndpoint, request, reply);
      } else {
        reply.code(410).send({ message: "Endpoint unabled.", url: request.url });
      }
    } catch (error) {
      this.replyMappedError(error, request, reply);
    }
  }
}
