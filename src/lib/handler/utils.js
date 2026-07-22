export const setCacheReply = (reply, data, headers) => {
  if (reply) {
    if (!reply.openfusionapi) {
      reply.openfusionapi = { lastResponse: { data: data } };
    }

    if (reply.openfusionapi.lastResponse) {
      reply.openfusionapi.lastResponse.data = data;
      if (headers !== undefined) {
        reply.openfusionapi.lastResponse.headers = headers;
      }
    } else {
      reply.openfusionapi.lastResponse = { data: data };
      if (headers !== undefined) {
        reply.openfusionapi.lastResponse.headers = headers;
      }
    }
  }
  return reply;
};

export const getHandlerExecutionContext = (context) => {
  return {
    request: context?.request,
    reply: context?.reply,
    method: context?.method || context?.endpoint,
    endpoint: context?.endpoint || context?.method,
    server_data: context?.server_data,
  };
};

export const sendHandlerResponse = (
  reply,
  { statusCode = 200, data = null, cache = true, headers, contentType } = {},
) => {
  let inferredContentType = contentType;

  if (headers) {
    const isMapLike = headers instanceof Map;
    const isObjectLike = typeof headers === "object" && headers !== null;
    const isIterable =
      isObjectLike && typeof headers[Symbol.iterator] === "function";

    if (isMapLike) {
      for (const [key, value] of headers) {
        if (!inferredContentType && key.toLowerCase() === "content-type") {
          inferredContentType = value;
        } else {
          reply.header(key, value);
        }
      }
    } else if (isIterable && !isObjectLike) {
      // Generic iterables (e.g. Headers) that are not plain objects.
      for (const [key, value] of headers) {
        if (!inferredContentType && key.toLowerCase() === "content-type") {
          inferredContentType = value;
        } else {
          reply.header(key, value);
        }
      }
    } else if (isObjectLike) {
      for (const [key, value] of Object.entries(headers)) {
        if (!inferredContentType && key.toLowerCase() === "content-type") {
          inferredContentType = value;
        } else {
          reply.header(key, value);
        }
      }
    } else {
      console.warn(
        "sendHandlerResponse: headers ignored because they are not iterable/object",
      );
    }
  }

  if (inferredContentType) {
    reply.type(inferredContentType);
  }

  if (cache) {
    setCacheReply(reply, data, headers);
  }

  reply.code(statusCode).send(data);
};

export const sendHandlerError = (reply, statusCode, error, extra = {}) => {
  reply.code(statusCode).send({ error, ...extra });
};

export const isValidHttpStatusCode = (code) => {
  // Lista de rangos válidos para códigos de estado HTTP
  const validRanges = [
    [100, 199], // Informativos
    [200, 299], // Éxito
    [300, 399], // Redirección
    [400, 499], // Errores del cliente
    [500, 599], // Errores del servidor
  ];

  // Verifica si el número está dentro de alguno de los rangos válidos
  return validRanges.some(([min, max]) => code >= min && code <= max);
};

export const replyException = (request, reply, error) => {
  //console.trace(error);
  let trace_id = request?.headers?.["ofapi-trace-id"] || "";

  if (reply.openfusionapi?.lastResponse) {
    reply.openfusionapi.lastResponse.exception = error;
  }

  const statusCode =
    typeof error === "object" && error?.statusCode != null
      ? error.statusCode
      : 500;

  const message =
    typeof error === "string"
      ? error
      : error?.message || "Internal Server Error";

  if (message == "" && typeof error === "object") {
    // Para errores de validación de Sequelize (v6) u otros errores con la propiedad `errors` directamente
    const validationErrors = error?.errors || error?.parent?.errors;
    message =
      Array.isArray(validationErrors) && validationErrors.length > 0
        ? validationErrors.map((e) => e.message).join(", ")
        : "Internal Server Error.";
  }

  reply.code(statusCode).send({ error: message, trace_id });
  return;
};

