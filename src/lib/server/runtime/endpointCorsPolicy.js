const CORS_KEYS = ["origin", "credentials", "allowedHeaders", "methods", "maxAge"];
const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "QUERY",
];

export const isConfiguredCors = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return CORS_KEYS.some((key) => value[key] !== undefined);
  }
  return false;
};

export const validateEndpointCors = (value) => {
  if (!isConfiguredCors(value)) {
    return { valid: true, error: null };
  }

  if (typeof value === "string") {
    return validateOriginValue(value);
  }

  if (Array.isArray(value)) {
    return validateOriginValue(value);
  }

  if (typeof value !== "object" || value === null) {
    return {
      valid: false,
      error:
        "cors must be an array of allowed origins or an object { origin, credentials, allowedHeaders, methods, maxAge }.",
    };
  }

  const unknownKeys = Object.keys(value).filter(
    (key) => !CORS_KEYS.includes(key)
  );
  if (unknownKeys.length > 0) {
    return {
      valid: false,
      error: `cors contains unknown keys: ${unknownKeys.join(", ")}. Allowed: ${CORS_KEYS.join(", ")}.`,
    };
  }

  if (value.origin !== undefined) {
    const originResult = validateOriginValue(value.origin);
    if (!originResult.valid) {
      return originResult;
    }
  }

  if (value.credentials !== undefined && typeof value.credentials !== "boolean") {
    return { valid: false, error: "cors.credentials must be a boolean." };
  }

  if (
    value.allowedHeaders !== undefined &&
    !isStringArray(value.allowedHeaders)
  ) {
    return {
      valid: false,
      error: "cors.allowedHeaders must be an array of strings.",
    };
  }

  if (value.methods !== undefined && !isStringArray(value.methods)) {
    return { valid: false, error: "cors.methods must be an array of strings." };
  }

  if (value.maxAge !== undefined && typeof value.maxAge !== "number") {
    return { valid: false, error: "cors.maxAge must be a number." };
  }

  return { valid: true, error: null };
};

const validateOriginValue = (origin) => {
  if (origin === true || origin === false) {
    return { valid: true, error: null };
  }

  if (typeof origin !== "string" && !Array.isArray(origin)) {
    return {
      valid: false,
      error: "cors.origin must be a string, a boolean or an array of strings.",
    };
  }

  const list = Array.isArray(origin) ? origin : [origin];
  if (!isStringArray(list)) {
    return { valid: false, error: "cors.origin must contain only strings." };
  }

  const empty = list.find((entry) => entry.trim() === "");
  if (empty !== undefined) {
    return { valid: false, error: "cors.origin entries must not be empty." };
  }

  return { valid: true, error: null };
};

const isStringArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

export const normalizeEndpointCors = (value) => {
  if (!isConfiguredCors(value)) {
    return null;
  }

  if (typeof value === "string") {
    return { origin: [value] };
  }

  if (Array.isArray(value)) {
    return { origin: [...value] };
  }

  const origin = value.origin === undefined ? [] : value.origin;

  return {
    origin: Array.isArray(origin) ? [...origin] : origin,
    credentials: value.credentials === true,
    allowedHeaders: value.allowedHeaders,
    methods: value.methods,
    maxAge: value.maxAge,
  };
};

export const isOriginAllowed = (origin, corsConfig) => {
  if (!origin || !corsConfig) {
    return false;
  }

  const allowed = corsConfig.origin;

  if (allowed === true) {
    return true;
  }

  const list = Array.isArray(allowed) ? allowed : typeof allowed === "string" ? [allowed] : [];

  if (list.length === 0) {
    return false;
  }

  return list.some((entry) => {
    if (entry === "*") {
      return true;
    }
    if (typeof entry === "string") {
      return entry === origin;
    }
    if (entry instanceof RegExp) {
      return entry.test(origin);
    }
    return false;
  });
};