import { LogEntry, Application } from "./models.js";
import { getEndpointByIdApp, getAllEndpoints } from "./endpoint.js";
import { Op, Sequelize } from "sequelize";
import dbsequelize from "./sequelize.js";
import { getCorrectedNow } from "../server/timeSync.js";

/**
 * Calcula una ventana [from, to] terminando en el instante actual, retrocediendo
 * `hours` u `days` horas/días. Usa un solo `to` de referencia para que `from`/`to`
 * sean consistentes, y aritmética de milisegundos (no dependiente de la zona
 * horaria local del proceso) ya que solo se necesita una duración absoluta.
 *
 * `to` se calcula con `getCorrectedNow()` (no `new Date()` directo): si el reloj del
 * host/contenedor está desincronizado, todas las consultas por `last_hours`/`last_days`
 * de este archivo (getLogs, getLogsRecordsPerMinute, getLogsStatusClassPerMinute,
 * getTopErrorEndpoints*, getAppEndpointUsageSummary) quedarían ancladas a una hora
 * incorrecta; al centralizar aquí, un solo punto corrige a todas.
 *
 * @param {{hours?: number, days?: number}} amount
 * @returns {{from: Date, to: Date}}
 */
function windowFromNow({ hours = 0, days = 0 } = {}) {
  const to = new Date(getCorrectedNow());
  const ms = (days * 24 + hours) * 60 * 60 * 1000;
  const from = new Date(to.getTime() - ms);
  return { from, to };
}

export const LOG_LEVEL = Object.freeze({
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
  0: "TRACE",
  1: "DEBUG",
  2: "INFO",
  3: "WARN",
  4: "ERROR",
  5: "FATAL",
});

export const getLogLevelByStatusCode = (status_code) => {
  let r = LOG_LEVEL.DEBUG;
  if (status_code >= 100 && status_code <= 199) {
    r = LOG_LEVEL.INFO;
  } else if (status_code >= 200 && status_code <= 299) {
    r = LOG_LEVEL.DEBUG;
  } else if (status_code >= 300 && status_code <= 399) {
    r = LOG_LEVEL.INFO;
  } else if (status_code >= 400 && status_code <= 499) {
    r = LOG_LEVEL.ERROR;
  } else if (status_code >= 500 && status_code <= 599) {
    r = LOG_LEVEL.FATAL;
  }

  return r;
};

export const createLog = async (dataLog) => {
  try {
    return await LogEntry.create(dataLog);
  } catch (error) {
    console.error("Error performing INSERT log:", error);
    throw error;
  }
};

export const createLogEntriesBulk = async (logDataArray) => {
  if (!logDataArray || logDataArray.length === 0) {
    return { success: true, inserted: 0 };
  }

  const t = await dbsequelize.transaction();

  try {
    const processedData = logDataArray.map((log) => ({
      ...log,
      // Asegurar formato correcto de timestamps
      timestamp:
        log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp),

      // Para campos JSON, Sequelize los convertirá automáticamente con tus getters/setters
      // Pero para máxima performance, podrías pre-procesarlos aquí
    }));

    await LogEntry.bulkCreate(processedData, {
      transaction: t,
      individualHooks: false, // Deshabilitar hooks para mejor performance
      returning: false,
      ignoreDuplicates: false,
    });

    await t.commit();

    return {
      success: true,
      inserted: processedData.length,
      timestamp: new Date(),
    };
  } catch (error) {
    await t.rollback();
    console.error("Error en bulk insert de logs:", error);

    throw error;
  }
};


/**
 * Función para consultar logs con filtros opcionales
 * @param {Object} options - Parámetros de filtrado
 * @param {number} options.last_hours - Últimas N horas desde ahora (ej: 24 = últimas 24 horas)
 * @param {Date|string} options.start_date - Fecha de inicio (inclusive)
 * @param {Date|string} options.end_date - Fecha de fin (inclusive)
 * @param {string} options.idendpoint - UUID del endpoint
 * @param {string} [options.environment] - Ambiente del endpoint (dev/qa/prd) para filtrar los logs
 * @param {number} options.level - Nivel del log (SMALLINT)
 * @param {string} options.method - Método HTTP (GET, POST, etc.)
 * @param {number} options.status_code - Código de estado HTTP
 * @param {number} options.limit - Límite de registros a devolver (default: 1000, max: 10000)
 * @param {number} options.offset - Offset para paginación
 * @param {string} options.order - Campo para ordenar (default: 'timestamp')
 * @param {string} options.orderDirection - Dirección del orden (ASC/DESC, default: 'DESC')
 * @param {string} options.trace_id - Clave de correlacion principal para rastrear una ejecucion y su cadena de errores extremo a extremo.
 * @returns {Promise<{data: Array, total: number, meta: Object}>}
 */
