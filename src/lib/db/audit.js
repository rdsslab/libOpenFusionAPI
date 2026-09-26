/**
 * @file audit.js
 * @description Capa de acceso a datos para la tabla `ofapi_audit_log`.
 *
 * Pista de auditoría de acciones de usuario (GUI + tools MCP pasan por los
 * mismos endpoints REST /api/system/*). Registro append-only: login/logout
 * y CRUD de apps, endpoints, appvars, bots, interval tasks, usuarios,
 * api clients y api keys.
 *
 * Los snapshots `before_data`/`after_data` llegan YA SANITIZADOS por
 * auditService.recordAudit(); esta capa solo persiste.
 */

import { AuditLog } from "./models.js";
import { Op } from "sequelize";
import dbsequelize from "./sequelize.js";

/** Tope del mensaje serializado para los campos `message`. */
const MAX_MESSAGE_CHARS = 4096;

/**
 * Catálogo de acciones de auditoría.
 */
export const AUDIT_ACTIONS = Object.freeze({
  LOGIN: "login",
  LOGIN_FAILED: "login_failed",
  LOGOUT: "logout",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  ENABLE: "enable",
  DISABLE: "disable",
  RESTORE: "restore",
  BULK_DELETE: "bulk_delete",
});

/**
 * Catálogo de tipos de entidad auditados.
 */
export const AUDIT_ENTITY_TYPES = Object.freeze({
  APP: "app",
  APPVAR: "appvar",
  ENDPOINT: "endpoint",
  BOT: "bot",
  INTERVAL_TASK: "interval_task",
  USER: "user",
  APICLIENT: "apiclient",
  APIKEY: "apikey",
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
 * Registra un evento de auditoría.
 *
 * Nunca lanza: la auditoría no puede tumbar la operación de negocio.
 *
 * @param {Object} data
 * @param {string} [data.trace_id]        - ofapi-trace-id del request
 * @param {string} [data.actor_kind]      - user|apikey|system
 * @param {string} [data.actor_id]        - PK del actor como string
 * @param {string} [data.actor_username]  - Usuario/cliente que ejecutó la acción
 * @param {string} [data.idclient]        - UUID del api client (si aplica)
 * @param {string} data.action            - Ver AUDIT_ACTIONS
 * @param {string} data.entity_type       - Ver AUDIT_ENTITY_TYPES
 * @param {string} [data.entity_id]       - PK de la entidad como string
 * @param {string} [data.idapp]           - UUID de la app propietaria
 * @param {string} [data.environment]     - dev|qa|prd (acciones por app)
 * @param {string} [data.target_username] - Usuario objetivo (login/reset...)
 * @param {boolean} [data.status=true]    - true = éxito, false = fallo
 * @param {number} [data.result_code]     - Código HTTP/resultado
 * @param {string} [data.message]         - Resumen legible
 * @param {any}    [data.before]          - Snapshot previo sanitizado
 * @param {any}    [data.after]           - Snapshot resultante sanitizado
 * @param {string} [data.ip]              - IP del cliente
 * @param {string} [data.user_agent]      - User agent del cliente
 * @returns {Promise<object|null>}
 */
export const createAuditLog = async (data) => {
  try {
    return await AuditLog.create({
      trace_id: data.trace_id || null,
      actor_kind: data.actor_kind || "user",
      actor_id: data.actor_id != null ? String(data.actor_id) : null,
      actor_username: data.actor_username || null,
      idclient: data.idclient || null,
      action: data.action,
      entity_type: data.entity_type,
      entity_id: data.entity_id != null ? String(data.entity_id) : null,
      idapp: data.idapp || null,
      environment: data.environment || null,
      target_username: data.target_username || null,
      status: data.status !== false,
      result_code: data.result_code != null ? data.result_code : null,
      message: data.message ? truncateValue(data.message) : null,
      before_data: data.before || null,
      after_data: data.after || null,
      ip: data.ip || null,
      user_agent: data.user_agent || null,
    });
  } catch (error) {
    console.error("[audit.js] Error creating audit log:", error);
    return null;
  }
};

/**
 * Lista de eventos de auditoría con filtros y paginado (vista ligera, sin
 * `before_data`/`after_data`; el detalle se obtiene con getAuditLogById).
 *
 * @param {Object} filters
 * @param {string} [filters.actor_kind]
 * @param {string} [filters.actor_username]
 * @param {string} [filters.action]
 * @param {string} [filters.entity_type]
 * @param {string} [filters.entity_id]
 * @param {string} [filters.idapp]
 * @param {string} [filters.environment]
 * @param {string} [filters.target_username]
 * @param {boolean} [filters.status]
 * @param {Date|string} [filters.from]
 * @param {Date|string} [filters.to]
 * @param {number} [filters.limit=50]
 * @param {number} [filters.offset=0]
 * @returns {Promise<{rows: Object[], total: number, offset: number, limit: number}>}
 */
export const getAuditLogs = async (filters = {}) => {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(filters.limit) || 50)));
  const offset = Math.max(0, Math.floor(Number(filters.offset) || 0));

  const where = {};
  if (filters.actor_kind) where.actor_kind = filters.actor_kind;
  if (filters.idclient) where.idclient = filters.idclient;
  if (filters.actor_username) {
    where.actor_username = { [Op.eq]: filters.actor_username };
  }
  if (filters.action) where.action = filters.action;
  if (filters.entity_type) where.entity_type = filters.entity_type;
  if (filters.entity_id) where.entity_id = String(filters.entity_id);
  if (filters.idapp) where.idapp = filters.idapp;
  if (filters.environment) where.environment = filters.environment;
  if (filters.target_username) where.target_username = filters.target_username;
  if (filters.status !== undefined && filters.status !== null) {
    where.status = filters.status !== false && filters.status !== "false";
  }

  const dateFilter = {};
  if (filters.from) {
    const from = new Date(filters.from);
    if (!isNaN(from.getTime())) dateFilter[Op.gte] = from;
  }
  if (filters.to) {
    const to = new Date(filters.to);
    if (!isNaN(to.getTime())) dateFilter[Op.lte] = to;
  }
  if (Object.keys(dateFilter).length > 0) where.timestamp = dateFilter;

  try {
    const [rows, total] = await Promise.all([
      AuditLog.findAll({
        attributes: [
          "id",
          "trace_id",
          "timestamp",
          "actor_kind",
          "actor_id",
          "actor_username",
          "idclient",
          "action",
          "entity_type",
          "entity_id",
          "idapp",
          "environment",
          "target_username",
          "status",
          "result_code",
          "message",
          "ip",
          "user_agent",
        ],
        where,
        order: [["timestamp", "DESC"], ["id", "DESC"]],
        limit,
        offset,
        raw: true,
      }),
      AuditLog.count({ where }),
    ]);

    return { rows, total, offset, limit };
  } catch (error) {
    console.error("[audit.js] Error in getAuditLogs:", error);
    throw error;
  }
};

