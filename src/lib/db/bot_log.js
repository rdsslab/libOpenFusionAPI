/**
 * @file bot_log.js
 * @description Capa de acceso a datos para la tabla `ofapi_bot_log`.
 *
 * Historial detallado de eventos del ciclo de vida de los bots. Reemplaza el
 * uso de `LogEntry` para logs de bots con campos semánticos específicos
 * (provider, event, error_type, snapshots de estado runtime, etc.).
 *
 * Patrón similar a `interval_task_run.js`: cada evento es una fila distinta,
 * la poda es explícita y se gobierna con un límite configurable.
 */

import { BotLog } from "./models.js";
import { Op } from "sequelize";
import dbsequelize from "./sequelize.js";

/** Tope del mensaje serializado para campos JSON grandes. */
const MAX_MESSAGE_CHARS = 4096;

const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Catálogo de eventos de bots. Facilita validación y documentación.
 */
export const BOT_LOG_EVENTS = Object.freeze({
  STARTED: "bot_started",
  STOPPED: "bot_stopped",
  STARTUP_ERROR: "bot_startup_error",
  RUNTIME_ERROR: "bot_runtime_error",
  WORKER_CRASH: "bot_worker_crash",
  TOKEN_ERROR: "bot_token_error",
  RETRY_SCHEDULED: "bot_start_retry_scheduled",
  DEFERRED: "bot_start_deferred",
  QUARANTINED: "bot_quarantined",
  RESTARTING: "bot_restarting",
  AUTO_DISABLED: "bot_auto_disabled",
  DISABLED_BY_USER: "bot_disabled_by_user",
  OUTAGE_SUSPECTED: "bot_platform_outage_suspected",
  OUTAGE_CLEARED: "bot_platform_outage_cleared",
  MANAGE_ERROR: "bot_manage_error",
  AUTO_DISABLE_FAILED: "bot_auto_disable_failed",
  CUSTOM_LOG: "bot_custom_log",
});

/**
 * Niveles de log alineados con LOG_LEVEL de log.js pero independientes.
 */
export const BOT_LOG_LEVEL = Object.freeze({
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
});

/**
 * Recorta un valor serializado para que no infle la tabla.
 * @param {any} value
 * @returns {any}
 */
function truncateValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    return value.length > MAX_MESSAGE_CHARS
      ? value.slice(0, MAX_MESSAGE_CHARS) + "...[truncated]"
      : value;
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_MESSAGE_CHARS) return serialized;
    return serialized.slice(0, MAX_MESSAGE_CHARS) + "...[truncated]";
  } catch {
    return "[unserializable]";
  }
}

/**
 * Registra un evento de ciclo de vida de un bot.
 *
 * Nunca lanza: la observabilidad no puede tumbar la operación del bot.
 *
 * @param {Object} data
 * @param {string} [data.idbot]            - UUID del bot (null para eventos de plataforma)
 * @param {string} [data.idapp]            - UUID de la aplicación
 * @param {string} [data.trace_id]         - Correlación del intento de arranque
 * @param {string} [data.provider]         - Proveedor de mensajería
 * @param {string} [data.environment]      - Ambiente (dev/qa/prd)
 * @param {string} data.event              - Nombre del evento (ver BOT_LOG_EVENTS)
 * @param {number} [data.log_level=2]      - Severidad (0-5)
 * @param {number} [data.status_code]      - Estado semántico (200/400/500/503)
 * @param {string} [data.error_type]       - Clasificación del error
 * @param {any}    [data.message]          - Mensaje legible + detalles estructurados
 * @param {string} [data.stack]            - Stack trace truncado
 * @param {any}    [data.provider_response] - Respuesta cruda del provider
 * @param {string} [data.runtime_status_snapshot] - Estado del bot al momento del log
 * @param {number} [data.failure_count_snapshot]  - failure_count al momento del log
 * @param {number} [data.duration_ms]      - Duración del intento o uptime
 * @param {string} [data.user_agent]       - Quién generó: 'system', 'user', 'worker'
 * @param {any}    [data.metadata]         - Datos específicos del provider
 * @returns {Promise<object|null>}
 */
export const createBotLog = async (data) => {
  try {
    return await BotLog.create({
      idbot: data.idbot || null,
      idapp: data.idapp || null,
      trace_id: data.trace_id || null,
      timestamp: new Date(),
      provider: data.provider || null,
      environment: data.environment || null,
      event: data.event,
      log_level: data.log_level ?? BOT_LOG_LEVEL.INFO,
      status_code: data.status_code ?? null,
      error_type: data.error_type || null,
      message: data.message ? truncateValue(data.message) : null,
      stack: data.stack ? String(data.stack).slice(0, 2000) : null,
      provider_response: data.provider_response
        ? truncateValue(data.provider_response)
        : null,
      runtime_status_snapshot: data.runtime_status_snapshot || null,
      failure_count_snapshot: data.failure_count_snapshot ?? null,
      duration_ms: data.duration_ms ?? null,
      user_agent: data.user_agent || null,
      metadata: data.metadata ? truncateValue(data.metadata) : null,
    });
  } catch (error) {
    console.error("[bot_log.js] Error creating bot log:", error);
    return null;
  }
};

