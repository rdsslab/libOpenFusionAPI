import { Sequelize, QueryTypes } from "sequelize";
import { getAppVarsByIdApp } from "../db/appvars.js";
import {
  getAppVarContext,
  getHandlerExecutionContext,
  parseJsonConfig,
  replyException,
  sendHandlerError,
  sendHandlerResponse,
  buildConnectionCacheKey,
  resolveAppVar,
  resolveAppVarPlaceholder,
} from "./utils.js";

import { Pool } from "./ConnectionPool.js";
import { mergeObjects } from "../server/utils.js";

const mergeAppVarsByEnvironment = (baseAppVars, overrideAppVars) => {
  if (!baseAppVars && !overrideAppVars) {
    return undefined;
  }

  const merged = { ...(baseAppVars || {}) };

  if (!overrideAppVars || typeof overrideAppVars !== "object") {
    return merged;
  }

  for (const [environment, values] of Object.entries(overrideAppVars)) {
    if (!values || typeof values !== "object") {
      merged[environment] = values;
      continue;
    }

    merged[environment] = {
      ...(merged[environment] || {}),
      ...values,
    };
  }

  return merged;
};

const extractMssqlErrorNumber = (error) => {
  const directNumber = error?.parent?.number ?? error?.original?.number;
  if (typeof directNumber === "number") {
    return directNumber;
  }

  const parentErrors = error?.parent?.errors;
  if (Array.isArray(parentErrors)) {
    const nested = parentErrors.find((item) => typeof item?.number === "number");
    if (nested) {
      return nested.number;
    }
  }

  return undefined;
};