export const getLogs = async (options = {}) => {
  try {
    // === PROCESAMIENTO DE PARÁMETROS ===

    // Parámetros con valores por defecto
    const {
      idapp,
      last_hours,
      start_date,
      end_date,
      idendpoint,
      environment,
      log_level,
      method,
      status_code,
      limit = 1000,
      offset = 0,
      order = "timestamp",
      orderDirection = "DESC",
      trace_id,
      raw = true, // Si quieres objetos planos en lugar de instancias de Sequelize
      lightweight = false, // Si true, omite campos grandes (req_headers, res_headers, response_data, message)
    } = options;

    //

    // === VALIDACIONES ===

    const normalizedLimit = Number(limit);
    const normalizedOffset = Number(offset);
    const hasOrderDirection = Object.prototype.hasOwnProperty.call(
      options,
      "orderDirection"
    );
    const rawOrder = Array.isArray(order) ? order[0] : order;
    const rawOrderDirection = Array.isArray(orderDirection)
      ? orderDirection[0]
      : orderDirection;

    const orderAliases = {
      createdat: "timestamp",
      updatedat: "timestamp",
      idapp: "idapp",
      idendpoint: "idendpoint",
      traceid: "trace_id",
      statuscode: "status_code",
      loglevel: "log_level",
      useragent: "user_agent",
      reqheaders: "req_headers",
      resheaders: "res_headers",
      responsetime: "response_time",
      responsedata: "response_data",
    };

    const validOrderFields = [
      "id",
      "timestamp",
      "idapp",
      "idendpoint",
      "trace_id",
      "url",
      "method",
      "status_code",
      "log_level",
      "user_agent",
      "client",
      "req_headers",
      "res_headers",
      "response_time",
      "response_data",
      "message",
    ];

    // Validar límite
    if (!Number.isInteger(normalizedLimit)) {
      throw new Error("El límite debe ser un número entero");
    }

    if (normalizedLimit > 999999) {
      throw new Error("El límite no puede ser mayor a 999999 registros");
    }

    if (normalizedLimit < 1) {
      throw new Error("El límite debe ser mayor a 0");
    }

    // Validar offset
    if (!Number.isInteger(normalizedOffset)) {
      throw new Error("El offset debe ser un número entero");
    }

    if (normalizedOffset < 0) {
      throw new Error('El offset no puede ser negativo');
    }

    const orderInput = typeof rawOrder === "string" ? rawOrder.trim() : "";
    const orderInputMatch = orderInput.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(ASC|DESC))?$/i
    );

    const requestedOrderField = orderInputMatch
      ? orderInputMatch[1]
      : orderInput;
    const requestedInlineOrderDirection = orderInputMatch
      ? orderInputMatch[2]
      : undefined;

    const requestedOrderKey = String(requestedOrderField || "")
      .trim()
      .toLowerCase();
    const aliasedOrder = orderAliases[requestedOrderKey] || requestedOrderField;

    let normalizedOrder = typeof aliasedOrder === "string" ? aliasedOrder.trim() : "";

    // Validar dirección de orden (con soporte para "timestamp DESC" cuando no se envía orderDirection)
    const validOrderDirections = ["ASC", "DESC"];
    let normalizedOrderDirection = String(rawOrderDirection || "DESC")
      .toUpperCase()
      .trim();

    if (!hasOrderDirection && requestedInlineOrderDirection) {
      normalizedOrderDirection = requestedInlineOrderDirection.toUpperCase();
    }

    const serializeValue = (value) => {
      if (value === undefined) return "undefined";
      if (value === null) return "null";
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };

      const throwValidationError = ({ field, message, received, accepted, range }) => {
        const validationError = new Error(message);
        validationError.name = "ValidationError";
        validationError.statusCode = 400;
        validationError.details = {
          field,
          ...(received !== undefined ? { received } : {}),
          ...(accepted ? { accepted } : {}),
          ...(range ? { range } : {}),
        };
        throw validationError;
      };

      // Validate pagination bounds
      if (!Number.isInteger(normalizedLimit)) {
        throwValidationError({
          field: "limit",
          message: `Invalid 'limit' value '${serializeValue(limit)}'. 'limit' must be an integer between 1 and 999999.`,
          received: limit,
          range: { min: 1, max: 999999 },
        });
      }

      if (normalizedLimit > 999999 || normalizedLimit < 1) {
        throwValidationError({
          field: "limit",
          message: `Invalid 'limit' value '${serializeValue(limit)}'. Accepted range is 1 to 999999.`,
          received: limit,
          range: { min: 1, max: 999999 },
        });
      }

      if (!Number.isInteger(normalizedOffset)) {
        throwValidationError({
          field: "offset",
          message: `Invalid 'offset' value '${serializeValue(offset)}'. 'offset' must be an integer greater than or equal to 0.`,
          received: offset,
          range: { min: 0 },
        });
      }

      if (normalizedOffset < 0) {
        throwValidationError({
          field: "offset",
          message: `Invalid 'offset' value '${serializeValue(offset)}'. Accepted range is 0 or greater.`,
          received: offset,
          range: { min: 0 },
        });
      }

    if (!validOrderDirections.includes(normalizedOrderDirection)) {
      const acceptedValues = validOrderDirections.join(", ");
      const receivedValue = serializeValue(rawOrderDirection);
        throwValidationError({
        field: "orderDirection",
          message: `Invalid 'orderDirection' value '${receivedValue}'. Accepted values are: ${acceptedValues}.`,
        received: rawOrderDirection,
        accepted: validOrderDirections,
        });
    }

    if (!validOrderFields.includes(normalizedOrder)) {
      const acceptedValues = validOrderFields.join(", ");
      const receivedValue = serializeValue(rawOrder || orderInput);
        throwValidationError({
        field: "order",
          message: `Invalid 'order' value '${receivedValue}'. Accepted values are: ${acceptedValues}.`,
        received: rawOrder,
        accepted: validOrderFields,
        });
    }

    // === CONSTRUCCIÓN DE CONDICIONES WHERE ===

    const whereConditions = {};

    // === FILTROS DE FECHA ===

    let dateFilter = null;

    // Si se proporcionan start_date y end_date, usar esos
    if (start_date && end_date) {
      const startDate = new Date(start_date);
      const endDate = new Date(end_date);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throwValidationError({
            field: "start_date,end_date",
            message: `Invalid date range. Received start_date='${serializeValue(start_date)}' and end_date='${serializeValue(end_date)}'. Both values must be valid datetime strings.`,
            received: { start_date, end_date },
          });
      }

      // Asegurar que end_date sea posterior a start_date (Esto se debería validar en el lado del cliente)
      if (startDate >= endDate) {
          throwValidationError({
            field: "start_date,end_date",
            message: `Invalid date range. 'start_date' must be earlier than 'end_date'. Received start_date='${serializeValue(start_date)}' and end_date='${serializeValue(end_date)}'.`,
            received: { start_date, end_date },
          });
      }

      dateFilter = {
        [Op.between]: [startDate, endDate],
      };
    } else if (last_hours !== undefined && last_hours !== null) {
      const last_hours_int = Number(last_hours);
      // Si se proporciona last_hours, calcular desde ahora hacia atrás
      if (!Number.isInteger(last_hours_int) || last_hours_int <= 0) {
          throwValidationError({
            field: "last_hours",
            message: `Invalid 'last_hours' value '${serializeValue(last_hours)}'. It must be a positive integer.`,
            received: last_hours,
            range: { min: 1 },
          });
      }
      const { from: pastDate } = windowFromNow({ hours: last_hours_int });

      dateFilter = {
        [Op.gte]: pastDate, // Greater Than or Equal
      };
    }

    // Aplicar filtro de fecha si existe
    if (dateFilter) {
      whereConditions.timestamp = dateFilter;
    }

    // === OTROS FILTROS (solo si se proporcionan) ===

    // Filtro por log_level
    if (log_level !== undefined && log_level !== null) {
      const normalizedLogLevel = Number(log_level);
      if (
        !Number.isInteger(normalizedLogLevel) ||
        normalizedLogLevel < 1 ||
        normalizedLogLevel > 3
      ) {
          throwValidationError({
            field: "log_level",
            message: `Invalid 'log_level' value '${serializeValue(log_level)}'. Accepted values are integers from 1 to 3.`,
            received: log_level,
            range: { min: 1, max: 3 },
          });
      }
      whereConditions.log_level = normalizedLogLevel;
    }

    if (trace_id !== undefined && trace_id !== null) {
      if (typeof trace_id !== "string" || trace_id.trim().length === 0) {
        throwValidationError({
          field: "trace_id",
          message: `Invalid 'trace_id' value '${serializeValue(trace_id)}'. It must be a non-empty string.`,
          received: trace_id,
        });
      }
      whereConditions.trace_id = trace_id.trim();
    }

    // Filtro por method
    if (method) {
      if (typeof method !== "string" || method.trim().length === 0) {
        throwValidationError({
          field: "method",
          message: `Invalid 'method' value '${serializeValue(method)}'. It must be a non-empty string.`,
          received: method,
        });
      }
      whereConditions.method = method.toUpperCase().trim();
    }

    // Filtro por status_code: acepta valor exacto (404), grupo (4xx/5xx) o lista separada por comas (502,404)
    if (status_code !== undefined && status_code !== null && status_code !== "") {
      const raw = String(status_code).trim();
      const groupMatch = /^([1-5])xx$/i.exec(raw);

      if (groupMatch) {
        const base = Number(groupMatch[1]) * 100;
        whereConditions.status_code = { [Op.between]: [base, base + 99] };
      } else if (raw.includes(",")) {
        const codes = raw.split(",").map((part) => Number(part.trim()));
        const hasInvalidCode = codes.some(
          (code) => !Number.isInteger(code) || code < 100 || code > 599,
        );
        if (hasInvalidCode) {
          throwValidationError({
            field: "status_code",
            message: `Invalid 'status_code' value '${serializeValue(status_code)}'. Each code in the list must be an integer between 100 and 599.`,
            received: status_code,
            range: { min: 100, max: 599 },
          });
        }
        whereConditions.status_code = { [Op.in]: codes };
      } else {
        const normalizedStatusCode = Number(raw);
        if (
          !Number.isInteger(normalizedStatusCode) ||
          normalizedStatusCode < 100 ||
          normalizedStatusCode > 599
        ) {
          throwValidationError({
            field: "status_code",
            message: `Invalid 'status_code' value '${serializeValue(status_code)}'. Accepted range is 100 to 599, or use group format (e.g. '4xx', '5xx') or comma-separated list (e.g. '502,404').`,
            received: status_code,
            range: { min: 100, max: 599 },
          });
        }
        whereConditions.status_code = normalizedStatusCode;
      }
    }

    // Filtro por App o idendpoint
    if (idapp) {
      whereConditions.idapp = idapp;
    } else if (idendpoint) {
      // Usar el endpoint individual
      if (typeof idendpoint !== "string" || idendpoint.length === 0) {
        throwValidationError({
          field: "idendpoint",
          message: `Invalid 'idendpoint' value '${serializeValue(idendpoint)}'. It must be a non-empty string.`,
          received: idendpoint,
        });
      }
      whereConditions.idendpoint = idendpoint;
    }

    // Filtro por environment
    Object.assign(whereConditions, getEnvironmentFilter(environment));

    // === CONFIGURACIÓN DE LA CONSULTA ===

    // Atributos ligeros (siempre presentes)
    const lightweightAttributes = [
      "id",
      "timestamp",
      "idapp",
      "idendpoint",
      "trace_id",
      "url",
      "method",
      "status_code",
      "log_level",
      "response_time",
    ];

    // Atributos completos (incluye campos grandes)
    const fullAttributes = [
      ...lightweightAttributes,
      "user_agent",
      "client",
      "req_headers",
      "res_headers",
      "response_data",
      "message",
    ];

    const queryOptions = {
      where: whereConditions,
      attributes: lightweight ? lightweightAttributes : fullAttributes,
      order: [[normalizedOrder, normalizedOrderDirection]],
      limit: normalizedLimit,
      offset: normalizedOffset,
      raw: raw, // Devolver objetos planos si se solicita
    };

    // === EJECUTAR CONSULTA ===
    // Ejecutar consulta principal
    const logs = await LogEntry.findAll(queryOptions);

    if (raw && logs && logs.length > 0) {
      const jsonFields = [
        "req_headers",
        "res_headers",
        "query",
        "body",
        "params",
        "response_data",
        "message",
      ];
      return logs.map((log) => {
        const item = { ...log };
        jsonFields.forEach((field) => {
          if (typeof item[field] === "string") {
            try {
              item[field] = JSON.parse(item[field]);
            } catch (e) {
              // ignore invalid json just in case
            }
          }
        });
        return item;
      });
    }

    return logs;
  } catch (error) {
    console.error("❌ Error in getLogs:", error);

    throw error;
  }
};

