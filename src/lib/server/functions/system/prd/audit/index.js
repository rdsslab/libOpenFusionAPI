/**
 * @file audit/index.js
 * @description Handlers FUNCTION del sistema para consultar la pista de
 * auditoría (`ofapi_audit_log`):
 *
 *  - GET  /system/audit/log        => fnAuditLogSearch
 *  - GET  /system/audit/log/stats  => fnAuditLogStats
 *
 * Los eventos se escriben desde los demás handlers (recordAudit); aquí solo
 * se leen, nunca se modifican.
 */
import {
  getAuditLogs,
  getAuditLogById,
  getAuditLogStats,
  pruneAuditLogsBefore,
} from "../../../../../db/audit.js";
import { getAppVarsByIdApp } from "../../../../../db/appvars.js";

const SYSTEM_APP_ID = "cfcd2084-95d5-65ef-66e7-dff9f98764da";
const RETENTION_VAR = "$_VAR_AUDIT_LOG_RETENTION_DAYS";
const DEFAULT_RETENTION_DAYS = 365;

async function getRetentionDays() {
  try {
    const rows = (await getAppVarsByIdApp(SYSTEM_APP_ID)) || [];
    const row = rows
      .map((row) => (row.toJSON ? row.toJSON() : row))
      .find((row) => row.name === RETENTION_VAR);
    if (!row || row.value === null || row.value === undefined) {
      return DEFAULT_RETENTION_DAYS;
    }
    const days = Math.floor(Number(row.value));
    return Number.isFinite(days) && days >= 0 ? days : DEFAULT_RETENTION_DAYS;
  } catch (error) {
    console.error("[audit] getRetentionDays:", error?.message || error);
    return DEFAULT_RETENTION_DAYS;
  }
}

export async function fnAuditLogSearch(params) {
  let r = { data: undefined, code: 204 };

  try {
    const queryParams = params?.request?.query || {};
    const bodyParams = params?.request?.body || {};
    const merged = { ...queryParams, ...bodyParams };

    if (merged.id !== undefined && merged.id !== null && merged.id !== "") {
      const row = await getAuditLogById(merged.id);
      if (!row) {
        r.data = { error: "Audit log entry not found." };
        r.code = 404;
        return r;
      }
      r.data = row;
      r.code = 200;
      return r;
    }

    r.data = await getAuditLogs(merged);
    r.code = 200;
  } catch (error) {
    r.data = { error: error?.message || "Unexpected error while retrieving audit logs." };
    r.code = 500;
  }
  return r;
}

export async function fnAuditLogStats(params) {
  let r = { data: undefined, code: 204 };

  try {
    const queryParams = params?.request?.query || {};
    const bodyParams = params?.request?.body || {};
    const merged = { ...queryParams, ...bodyParams };

    r.data = await getAuditLogStats({ last_days: merged.last_days });
    r.code = 200;
  } catch (error) {
    r.data = { error: error?.message || "Unexpected error while computing audit stats." };
    r.code = 500;
  }
  return r;
}

/**
 * Poda de retención: elimina eventos de auditoría más antiguos que
 * `$_VAR_AUDIT_LOG_RETENTION_DAYS` (AppVar de la app system, default 365).
 * Maintenance endpoint llamado por un interval task diario.
 */
export async function fnAuditLogRetentionPrune(params) {
  let r = { data: undefined, code: 204 };

  try {
    const retentionDays = await getRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    if (retentionDays <= 0) {
      r.data = {
        retention_days: retentionDays,
        pruned: 0,
        status: "disabled",
        cutoff: null,
        message:
          "Retention set to 0: pruning disabled, audit rows are kept indefinitely.",
      };
      r.code = 200;
      return r;
    }

    const pruned = await pruneAuditLogsBefore(cutoff);
    r.data = {
      retention_days: retentionDays,
      pruned,
      status: "ok",
      cutoff: cutoff.toISOString(),
    };
    r.code = 200;
  } catch (error) {
    r.data = { error: error?.message || "Unexpected error while pruning audit logs." };
    r.code = 500;
  }
  return r;
}