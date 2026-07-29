import { mergeObjects } from "../server/utils.js";
import {
  getAppVarContext,
  getHandlerExecutionContext,
  parseJsonConfig,
  replyException,
  sendHandlerError,
  sendHandlerResponse,
  resolveAppVarPlaceholder,
} from "./utils.js";
import hana from "@sap/hana-client";

const connections = new Map();
const MAX_CONNECTIONS = 50;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const RESERVED_HANA_REQUEST_KEYS = new Set([
  "bind",
  "replacements",
  "params",
  "config",
]);

/**
 * Obtiene un pool de conexiones HANA del caché o crea uno nuevo.
 * Implementa LRU (Least Recently Used) y TTL.
 */
const getConnection = async (configHash, paramsSQL) => {
  const now = Date.now();

  // 1. Verificar Caché
  if (connections.has(configHash)) {
    const entry = connections.get(configHash);

    // Verificar TTL
    if (now - entry.created > CACHE_TTL) {
      console.log(`HANA Pool expired: ${configHash}`);
      try {
        entry.pool.clear();
      } catch (e) {
        console.error("Error disconnecting expired pool", e);
      }
      connections.delete(configHash);
    } else {
      // Actualizar uso y retornar
      entry.lastUsed = now;
      return entry.pool;
    }
  }

  // 2. Limpieza LRU si está lleno
  if (connections.size >= MAX_CONNECTIONS) {
    let oldestHash = null;
    let oldestTime = Infinity;

    for (const [hash, entry] of connections.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestHash = hash;
      }
    }

    if (oldestHash) {
      console.log(`Closing idle HANA pool: ${oldestHash}`);
      const oldEntry = connections.get(oldestHash);
      try {
        oldEntry.pool.clear();
      } catch (err) {
        console.error("Error closing idle HANA pool:", err);
      }
      connections.delete(oldestHash);
    }
  }

  // 3. Crear nuevo Pool
  // @ts-ignore
  const pool = hana.createPool(paramsSQL.config, {
    max: 10,
    min: 0,
    maxIdleTime: 20000, // 20 segundos idle
    checkInterval: 5000,
  });

  // 4. Guardar en caché
  connections.set(configHash, {
    pool,
    created: now,
    lastUsed: now,
  });

  return pool;
};

/**
 * Evicta un pool cacheado sin esperar a que cierre (best-effort). Se usa cuando
 * una query excede su timeout, para que la siguiente petición no reutilice un
 * pool cuyas conexiones puedan haber quedado colgadas contra HANA.
 */
const invalidatePool = (configHash) => {
  const entry = connections.get(configHash);
  if (!entry) {
    return;
  }

  connections.delete(configHash);

  try {
    entry.pool.clear();
  } catch (err) {
    console.error(`Error invalidating HANA pool ${configHash}:`, err.message);
  }
};