/**
 * Registra múltiples eventos en una sola transacción.
 *
 * @param {Object[]} logDataArray
 * @returns {Promise<{success: boolean, inserted: number}>}
 */
export const createBotLogsBulk = async (logDataArray) => {
  if (!logDataArray || logDataArray.length === 0) {
    return { success: true, inserted: 0 };
  }

  const t = await dbsequelize.transaction();

  try {
    const processedData = logDataArray.map((log) => ({
      idbot: log.idbot || null,
      idapp: log.idapp || null,
      trace_id: log.trace_id || null,
      timestamp: log.timestamp instanceof Date ? log.timestamp : new Date(),
      provider: log.provider || null,
      environment: log.environment || null,
      event: log.event,
      log_level: log.log_level ?? BOT_LOG_LEVEL.INFO,
      status_code: log.status_code ?? null,
      error_type: log.error_type || null,
      message: log.message ? truncateValue(log.message) : null,
      stack: log.stack ? String(log.stack).slice(0, 2000) : null,
      provider_response: log.provider_response
        ? truncateValue(log.provider_response)
        : null,
      runtime_status_snapshot: log.runtime_status_snapshot || null,
      failure_count_snapshot: log.failure_count_snapshot ?? null,
      duration_ms: log.duration_ms ?? null,
      user_agent: log.user_agent || null,
      metadata: log.metadata ? truncateValue(log.metadata) : null,
    }));

    await BotLog.bulkCreate(processedData, {
      transaction: t,
      individualHooks: false,
      returning: false,
    });

    await t.commit();
    return { success: true, inserted: processedData.length };
  } catch (error) {
    await t.rollback();
    console.error("[bot_log.js] Error in bulk insert:", error);
    throw error;
  }
};

/**
 * Consulta logs de un bot con filtros opcionales.
 *
 * @param {Object} [options]
 * @param {string} [options.idbot]          - Filtrar por bot
 * @param {string} [options.idapp]          - Filtrar por aplicación
 * @param {string} [options.event]          - Filtrar por evento (o lista separada por comas)
 * @param {string} [options.environment]    - Filtrar por ambiente
 * @param {string} [options.provider]       - Filtrar por proveedor
 * @param {string} [options.error_type]     - Filtrar por tipo de error
 * @param {string} [options.trace_id]       - Filtrar por trace de correlación
 * @param {number} [options.log_level]      - Filtrar por nivel mínimo
 * @param {Date|string} [options.start_date] - Fecha inicio (inclusive)
 * @param {Date|string} [options.end_date]  - Fecha fin (inclusive)
 * @param {number} [options.last_hours]     - Últimas N horas
 * @param {number} [options.limit=500]      - Límite de registros
 * @param {number} [options.offset=0]       - Offset para paginación
 * @param {string} [options.order="timestamp"] - Campo de orden
 * @param {string} [options.orderDirection="DESC"] - Dirección ASC/DESC
 * @returns {Promise<Object[]>}
 */
export const getBotLogs = async (options = {}) => {
  const {
    idbot,
    idapp,
    event,
    environment,
    provider,
    error_type,
    trace_id,
    log_level,
    start_date,
    end_date,
    last_hours,
    limit = 500,
    offset = 0,
    order = "timestamp",
    orderDirection = "DESC",
  } = options;

  try {
    const where = {};

    if (idbot) where.idbot = idbot;
    if (idapp) where.idapp = idapp;
    if (trace_id) where.trace_id = trace_id;
    if (provider) where.provider = provider;

    if (environment) {
      if (environment === "prd") {
        where[Op.or] = [{ environment: "prd" }, { environment: null }];
      } else {
        where.environment = environment;
      }
    }

    // Filtro por evento: acepta uno o lista separada por comas
    if (event) {
      const events = String(event)
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
      if (events.length === 1) {
        where.event = events[0];
      } else if (events.length > 1) {
        where.event = { [Op.in]: events };
      }
    }

    // Filtro por error_type: acepta uno o lista separada por comas
    if (error_type) {
      const types = String(error_type)
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      if (types.length === 1) {
        where.error_type = types[0];
      } else if (types.length > 1) {
        where.error_type = { [Op.in]: types };
      }
    }

    // Filtro por log_level mínimo
    if (log_level !== undefined && log_level !== null) {
      const lvl = Number(log_level);
      if (Number.isInteger(lvl) && lvl >= 0 && lvl <= 5) {
        where.log_level = { [Op.gte]: lvl };
      }
    }

    // Filtros de fecha
    if (start_date && end_date) {
      const startDate = new Date(start_date);
      const endDate = new Date(end_date);
      if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
        where.timestamp = { [Op.between]: [startDate, endDate] };
      }
    } else if (last_hours !== undefined && last_hours !== null) {
      const hours = Number(last_hours);
      if (Number.isInteger(hours) && hours > 0) {
        const from = new Date(Date.now() - hours * 60 * 60 * 1000);
        where.timestamp = { [Op.gte]: from };
      }
    }

    const normalizedLimit = Math.min(Math.max(Number(limit) || 500, 1), 10000);
    const normalizedOffset = Math.max(Number(offset) || 0, 0);

    return await BotLog.findAll({
      where,
      order: [[order, orderDirection.toUpperCase() === "ASC" ? "ASC" : "DESC"]],
      limit: normalizedLimit,
      offset: normalizedOffset,
      raw: true,
    });
  } catch (error) {
    console.error("[bot_log.js] Error in getBotLogs:", error);
    throw error;
  }
};