// === FUNCIONES AUXILIARES ÚTILES ===

/**
 * Función específica para obtener logs por endpoint
 * @param {string} endpointId - UUID del endpoint
 * @param {Object} additionalFilters - Filtros adicionales
 */
export const getLogsByEndpoint = async (endpointId, additionalFilters = {}) => {
  return await getLogs({
    idendpoint: endpointId,
    ...additionalFilters,
  });
};

/**
 * Función para obtener estadísticas básicas de logs
 * @param {Object} filters - Filtros a aplicar
 */
export const getLogStats = async (filters = {}) => {
  try {
    const queryOptions = {
      where: {},
      attributes: [
        [dbsequelize.fn("COUNT", dbsequelize.col("*")), "total_logs"],
        [dbsequelize.fn("MIN", dbsequelize.col("timestamp")), "oldest_log"],
        [dbsequelize.fn("MAX", dbsequelize.col("timestamp")), "newest_log"],
        [
          dbsequelize.fn("AVG", dbsequelize.col("response_time")),
          "avg_response_time",
        ],
        [dbsequelize.fn("COUNT", dbsequelize.col("level")), "logs_by_level"],
      ],
      raw: true,
    };

    // Aplicar filtros
    if (filters.last_hours) {
      // getCorrectedNow() en vez de new Date(): mismo motivo que windowFromNow más
      // arriba en este archivo, para que este resumen no quede desalineado si el reloj
      // del host/contenedor está desincronizado.
      const now = new Date(getCorrectedNow());
      const pastDate = new Date(
        now.getTime() - filters.last_hours * 60 * 60 * 1000
      );
      queryOptions.where.timestamp = { [Op.gte]: pastDate };
    }

    if (filters.idendpoint) {
      queryOptions.where.idendpoint = filters.idendpoint;
    }

    /*
    if (filters.level !== undefined) {
      queryOptions.where.level = filters.level;
    }
    */

    const stats = await LogEntry.findAll(queryOptions);

    return {
      success: true,
      data: stats[0],
      filters_applied: Object.keys(queryOptions.where).length,
    };
  } catch (error) {
    console.error("Error obteniendo estadísticas:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/*
export const getLogs = async ({
  idapp,
  idendpoint,
  hours,
  level,
  limit,
} = {}) => {

  const where = {};

  // 1. Filtro por timestamp
  if (hours !== undefined) {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hours);
    where.timestamp = { [Op.gte]: cutoffDate };
  }

  // 2. Filtro por idendpoint en LogEntry
  if (idendpoint) {
    where.idendpoint = idendpoint;
  }

  // Agregar filtro por level si está definido
  // Corrección: El valor 0 es válido, por lo que la comparación debe ser con undefined o null.
  if (level !== undefined && level !== null) {
    where.level = level;
  }

  // 3. Configuración del include para Endpoint
  const include = [
    {
      model: Endpoint,
      as: "endpoint", // <<< ¡ESTA ES LA LÍNEA CLAVE! Usa el alias definido en la asociación.
      required: true, // Esto forza un INNER JOIN
      attributes: ["idapp", "environment", "method", "handler"],
      // Filtro por idapp en la tabla Endpoint
      where: idapp ? { idapp } : undefined,
    },
  ];

  // 4. Configuración final de la consulta
  const options = {
    where,
    include,
    attributes: [
      "idendpoint",
      // "id", // TU MODELO LogEntry no tiene un campo 'id'. Lo he comentado.
      "timestamp",
      "level",
      "status_code",
      "user_agent",
      "client",
      "req_headers",
      "response_time",
      "url",
    ],
    // Ordenamos por 'timestamp' que sí existe en tu modelo
    order: [["timestamp", "DESC"]],
    limit: limit || 99999,
    raw: true, // <<< LÍNEA CLAVE: habilita el modo raw
  };

  return LogEntry.findAll(options);
};
*/

/**
 * Obtiene la cantidad de registros por minuto para un endpoint específico
 * en las últimas N horas (por defecto 24 horas).
 *
 * @param {string} idendpoint - UUID del endpoint a filtrar
 * @param {number} [last_hours=24] - Número de horas a considerar (desde ahora hacia atrás)
 * @returns {Promise<Array>} - Array con { timestamp, idendpoint, count }
 */
// Función para generar el truncado de fecha según el tipo de BD y la granularidad
// (reutilizable). granularity: 'minute' | 'hour'.
function getTruncatedColumnByGranularity(sequelize, granularity = "minute") {
  const dialect = sequelize.getDialect(); // Accedemos al dialecto desde el modelo

  const mysqlFormat = granularity === "hour" ? "%Y-%m-%d %H:00:00" : "%Y-%m-%d %H:%i:00";
  const sqliteFormat = granularity === "hour" ? "%Y-%m-%d %H:00:00" : "%Y-%m-%d %H:%M:00";

  switch (dialect) {
    case "postgres":
      return sequelize.fn("DATE_TRUNC", granularity, sequelize.col("timestamp"));
    case "mysql":
    case "mariadb":
      // MariaDB es compatible con la sintaxis de fecha de MySQL.
      return sequelize.fn(
        "DATE_FORMAT",
        sequelize.col("timestamp"),
        mysqlFormat
      );
    case "mssql":
      return sequelize.fn(
        "DATEADD",
        granularity,
        sequelize.fn(
          "DATEDIFF",
          granularity,
          sequelize.literal("0"),
          sequelize.col("timestamp")
        ),
        sequelize.literal("0")
      );
    case "sqlite":
      return sequelize.fn(
        "STRFTIME",
        sqliteFormat,
        sequelize.col("timestamp")
      );
    case "oracle":
      // TRUNC(timestamp, 'HH24') trunca a la hora; TRUNC(timestamp, 'MI') trunca al minuto.
      return sequelize.fn(
        "TRUNC",
        sequelize.col("timestamp"),
        sequelize.literal(granularity === "hour" ? "'HH24'" : "'MI'")
      );
    default:
      // Fallback para otros dialectos o error
      throw new Error(`Dialecto no soportado: ${dialect}`);
  }
}

function getTruncatedMinuteColumn(sequelize) {
  return getTruncatedColumnByGranularity(sequelize, "minute");
}

// Los logs históricos anteriores a la columna `environment` quedan en NULL;
// se tratan como 'prd' al filtrar por ese ambiente (era el único usado hasta ahora).
function getEnvironmentFilter(environment) {
  if (!environment) return {};
  if (environment === "prd") {
    return { [Op.or]: [{ environment: "prd" }, { environment: null }] };
  }
  return { environment };
}

export const getLogsRecordsPerMinute = async (options) => {
  // Parámetros con valores por defecto
  const {
    idapp,
    last_hours = 24,
    idendpoint,
    environment,
    raw = true, // Si quieres objetos planos en lugar de instancias de Sequelize
  } = options;

  try {
    // Validaciones básicas
    //if (!idendpoint) throw new Error("Se requiere un idendpoint válido");
    if (last_hours <= 0)
      throw new Error("Las horas deben ser un número positivo");

    const sequelize = LogEntry.sequelize;

    const { from: startDate, to: endDate } = windowFromNow({
      hours: last_hours || 1,
    });

    // Filtro por App o idendpoint
    let endpointFilter;
    if (idapp) {
      endpointFilter = { idapp }; // Esto no funcionara directamente aqui porque getCountsByMinute usa Logic compleja
      // Revertimos a lógica simplificada si getCountsByMinute no soporta idapp directo aún
      // PERO getCountsByMinute recibe endpointFilter y lo usa en el WHERE.
      // Si pasamos {idapp: idapp} como endpointFilter, fallará porque idendpoint espera un UUID o array.
      // REVISAR: getCountsByMinute usa: { idendpoint: endpointFilter }
      // Por lo tanto, SI necesitamos obtener los endpoints, O modificar getCountsByMinute.
      // Modificaremos getCountsByMinute para ser más flexible.
    }

    // Recalcular endpointFilter correctamente:
    // Si queremos filtrar por app, la logica anterior de obtener todos los endpoints era valida para esta funcion especifica
    // porque getCountsByMinute agrupa por idendpoint.
    // Si filtramos solo por idapp en Logs, perderemos la agrupacion por idendpoint si no estan en el resultado.
    // PERO, la query agrupa por idendpoint.

    // Solucion: Si hay idapp, pasamos un filtro especial a getCountsByMinute

    const rawResults = await getCountsByMinute(
      sequelize,
      startDate,
      endDate,
      idapp ? null : endpointFilter, // Si hay idapp, endpointFilter es null por ahora (lo manejaremos adentro)
      idapp,
      environment
    );

    return rawResults;
  } catch (error) {
    console.error("❌ Error obteniendo registros por minuto:", error);
    return {
      success: false,
      error: error.message,
      data: [],
    };
  }
};

// === CONSULTA PARA OBTENER CONTEOS POR MINUTO ===
async function getCountsByMinute(
  sequelize,
  startDate,
  endDate,
  endpointFilter,
  idapp, // Nuevo parametro opcional
  environment
) {
  const truncatedColumn = getTruncatedMinuteColumn(sequelize);

  const rawResults = await LogEntry.findAll({
    where: {
      [Op.and]: [
        { timestamp: { [Op.between]: [startDate, endDate] } },
        endpointFilter ? { idendpoint: endpointFilter } : {},
        idapp ? { idapp: idapp } : {},
        getEnvironmentFilter(environment),
      ],
    },
    attributes: [
      // Usamos la columna truncada generada dinámicamente
      [truncatedColumn, "minute"],
      "idendpoint",
      [sequelize.fn("COUNT", "*"), "count"],
    ],
    group: ["minute", "idendpoint"], // Agrupamos por las columnas alias y idendpoint
    order: [["minute", "ASC"]],
    raw: true, // Resultados crudos para manipular fechas
  });

  return rawResults;
}

// === CONSULTA PARA OBTENER CONTEOS POR MINUTO + STATUS CODE ===
async function getStatusCountsByMinute(
  sequelize,
  startDate,
  endDate,
  idapp,
  environment
) {
  const truncatedColumn = getTruncatedMinuteColumn(sequelize);

  const rawResults = await LogEntry.findAll({
    where: {
      [Op.and]: [
        { timestamp: { [Op.between]: [startDate, endDate] } },
        idapp ? { idapp } : {},
        getEnvironmentFilter(environment),
      ],
    },
    attributes: [
      [truncatedColumn, "minute"],
      "status_code",
      [sequelize.fn("COUNT", "*"), "count"],
    ],
    group: ["minute", "status_code"],
    order: [["minute", "ASC"]],
    raw: true,
  });

  return rawResults;
}

// === CONSULTA PARA OBTENER PROMEDIO DE RESPONSE_TIME POR MINUTO ===
async function getAvgResponseTimeByMinute(
  sequelize,
  startDate,
  endDate,
  idapp,
  environment
) {
  const truncatedColumn = getTruncatedMinuteColumn(sequelize);

  const rawResults = await LogEntry.findAll({
    where: {
      [Op.and]: [
        { timestamp: { [Op.between]: [startDate, endDate] } },
        idapp ? { idapp } : {},
        getEnvironmentFilter(environment),
      ],
    },
    attributes: [
      [truncatedColumn, "minute"],
      [sequelize.fn("AVG", sequelize.col("response_time")), "avg_response_time"],
    ],
    group: ["minute"],
    order: [["minute", "ASC"]],
    raw: true,
  });

  return rawResults;
}

function statusClassFor(status_code) {
  const code = Number(status_code);
  if (code < 200) return "info";
  if (code < 300) return "success";
  if (code < 400) return "redirect";
  if (code < 500) return "client_error";
  return "server_error";
}

/**
 * Obtiene la cantidad de requests por minuto, agrupados por clase de status HTTP
 * (info/success/redirect/client_error/server_error), para una app en las últimas N horas.
 *
 * @param {{idapp: string, last_hours?: number, environment?: string}} options
 * @returns {Promise<Array<{minute: string, status_class: string, count: number}>>}
 */
export const getLogsStatusClassPerMinute = async (options) => {
  const { idapp, last_hours = 24, environment } = options;

  try {
    if (last_hours <= 0)
      throw new Error("Las horas deben ser un número positivo");

    const sequelize = LogEntry.sequelize;
    const { from: startDate, to: endDate } = windowFromNow({
      hours: last_hours || 1,
    });

    const rawResults = await getStatusCountsByMinute(
      sequelize,
      startDate,
      endDate,
      idapp,
      environment
    );

    const bucketed = new Map();
    for (const row of rawResults) {
      const status_class = statusClassFor(row.status_code);
      const key = `${row.minute}|${status_class}`;
      bucketed.set(key, (bucketed.get(key) || 0) + Number(row.count));
    }

    return Array.from(bucketed, ([key, count]) => {
      const [minute, status_class] = key.split("|");
      return { minute, status_class, count };
    });
  } catch (error) {
    console.error(
      "❌ Error obteniendo registros por minuto y clase de status:",
      error
    );
    return {
      success: false,
      error: error.message,
      data: [],
    };
  }
};

/**
 * Obtiene el response_time promedio por minuto para una app en las últimas N horas.
 *
 * @param {{idapp: string, last_hours?: number, environment?: string}} options
 * @returns {Promise<Array<{minute: string, avg_response_time: number}>>}
 */
export const getResponseTimePerMinute = async (options) => {
  const { idapp, last_hours = 24, environment } = options;

  try {
    if (last_hours <= 0)
      throw new Error("Las horas deben ser un número positivo");

    const sequelize = LogEntry.sequelize;
    const { from: startDate, to: endDate } = windowFromNow({
      hours: last_hours || 1,
    });

    const rawResults = await getAvgResponseTimeByMinute(
      sequelize,
      startDate,
      endDate,
      idapp,
      environment
    );

    return rawResults.map((row) => ({
      minute: row.minute,
      avg_response_time: Number(row.avg_response_time || 0),
    }));
  } catch (error) {
    console.error("❌ Error obteniendo response_time promedio por minuto:", error);
    return {
      success: false,
      error: error.message,
      data: [],
    };
  }
};

/**
 * Obtiene un resumen de logs agrupados por idendpoint para una aplicación específica.
 *
 * @param {{idapp: string, last_days?: number, environment?: string}} data
 * @returns {Promise<Array<{ idendpoint: string, totalStatusCode: number, recordCount: number }>>}
 *          Un array de objetos, cada uno representando un endpoint con el total de status_code y la cantidad de registros.
 */
export async function getLogSummaryByAppStatusCode(data) {
  if (data && data.idapp) {
    try {
      const last_days =
        data.last_days !== undefined && data.last_days !== null
          ? Number(data.last_days)
          : 7;
      if (!Number.isInteger(last_days) || last_days <= 0) {
        throw new Error(
          `El parámetro 'last_days' debe ser un entero positivo. Recibido: ${data.last_days}`,
        );
      }

      const { from: pastDate } = windowFromNow({ days: last_days });

      const summary = await LogEntry.findAll({
        attributes: [
          "idendpoint", // El campo por el que agrupamos
          "status_code",
          [dbsequelize.fn("COUNT", dbsequelize.col("id")), "recordCount"], // Cantidad de registros
        ],
        where: {
          [Op.and]: [
            { idapp: data.idapp }, // Filtra por el idapp proporcionado
            { timestamp: { [Op.gte]: pastDate } }, // Solo logs desde `last_days` días atrás
            getEnvironmentFilter(data.environment),
          ],
        },
        group: ["idendpoint", "status_code"], // Agrupa los resultados por idendpoint
        raw: true, // Importante para obtener objetos JSON planos en lugar de instancias del modelo Sequelize
      });

      return summary;
    } catch (error) {
      console.error("Error al obtener el resumen de logs por endpoint:", error);
      throw error; // Propagar el error para que la lógica superior lo maneje
    }
  } else {
    throw new Error("El parámetro idapp es obligatorio");
  }
}

export async function getAppEndpointUsageSummary(data) {
  if (!data || !data.idapp) {
    throw new Error("El parámetro idapp es obligatorio");
  }

  const last_days =
    data.last_days !== undefined && data.last_days !== null
      ? Number(data.last_days)
      : 7;
  if (!Number.isInteger(last_days) || last_days <= 0) {
    throw new Error(
      `El parámetro 'last_days' debe ser un entero positivo. Recibido: ${data.last_days}`,
    );
  }

  const top = data.top !== undefined && data.top !== null ? Number(data.top) : 5;
  if (!Number.isInteger(top) || top <= 0) {
    throw new Error(
      `El parámetro 'top' debe ser un entero positivo. Recibido: ${data.top}`,
    );
  }

  if (
    data.status !== undefined &&
    data.status !== "enabled" &&
    data.status !== "disabled"
  ) {
    throw new Error(
      `El parámetro 'status' debe ser 'enabled' o 'disabled'. Recibido: ${data.status}`,
    );
  }

  // Full endpoint list for the app (used for the "totals" block, unfiltered by `status`)
  const allEndpoints = (
    await getEndpointByIdApp(
      data.idapp,
      ["idendpoint", "resource", "method", "title", "enabled"],
      data.environment
    )
  ).map((e) => (e.toJSON ? e.toJSON() : e));

  // Endpoints considered for most_used/unused, per `status` filter
  const consideredEndpoints =
    data.status === undefined
      ? allEndpoints
      : allEndpoints.filter((e) => e.enabled === (data.status === "enabled"));

  const { from: pastDate, to: windowEnd } = windowFromNow({ days: last_days });

  const counts = await LogEntry.findAll({
    attributes: [
      "idendpoint",
      [dbsequelize.fn("COUNT", dbsequelize.col("id")), "recordCount"],
    ],
    where: {
      [Op.and]: [
        { idapp: data.idapp },
        { timestamp: { [Op.gte]: pastDate } },
        getEnvironmentFilter(data.environment),
      ],
    },
    group: ["idendpoint"],
    raw: true,
  });
  const countMap = new Map(counts.map((c) => [c.idendpoint, Number(c.recordCount)]));

  const enriched = consideredEndpoints.map((e) => ({
    idendpoint: e.idendpoint,
    resource: e.resource,
    method: e.method,
    title: e.title,
    enabled: e.enabled,
    requestCount: countMap.get(e.idendpoint) || 0,
  }));

  const most_used = [...enriched]
    .sort((a, b) => b.requestCount - a.requestCount)
    .slice(0, top);

  const unused = enriched
    .filter((e) => e.requestCount === 0)
    .sort((a, b) => a.resource.localeCompare(b.resource))
    .slice(0, top);

  return {
    idapp: data.idapp,
    window: {
      last_days,
      from: pastDate.toISOString(),
      to: windowEnd.toISOString(),
    },
    totals: {
      total_endpoints: allEndpoints.length,
      enabled_endpoints: allEndpoints.filter((e) => e.enabled).length,
      total_requests_in_window: counts.reduce(
        (sum, c) => sum + Number(c.recordCount),
        0,
      ),
    },
    most_used,
    unused,
  };
}

/**
 * Devuelve el top N de endpoints con más errores (status_code >= 400) en una ventana de
 * tiempo reciente. Filtros idapp/environment opcionales; si se omiten el ranking es global.
 *
 * @param {{last_hours?: number, top?: number, idapp?: string, environment?: string}} data
 */
export async function getTopErrorEndpoints(data = {}) {
  const last_hours =
    data.last_hours !== undefined && data.last_hours !== null
      ? Number(data.last_hours)
      : 24;
  if (!Number.isInteger(last_hours) || last_hours <= 0) {
    throw new Error(
      `El parámetro 'last_hours' debe ser un entero positivo. Recibido: ${data.last_hours}`,
    );
  }

  const top = data.top !== undefined && data.top !== null ? Number(data.top) : 10;
  if (!Number.isInteger(top) || top <= 0) {
    throw new Error(
      `El parámetro 'top' debe ser un entero positivo. Recibido: ${data.top}`,
    );
  }

  const { from: pastDate, to: windowEnd } = windowFromNow({ hours: last_hours });

  const counts = await LogEntry.findAll({
    attributes: [
      "idendpoint",
      [dbsequelize.fn("COUNT", dbsequelize.col("id")), "errorCount"],
    ],
    where: {
      [Op.and]: [
        { status_code: { [Op.gte]: 400 } },
        { timestamp: { [Op.gte]: pastDate } },
        ...(data.idapp ? [{ idapp: data.idapp }] : []),
        getEnvironmentFilter(data.environment),
      ],
    },
    group: ["idendpoint"],
    raw: true,
  });

  const ranked = counts
    .map((c) => ({ idendpoint: c.idendpoint, errorCount: Number(c.errorCount) }))
    .sort((a, b) => b.errorCount - a.errorCount)
    .slice(0, top);

  const allEndpoints = (await getAllEndpoints()).map((e) =>
    e.toJSON ? e.toJSON() : e,
  );
  const endpointMap = new Map(allEndpoints.map((e) => [e.idendpoint, e]));

  const apps = await Application.findAll({
    attributes: ["idapp", "app"],
    raw: true,
  });
  const appMap = new Map(apps.map((a) => [a.idapp, a.app]));

  const top_error_endpoints = ranked.map((r) => {
    const endpoint = endpointMap.get(r.idendpoint);
    return {
      idendpoint: r.idendpoint,
      errorCount: r.errorCount,
      resource: endpoint?.resource,
      method: endpoint?.method,
      title: endpoint?.title,
      idapp: endpoint?.idapp,
      app: appMap.get(endpoint?.idapp),
    };
  });

  return {
    window: {
      last_hours,
      from: pastDate.toISOString(),
      to: windowEnd.toISOString(),
    },
    filters: {
      idapp: data.idapp || null,
      environment: data.environment || null,
    },
    top_error_endpoints,
  };
}

/**
 * Igual que getTopErrorEndpoints, pero además desglosa el conteo de errores de
 * cada endpoint del ranking en buckets de tiempo (hora o minuto), para poder
 * graficar en qué momentos se concentraron los errores.
 *
 * @param {{idapp?: string, environment?: string, last_hours?: number, top?: number, granularity?: 'hour'|'minute'}} data
 */
export async function getTopErrorEndpointsByTime(data = {}) {
  const granularity = data.granularity === "minute" ? "minute" : "hour";

  const ranking = await getTopErrorEndpoints(data);
  const idendpoints = ranking.top_error_endpoints.map((e) => e.idendpoint);

  if (idendpoints.length === 0) {
    return { ...ranking, granularity, top_error_endpoints: [] };
  }

  const sequelize = LogEntry.sequelize;
  const truncatedColumn = getTruncatedColumnByGranularity(sequelize, granularity);
  const pastDate = new Date(ranking.window.from);

  const rows = await LogEntry.findAll({
    attributes: [
      [truncatedColumn, "bucket"],
      "idendpoint",
      [dbsequelize.fn("COUNT", dbsequelize.col("id")), "count"],
    ],
    where: {
      [Op.and]: [
        { idendpoint: idendpoints },
        { status_code: { [Op.gte]: 400 } },
        { timestamp: { [Op.gte]: pastDate } },
      ],
    },
    group: ["bucket", "idendpoint"],
    order: [["bucket", "ASC"]],
    raw: true,
  });

  const seriesByEndpoint = new Map();
  for (const row of rows) {
    if (!seriesByEndpoint.has(row.idendpoint)) {
      seriesByEndpoint.set(row.idendpoint, []);
    }
    seriesByEndpoint
      .get(row.idendpoint)
      .push({ bucket: row.bucket, count: Number(row.count) });
  }

  return {
    ...ranking,
    granularity,
    top_error_endpoints: ranking.top_error_endpoints.map((e) => ({
      ...e,
      series: seriesByEndpoint.get(e.idendpoint) || [],
    })),
  };
}

function normalizeTraceId(trace_id) {
  const normalized = typeof trace_id === "string" ? trace_id.trim() : "";
  if (!normalized) {
    throw new Error("trace_id es obligatorio y debe ser una cadena no vacia");
  }
  return normalized;
}

function normalizePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error("El valor debe ser un entero positivo");
  }
  return normalized;
}

