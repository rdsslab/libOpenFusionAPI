import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getHandlerExecutionContext } from "./utils.js";
import {
  parseJsonConfig,
  resolveAppVarPlaceholder,
  replyException,
  sendHandlerError,
  sendHandlerResponse,
  applyConnectionOverride,
  buildConnectionCacheKey,
  parseConnectionOverrideAllowlist,
  resolveConnectionOverrideAllowlist,
  getAppVarContext,
  createBadRequestError,
} from "./utils.js";
import { recordConnectionOverride } from "./connectionOverrideLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESERVED_HIVE_REQUEST_KEYS = new Set(["bind", "replacements", "connection"]);

/**
 * Handler HIVE-DRIVER (Impala / Hive via hive-driver puro JS)
 *
 * Mitigaciones incluidas:
 * - Aislamiento con worker_threads (evita bloqueo del event loop por deserialización Thrift)
 * - Paginação por lotes (maxRows) para evitar traer millones de filas de golpe
 * - TLS opcional para proteger credenciales de dominio (LDAP/PLAIN)
 * - Sustitución segura de parámetros (bind) con escape de literales SQL
 * - Precisión de números grandes: devuelve Int64 como string cuando corresponde
 * - Auth pluggable: hoy usa PlainTcpAuthentication; en futuro cambiar a KerberosTcpAuthentication sin tocar handler
 */

export const hiveFunction = async (context) => {
  const { request, reply, method, endpoint } = getHandlerExecutionContext(context);
  try {
    const { appVars, environment } = getAppVarContext(endpoint, method);
    let custom_data = method.custom_data;
    custom_data = resolveAppVarPlaceholder(custom_data, appVars, environment);

    let paramsSQL = {
      query: method.code,
      config: parseJsonConfig(custom_data),
    };

    if (!paramsSQL.config || (typeof paramsSQL.config === "object" && Object.keys(paramsSQL.config).length === 0)) {
      const fallbackConfig = resolveAppVarPlaceholder("$_VAR_HIVE_CONFIG", appVars, environment);
      if (fallbackConfig && typeof fallbackConfig === "object") {
        paramsSQL.config = fallbackConfig;
      }
    }

    // Obtener datos de request (GET / POST)
    const requestQuery = request.query && typeof request.query === "object" ? request.query : {};
    const requestBody = request.body && typeof request.body === "object" ? request.body : {};
    let data_request = {};
    if (request.method === "GET") {
      data_request.bind = requestQuery;
    } else {
      data_request = { ...requestQuery, ...requestBody };
    }

    if (data_request) {
      if (data_request.config) {
        let connection_json;
        try {
          connection_json = typeof data_request.config === "object" ? data_request.config : JSON.parse(data_request.config);
        } catch (e) {
          sendHandlerError(reply, 400, "Invalid JSON in connection params");
          return;
        }
        const hiveCeiling = new Set([
          "host", "port", "username", "password", "database",
          "useTLS", "tls", "authType", "maxRows", "timeoutMs"
        ]);
        const overrideAllowlist = resolveConnectionOverrideAllowlist(
          hiveCeiling,
          parseConnectionOverrideAllowlist(paramsSQL.config?.connection_override_allow),
        );
        const { config: merged, applied, rejected } = applyConnectionOverride(
          paramsSQL.config,
          connection_json,
          overrideAllowlist,
        );
        paramsSQL.config = merged;
        if (applied.length > 0 || rejected.length > 0) {
          recordConnectionOverride(
            { applied, rejected },
            overrideAllowlist,
            {
              handler: "HIVE_DRIVER",
              resource: method.resource,
              idendpoint: method.idendpoint,
              idapp: method.idapp,
              environment,
            },
            { method: request.method, url: request.url },
          );
        }
      }

      // Extraer bind params (como hace sqlFunction / sqlHana)
      let bind_json = undefined;
      let replacements = undefined;

      if (data_request.replacements) {
        replacements = data_request.replacements;
      }
      if (data_request.bind) {
        try {
          bind_json = typeof data_request.bind === "object" ? data_request.bind : JSON.parse(data_request.bind);
        } catch (e) {
          sendHandlerError(reply, 400, "Invalid JSON in bind params");
          return;
        }
      } else if (data_request && typeof data_request === "object") {
        bind_json = Object.fromEntries(
          Object.entries(data_request).filter(([key]) => !RESERVED_HIVE_REQUEST_KEYS.has(key)),
        );
      }

      // Normalizar keys (quitar prefijos : $ @)
      let clean_bind = undefined;
      if (bind_json) {
        if (Array.isArray(bind_json)) {
          clean_bind = bind_json;
        } else {
          clean_bind = {};
          for (const param in bind_json) {
            const key = param.replace(/^[:$@]/, "");
            const valor = bind_json[param];
            if (Array.isArray(valor)) {
              clean_bind[key] = valor;
            } else if (typeof valor === "object" && valor !== null) {
              clean_bind[key] = JSON.stringify(valor);
            } else {
              clean_bind[key] = valor;
            }
          }
        }
      }

      // Auto-detectar replacements (:nombre) vs bind ($nombre)
      // Para Impala/Hive, no hay placeholders nativos, así que usamos sustitución segura literal
      let sql = paramsSQL.query || "";
      if (replacements && clean_bind) {
        sql = substituteBindParams(sql, clean_bind, "replacements");
      } else if (clean_bind && Object.keys(clean_bind).length > 0) {
        sql = substituteBindParams(sql, clean_bind, "bind");
      }

      if (!paramsSQL.config || !paramsSQL.config.host || !paramsSQL.query) {
        sendHandlerError(reply, 400, "Params configuration is not complete (need host, port, query)");
        return;
      }

      // Configuración de ejecución
      const endpointTimeoutMs = method?.timeout !== undefined && method?.timeout !== null
        ? Number(method.timeout) * 1000
        : undefined;

      const maxRows = Number(paramsSQL.config.maxRows || 1000);
      const timeoutMs = Number(paramsSQL.config.timeoutMs || (endpointTimeoutMs || 30000));

      try {
        // EJECUCIÓN Aislada con worker_threads para evitar bloqueo del event loop
        const result = await runHiveWorker({
          sql,
          config: paramsSQL.config,
          bind: clean_bind,
          maxRows,
          timeoutMs,
        });

        sendHandlerResponse(reply, {
          statusCode: 200,
          data: result,
        });
      } catch (err) {
        if (err?.name === "TimeoutError") {
          sendHandlerError(reply, 504, err.message);
        } else {
          replyException(request, reply, err);
        }
      }
    } else {
      sendHandlerError(reply, 400, "Not data");
    }
  } catch (error) {
    replyException(request, reply, error);
  }
};

