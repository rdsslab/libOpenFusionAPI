import { Sequelize, QueryTypes } from "sequelize";
import { mergeObjects } from "../server/utils.js";
import { parseQualifiedName } from "../db/utils.js";
import {
  getAppVarContext,
  getHandlerExecutionContext,
  parseJsonConfig,
  replyException,
  resolveAppVarPlaceholder,
  sendHandlerError,
  sendHandlerResponse,
} from "./utils.js";
import { buildConnectionCacheKey } from "./utils.js";

import { Pool } from "./ConnectionPool.js";

export const sqlFunctionInsertBulk = async (context) => {
  const { request, reply, method, endpoint } = getHandlerExecutionContext(context);
  try {
    const { appVars, environment } = getAppVarContext(endpoint, method);
    const custom_data = resolveAppVarPlaceholder(
      method.custom_data,
      appVars,
      environment,
    );
    const customData = parseJsonConfig(custom_data);

    if (!customData) {
      sendHandlerError(reply, 400, "custom_data configuration is required");
      return;
    }

    let paramsSQL = { table_name: method.code, config: customData };

    // query_type viene de custom_data (no de code, que es la query SQL)
    let query_type = QueryTypes.INSERT;
    if (paramsSQL.config.query_type && QueryTypes[paramsSQL.config.query_type]) {
      query_type = QueryTypes[paramsSQL.config.query_type];
    }

    // Solo POST tiene sentido para bulk insert
    if (request.method !== "POST") {
      sendHandlerError(reply, 405, "Only POST method is allowed for bulk insert");
      return;
    }

    let data_request = request.body || {};

    // Merge de parámetros de conexión del request (override)
    if (data_request.config) {
      try {
        let connection_json =
          typeof data_request.config === "object"
            ? data_request.config
            : JSON.parse(data_request.config);
        paramsSQL.config = mergeObjects(paramsSQL.config, connection_json);
      } catch (e) {
        sendHandlerError(reply, 400, "Invalid JSON in config params");
        return;
      }
    }

    // Parsear nombre calificado de tabla
    try {
      let { database, schema, table } = parseQualifiedName(paramsSQL.table_name);
      if (database) paramsSQL.config.database = database;
      if (schema) paramsSQL.config.schema = schema;
      if (table) paramsSQL.table_name = table;
    } catch (error) {
      // Nombre no calificado, continuar con lo que hay
    }

    // Validaciones con early return
    if (!paramsSQL.config.database) {
      sendHandlerError(reply, 400, "Database is required");
      return;
    }

    if (!paramsSQL.table_name || paramsSQL.table_name.length === 0) {
      sendHandlerError(reply, 400, "Table name is required");
      return;
    }

    if (!paramsSQL.config.options) {
      sendHandlerError(reply, 400, "Params configuration is not complete");
      return;
    }

    // Desactiva el log por defecto si no está definido explícitamente
    if (paramsSQL.config.options.logging === undefined) {
      paramsSQL.config.options.logging = false;
    }

    const configHash = buildConnectionCacheKey(paramsSQL.config, environment);

    const sequelize = await Pool.getConnection(configHash, paramsSQL);

    // Endpoint-configured timeout (seconds). Without it, a stalled connection leaves the
    // request hanging forever, ignoring the timeout set for this endpoint. Note that if the
    // timeout fires mid-transaction, the transaction may still be in flight on the DB side;
    // evicting the cached connection at least prevents the next request from reusing it.
    const hasEndpointTimeout = method?.timeout !== undefined && method?.timeout !== null;
    const endpointTimeoutSeconds = hasEndpointTimeout ? Number(method.timeout) : undefined;
    const endpointTimeoutMs =
      hasEndpointTimeout && Number.isFinite(endpointTimeoutSeconds) && endpointTimeoutSeconds > 0
        ? endpointTimeoutSeconds * 1000
        : undefined;

    const runBulkInsert = () => bulkInsertWithTransaction(
      sequelize,
      paramsSQL.config.schema,
      paramsSQL.table_name,
      data_request.data,
      paramsSQL.ignoreDuplicates
    );

    let result_query;

    if (endpointTimeoutMs) {
      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const timeoutError = new Error(
            `SQL bulk insert handler execution timed out after ${endpointTimeoutMs}ms`,
          );
          timeoutError.name = "TimeoutError";
          reject(timeoutError);
        }, endpointTimeoutMs);
      });

      try {
        result_query = await Promise.race([runBulkInsert(), timeoutPromise]);
      } catch (raceErr) {
        if (raceErr?.name === "TimeoutError") {
          Pool.invalidate(configHash);
          sendHandlerError(reply, 504, raceErr.message);
          return;
        }
        throw raceErr;
      } finally {
        clearTimeout(timeoutHandle);
      }
    } else {
      result_query = await runBulkInsert();
    }

    sendHandlerResponse(reply, {
      statusCode: 200,
      data: result_query,
    });
  } catch (error) {
    replyException(request, reply, error);
  }
};

async function bulkInsertWithTransaction(
  sequelize,
  schema,
  tableName,
  rows,
  ignoreDuplicates
) {
  const queryInterface = sequelize.getQueryInterface();
  const transaction = await sequelize.transaction();

  let opts = {
    transaction,
    ignoreDuplicates: ignoreDuplicates,
  };

  try {
    let result = await queryInterface.bulkInsert(
      { schema: schema, tableName: tableName },
      rows,
      opts
    );

    await transaction.commit();
    return { inserted: result };
  } catch (error) {
    await transaction.rollback();
    console.error(`❌ Error en bulk insert (${tableName}):`, error.message);
    throw error;
  }
}