function parseBooleanOption(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
}

/**
 * Obtiene solo eventos problematicos por trace_id.
 * Problematicos = 3xx + 4xx + 5xx (configurable).
 */
export async function getTraceErrorsOnly(options = {}) {
  try {
    const trace_id = normalizeTraceId(options.trace_id);
    const include_redirects = parseBooleanOption(options.include_redirects, true);
    const include_client_errors = parseBooleanOption(
      options.include_client_errors,
      true,
    );
    const include_server_errors = parseBooleanOption(
      options.include_server_errors,
      true,
    );

    const limit = normalizePositiveInt(options.limit, 200);
    const offset = Number(options.offset || 0);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("offset debe ser un entero mayor o igual a 0");
    }

    const statusFilters = [];
    if (include_redirects) {
      statusFilters.push({ [Op.between]: [300, 399] });
    }
    if (include_client_errors) {
      statusFilters.push({ [Op.between]: [400, 499] });
    }
    if (include_server_errors) {
      statusFilters.push({ [Op.between]: [500, 599] });
    }

    if (statusFilters.length === 0) {
      return [];
    }

    const where = {
      trace_id,
      status_code: {
        [Op.or]: statusFilters,
      },
    };

    return await LogEntry.findAll({
      where,
      attributes: [
        "id",
        "timestamp",
        "trace_id",
        "idapp",
        "idendpoint",
        "url",
        "method",
        "status_code",
        "log_level",
        "response_time",
        "message",
      ],
      order: [["timestamp", "ASC"]],
      limit,
      offset,
      raw: true,
    });
  } catch (error) {
    console.error("Error en getTraceErrorsOnly:", error);
    throw error;
  }
}