/**
 * Sustitución segura de parámetros para Impala/Hive
 * No usa placeholders nativos (no hay bind de servidor), hace sustitución literal con escape.
 */
function substituteBindParams(sql, params, style) {
  if (!sql || !params) return sql;
  const isReplacements = style === "replacements"; // usa :nombre
  const regex = isReplacements ? /:([a-zA-Z_][a-zA-Z0-9_]*)/g : /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

  let replaced = sql;
  // Si hay arrays, reemplazamos con expansión IN(...)
  for (const [key, value] of Object.entries(params)) {
    const placeholder = isReplacements ? ":" + key : "$" + key;
    if (Array.isArray(value) && value.length > 0) {
      const expanded = value.map(v => safeLiteral(v)).join(", ");
      replaced = replaced.split(placeholder).join(expanded);
    } else {
      replaced = replaced.split(placeholder).join(safeLiteral(value));
    }
  }
  return replaced;
}

function safeLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null && typeof value.low === "number" && typeof value.high === "number") {
    // Int64 / BigInt como string para preservar precisión
    return `"${String(value)}"`;
  }
  // String: escapar comillas simples duplicándolas; envolver en comillas simples
  const s = String(value);
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Ejecuta la consulta aislada en un Worker para no bloquear el event loop.
 */
function runHiveWorker({ sql, config, bind, maxRows, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, "hive-worker.js"), {
      workerData: { sql, config, bind, maxRows, timeoutMs },
    });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Hive query time out after " + timeoutMs + "ms"));
    }, timeoutMs + 5000); // margen para cierre

    worker.on("message", (msg) => {
      clearTimeout(timer);
      if (msg.error) {
        const err = new Error(msg.error);
        err.name = msg.name || "HiveDriverError";
        reject(err);
      } else {
        resolve(msg.result);
      }
      worker.terminate();
    });

    worker.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    worker.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error("Hive worker exited with code " + code));
      }
    });
  });
}