export const sqlHana = async (context) => {
  const { request, reply, method, endpoint } = getHandlerExecutionContext(context);
  try {
    const { appVars, environment } = getAppVarContext(endpoint, method);
    const custom_data = resolveAppVarPlaceholder(
      method.custom_data,
      appVars,
      environment,
    );
    const parsedConfig = parseJsonConfig(custom_data);

    let paramsSQL = {
      query: method.code,
      config: parsedConfig,
    };

    /*
    try {
      paramsSQL = JSON.parse(method.code);
    } catch (e) {
      reply.code(400).send({ error: "Invalid JSON in method code" });
      return;
    }
    */

    let data_request = {};

    const requestQuery = request.query && typeof request.query === "object" ? request.query : {};
    const requestBody = request.body && typeof request.body === "object" ? request.body : {};

    if (request.method == "GET") {
      // Compatibilidad: los query params del GET funcionan como bind
      data_request.bind = requestQuery;
    } else {
      // En métodos distintos de GET se soportan query + body, con body como prioridad.
      data_request = mergeObjects(requestQuery, requestBody);
    }

    if (data_request) {
      // 104: Securely merge connection parameters
      if (data_request.config) {
        let connection_json;
        try {
          connection_json =
            typeof data_request.config === "object"
              ? data_request.config
              : JSON.parse(data_request.config);
        } catch (e) {
          sendHandlerError(reply, 400, "Invalid JSON in connection params");
          return;
        }

        // SECURITY: Only allow specific overrides (uid, pwd)
        // Prevent clients from changing the host/port or other critical configs
        const ALLOWED_OVERRIDES = ["uid", "pwd", "user", "password"];
        const safe_connection_params = {};

        for (const key of Object.keys(connection_json)) {
          if (ALLOWED_OVERRIDES.includes(key)) {
            safe_connection_params[key] = connection_json[key];
          }
        }

        paramsSQL.config = mergeObjects(paramsSQL.config, safe_connection_params);
      }


      // Initialize defaults if needed (e.g., encryption)
      if (paramsSQL.config) {
        if (paramsSQL.config.encrypt === undefined) {
          paramsSQL.config.encrypt = true;
        }
        // Common for internal IP usage to skip cert validation
        if (paramsSQL.config.sslValidateCertificate === undefined) {
          paramsSQL.config.sslValidateCertificate = false;
        }
      }

      //      console.log(paramsSQL);

      if (paramsSQL.config) {
        const configHash = JSON.stringify(paramsSQL.config);
        const pool = await getConnection(configHash, paramsSQL);

        // Obtener parámetros de bind o replacements (ambos válidos)
        let bind_json = undefined;

        // Prioridad: replacements > bind > params (retrocompatibilidad)
        if (data_request.replacements) {
          bind_json = data_request.replacements;
        } else if (data_request.bind) {
          try {
            bind_json = typeof data_request.bind === "object"
              ? data_request.bind
              : JSON.parse(data_request.bind);
          } catch (e) {
            sendHandlerError(reply, 400, "Invalid JSON in bind params");
            return;
          }
        } else if (data_request.params) {
          try {
            bind_json = typeof data_request.params === "object"
              ? data_request.params
              : JSON.parse(data_request.params);
          } catch (e) {
            sendHandlerError(reply, 400, "Invalid JSON in params");
            return;
          }
        } else if (data_request && typeof data_request === "object") {
          bind_json = Object.fromEntries(
            Object.entries(data_request).filter(
              ([key]) => !RESERVED_HANA_REQUEST_KEYS.has(key),
            ),
          );
        }

        // Estandarizar keys: limpiar prefijos (:, $, @)
        // NOTA: No se hace JSON.stringify de arrays porque executeQuery los necesita
        // para expandir IN(:param) a IN(?, ?, ...)
        let clean_params = undefined;
        if (bind_json) {
          if (Array.isArray(bind_json)) {
            clean_params = bind_json;
          } else {
            clean_params = {};
            for (let param in bind_json) {
              const key = param.replace(/^[:$@]/, '');
              const valor = bind_json[param];
              if (Array.isArray(valor)) {
                // Preservar arrays para expansión IN(?, ?, ...)
                clean_params[key] = valor;
              } else if (typeof valor === "object" && valor !== null) {
                clean_params[key] = JSON.stringify(valor);
              } else {
                clean_params[key] = valor;
              }
            }
          }
        }

        // Endpoint-configured timeout (seconds). Without it, a stalled HANA connection
        // leaves the request hanging forever, ignoring the timeout set for this endpoint.
        const hasEndpointTimeout = method?.timeout !== undefined && method?.timeout !== null;
        const endpointTimeoutSeconds = hasEndpointTimeout ? Number(method.timeout) : undefined;
        const endpointTimeoutMs =
          hasEndpointTimeout && Number.isFinite(endpointTimeoutSeconds) && endpointTimeoutSeconds > 0
            ? endpointTimeoutSeconds * 1000
            : undefined;

        const runQuery = () => executeQuery(
          pool,
          paramsSQL.query,
          clean_params,
          paramsSQL.options
        );

        let result;

        if (endpointTimeoutMs) {
          let timeoutHandle;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
              const timeoutError = new Error(
                `HANA handler execution timed out after ${endpointTimeoutMs}ms`,
              );
              timeoutError.name = "TimeoutError";
              reject(timeoutError);
            }, endpointTimeoutMs);
          });

          try {
            result = await Promise.race([runQuery(), timeoutPromise]);
          } catch (raceErr) {
            if (raceErr?.name === "TimeoutError") {
              invalidatePool(configHash);
              sendHandlerError(reply, 504, raceErr.message);
              return;
            }
            throw raceErr;
          } finally {
            clearTimeout(timeoutHandle);
          }
        } else {
          result = await runQuery();
        }

        sendHandlerResponse(reply, {
          statusCode: 200,
          data: result,
        });
        /*
        var conn_params_qa = {
          "serverNode": "192.169.178.123:10349",
          "uid": "USER",
          "pwd": "PASS123",
        };
        */

        //  console.log('-------------> ', result_query.toSQL())
      } else {
        sendHandlerError(reply, 400, "Params configuration is not complete");
      }
    } else {
      sendHandlerError(reply, 400, "Not data");
    }
  } catch (error) {
    replyException(request, reply, error);
  }
};

function executeQuery(pool, command, params_bind, options) {
  return new Promise((resolve, reject) => {
    // 1. Parsing Single-Pass para robustez (ignora quotes)
    let new_command = "";
    let params = [];
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let i = 0;

    try {
      while (i < command.length) {
        const char = command[i];

        // Manejo de comillas
        if (char === "'" && !inDoubleQuote) {
          inSingleQuote = !inSingleQuote;
          new_command += char;
          i++;
          continue;
        }
        if (char === '"' && !inSingleQuote) {
          inDoubleQuote = !inDoubleQuote;
          new_command += char;
          i++;
          continue;
        }

        // Detección de Placeholders fuera de comillas
        if (
          !inSingleQuote &&
          !inDoubleQuote &&
          (char === "$" || char === ":")
        ) {
          // Extraer nombre del placeholder
          let j = i + 1;
          while (j < command.length && /[a-zA-Z0-9_]/.test(command[j])) {
            j++;
          }
          const placeholder = command.slice(i, j);
          const bindName = placeholder.replace(/[:$]/g, "");

          if (j > i + 1) {
            // Placeholder válido encontrado
            // Verificar existencia en bind params
            if (
              params_bind &&
              Object.prototype.hasOwnProperty.call(params_bind, bindName)
            ) {
              const value = params_bind[bindName];

              if (Array.isArray(value)) {
                // Expansión de Arrays: IN (?) -> IN (?,?,?)
                if (value.length === 0) {
                  throw new Error(
                    `Empty array provided for parameter ${placeholder}`
                  );
                }
                const placeholders = value.map(() => "?").join(", ");
                new_command += placeholders;
                params.push(...value);
              } else {
                // Valor simple
                new_command += "?";
                params.push(value);
              }
            } else {
              throw new Error(`Missing parameter value for ${placeholder}`);
            }

            i = j; // Saltar placeholder
            continue;
          }
        }

        // Caracter normal
        new_command += char;
        i++;
      }
    } catch (err) {
      return reject(err);
    }

    // 2. Ejecución con Pool



    pool.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      connection.exec(new_command, params, options, (err, result) => {
        connection.close(); // Liberar conexión al pool
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  });
}

/*

Manual Verification
Multiple Requests: Verify process handle count stays stable.
Complex Query: Verify $param used multiple times works correctly.

*/