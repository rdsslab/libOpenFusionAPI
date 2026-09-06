import { normalizeEndpointCors, isOriginAllowed } from "./endpointCorsPolicy.js";

const corsDefaultDeny = process.env.CORS_DEFAULT_DENY === "true";

export async function registerCorePlugins({
  fastify,
  maxBodyBytes,
  jwtKey,
  wwwDirPath,
  plugins,
  corsConfig,
  corsPolicy,
}) {
  const {
    formbody,
    multipart,
    cookie,
    cors,
    websocket,
    fastifyStatic,
    fs,
  } = plugins;

  await fastify.register(formbody, {
    bodyLimit: maxBodyBytes,
  });

  await fastify.register(multipart, {
    attachFieldsToBody: true,
    limits: {
      fileSize: maxBodyBytes,
    },
  });

  fastify.register(cookie, {
    secret: jwtKey,
    hook: "preValidation",
    parseOptions: {},
  });

  const resolvedCorsConfig =
    typeof corsPolicy === "function" ? corsPolicy(corsConfig) : corsConfig;

  await fastify.register(cors, {
    ...resolvedCorsConfig,
  });

  fastify.addHook("onSend", async (request, reply, payload) => {
    const requestOrigin = request.headers.origin;
    const endpointCors = normalizeEndpointCors(
      request?.openfusionapi?.handler?.params?.cors
    );

    if (requestOrigin) {
      if (endpointCors) {
        const allowed = isOriginAllowed(requestOrigin, endpointCors);

        if (allowed) {
          reply.raw.removeHeader("Access-Control-Allow-Origin");
          reply.raw.setHeader(
            "Access-Control-Allow-Origin",
            endpointCors.origin === "*" || endpointCors.origin === true
              ? "*"
              : requestOrigin
          );
          if (endpointCors.credentials) {
            reply.raw.removeHeader("Access-Control-Allow-Credentials");
            reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
          }
        } else {
          reply.raw.removeHeader("Access-Control-Allow-Origin");
          reply.raw.removeHeader("Access-Control-Allow-Credentials");
        }
      } else if (corsDefaultDeny) {
        reply.raw.removeHeader("Access-Control-Allow-Origin");
        reply.raw.removeHeader("Access-Control-Allow-Credentials");
      } else if (
        resolvedCorsConfig?.origin === true ||
        typeof resolvedCorsConfig?.origin === "function"
      ) {
        reply.raw.removeHeader("Access-Control-Allow-Origin");
        reply.raw.setHeader("Access-Control-Allow-Origin", requestOrigin);
        if (resolvedCorsConfig?.credentials === true) {
          reply.raw.removeHeader("Access-Control-Allow-Credentials");
          reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
        }
      }
    }

    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    return payload;
  });

  await fastify.register(websocket);

  if (!fs.existsSync(wwwDirPath)) {
    fs.mkdirSync(wwwDirPath);
  }

  await fastify.register(fastifyStatic, {
    root: wwwDirPath,
    prefix: "/",
  });
}
