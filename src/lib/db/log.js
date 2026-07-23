import { LogEntry } from "./models.js";
import { getEndpointByIdApp, getAllEndpoints } from "./endpoint.js";
import { Op, Sequelize } from "sequelize";
import dbsequelize from "./sequelize.js";

import { DateTime } from "luxon";

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
      // TODO: Es posible que se deba usar Luxon para los calculos de fechas
      //const now = new Date();

      // 1. Obtener la fecha y hora actual
      const ahora = DateTime.now();
      // 2. Restar 5 horas
      const tiempoAtras = ahora.minus({ hours: last_hours_int });

      // 3. Convertir el resultado a un objeto Date de JavaScript
      const pastDate = tiempoAtras.toJSDate();
      /*
      const pastDate = new Date(
        now.getTime() - last_hours_int * 60 * 60 * 1000
      );
      */

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

    // Filtro por status_code
    if (status_code !== undefined && status_code !== null) {
      const normalizedStatusCode = Number(status_code);
      if (
        !Number.isInteger(normalizedStatusCode) ||
        normalizedStatusCode < 100 ||
        normalizedStatusCode > 599
      ) {
        throwValidationError({
          field: "status_code",
          message: `Invalid 'status_code' value '${serializeValue(status_code)}'. Accepted range is 100 to 599.`,
          received: status_code,
          range: { min: 100, max: 599 },
        });
      }
      whereConditions.status_code = normalizedStatusCode;
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
      const now = new Date();
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
export const getLogsRecordsPerMinute = async (options) => {
  // Parámetros con valores por defecto
  const {
    idapp,
    last_hours = 24,
    idendpoint,
    raw = true, // Si quieres objetos planos en lugar de instancias de Sequelize
  } = options;

  try {
    // Validaciones básicas
    //if (!idendpoint) throw new Error("Se requiere un idendpoint válido");
    if (last_hours <= 0)
      throw new Error("Las horas deben ser un número positivo");

    const sequelize = LogEntry.sequelize;

    const endDate = new Date(); // Ahora
    //const startDate = new Date(endDate.getTime() - last_hours * 60 * 60 * 1000); // Fecha de inicio

    // 1. Obtener la fecha y hora actual
    const ahora = DateTime.now();
    // 2. Restar 5 horas
    const tiempoAtras = ahora.minus({ hours: last_hours || 1 });

    // 3. Convertir el resultado a un objeto Date de JavaScript
    const startDate = tiempoAtras.toJSDate();

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
      idapp
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
  idapp // Nuevo parametro opcional
) {
  // Función para generar el truncado de fecha según el tipo de BD
  const getTruncatedMinuteColumn = () => {
    const dialect = sequelize.getDialect(); // Accedemos al dialecto desde el modelo

    switch (dialect) {
      case "postgres":
        return sequelize.fn("DATE_TRUNC", "minute", sequelize.col("timestamp"));
      case "mysql":
        return sequelize.fn(
          "DATE_FORMAT",
          sequelize.col("timestamp"),
          "%Y-%m-%d %H:%i:00"
        );
      case "mssql":
        return sequelize.fn(
          "DATEADD",
          "minute",
          sequelize.fn(
            "DATEDIFF",
            "minute",
            sequelize.literal("0"),
            sequelize.col("timestamp")
          ),
          sequelize.literal("0")
        );
      case "sqlite":
        return sequelize.fn(
          "STRFTIME",
          "%Y-%m-%d %H:%M:00",
          sequelize.col("timestamp")
        );
      default:
        // Fallback para otros dialectos o error
        throw new Error(`Dialecto no soportado: ${dialect}`);
    }
  };

  const truncatedColumn = getTruncatedMinuteColumn();

  const rawResults = await LogEntry.findAll({
    where: {
      [Op.and]: [
        { timestamp: { [Op.between]: [startDate, endDate] } },
        endpointFilter ? { idendpoint: endpointFilter } : {},
        idapp ? { idapp: idapp } : {},
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

/**
 * Obtiene un resumen de logs agrupados por idendpoint para una aplicación específica.
 *
 * @param {string} idapp El UUID de la aplicación a consultar.
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

      const pastDate = DateTime.now().minus({ days: last_days }).toJSDate();

      const summary = await LogEntry.findAll({
        attributes: [
          "idendpoint", // El campo por el que agrupamos
          "status_code",
          [dbsequelize.fn("COUNT", dbsequelize.col("id")), "recordCount"], // Cantidad de registros
        ],
        where: {
          idapp: data.idapp, // Filtra por el idapp proporcionado
          timestamp: { [Op.gte]: pastDate }, // Solo logs desde `last_days` días atrás
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
