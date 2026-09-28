import crypto from "node:crypto";
import { buildErrorPayload } from "../server/errorPayload.js";

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

  // El código se fija ANTES de capturar para caché. `setCacheReply` se llama desde
  // aquí y `EndpointCache.setCache` graba `reply.statusCode`; si se invirtiera el
  // orden, la caché almacenaría el código anterior (200 por defecto) y la segunda
  // petición devolvería 200 aunque la primera hubiera respondido 201.
  reply.code(statusCode);

  if (cache) {
    setCacheReply(reply, data, headers);
  }

  reply.send(data);
};

export const sendHandlerError = (reply, statusCode, error, extra = {}) => {
  const payload = { error, ...extra };
  if (reply.openfusionapi?.lastResponse) {
    reply.openfusionapi.lastResponse.data = payload;
  }
  reply.code(statusCode).send(payload);
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

/**
 * Resuelve el código de estado del camino de éxito a partir de `$_RETURN_STATUS_`.
 *
 * El rango es 200–399 a propósito. Los 4xx y 5xx tienen que seguir saliendo por
 * `$_EXCEPTION_`, porque ese es el camino que arma `buildErrorPayload` y le pone
 * `trace_id`. Aceptarlos aquí dejaría dos formas distintas de producir un error:
 * una con el cuerpo normalizado y otra sin él, y el cliente no podría saber con
 * cuál de las dos está lidiando.
 *
 * Un valor inválido degrada a 200 en vez de a 500, y avisa. La alternativa —convertir
 * un error de programación en un 500— castiga al cliente por un descuido que no
 * tiene: el endpoint hizo su trabajo y devolvió datos válidos, lo único que estaba
 * mal era un número mal escrito. El warning es lo que permite enterarse.
 *
 * @param {unknown} raw valor asignado por el usuario a `$_RETURN_STATUS_`
 * @param {object} [context]
 * @param {string} [context.endpoint] nombre del endpoint, para el warning
 * @returns {{statusCode: number, valid: boolean, reason?: string, sendsBody: boolean}}
 */
export const resolveSuccessStatus = (raw, context = {}) => {
  const fallback = { statusCode: 200, valid: false, sendsBody: true };

  if (raw === undefined || raw === null) {
    return { statusCode: 200, valid: true, sendsBody: true };
  }

  // Se exige un entero. `Number("201")` daría 201, pero un string no es lo que el
  // contrato dice y aceptarlo ocultaría el error de programación en vez de avisar.
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    warnInvalidStatus(raw, context);
    return fallback;
  }

  if (raw < 200 || raw > 399) {
    warnInvalidStatus(raw, context);
    return fallback;
  }

  // 204 y 304 no admiten body: es el propio protocolo, no una preferencia.
  if (raw === 204 || raw === 304 || (raw >= 100 && raw <= 199)) {
    return { statusCode: raw, valid: true, sendsBody: false };
  }

  return { statusCode: raw, valid: true, sendsBody: true };
};

/**
 * Códigos 3xx sin `Location` no son utilizables: el cliente no tiene adónde ir.
 * No se corrige ni se bloquea el envío — el autor puede estar redirigiendo con un
 * destino que él mismo compone en el body — pero sí se dice en el log, porque
 * mirar la respuesta y no ver de dónde redirige es un hallazgo que cuesta tiempo.
 */
export const warnIfRedirectWithoutLocation = (statusCode, headers, context = {}) => {
  if (statusCode < 300 || statusCode > 399) return;
  if (statusCode === 304) return;

  let hasLocation = false;
  try {
    if (headers instanceof Map) {
      hasLocation = headers.has("Location") || headers.has("location");
    } else if (headers && typeof headers === "object") {
      hasLocation = Object.keys(headers).some((k) => k.toLowerCase() === "location");
    }
  } catch {
    // Un objeto con getters hostiles no debe tumbar la respuesta.
  }

  if (!hasLocation) {
    console.warn(
      `$_RETURN_STATUS_ = ${statusCode} on endpoint ` +
      `${context.endpoint || "(unknown)"} has no Location header. Clients cannot follow ` +
      `a redirect without it.`,
    );
  }
};

function warnInvalidStatus(raw, context) {
  const shown =
    typeof raw === "string" ? JSON.stringify(raw) : String(raw);
  console.warn(
    `$_RETURN_STATUS_ = ${shown} on endpoint ${context.endpoint || "(unknown)"} ` +
    `is not a valid success status: it must be an INTEGER between 200 and 399. ` +
    `Falling back to 200. Errors (4xx, 5xx) must be raised with $_EXCEPTION_ so the ` +
    `body keeps its standard shape.`,
  );
}

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

  let message =
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

  // El detalle solo sale si el autor lo marcó como público con
  // $_EXCEPTION_({ ..., data: { public } }); el resto se queda en el log.
  const payload = buildErrorPayload(message, trace_id, error);
  if (reply.openfusionapi?.lastResponse) {
    reply.openfusionapi.lastResponse.data = payload;
  }
  reply.code(statusCode).send(payload);
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

// ------------------------------------------------------------------
// Detección de placeholders SQL
// ------------------------------------------------------------------