/**
 * Devuelve endpoints mas lentos dentro de un trace_id.
 */
export async function getTraceSlowestHops(options = {}) {
  try {
    const trace_id = normalizeTraceId(options.trace_id);
    const threshold_ms = Number(options.threshold_ms ?? 500);
    if (!Number.isFinite(threshold_ms) || threshold_ms < 0) {
      throw new Error("threshold_ms debe ser un numero mayor o igual a 0");
    }
    const top_n = normalizePositiveInt(options.top_n, 10);

    const rows = await LogEntry.findAll({
      where: {
        trace_id,
        response_time: {
          [Op.gte]: threshold_ms,
        },
      },
      attributes: [
        "idendpoint",
        "url",
        "method",
        [Sequelize.fn("COUNT", Sequelize.col("id")), "hits"],
        [Sequelize.fn("AVG", Sequelize.col("response_time")), "avg_response_time"],
        [Sequelize.fn("MAX", Sequelize.col("response_time")), "max_response_time"],
        [Sequelize.fn("MIN", Sequelize.col("response_time")), "min_response_time"],
        [Sequelize.fn("SUM", Sequelize.col("response_time")), "total_response_time"],
      ],
      group: ["idendpoint", "url", "method"],
      order: [[Sequelize.literal("max_response_time"), "DESC"]],
      limit: top_n,
      raw: true,
    });

    return rows.map((row) => ({
      ...row,
      hits: Number(row.hits || 0),
      avg_response_time: Number(row.avg_response_time || 0),
      max_response_time: Number(row.max_response_time || 0),
      min_response_time: Number(row.min_response_time || 0),
      total_response_time: Number(row.total_response_time || 0),
    }));
  } catch (error) {
    console.error("Error en getTraceSlowestHops:", error);
    throw error;
  }
}