const isLiveAppVarsRefreshEnabled = () => {
  const raw = String(process.env.OFAPI_APPVARS_LIVE_READ || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const RESERVED_SQL_REQUEST_KEYS = new Set(["bind", "replacements", "connection"]);

export const sqlFunction = async (context) => {
  const { request, reply, method, endpoint } = getHandlerExecutionContext(context);
  try {
    // Resolve AppVar placeholder if present in custom_data
    let custom_data = method.custom_data;
    const { appVars: appVarsSnapshot, environment } = getAppVarContext(
      endpoint,
      method,
    );
    let appVars = appVarsSnapshot;

    // By default we use endpoint cache snapshot (faster and now invalidated on AppVar changes).
    // Live DB refresh is optional and disabled by default.
    if (endpoint?.idapp && isLiveAppVarsRefreshEnabled()) {
      try {
        const liveAppVars = await getAppVarsByIdApp(endpoint.idapp);
        if (Array.isArray(liveAppVars) && liveAppVars.length > 0) {
          const liveAppVarsByEnvironment = liveAppVars.reduce((acc, item) => {
            if (!acc[item.environment]) {
              acc[item.environment] = {};
            }
            acc[item.environment][item.name] = item.value;
            return acc;
          }, {});

          appVars = mergeAppVarsByEnvironment(
            appVarsSnapshot,
            liveAppVarsByEnvironment,
          );
        }
      } catch (error) {
        console.warn("[sqlFunction] Could not refresh live app vars from PostgreSQL:", error?.message || error);
      }
    }

    custom_data = resolveAppVarPlaceholder(custom_data, appVars, environment);

    let paramsSQL = {
      query: method.code,
      config: parseJsonConfig(custom_data),
    };

    // Backward compatibility: if endpoint has no config, try default SQLite AppVar.
    if (
      !paramsSQL.config ||
      (typeof paramsSQL.config === "object" && Object.keys(paramsSQL.config).length === 0)
    ) {
      const fallbackConfig = resolveAppVar("$_VAR_SQLITE", appVars, environment);
      if (fallbackConfig && typeof fallbackConfig === "object") {
        paramsSQL.config = fallbackConfig;
      }
    }

    /* 
  El config debería tener:
 
 // Option 3: Passing parameters separately (other dialects)
 const sequelize = new Sequelize('database', 'username', 'password', {
   host: 'localhost',
   dialect: 'postgres'
 });
 
  */

    /*
    try {
      paramsSQL = JSON.parse(method.code);
    } catch (e) {
      reply.code(400).send({ error: "Invalid JSON in method code" });
      return;
    }
    */

    let data_bind = {};
    let data_request = {};
    let connection_json = undefined;
    let query_type = QueryTypes.SELECT;

    if (paramsSQL.config && paramsSQL.config.query_type && QueryTypes[paramsSQL.config.query_type]) {
      query_type = QueryTypes[paramsSQL.config.query_type];
    } else if (paramsSQL.query_type && QueryTypes[paramsSQL.query_type]) {
      query_type = QueryTypes[paramsSQL.query_type];
    } else if (paramsSQL.query) {
      const cleanQuery = paramsSQL.query
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--.*$/gm, "")
        .trim();
      const matchWord = cleanQuery.match(/^[a-zA-Z]+/);
      if (matchWord) {
        const verb = matchWord[0].toUpperCase();
        if (QueryTypes[verb]) {
          query_type = QueryTypes[verb];
        }
      }
    }

    const requestQuery = request.query && typeof request.query === "object" ? request.query : {};
    const requestBody = request.body && typeof request.body === "object" ? request.body : {};

    if (request.method == "GET") {
      // Obtiene los datos del query
      data_request.bind = requestQuery;
    } else {
      // Para POST, PUT, PATCH, DELETE, OPTIONS y HEAD se prioriza el body y se conserva query como fallback.
      data_request = mergeObjects(requestQuery, requestBody);
    }

    if (data_request) {
      // Obtiene los parametros de conexión
      if (data_request?.connection) {
        try {
          connection_json =
            typeof data_request.connection == "object"
              ? data_request.connection
              : JSON.parse(data_request.connection);
        } catch (e) {
          sendHandlerError(reply, 400, "Invalid JSON in connection params");
          return;
        }
      }

      paramsSQL.config = mergeObjects(paramsSQL.config, connection_json);
    }

    // Obtiene los valores para hacer el bind de datos
    let bind_json = undefined;
    let replacements = undefined;

    if (data_request.replacements) {
      replacements = data_request.replacements;
    }

    if (data_request.bind) {
      try {
        bind_json =
          typeof data_request.bind == "object"
            ? data_request.bind
            : JSON.parse(data_request.bind);
      } catch (e) {
        sendHandlerError(reply, 400, "Invalid JSON in bind params");
        return;
      }
    } else if (data_request && typeof data_request === "object") {
      bind_json = Object.fromEntries(
        Object.entries(data_request).filter(([key]) => !RESERVED_SQL_REQUEST_KEYS.has(key)),
      );
    }

    // Procesar y estandarizar los parámetros del bind
    if (bind_json) {
      if (Array.isArray(bind_json)) {
        data_bind = bind_json;
      } else {
        for (let param in bind_json) {
          // Limpiar prefijos (:, $, @) para estandarizar las keys
          const key = param.replace(/^[:$@]/, '');
          const valor = bind_json[param];
          if (Array.isArray(valor)) {
            // Keep Fastify query semantics: repeated keys remain arrays.
            data_bind[key] = valor;
          } else {
            data_bind[key] = (typeof valor === "object" && valor !== null)
              ? JSON.stringify(valor)
              : valor;
          }
        }
      }
    }

    // Auto-detectar si la query usa :key (replacements) o $key (bind)
    // Según docs Sequelize: replacements usa ":" y bind usa "$"
    if (paramsSQL.query && !replacements && !Array.isArray(data_bind)
      && Object.keys(data_bind).length > 0) {
      const hasColonParams = /:[a-zA-Z_][a-zA-Z0-9_]*/.test(paramsSQL.query);
      if (hasColonParams) {
        replacements = data_bind;
        data_bind = {};
      }
    }

    // For named bind params ($param), fill omitted values with empty string.
    // This keeps optional SQL filters from failing when a query param is absent.
    if (paramsSQL.query && !replacements && !Array.isArray(data_bind)) {
      const bindNames = new Set();
      const bindRegex = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
      let match;
      while ((match = bindRegex.exec(paramsSQL.query)) !== null) {
        bindNames.add(match[1]);
      }

      for (const bindName of bindNames) {
        if (!Object.prototype.hasOwnProperty.call(data_bind, bindName)) {
          data_bind[bindName] = "";
        }
      }
    }

    if (paramsSQL.config.database) {
      //console.log("Config sqlFunction", paramsSQL, request.method, data_bind);

      // Verificar las configuraciones minimas
      if (paramsSQL && paramsSQL.config.options && paramsSQL.query) {
        const configHash = buildConnectionCacheKey(paramsSQL.config, environment);
/*
        console.log("[sqlFunction] Connection context", {
          environment,
          database: paramsSQL.config.database,
          username: paramsSQL.config.username,
          host: paramsSQL.config.options?.host,
          port: paramsSQL.config.options?.port,
          cacheKey: configHash,
          dialect: paramsSQL.config.options?.dialect,
          hasConnectionOverride: !!connection_json,
          hasAppVarCustomData: typeof custom_data === "string" && custom_data.startsWith("$_"),
        });
        */

        let sequelize = await Pool.getConnection(configHash, paramsSQL);

        let result_query = undefined;

        const queryOptions = { type: query_type, logging: false };

        if (replacements) {
          queryOptions.replacements = replacements;
        } else if (data_bind && (Array.isArray(data_bind)
          ? data_bind.length > 0 : Object.keys(data_bind).length > 0)) {
          queryOptions.bind = data_bind;
        }

        const runQuery = async () => {
          try {
            return await sequelize.query(paramsSQL.query, queryOptions);
          } catch (queryErr) {
            const mssqlNumber = extractMssqlErrorNumber(queryErr);

            // Retry único para errores de apertura de base en MSSQL.
            if (mssqlNumber === 945) {
              console.warn(`[sqlFunction] MSSQL error 945 detected for ${configHash}. Rebuilding connection and retrying once.`);

              const currentConn = Pool.connections.get(configHash);
              if (currentConn?.sequelize) {
                try {
                  await currentConn.sequelize.close();
                } catch (closeErr) {
                  console.error("Error closing failed pool connection:", closeErr);
                }
              }

              Pool.connections.delete(configHash);
              sequelize = await Pool.getConnection(configHash, paramsSQL);
              return await sequelize.query(paramsSQL.query, queryOptions);
            }

            throw queryErr;
          }
        };

        // Endpoint-configured timeout (seconds) is otherwise only honored by the JS/VM
        // handler. Without this, a stalled connection leaves the request hanging forever,
        // ignoring the timeout the user set for this endpoint.
        const hasEndpointTimeout = endpoint?.timeout !== undefined && endpoint?.timeout !== null;
        const endpointTimeoutSeconds = hasEndpointTimeout ? Number(endpoint.timeout) : undefined;
        const endpointTimeoutMs =
          hasEndpointTimeout && Number.isFinite(endpointTimeoutSeconds) && endpointTimeoutSeconds > 0
            ? endpointTimeoutSeconds * 1000
            : undefined;

        if (endpointTimeoutMs) {
          let timeoutHandle;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
              const timeoutError = new Error(
                `SQL handler execution timed out after ${endpointTimeoutMs}ms`,
              );
              timeoutError.name = "TimeoutError";
              reject(timeoutError);
            }, endpointTimeoutMs);
          });

          try {
            result_query = await Promise.race([runQuery(), timeoutPromise]);
          } catch (raceErr) {
            if (raceErr?.name === "TimeoutError") {
              // The query may still be running against a stuck connection; evict it so the
              // next request doesn't inherit the same hung socket.
              Pool.invalidate(configHash);
              sendHandlerError(reply, 504, raceErr.message);
              return;
            }
            throw raceErr;
          } finally {
            clearTimeout(timeoutHandle);
          }
        } else {
          result_query = await runQuery();
        }

        //  console.log('-------------> ', result_query.toSQL())

        sendHandlerResponse(reply, {
          statusCode: 200,
          data: result_query,
        });
      } else {
        sendHandlerError(reply, 400, "Params configuration is not complete");
      }
    } else {
      sendHandlerError(reply, 400, "Database Params configuration is not complete");
    }

  } catch (error) {
    replyException(request, reply, error);
  }
};
