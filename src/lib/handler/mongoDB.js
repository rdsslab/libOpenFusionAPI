import { functionsVars, listFunctionsVars } from "../server/functionVars.js";
import mongoose from "mongoose";
import {
  getAppVarContext,
  parseJsonConfig,
  replyException,
  sendHandlerError,
  sendHandlerResponse,
  resolveAppVarPlaceholder,
} from "./utils.js";

// Best-effort eviction of a connection stuck in "connecting" state. Without this, a
// timed-out connect attempt stays cached and every subsequent request for the same
// config would keep returning the same never-ready connection.
const invalidateConnection = (paramsMongo) => {
  const key = getConnectionKey(paramsMongo);
  const conn = connectionCache.get(key);
  if (!conn) {
    return;
  }

  connectionCache.delete(key);

  try {
    conn.close().catch((err) => {
      console.error(`Error closing invalidated MongoDB connection ${key}:`, err.message);
    });
  } catch (err) {
    console.error(`Error invalidating MongoDB connection ${key}:`, err.message);
  }
};

// TODO: No probado completamente, revisar antes de producción

export const getMongoDBParams = (custom_data) => {
  let paramsMongo;
  if (
    custom_data !== undefined &&
    custom_data !== null &&
    !(typeof custom_data === "string" && custom_data.trim().length === 0)
  ) {
    paramsMongo = parseJsonConfig(custom_data);
  }

  if (!paramsMongo) {
    paramsMongo = {
      host: "localhost",
      port: 27017,
      dbName: "my_db",
      user: "",
      pass: "",
    };
  }

  if (typeof paramsMongo === "object") {
    if (!paramsMongo.options) {
      paramsMongo.options = {};
    }
  }

  return paramsMongo;
};

/* ============================================================
   CACHE DE CONEXIONES POR CONFIGURACIÓN
   Cada combinación única de host/port/dbName/user tiene su propio
   pool de conexiones (mongoose.createConnection).
   ============================================================ */
const connectionCache = new Map();

/**
 * Genera una clave única para la configuración de conexión
 */
function getConnectionKey(params) {
  if (typeof params === "string") {
    return params;
  }
  if (params.uri) {
    return params.uri;
  }
  return JSON.stringify({
    host: params.host,
    port: params.port,
    dbName: params.dbName,
    user: params.user,
  });
}

/**
 * Obtiene o crea una conexión de mongoose para la configuración dada.
 * Si ya existe una conexión activa para esta config, la reutiliza.
 */
async function getOrCreateConnection(paramsMongo) {
  const key = getConnectionKey(paramsMongo);

  if (connectionCache.has(key)) {
    const conn = connectionCache.get(key);
    // readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    if (conn.readyState === 1 || conn.readyState === 2) {
      return conn;
    }
    // Conexión muerta, limpiar
    connectionCache.delete(key);
  }

  let connectionString;
  let connectionOptions = {};

  if (typeof paramsMongo === "string") {
    connectionString = paramsMongo;
  } else if (paramsMongo.uri) {
    connectionString = paramsMongo.uri;
    connectionOptions = { ...paramsMongo.options };
    if (paramsMongo.dbName !== undefined && paramsMongo.dbName !== null) {
      connectionOptions.dbName = paramsMongo.dbName;
    }
    if (paramsMongo.user) {
      connectionOptions.user = paramsMongo.user;
    }
    if (paramsMongo.pass) {
      connectionOptions.pass = paramsMongo.pass;
    }
  } else {
    connectionString = `mongodb://${paramsMongo.host}:${paramsMongo.port}`;
    connectionOptions = { ...paramsMongo.options };
    if (paramsMongo.dbName !== undefined && paramsMongo.dbName !== null) {
      connectionOptions.dbName = paramsMongo.dbName;
    }
    if (paramsMongo.user) {
      connectionOptions.user = paramsMongo.user;
    }
    if (paramsMongo.pass) {
      connectionOptions.pass = paramsMongo.pass;
    }
  }

  const conn = mongoose.createConnection(connectionString, connectionOptions);

  // Limpiar cache si la conexión se cierra o hay error
  conn.on("disconnected", () => {
    connectionCache.delete(key);
  });
  conn.on("error", (err) => {
    console.error(`MongoDB connection error (${connectionString}):`, err.message);
    connectionCache.delete(key);
  });

  connectionCache.set(key, conn);

  // Esperar a que la conexión esté lista
  await conn.asPromise();

  return conn;
}

export const mongodbFunction = async (context) => {
  const request = context?.request;
  const reply = context?.reply;
  const method = context?.method || context?.endpoint;
  const endpoint = context?.endpoint || context?.method;
  const server_data = context?.server_data;
  try {
    if (!method.jsFn) {
      throw new Error("Function 'jsFn' is not defined in the method configuration.");
    }

    const { appVars, environment } = getAppVarContext(endpoint, method);
    const custom_data = resolveAppVarPlaceholder(
      method.custom_data,
      appVars,
      environment,
    );

    let paramsMongo;
    try {
      paramsMongo = getMongoDBParams(custom_data);
    } catch (error) {
      sendHandlerError(reply, 400, error?.message || "Invalid MongoDB configuration");
      return;
    }

    // Endpoint-configured timeout (seconds). The VM already enforces this for the user's
    // JS code (method.jsFn), but connection establishment happens before that and was
    // previously unbounded — a Mongo host that never responds would hang here forever.
    const hasEndpointTimeout = method?.timeout !== undefined && method?.timeout !== null;
    const endpointTimeoutSeconds = hasEndpointTimeout ? Number(method.timeout) : undefined;
    const endpointTimeoutMs =
      hasEndpointTimeout && Number.isFinite(endpointTimeoutSeconds) && endpointTimeoutSeconds > 0
        ? endpointTimeoutSeconds * 1000
        : undefined;

    let conn;

    if (endpointTimeoutMs) {
      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const timeoutError = new Error(
            `MongoDB connection timed out after ${endpointTimeoutMs}ms`,
          );
          timeoutError.name = "TimeoutError";
          reject(timeoutError);
        }, endpointTimeoutMs);
      });

      try {
        conn = await Promise.race([getOrCreateConnection(paramsMongo), timeoutPromise]);
      } catch (raceErr) {
        if (raceErr?.name === "TimeoutError") {
          invalidateConnection(paramsMongo);
          sendHandlerError(reply, 504, raceErr.message);
          return;
        }
        throw raceErr;
      } finally {
        clearTimeout(timeoutHandle);
      }
    } else {
      conn = await getOrCreateConnection(paramsMongo);
    }

    let fnVars = functionsVars(request, reply, method.environment);
    fnVars.mongooseInstance = conn; // Conexión específica para esta config

    let fnresult = await method.jsFn(fnVars);

    sendHandlerResponse(reply, {
      statusCode: 200,
      data: fnresult.data,
      headers: fnresult.headers,
    });

  } catch (error) {
    replyException(request, reply, error);
  }
};