/**
 * Obtiene un evento de auditoría con sus snapshots before/after.
 *
 * @param {BigInt|string|number} id - PK de la fila
 * @returns {Promise<object|null>}
 */
const parseJsonSnapshot = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const getAuditLogById = async (id) => {
  try {
    const row = await AuditLog.findByPk(id, { raw: true });
    if (!row) return null;
    return {
      ...row,
      before_data: parseJsonSnapshot(row.before_data),
      after_data: parseJsonSnapshot(row.after_data),
    };
  } catch (error) {
    console.error("[audit.js] Error in getAuditLogById:", error);
    return null;
  }
};

/**
 * Elimina eventos anteriores a una fecha dada (retención configurable).
 *
 * @param {Date|string} before - Fecha límite (logs anteriores se borran)
 * @returns {Promise<number>} Filas borradas
 */
export const pruneAuditLogsBefore = async (before) => {
  try {
    const cutoff = new Date(before);
    if (isNaN(cutoff.getTime())) {
      throw new Error("Invalid date for pruning");
    }
    return await AuditLog.destroy({
      where: { timestamp: { [Op.lt]: cutoff } },
    });
  } catch (error) {
    console.error("[audit.js] Error pruning audit logs by date:", error);
    return 0;
  }
};

/**
 * Resumen de eventos en una ventana de tiempo.
 *
 * @param {Object} options
 * @param {number} [options.last_days=30]
 * @returns {Promise<Object>}
 */
export const getAuditLogStats = async (options = {}) => {
  const { last_days = 30 } = options;

  try {
    const from = new Date(Date.now() - last_days * 24 * 60 * 60 * 1000);

    const by_action = await AuditLog.findAll({
      attributes: [
        "action",
        [dbsequelize.fn("COUNT", dbsequelize.col("id")), "count"],
      ],
      where: { timestamp: { [Op.gte]: from } },
      group: ["action"],
      raw: true,
    });

    const by_actor = await AuditLog.findAll({
      attributes: [
        "actor_username",
        [dbsequelize.fn("COUNT", dbsequelize.col("id")), "count"],
      ],
      where: {
        timestamp: { [Op.gte]: from },
        actor_username: { [Op.ne]: null },
      },
      group: ["actor_username"],
      raw: true,
    });

    const by_entity = await AuditLog.findAll({
      attributes: [
        "entity_type",
        [dbsequelize.fn("COUNT", dbsequelize.col("id")), "count"],
      ],
      where: { timestamp: { [Op.gte]: from } },
      group: ["entity_type"],
      raw: true,
    });

    const failures = await AuditLog.count({
      where: { timestamp: { [Op.gte]: from }, status: false },
    });

    return {
      window: { last_days, from: from.toISOString(), to: new Date().toISOString() },
      total: by_action.reduce((acc, row) => acc + Number(row.count), 0),
      failures,
      by_action,
      by_actor,
      by_entity,
    };
  } catch (error) {
    console.error("[audit.js] Error in getAuditLogStats:", error);
    throw error;
  }
};