/**
 * Resumen compacto del trace para agentes IA.
 */
export async function getTraceSummary(options = {}) {
  try {
    const trace_id = normalizeTraceId(options.trace_id);
    const slow_threshold_ms = Number(options.slow_threshold_ms ?? 500);
    if (!Number.isFinite(slow_threshold_ms) || slow_threshold_ms < 0) {
      throw new Error("slow_threshold_ms debe ser un numero mayor o igual a 0");
    }

    const traceLogs = await LogEntry.findAll({
      where: { trace_id },
      attributes: [
        "timestamp",
        "idendpoint",
        "url",
        "method",
        "status_code",
        "response_time",
      ],
      order: [["timestamp", "ASC"]],
      raw: true,
    });

    if (!traceLogs.length) {
      return {
        trace_id,
        total_requests: 0,
        by_status_family: {
          "2xx": 0,
          "3xx": 0,
          "4xx": 0,
          "5xx": 0,
          other: 0,
        },
        errors_total: 0,
        slow_requests_total: 0,
        unique_endpoints: 0,
        first_timestamp: null,
        last_timestamp: null,
        worst_status_code: null,
        first_problematic_request: null,
        slowest_request: null,
      };
    }

    const statusFamily = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 };
    let errors_total = 0;
    let slow_requests_total = 0;
    let first_problematic_request = null;
    let slowest_request = null;
    let worst_status_code = 0;
    const uniqueEndpointKeys = new Set();

    for (const log of traceLogs) {
      const sc = Number(log.status_code || 0);
      if (sc >= 200 && sc <= 299) statusFamily["2xx"]++;
      else if (sc >= 300 && sc <= 399) statusFamily["3xx"]++;
      else if (sc >= 400 && sc <= 499) statusFamily["4xx"]++;
      else if (sc >= 500 && sc <= 599) statusFamily["5xx"]++;
      else statusFamily.other++;

      if (sc >= 300) {
        errors_total++;
        if (!first_problematic_request) {
          first_problematic_request = {
            timestamp: log.timestamp,
            idendpoint: log.idendpoint,
            url: log.url,
            method: log.method,
            status_code: sc,
            response_time: Number(log.response_time || 0),
          };
        }
      }

      const rt = Number(log.response_time || 0);
      if (rt >= slow_threshold_ms) {
        slow_requests_total++;
      }

      if (!slowest_request || rt > Number(slowest_request.response_time || 0)) {
        slowest_request = {
          timestamp: log.timestamp,
          idendpoint: log.idendpoint,
          url: log.url,
          method: log.method,
          status_code: sc,
          response_time: rt,
        };
      }

      if (sc > worst_status_code) {
        worst_status_code = sc;
      }

      uniqueEndpointKeys.add(`${log.method || ""}::${log.url || ""}::${log.idendpoint || ""}`);
    }

    return {
      trace_id,
      total_requests: traceLogs.length,
      by_status_family: statusFamily,
      errors_total,
      slow_requests_total,
      unique_endpoints: uniqueEndpointKeys.size,
      first_timestamp: traceLogs[0]?.timestamp || null,
      last_timestamp: traceLogs[traceLogs.length - 1]?.timestamp || null,
      worst_status_code,
      first_problematic_request,
      slowest_request,
    };
  } catch (error) {
    console.error("Error en getTraceSummary:", error);
    throw error;
  }
}