/**
 * Elimina logs antiguos de un bot, conservando solo los más recientes.
 *
 * @param {string} idbot - UUID del bot
 * @param {number} keep  - Número de logs a conservar (0 = borrar todo)
 * @returns {Promise<number>} Filas borradas
 */
export const pruneBotLogs = async (idbot, keep) => {
  try {
    const limit = Math.max(0, Math.floor(Number(keep) || 0));

    if (limit === 0) {
      return await BotLog.destroy({ where: { idbot } });
    }

    // Buscar el corte: obtener los IDs de los más recientes
    const survivors = await BotLog.findAll({
      attributes: ["id"],
      where: { idbot },
      order: [["id", "DESC"]],
      limit,
      raw: true,
    });

    if (survivors.length < limit) return 0;

    const oldestKept = survivors[survivors.length - 1].id;

    return await BotLog.destroy({
      where: { idbot, id: { [Op.lt]: oldestKept } },
    });
  } catch (error) {
    console.error("[bot_log.js] Error pruning bot logs:", error);
    return 0;
  }
};

/**
 * Elimina todos los logs más antiguos que una fecha dada.
 *
 * @param {Date|string} before - Fecha límite (logs anteriores se borran)
 * @returns {Promise<number>} Filas borradas
 */
export const pruneBotLogsBefore = async (before) => {
  try {
    const cutoff = new Date(before);
    if (isNaN(cutoff.getTime())) {
      throw new Error("Invalid date for pruning");
    }

    return await BotLog.destroy({
      where: { timestamp: { [Op.lt]: cutoff } },
    });
  } catch (error) {
    console.error("[bot_log.js] Error pruning bot logs by date:", error);
    return 0;
  }
};

/**
 * Resumen de eventos de un bot en una ventana de tiempo.
 *
 * @param {Object} options
 * @param {string} options.idbot           - UUID del bot
 * @param {number} [options.last_hours=24] - Horas hacia atrás
 * @returns {Promise<Object>}
 */
export const getBotLogStats = async (options = {}) => {
  const { idbot, last_hours = 24 } = options;

  try {
    if (!idbot) throw new Error("idbot is required");

    const from = new Date(Date.now() - last_hours * 60 * 60 * 1000);

    const events = await BotLog.findAll({
      attributes: [
        "event",
        [dbsequelize.fn("COUNT", dbsequelize.col("id")), "count"],
      ],
      where: {
        idbot,
        timestamp: { [Op.gte]: from },
      },
      group: ["event"],
      raw: true,
    });

    const errors = await BotLog.findAll({
      attributes: [
        "error_type",
        [dbsequelize.fn("COUNT", dbsequelize.col("id")), "count"],
      ],
      where: {
        idbot,
        timestamp: { [Op.gte]: from },
        error_type: { [Op.ne]: null },
      },
      group: ["error_type"],
      raw: true,
    });

    const total = await BotLog.count({
      where: {
        idbot,
        timestamp: { [Op.gte]: from },
      },
    });

    return {
      idbot,
      window: { last_hours, from: from.toISOString(), to: new Date().toISOString() },
      total_events: total,
      by_event: events,
      by_error_type: errors,
    };
  } catch (error) {
    console.error("[bot_log.js] Error in getBotLogStats:", error);
    throw error;
  }
};

/**
 * Último log de un bot (el más reciente).
 *
 * @param {string} idbot
 * @returns {Promise<Object|null>}
 */
export const getLatestBotLog = async (idbot) => {
  try {
    const logs = await BotLog.findAll({
      where: { idbot },
      order: [["timestamp", "DESC"]],
      limit: 1,
      raw: true,
    });
    return logs.length > 0 ? logs[0] : null;
  } catch (error) {
    console.error("[bot_log.js] Error in getLatestBotLog:", error);
    return null;
  }
};