/** Contenedores en los que puede aparecer un placeholder, según dónde lo encontró el escáner. */
const EN_CODIGO = "codigo";
const EN_COMENTARIO_LINEA = "comentario_linea";
const EN_COMENTARIO_BLOQUE = "comentario_bloque";
const EN_LITERAL = "literal";
const EN_IDENTIFICADOR = "identificador";
const EN_DOLLAR_QUOTED = "dollar_quoted";

/**
 * Busca los `$nombre` que hay dentro de un trozo ya delimitado (un comentario, un
 * literal…) y los etiqueta con el trozo que los contiene.
 *
 * El trozo se recorre con una copia propia de la regex y con el flag `g`, no con el
 * `y` pegajoso del escáner principal: pegajosa solo prueba en `lastIndex` y no busca
 * hacia delante, así que se encontraría con el espacio inicial de `/* sale de
 * $_VAR_X *\/` y no avanzaría nunca. La copia es por `lastIndex`, que es estado
 * compartido entre los dos recorridos.
 *
 * @param {object[]} tokens
 * @param {RegExp} patron regex del escáner principal; se re-instancia en cada uso
 * @param {string} query
 * @param {number} desde inicio del trozo, inclusive
 * @param {number} hasta fin del trozo, exclusive
 * @param {string} contenedor
 */
const anotar = (tokens, patron, query, desde, hasta, contenedor) => {
  if (desde >= hasta) return;
  const re = new RegExp(patron.source, "g");
  re.lastIndex = desde;
  let m;
  while ((m = re.exec(query)) !== null && m.index < hasta) {
    tokens.push({ name: m[0].slice(1), estilo: "bind", contenedor, inicio: m.index, fin: m.index + m[0].length });
    re.lastIndex = m.index + m[0].length;
  }
};

/**
 * Escáner carácter a carácter del SQL. Recorre la consulta una sola vez y anota
 * cada placeholder que encuentra junto con **dónde** está, que es la información
 * que después necesita tanto `scanSqlPlaceholders` (solo quiere los de código) como
 * `prepararSqlParaBinds` (quiere distinguirlos de los que viven en un comentario o
 * en un literal).
 *
 * Por qué un escáner y no una regex: una regex que busque `:nombre` o `$nombre` sobre
 * el SQL crudo confunde sintaxis del dialecto con placeholders. Los falsos positivos
 * reales son:
 *   - casts `::tipo`      → en `$event::json`, `:json` parece un placeholder
 *   - literales de texto  → en `to_char(now(), 'HH24:MI')`, `:MI` no lo es
 *   - comentarios y cuerpos `$$…$$` → un `:param` mencionado en un comentario de
 *     bloque no es un parámetro
 *
 * Con la regex ingenua, `SELECT fn_insert($event::json)` se clasifica como
 * `replacements`, el handler mueve todos los binds a `replacements` y `$event` llega
 * intacto a PostgreSQL, que responde `error de sintaxis en o cerca de «$»`. Ese
 * fallo es determinista: **toda** consulta PostgreSQL que mezcle `$param` con un
 * cast falla siempre.
 *
 * El escáner salta por completo el contenido de literales, identificadores
 * entrecomillados, comentarios y cadenas dollar-quoted, de modo que solo se reportan
 * los `:` y `$` que están en posición de placeholder, y los que sí aparecen dentro
 * de esos trozos quedan etiquetados con el trozo que los contiene.
 *
 * @param {string} query
 * @returns {{name: string, estilo: "bind"|"replacements", contenedor: string, inicio: number, fin: number}[]}
 */