/**
 * Resolve AppVar placeholders (e.g., $_VAR_SQLITE) to their actual values.
 * Supports placeholders in custom_data or code fields.
 * 
 * @param {string|object} value - The value that may contain an AppVar placeholder
 * @param {object} app_vars - The app_vars object from endpoint context (keyed by environment)
 * @param {string} environment - Current environment (dev, qa, prd)
 * @returns {string|object} - Resolved value if placeholder found, otherwise original value
 */
export const resolveAppVar = (value, app_vars, environment = 'dev') => {
  if (!value || typeof value !== 'string') {
    return value;
  }

  const raw = value.trim();
  const normalizedKey =
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw;

  const normalizeResolved = (resolved) => {
    if (typeof resolved !== "string") {
      return resolved;
    }

    const trimmed = resolved.trim();

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return resolved;
      }
    }

    return resolved;
  };

  const findAppVarValue = (name) => {
    if (!app_vars) {
      return undefined;
    }

    // Shape 1: { dev: { '$_VAR_NAME': value } }
    if (app_vars?.[environment] && typeof app_vars[environment] === "object") {
      const envValue = app_vars[environment][name];
      if (envValue !== undefined) {
        return envValue;
      }
    }

    // Shape 2: { '$_VAR_NAME': value }
    if (app_vars?.[name] !== undefined) {
      return app_vars[name];
    }

    // Shape 3: array [{ name, environment, value }]
    if (Array.isArray(app_vars)) {
      const match = app_vars.find(
        (row) => row?.name === name && (!row?.environment || row.environment === environment),
      );
      if (match?.value !== undefined) {
        return match.value;
      }
    }

    // Shape 4: { dev: [{ name, value }] }
    const envList = app_vars?.[environment];
    if (Array.isArray(envList)) {
      const match = envList.find((row) => row?.name === name);
      if (match?.value !== undefined) {
        return match.value;
      }
    }

    return undefined;
  };

  // Check if value is an AppVar placeholder (e.g., "$_VAR_NAME")
  if (normalizedKey.startsWith('$_')) {
    const resolved = findAppVarValue(normalizedKey);
    
    if (resolved !== undefined) {
      return normalizeResolved(resolved);
    }
  }

  return value;
};

export const createBadRequestError = (message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = 400;
  return Object.assign(error, extra);
};

export const getAppVarContext = (endpoint, method = endpoint) => {
  return {
    appVars:
      endpoint?.app_vars ||
      endpoint?.params?.app_vars ||
      method?.app_vars ||
      method?.params?.app_vars,
    environment:
      endpoint?.environment ||
      endpoint?.params?.environment ||
      method?.environment ||
      method?.params?.environment ||
      "dev",
  };
};

export const resolveAppVarPlaceholder = (value, appVars, environment = "dev") => {
  const placeholder =
    typeof value === "string" && value.trim().startsWith("$_")
      ? value.trim()
      : null;

  if (!placeholder) {
    return value;
  }

  const resolved = resolveAppVar(value, appVars, environment);
  if (typeof resolved === "string" && resolved.trim() === placeholder) {
    throw createBadRequestError(
      `AppVar ${placeholder} not found for environment ${environment}`,
    );
  }

  return resolved;
};

export const parseJsonConfig = (
  value,
  errorMessage = "Invalid JSON in method custom_data/AppVar",
) => {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw createBadRequestError(errorMessage);
  }
};

/**
 * Build a deterministic cache key for database connections.
 * Includes the resolved environment so production and test connections cannot share a pool entry.
 */
export const buildConnectionCacheKey = (config = {}, environment = 'dev') => {
  const options = config?.options || {};

  return JSON.stringify({
    environment,
    database: config?.database,
    username: config?.username,
    host: options?.host,
    port: options?.port,
    dialect: options?.dialect,
    dialectOptions: options?.dialectOptions,
    pool: options?.pool,
    ssl: options?.ssl,
  });
};
