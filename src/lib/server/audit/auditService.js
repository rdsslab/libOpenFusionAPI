/**
 * @file auditService.js
 * @description Servicio de auditoría de acciones de usuario.
 *
 * Registra en `ofapi_audit_log` (auditService.recordAudit) las mutaciones
 * hechas por usuarios del sistema a través de los endpoints REST /api/system/*
 * (usados por la GUI y por las herramientas MCP). El actor, trace_id, IP y
 * user agent se derivan de `params.request`.
 *
 * Garantías:
 *  - `recordAudit` NUNCA lanza: si la persistencia falla, solo se loguea.
 *  - `sanitizeForAudit` redacta secretos (password, token, valores de AppVars
 *    => "[REDACTED]") antes de persistir.
 */

import { createAuditLog, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "../../db/audit.js";
import { getIPFromRequest } from "../utils.js";

export { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES };

/** Claves cuyo valor se redacta siempre, en cualquier profundidad. */
const SENSITIVE_KEYS = new Set([
  "password",
  "contrasena",
  "pass",
  "password_hash",
  "passwordhash",
  "token",
  "refresh_token",
  "refreshtoken",
  "access_token",
  "accesstoken",
  "secret",
  "client_secret",
  "clientsecret",
  "api_key",
  "apikey",
  "apikey_hash",
  "apikeyhash",
  "authorization",
  "auth",
  "x-api-key",
  "set-cookie",
  "private_key",
  "privatekey",
]);

/** Profundidad máxima de recorrido del snapshot antes de truncar. */
const MAX_SANITIZE_DEPTH = 8;

/**
 * Redacta secretos de un snapshot antes de persistirlo.
 *
 * Reglas:
 *  - Clave en SENSITIVE_KEYS => "[REDACTED]".
 *  - Objeto con forma de AppVar (`name` string + clave `value`) =>
 *    `value` se redacta (los AppVars pueden contener tokens de terceros).
 *
 * @param {any} value
 * @returns {any} Copia saneada (sin mutar el original).
 */
export const sanitizeForAudit = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (typeof value === "function") return "[fn]";
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    if (depth > MAX_SANITIZE_DEPTH) return "[array]";
    return value.map((item) => sanitizeForAudit(item, depth + 1));
  }

  if (depth > MAX_SANITIZE_DEPTH) return "[object]";

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    const looksLikeAppVarValue =
      lowerKey === "value" && typeof value.name === "string" && value.name !== "";

    if (SENSITIVE_KEYS.has(lowerKey) || looksLikeAppVarValue) {
      out[key] = "[REDACTED]";
    } else if (typeof val === "object" && val !== null) {
      out[key] = sanitizeForAudit(val, depth + 1);
    } else {
      out[key] = val;
    }
  }
  return out;
};

/**
 * Actor que ejecuta la acción, derivado del usuario autenticado.
 *
 * @param {Object} params - Parámetros del handler del sistema
 * @returns {{kind: string, id: string|null, username: string|null, idclient: string|null}}
 */
export const getActorFromParams = (params) => {
  const u = params?.request?.openfusionapi?.user;
  if (u?.admin?.iduser) {
    return {
      kind: "user",
      id: String(u.admin.iduser),
      username: u.admin.username || "-",
      idclient: null,
    };
  }
  if (u?.apikey?.idclient) {
    return {
      kind: "apikey",
      id: null,
      username: u.apikey?.name || "-",
      idclient: u.apikey.idclient,
    };
  }
  return { kind: "user", id: null, username: "-", idclient: null };
};

/**
 * Metadata del request (trace_id, IP, user agent).
 *
 * @param {Object} params
 * @returns {{trace_id: string|null, ip: string|null, user_agent: string|null}}
 */
export const getRequestMetaFromParams = (params) => ({
  trace_id: params?.request?.headers?.["ofapi-trace-id"] || null,
  ip: getIPFromRequest(params?.request) || null,
  user_agent: params?.request?.headers?.["user-agent"] || null,
});

/**
 * Registra un evento de auditoría. Nunca lanza.
 *
 * @param {Object} params - Parámetros del handler del sistema
 * @param {Object} entry
 * @param {string} entry.action        - Ver AUDIT_ACTIONS
 * @param {string} entry.entity_type   - Ver AUDIT_ENTITY_TYPES
 * @param {string} [entry.entity_id]
 * @param {string} [entry.idapp]
 * @param {string} [entry.environment]
 * @param {string} [entry.target_username]
 * @param {boolean} [entry.status=true]
 * @param {number} [entry.result_code]
 * @param {string} [entry.message]
 * @param {any}    [entry.before]      - Snapshot previo (se sanitiza aquí)
 * @param {any}    [entry.after]       - Snapshot resultante (se sanitiza aquí)
 * @param {Object} [entry.actor]       - Override de actor (p.ej. login fallido)
 * @returns {Promise<object|null>}
 */
export const recordAudit = async (params, entry = {}) => {
  try {
    const actor = entry.actor || getActorFromParams(params);
    const meta = getRequestMetaFromParams(params);

    return await createAuditLog({
      trace_id: entry.trace_id || meta.trace_id,
      actor_kind: entry.actor_kind || actor.kind,
      actor_id: entry.actor_id ?? actor.id,
      actor_username: entry.actor_username || actor.username,
      idclient: entry.idclient || actor.idclient,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id != null ? String(entry.entity_id) : null,
      idapp: entry.idapp || null,
      environment: entry.environment || null,
      target_username: entry.target_username || null,
      status: entry.status !== false,
      result_code: entry.result_code ?? null,
      message: entry.message || null,
      before: sanitizeForAudit(entry.before),
      after: sanitizeForAudit(entry.after),
      ip: entry.ip || meta.ip,
      user_agent: entry.user_agent || meta.user_agent,
    });
  } catch (error) {
    console.error(
      "[audit] recordAudit failed (non-blocking):",
      error?.message || error
    );
    return null;
  }
};