const scanSqlTokens = (query) => {
  const tokens = [];
  if (typeof query !== "string" || query.length === 0) return tokens;

  // Sticky (`y`) + `lastIndex` para anclar cada intento al cursor del escáner.
  const DOLLAR_QUOTED = /\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/y;
  const NAMED_BIND = /\$[A-Za-z_][A-Za-z0-9_]*/y;
  const COLON_PARAM = /:[A-Za-z_][A-Za-z0-9_]*/y;

  const n = query.length;
  let i = 0;

  while (i < n) {
    const c = query[i];
    const next = query[i + 1];

    // Comentario de línea: `-- …` hasta el fin de línea.
    if (c === "-" && next === "-") {
      const desde = i + 2;
      while (i < n && query[i] !== "\n") i++;
      anotar(tokens, NAMED_BIND, query, desde, i, EN_COMENTARIO_LINEA);
      continue;
    }

    // Comentario de bloque: `/* … */`.
    if (c === "/" && next === "*") {
      const desde = i + 2;
      i += 2;
      while (i < n && !(query[i] === "*" && query[i + 1] === "/")) i++;
      anotar(tokens, NAMED_BIND, query, desde, i, EN_COMENTARIO_BLOQUE);
      i += 2;
      continue;
    }

    // Literal de texto: `'…'`, con `''` como escape de comilla simple.
    if (c === "'") {
      const desde = i + 1;
      i++;
      while (i < n) {
        if (query[i] === "'") {
          if (query[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      anotar(tokens, NAMED_BIND, query, desde, i, EN_LITERAL);
      continue;
    }

    // Identificador entrecomillado: `"…"`, con `""` como escape.
    if (c === '"') {
      const desde = i + 1;
      i++;
      while (i < n) {
        if (query[i] === '"') {
          if (query[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      anotar(tokens, NAMED_BIND, query, desde, i, EN_IDENTIFICADOR);
      continue;
    }

    if (c === "$") {
      // Cadena dollar-quoted: `$tag$ … $tag$` (o `$$ … $$`). Su contenido no
      // contiene placeholders aunque parezca uno, así que se salta entera.
      DOLLAR_QUOTED.lastIndex = i;
      const quoted = DOLLAR_QUOTED.exec(query);
      if (quoted) {
        const tag = quoted[0];
        const end = query.indexOf(tag, i + tag.length);
        const desde = i + tag.length;
        i = end === -1 ? n : end + tag.length;
        anotar(tokens, NAMED_BIND, query, desde, i, EN_DOLLAR_QUOTED);
        continue;
      }

      // Bind con nombre: `$param`. Los posicionales `$1` no se detectan a propósito,
      // porque Sequelize solo los usa en `query(…, {bind})` con array.
      NAMED_BIND.lastIndex = i;
      const bind = NAMED_BIND.exec(query);
      if (bind) {
        tokens.push({ name: bind[0].slice(1), estilo: "bind", contenedor: EN_CODIGO, inicio: i, fin: i + bind[0].length });
        i += bind[0].length;
        continue;
      }

      i++;
      continue;
    }

    if (c === ":") {
      // Cast `::tipo` de PostgreSQL: no es un placeholder, se salta de dos en dos.
      if (next === ":") {
        i += 2;
        continue;
      }

      COLON_PARAM.lastIndex = i;
      const colon = COLON_PARAM.exec(query);
      if (colon) {
        tokens.push({ name: colon[0].slice(1), estilo: "replacements", contenedor: EN_CODIGO, inicio: i, fin: i + colon[0].length });
        i += colon[0].length;
        continue;
      }

      i++;
      continue;
    }

    i++;
  }

  return tokens;
};

/**
 * Analiza un SQL y separa los placeholders reales de los `:` que son sintaxis del
 * dialecto. Devuelve los nombres encontrados en cada estilo:
 *   - `bind`:       `$nombre` (param named de Sequelize)
 *   - `replacements`: `:nombre` (param posicional de Sequelize)
 *
 * Solo cuenta los que están en posición de placeholder; los que viven dentro de un
 * literal, un identificador entrecomillado, un comentario o un cuerpo `$$…$$` se
 * descartan, y para eso está `scanSqlTokens`, que además sabe dónde los encontró.
 *
 * @param {string} query
 * @returns {{bind: string[], replacements: string[]}}
 */
export const scanSqlPlaceholders = (query) => {
  const found = { bind: [], replacements: [] };
  for (const token of scanSqlTokens(query)) {
    if (token.contenedor !== EN_CODIGO) continue;
    found[token.estilo].push(token.name);
  }
  return found;
};

/**
 * Deja el SQL listo para que lo sustituya Sequelize sin que los comentarios le
 * confundan y sin que se esconda un `$nombre` dentro de un literal.
 *
 * ## Por qué hace falta
 *
 * Sequelize tiene dos caminos de sustitución y solo uno está ciego a los comentarios:
 *
 *   - `replacements` (`:nombre`, `?`) → `injectReplacements` (`lib/utils/sql.js`) es un
 *     escáner a mano que lleva la cuenta de si está dentro de un literal, un
 *     identificador entrecomillado, un comentario o un cuerpo `$$…$$`.
 *   - `bind` (`$nombre`) → `formatBindParameters`
 *     (`lib/dialects/abstract/query.js`) es una línea: `sql.replace(/\B\$(\$|\w+)/g, …)`.
 *     Una regex no puede distinguir "un `$nombre` en el SQL" de "un `$nombre` que
 *     alguien escribió en un comentario", así que cuenta los dos.
 *
 * La consecuencia es que escribir el nombre de una variable de aplicación dentro de
 * un comentario —`/* sale de $_VAR_MSSQL_TEST *\/`— lo convierte en un parámetro que
 * no existe, y la consulta entera falla con «Named bind parameter has no value in
 * the given object». Da igual que el handler ya supiera ignorarlo: el escáner de
 * `scanSqlPlaceholders` decide *qué se manda*, y la sustitución la hace Sequelize con
 * su propia regex, que es ciega. Por eso esto se corrige aquí y no solo en el handler.
 *
 * ## Lo que se hace con los comentarios: neutralizarlos, no reescribirlos
 *
 * Se inserta un espacio entre el `$` y el nombre: `$_VAR_X` pasa a ser `$ _VAR_X`. La
 * regex de Sequelize exige `\w+` justo detrás del `$`, así que deja de hacer match — y
 * para el motor el comentario sigue siendo un comentario con el mismo texto. El
 * espacio tiene que ir detrás del `$` y no delante: ` $VAR_X` deja el `$` pegado al
 * identificador y la regex casa igual. Es inerte por construcción: no cambia ni una
 * palabra de la consulta que el usuario escribió, y sirve igual para `--`, para
 * `/* … *\/` y para comentarios multilínea.
 *
 * El precio es que el SQL que llega al servidor ya no es byte a byte el del endpoint:
 * el texto de los comentarios lleva un espacio de más. Solo lo nota quien mire el log
 * de consultas del motor, y ese log no tenía nada de lo que fiarse: antes de esto
 * fallaba la consulta entera.
 *
 * ## Lo que se hace con los literales: no tocarlos, pero no dejarlos pasar
 *
 * Un `$nombre` dentro de un literal es un caso distinto y peor. Neutralizarlo también
 * exigiría reescribir el literal con concatenación —`+` en T-SQL, `||` en el resto—,
 * lo que cambia el texto que el cliente recibe, depende del dialecto y no se puede
 * aplicar ni a un identificador entrecomillado ni dentro de un cuerpo `$$…$$`, donde no
 * hay por dónde partirlo. Peor aún es lo que pasa hoy sin hacer nada: si el `$nombre`
 * del literal coincide con un parámetro real, Sequelize lo sustituye y el endpoint
 * responde **200 con el dato cambiado**. `SELECT 'coste: $name'` devuelve
 * `coste: @name`, y quien consume la respuesta no tiene forma de saber que lo que
 * leyó no es lo que se escribió. Un error es un problema; un 200 con el dato
 * corrupto, no.
 *
 * Así que aquí no se neutraliza: se devuelve el aviso en `rechazados` y quien llama
 * lanza un error explicando el conflicto. El autor del endpoint decide si renombra el
 * parámetro o construye ese texto fuera del SQL.
 *
 * @param {string} query
 * @returns {{sql: string, rechazados: {name: string, contenedor: string}[], comentados: number}}
 */
export const prepararSqlParaBinds = (query) => {
  const sinNadaQueHacer = { sql: query, rechazados: [], comentados: 0 };
  // Sin un solo `$` no hay ni bind que confundir ni nada que neutralizar: es el
  // caso de la mayoría de las consultas, y evita recorrerlas enteras.
  if (typeof query !== "string" || query.indexOf("$") === -1) return sinNadaQueHacer;

  const tokens = scanSqlTokens(query);
  if (tokens.length === 0) return sinNadaQueHacer;

  const rechazados = [];
  const neutralizar = [];
  for (const token of tokens) {
    if (token.estilo !== "bind") continue;
    if (token.contenedor === EN_COMENTARIO_LINEA || token.contenedor === EN_COMENTARIO_BLOQUE) {
      neutralizar.push(token);
    } else if (token.contenedor !== EN_CODIGO) {
      rechazados.push({ name: token.name, contenedor: token.contenedor });
    }
  }

  if (rechazados.length === 0 && neutralizar.length === 0) return sinNadaQueHacer;

  // De derecha a izquierda, para que los índices de los parches siguientes sigan
  // apuntando al sitio correcto del texto original. El espacio va DESPUÉS del `$`
  // —`$ _VAR_X`, no ` $VAR_X`— porque lo que hay que interrumpir es el `\w+` que la
  // regex exige justo detrás del `$`. Puesto delante, `$` seguiría pegado al
  // identificador y la regex casaría igual.
  neutralizar.sort((a, b) => b.inicio - a.inicio);
  let sql = query;
  for (const token of neutralizar) {
    sql = sql.slice(0, token.inicio + 1) + " " + sql.slice(token.inicio + 1);
  }

  return { sql, rechazados, comentados: neutralizar.length };
};

/**
 * Decide si la consulta debe viajar con `bind` (`$param`) o con `replacements`
 * (`:param`), que son los dos estilos que acepta Sequelize.
 *
 * Regla de decisión, en orden:
 *   1. Si el endpoint pidió `replacements` explícitamente, gana `replacements`
 *      (se resuelve antes, fuera de esta función).
 *   2. Si la consulta usa `$param` y además `:param`, gana `bind`: los casts `::`
 *      y los literales ya no pueden contaminar la detección, así que un `:` genuine
 *      junto a un `$` indica una consulta que mezcla estilos, y en ese caso `bind` es
 *      el camino que no pierde el `$` sin sustituir.
 *   3. Si solo hay `:param`, gana `replacements`.
 *   4. Si no hay ninguno, gana `bind` (comportamiento previo).
 *
 * @param {string} query
 * @returns {"bind"|"replacements"}
 */
export const detectSqlParamStyle = (query) => {
  const { bind, replacements } = scanSqlPlaceholders(query);
  if (bind.length > 0) return "bind";
  if (replacements.length > 0) return "replacements";
  return "bind";
};

/**
 * Nombres con los que el driver de HANA (`@sap/hana-client`) acepta la contraseña.
 * El de Sequelize es `password`, y aparece suelto en la raíz de la config y también
 * anidado dentro de `options` (`dialectOptions.password`), que es donde algunos
 * drivers la leen. La regla se aplica por nombre de clave y a cualquier nivel: una
 * lista de rutas concretas se queda corta en cuanto alguien anida la credencial un
 * nivel más.
 */
const CREDENTIAL_KEYS = new Set(["password", "pwd"]);

/**
 * Huella de un secreto, para poder compararlo sin escribirlo.
 *
 * Se usa `sha256` sin sal y en hexadecimal, y la razón de que sea sin sal es que la
 * huella tiene que ser estable: es la que decide si dos peticiones comparten el pool
 * de conexiones, y dos procesos —o el mismo proceso tras un reinicio— tienen que
 * llegar a la misma conclusión con la misma configuración. Una sal aleatoria por
 * proceso cumpliría eso, pero una sal fija en el código no protege nada, así que
 * fingiría una garantía que no existe.
 *
 * El residuo honesto de esto: `sha256` de una contraseña corta se puede adivinar por
 * fuerza bruta, así que una clave de caché filtrada no equivale a una contraseña
 * filtrada, pero tampoco es inocua. Quien tenga el log sigue necesitando el log.
 *
 * @param {unknown} value
 * @returns {string}
 */
const fingerprintCredential = (value) =>
  `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;

/** Un objeto plano: lo único que describe una configuración. */
const isPlainConfigObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Claves de la config que no cambian a qué servidor se conecta, y por eso quedan
 * fuera de la clave de caché. `query_type` y `connection_override_allow` se
 * documentan en los AI_SKILL de SQL, SQL_BULK_I y HANA.
 *
 * `parse_bigint` se retiró en 13.11.10: nunca estuvo cableada a nada que llegara
 * al driver, así que activarla no cambiaba el `int8` que recibía el cliente. Su
 * nombre se queda aquí, y no por compatiblidad de API sino porque el camino de
 * HANA serializa la config entera *menos* este set: si un endpoint antiguo
 * conserva la clave en su `custom_data`, entró en la clave de caché mientras la
 * opción vivía, y sacarla de aquí le haría abrir un pool distinto del de otro
 * endpoint idéntico sin la clave. Dos conexiones al mismo servidor que devuelven
 * exactamente lo mismo, que es el coste de una entrada de pool de más.
 */
const PLATFORM_CONFIG_KEYS = new Set([
  "query_type",
  "parse_bigint",
  "connection_override_allow",
]);

/** Claves ya retiradas que se avisa una sola vez por proceso, para no repetir el aviso por conexión. */
const AVISADOS_UNA_VEZ = new Set();

/**
 * Avisa, como mucho una vez por proceso, de una clave de config que ya no hace nada.
 *
 * Sin esto, quitar la clave es un silencio: quien la puso en su endpoint hace meses
 * que espera numeros donde le llegan strings, y no tiene forma de saber que la
 * opcion que configuró fue la que dejo de existir. El aviso se emite una vez porque
 * el pool cachea por config y una peticion por segundo no puede ser una linea por
 * segundo, y porque en los logs de arranque este archivo se lee entero.
 *
 * @param {string} clave
 * @param {string} mensaje
 */
const avisarClaveRetirada = (clave, mensaje) => {
  if (AVISADOS_UNA_VEZ.has(clave)) return;
  AVISADOS_UNA_VEZ.add(clave);
  console.warn(mensaje);
};

/**
 * Build a deterministic cache key for database connections.
 * Includes the resolved environment so production and test connections cannot share a pool entry.
 */
/**
 * Ordena las claves de un objeto de forma recursiva para que dos configuraciones
 * equivalentes produzcan la misma cadena.
 *
 * `JSON.stringify` respeta el orden de inserción, así que `{host, port}` y
 * `{port, host}` —la misma configuración escrita por dos endpoints distintos—
 * darían dos claves y por tanto dos conexiones al mismo servidor. Con un pool
 * acotado eso no es gratuito: son dos entradas que ocupan sitio y expulsan a otras.
 *
 * `null` y `undefined` se omiten. Para cualquier consumidor de la configuración son
 * indistinguibles de "no estaba", y distinguirlos produce claves distintas para
 * configs que se comportan igual. Dentro de un array sí se conservan, porque ahí la
 * posición significa algo.
 *
 * Una excepción a "se serializa tal cual": las claves de credencial no van en claro,
 * van su huella. La clave de caché se imprime en los logs (pool lleno, conexión
 * caduca, entrada vieja) y también viaja dentro de mensajes de error que se guardan
 * fuera, así que serializarla tal cual convierte cada uno de esos logs en una copia
 * de la contraseña de la base de datos. La huella cumple las dos funciones que
 * necesita: sigue distinguiendo una contraseña de otra —que es lo que la clave tiene
 * que hacer— y no se puede leer de vuelta.
 */
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;

  const out = {};
  for (const key of Object.keys(value).sort()) {
    let v = canonicalize(value[key]);
    if (CREDENTIAL_KEYS.has(key) && v !== undefined && v !== null) {
      v = fingerprintCredential(v);
    }
    if (v !== undefined && v !== null) out[key] = v;
  }
  return out;
};

/**
 * Normaliza la lista de claves que el body puede sobrescribir en la conexión.
 *
 * `null` significa "todo permitido", que es el comportamiento por defecto y el que
 * existió siempre. La lista solo actúa sobre endpoints que la declaran, de modo que
 * instalar esto no cambia el comportamiento de nadie hasta que alguien lo pida.
 *
 * Se aceptan rutas con punto para poder ser fino sin renunciar a la granularidad
 * gruesa: `"options"` abre todo `options` de golpe, mientras que
 * `"options.storage"` permite elegir el archivo de un sqlite sin abrir también el
 * motor. Esa distinción es la que hace útil la opción: un multi-tenant que quiere
 * que su cliente elija base puede permitir `database` y negar `options.dialect`
 * sin tener que elegir entre las dos cosas.
 *
 * @param {unknown} raw valor leído de `custom_data.connection_override_allow`
 * @returns {Set<string>|null} rutas normalizadas, o null si no hay restricción
 */
/**
 * Una entrada de la allowlist tiene que parecer un camino de configuración:
 * identificadores separados por puntos. El criterio es práctica, no teórica: se
 * puede elegir el nombre de una base con un guion y `cualquier-cosa` es un nombre
 * tan válido como `db_2`.
 */
const CONFIG_PATH_RE = /^[A-Za-z_$][A-Za-z0-9_$-]*(\.[A-Za-z_$][A-Za-z0-9_$-]*)*$/;

export const parseConnectionOverrideAllowlist = (raw) => {
  if (raw === undefined || raw === null || raw === "") return null;

  let list = raw;
  if (typeof list === "string") {
    const trimmed = list.trim();
    if (trimmed === "") return null;
    // Se admite la forma compacta "database,password" además del array, porque
    // custom_data se escribe a mano con frecuencia y no siempre como JSON válido.
    list = trimmed.split(",");
  }

  if (!Array.isArray(list)) return null;

  const paths = new Set();
  const descartadas = [];

  for (const entry of list) {
    if (typeof entry !== "string") {
      descartadas.push(String(entry));
      continue;
    }
    const path = entry.trim();
    if (path === "" || path === "*") continue;
    if (!CONFIG_PATH_RE.test(path)) {
      descartadas.push(path);
      continue;
    }
    paths.add(path);
  }

  if (descartadas.length > 0) {
    // Una entrada que no puede ser una clave no es una clave, y tratar `"????"` como
    // el nombre de una propiedad deja el endpoint con una lista que no permite
    // nada: un typo silencia la feature sin que nadie lo note. Se avisa porque el
    // error está en la configuración del endpoint y se escribe una sola vez.
    console.warn(
      `[sql][connection-override] connection_override_allow: entradas que no son rutas de configuración, ignoradas -> ${descartadas.join(", ")}`,
    );
  }

  // Una lista que se queda vacía tras limpiar no restringe nada, y restringir a nada
  // sería una forma indirecta de desactivar la feature que nadie pidió. Se trata
  // como "sin restricción", que es lo que alguien que la escribió así quería.
  //
  // Quien quiera negar todo lo declara de forma explícita y reconocible, con una
  // clave que existe pero que no conviene permitir: `["__nada__"]` bloquea igual que
  // `["options"]` en un handler con techo, y no se confunde con un error de dedo.
  return paths.size > 0 ? paths : null;
};

/**
 * Calcula la lista efectiva combinando el techo del handler con lo que declara el
 * endpoint. Siempre es una **intersección**: el endpoint puede estrechar lo que el
 * handler permite, nunca ampliarlo.
 *
 * La monotonicidad no es un detalle, es lo que hace segura la lectura de la
 * lista. Si bastara con declarar `connection_override_allow` para cambiar el
 * conjunto, entonces el orden en que se lee —antes de mezclar el body— sería lo
 * único que impide que un llamante se conceda permisos a sí mismo, y eso es
 * apoyarse en un detalle de implementación. Con la intersección, que el handler
 * fije un techo convierte el detalle en irrelevante: aunque el body declarase
 * una lista, no podría pasar de ese techo.
 *
 * `null` significa "sin restricción" y solo sobrevive si NINGÚN lado restringe.
 *
 * @param {Set<string>|null} defaultAllowlist techo impuesto por el handler
 * @param {Set<string>|null} declared lista declarada por el endpoint
 * @returns {Set<string>|null}
 */
export const resolveConnectionOverrideAllowlist = (defaultAllowlist, declared) => {
  if (defaultAllowlist === null) return declared;
  if (declared === null) return defaultAllowlist;

  const out = new Set();
  for (const path of declared) {
    // El endpoint nombra algo que el techo ya permite: se respeta tal cual.
    if (isPathAllowed(defaultAllowlist, path)) {
      out.add(path);
      continue;
    }
    // El endpoint estrecha un nivel más dentro de algo que el techo permite. Aquí
    // la intersección literal daría vacío y negaría de más, así que se conservan
    // las entradas del techo que caen dentro de lo declarado.
    for (const ceiling of defaultAllowlist) {
      if (ceiling.startsWith(path + ".")) out.add(ceiling);
    }
  }
  return out;
};

/**
 * ¿La lista permite tocar esta ruta concreta?
 *
 * Se recorre el prefijo ENTERO, no solo el primer segmento. Comprobar únicamente
 * `options` de `options.dialectOptions.ssl` parece suficiente hasta que se prueba
 * con una allowlist de dos niveles: la rama entraba por su propio nombre pero sus
 * hojas ya no tenían ancestro reconocido y se rechazaban todas. Un fallo así no
 * lanza error, deja de aplicar en silencio, y justo en el caso donde alguien se
 * tomó el trabajo de acotar.
 */
const isPathAllowed = (allowlist, path) => {
  if (allowlist === null) return true;
  if (allowlist.has(path)) return true;

  for (let cut = path.indexOf("."); cut !== -1; cut = path.indexOf(".", cut + 1)) {
    if (allowlist.has(path.slice(0, cut))) return true;
  }
  return false;
};

/**
 * Aplica el override del body respetando la allowlist del endpoint.
 *
 * Devuelve por separado lo aplicado y lo descartado, porque son dos hechos
 * distintos y el llamante registra uno como uso previsto y el otro como un
 * intento que no prosperó. Confundirlos sería justo el error que la allowlist
 * pretende evitar.
 *
 * La lista se resuelve sobre las rutas del override, no sobre las de la
 * configuración final: si el endpoint no declara `options.host`, el hecho de que
 * ese valor venga del `custom_data` guardado no lo hace tocable.
 *
 * @param {object} config configuración almacenada del endpoint
 * @param {object} override objeto `connection` recibido en el body
 * @param {Set<string>|null} allowlist
 * @returns {{config: object, applied: string[], rejected: string[]}}
 */
export const applyConnectionOverride = (config = {}, override, allowlist = null) => {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return { config, applied: [], rejected: [] };
  }

  const applied = new Set();
  const rejected = new Set();

  const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  /** ¿Hay alguna entrada de la allowlist dentro de esta rama? */
  const hasAllowedDescendant = (path) => {
    if (allowlist === null) return true;
    for (const allowed of allowlist) {
      if (allowed.startsWith(path + ".")) return true;
    }
    return false;
  };

  /**
   * Anota una rama entera como descartada. Se registran la raíz y sus hojas
   * porque un `options` entero rechazado y un `options.dialect` rechazado son
   * cosas distintas en el log: el primero dice que el llamador intentó
   * reemplazar el bloque de conexión completo, el segundo que intentó cambiar el
   * motor. En el log solo hay texto libre, así que la forma de la ruta es la
   * única pista.
   */
  const rejectBranch = (path, value) => {
    rejected.add(path);
    if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        const child = `${path}.${k}`;
        rejected.add(child);
        if (isPlainObject(v)) rejectBranch(child, v);
      }
    }
  };

  /**
   * Mezcla en profundidad solo lo permitido.
   *
   * El merge es SIEMPRE el mismo, con allowlist o sin ella. La allowlist decide
   * únicamente qué rutas se escriben, nunca cómo se combinan. Esa es la razón por
   * la que aquí no hay una rama de "copia entera" para lo permitido: si la hubiera,
   * declarar una allowlist cambiaría también la semántica del merge, y un endpoint
   * que declarase `["options"]` perdería de golpe las claves de `options` que el
   * body no mencionara. Un comportamiento que depende de si declaraste la
   * restricción es un comportamiento que nadie espera.
   *
   * Sobre una rama hay dos salidas y solo dos: si la lista concede algo dentro de
   * ella, se baja a decidir hoja por hoja —donde cada hoja vuelve a preguntar—; si
   * no concede nada, se descarta entera. Preguntar en la hoja y no en la rama es lo
   * que hace que `["options.host"]` permita una clave y deniegue la vecina, y lo que
   * hace que `["options"]` permita todas sin ningún caso especial.
   */
  const pick = (source, base, prefix) => {
    const out = isPlainObject(base) ? { ...base } : {};

    for (const [key, value] of Object.entries(source)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (isPlainObject(value)) {
        if (isPathAllowed(allowlist, path) || hasAllowedDescendant(path)) {
          out[key] = pick(value, isPlainObject(out[key]) ? out[key] : {}, path);
        } else {
          rejectBranch(path, value);
        }
        continue;
      }

      // Las hojas (valores escalares y arrays) se deciden una a una. Un array es
      // un valor, no una rama: si se permite la ruta se mezcla entero, y si no se
      // rechaza entero. Nunca se partializa.
      if (isPathAllowed(allowlist, path)) {
        out[key] = value;
        applied.add(path);
      } else {
        rejected.add(path);
      }
    }

    return out;
  };

  return {
    config: pick(override, config, ""),
    applied: [...applied],
    rejected: [...rejected],
  };
};

/**
 * Clave de caché determinista para las conexiones de base de datos.
 *
 * Incluye el entorno resuelto para que una conexión de `prd` y otra de `dev` no
 * compartan entrada, aunque apunten al mismo host.
 *
 * Sobre `options` se serializa el objeto ENTERO, no una lista de campos elegidos a
 * mano. La lista anterior (host, port, dialect, dialectOptions, pool, ssl) dejaba
 * fuera opciones que sí cambian a qué servidor se conecta, y el fallo que produce
 * no es un error visible sino una respuesta equivocada: con sqlite, `storage` es
 * el archivo real y `database` es solo una etiqueta, así que dos endpoints con el
 * mismo `database` y distinto `storage` compartían la conexión del primero y el
 * segundo leía la base equivocada sin decir nada. Lo mismo pasaba con el socket
 * unix de MySQL (`path`/`socketPath`), con el `search_path` de PostgreSQL
 * (`schema`) y con `timezone`, que es estado de sesión y cambia el resultado de
 * las consultas. Enumerar a mano una lista de campos tiene un alcance limitado:
 * cada opción que falta se añade solo cuando alguien la reporta, y para entonces
 * ya devolvió datos incorrectos.
 *
 * El efecto secundario es que dos configs que difieren en una opción irrelevante
 * ya no comparten conexión. Es el coste correcto: o son la misma conexión o son
 * conexiones distintas de verdad, y el pool está acotado y avisa cuando se llena.
 *
 * ## Contraseña
 *
 * La clave incluye la huella de la contraseña y no la contraseña. Sin ella, dos
 * endpoints sobre la misma base y el mismo usuario pero con distinta contraseña
 * compartían entrada: el segundo heredaba la conexión que abrió el primero y se
 * ejecutaba con sus credenciales sin saberlo. Un tenant con la contraseña
 * caducada no recibía un error de autenticación, leía los datos de otro. Y al revés:
 * un endpoint con la contraseña equivocada contestaba con los datos de quien sí
 * tenía razón. El fallo no es un error, es una respuesta de otro.
 *
 * ## Configs que no son de Sequelize
 *
 * HANA no pasa por Sequelize: su config no trae `options` y describe la conexión en
 * la raíz con otros nombres —`serverNode`, `databaseName`, `user`/`uid`,
 * `encrypt`, `sslValidateCertificate`—, así que ni `database` ni `username` ni
 * `password` dicen nada de ella. Ahora que el handler de HANA usa esta función, la
 * función tiene que saber leer esa forma: si no, todos esos campos entrarían como
 * `undefined` y dos tenants distintos compartirían entrada.
 *
 * Para esa forma el config entero se despliega en la clave, que es lo mismo que ya
 * se hace con `options` en el camino de Sequelize y evita mantener una lista de
 * campos a mano que se queda corta en el siguiente campo nuevo. El despliegue se
 * hace solo cuando NO hay `options`: en la forma de Sequelize, el resto de la raíz
 * son campos que la conexión no lee, y separarlos crearía entradas de pool que no
 * corresponden a conexiones distintas.
 */
export const buildConnectionCacheKey = (config = {}, environment = 'dev') => {
  // Solo un objeto plano describe opciones. `ConnectionPool` las consume con
  // `{...config.options}`, así que un array se extiende a `{}` y un `null` se
  // extiende a `{}`: ninguno de los dos es una configuración distinta, y
  // diferenciarlos haría que dos usos idénticos ocuparan dos entradas del pool.
  const options = isPlainConfigObject(config?.options) ? config.options : undefined;

  // Config sin `options`: la conexión entera está en la raíz y se serializa entera,
  // menos las claves que la plataforma usa para sí misma y que no cambian a qué
  // servidor se conecta. Aquí la lista es de EXCLUSIÓN, al revés que en el camino de
  // Sequelize, y la asimetría es deliberada: olvidarse de una clave de esta lista
  // cuesta una entrada de pool de más, mientras que olvidarse de un campo de
  // conexión —justo lo que se arregla aquí— reparte los datos de un tenant entre
  // endpoints que no lo comparten.
  let raiz;
  if (options === undefined && isPlainConfigObject(config)) {
    raiz = {};
    for (const [campo, valor] of Object.entries(config)) {
      if (!PLATFORM_CONFIG_KEYS.has(campo)) raiz[campo] = valor;
    }
  }

  // El aviso va aquí y no en la construcción de la conexión porque esta función la
  // usan tanto el camino de Sequelize como el de HANA, y la clave retirada puede
  // venir en cualquiera de los dos. Se emite una vez por proceso.
  if (config?.parse_bigint !== undefined && config?.parse_bigint !== null) {
    avisarClaveRetirada(
      "parse_bigint",
      "[ConnectionPool] La clave `parse_bigint` de custom_data se retiró en 13.11.10: nunca estuvo " +
        "conectada al driver, así que no convertía nada y el `bigint` que recibes es el mismo con la " +
        "clave puesta que sin ella. Se ignora en silencio a partir de ahora. Si esperabas números donde " +
        "llegas strings, la conversión que sí funciona es la de la plataforma en sus propias tablas, " +
        "no una clave del endpoint.",
    );
  }

  return JSON.stringify(
    canonicalize({
      ...raiz,
      environment,
      // Los tres siguientes aceptan el nombre de cada motor: Sequelize usa
      // `database`/`username`/`password` y HANA `databaseName`/`user`/`password` o
      // sus alias `uid`/`pwd`. Con un solo nombre, una config de HANA describía su
      // destino con campos que la clave no leía.
      database: config?.database ?? config?.databaseName,
      username: config?.username ?? config?.user ?? config?.uid,
      password: config?.password ?? config?.pwd,
      // `parse_bigint` ya no está, y su ausencia es el arreglo. Durante 13.11.0 a
      // 13.11.9 estuvo en la clave para que dos endpoints que difieran en ella
      // recibieran `int8` de forma distinta; como la opción no hacía nada, esa
      // separación solo compraba dos entradas de pool y dos conjuntos de conexiones
      // para entregar exactamente la misma respuesta.
      options,
    }),
  );
};
