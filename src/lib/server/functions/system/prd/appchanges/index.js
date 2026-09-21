/**
 * Notificador de cambios de configuración por-grupo para aplicaciones de
 * OpenFusionAPI. Handler FUNCTION del endpoint interno `POST /system/appgroup/changes`
 * de la app system. Se ejecuta por interval task (~90 s) y bajo demanda desde el
 * bot con `respond_inline=true` (comando /changes del grupo).
 *
 * Consume la pista de auditoría (`ofapi_audit_log`) en lugar de los logs de
 * tráfico: toda mutación de `/api/system/*` (GUI, MCP, bot) queda registrada por
 * `recordAudit()` (auditService.js) con `idapp` + `environment` + `status`.
 *
 * Para cada grupo vinculado (chat_id -> idapp) recopila los cambios de
 * configuración (entity_type app/endpoint/interval_task/bot, status=true)
 * ocurridos desde el cursor de `$_VAR_GROUP_APP_CHANGES_CURSOR` y publica un
 * mensaje de Telegram agregado por grupo. Un grupo sin cambios nuevos queda en
 * silencio (estado "quiet").
 *
 * Config vía AppVars (env prd):
 *  - $_VAR_TELEGRAM_TOKEN              token del bot (placeholder = sin configurar)
 *  - $_VAR_GROUP_APP_MAP               { chat_id: { idapp, environment, linked_by, linked_at, notify_changes? } }
 *  - $_VAR_GROUP_APP_CHANGES_CURSOR    { "last_ts": "ISO", "last_id": n } cursor global
 *  - $_VAR_GROUP_APP_CHANGES_ENABLED   "on" | "off" (default: on)
 */
import { getAppVarsByIdApp, upsertAppVar, ensureAppVarOnce } from "../../../../../db/appvars.js";
import { getAuditLogs } from "../../../../../db/audit.js";
import { Application } from "../../../../../db/models.js";
import { sendTelegramMessage } from "../user/sendTelegramMessage.js";

const SYSTEM_APP_ID = "cfcd2084-95d5-65ef-66e7-dff9f98764da";
const ENV = "prd";

const MAP_VAR = "$_VAR_GROUP_APP_MAP";
const CURSOR_VAR = "$_VAR_GROUP_APP_CHANGES_CURSOR";
const ENABLED_VAR = "$_VAR_GROUP_APP_CHANGES_ENABLED";
const DEFAULT_WINDOW_MINUTES = 15;

/** entity_type -> (icono, nombre legible). */
const ENTITY_META = {
  app: { icon: "📦", label: "app" },
  endpoint: { icon: "🔌", label: "endpoint" },
  interval_task: { icon: "🗓", label: "interval task" },
  bot: { icon: "🤖", label: "bot" },
};

/** action -> verbo legible. */
const ACTION_VERB = {
  create: "created",
  update: "updated",
  delete: "deleted",
  enable: "enabled",
  disable: "disabled",
  restore: "restored",
  bulk_delete: "bulk deleted",
};

/** Escapa texto para no romper el HTML de Telegram. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const iso = (d) => d.toISOString();

/** Encuentra una AppVar (name + environment) de la app system. */
async function findAppVar(name) {
  const rows = await getAppVarsByIdApp(SYSTEM_APP_ID);
  const list = (rows || []).map((r) => (r.toJSON ? r.toJSON() : r));
  return list.find((r) => r.name === name && String(r.environment || "") === ENV);
}

async function getAppVarValue(name) {
  const row = await findAppVar(name);
  if (!row || row.value === null || row.value === undefined) return undefined;
  return String(row.value);
}

/** Upsert seguro: con idvar si existe (evita el conflicto de PK de upsert sin idvar). */
async function setAppVarValue(name, value) {
  const existing = await findAppVar(name);
  if (existing?.idvar) {
    return upsertAppVar({
      idapp: existing.idapp || SYSTEM_APP_ID,
      name: existing.name || name,
      environment: existing.environment || ENV,
      type: existing.type || "string",
      idvar: existing.idvar,
      value,
    });
  }
  return ensureAppVarOnce({
    idapp: SYSTEM_APP_ID,
    name,
    environment: ENV,
    type: "string",
    value,
  });
}

/** Lee un objeto JSON serializado en AppVar tolerando valores incompletos. */
function parseJsonVar(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function getAppName(idapp) {
  try {
    const app = await Application.findByPk(idapp);
    if (!app) return null;
    const plain = app.toJSON ? app.toJSON() : app;
    return plain?.app || plain?.name || idapp;
  } catch (error) {
    return idapp;
  }
}

const fmtTime = (d) => {
  try {
    return new Date(d).toLocaleString("en-GB", { timeZone: "UTC", hour12: false });
  } catch {
    return String(d ?? "");
  }
};

const fmtName = (idapp, name) =>
  name && name !== idapp ? `${name} [${String(idapp).slice(0, 8)}]` : String(idapp);

/**
 * Cambios de configuración de una app en la ventana (from, to], en orden
 * cronológico ascendente. Ya filtrados por idapp + entity_type + status.
 */
async function collectChanges({ idapp, from, to }) {
  const { rows } = await getAuditLogs({ from, to, status: true, limit: 200 });
  const allowed = Object.keys(ENTITY_META);
  const out = [];
  for (const r of rows) {
    if (r.idapp == null || String(r.idapp) !== String(idapp)) continue;
    if (!allowed.includes(r.entity_type)) continue;
    if (r.action && !ACTION_VERB[r.action]) continue;
    out.push(r);
  }
  out.sort((a, b) => {
    const t = new Date(a.timestamp) - new Date(b.timestamp);
    return t !== 0 ? t : Number(a.id) - Number(b.id);
  });
  return out;
}

/** Agrega los eventos de una app en un mensaje HTML legible; null si no hay cambios. */
function buildReport({ appName, events, from, to }) {
  if (!events.length) return null;

  const counts = {};
  for (const e of events) {
    const meta = counts[e.entity_type] || (counts[e.entity_type] = {});
    meta[e.action] = (meta[e.action] || 0) + 1;
  }

  const lines = [
    `<b>🔔 OpenFusionAPI — configuration changes</b>`,
    `📦 App: <b>${esc(fmtName(events[0].idapp, appName))}</b>`,
  ];
  if (from && to) lines.push(`🕐 Window: ${fmtTime(from)} UTC → ${fmtTime(to)} UTC`);
  lines.push("");

  for (const [entityType, counters] of Object.entries(counts)) {
    const meta = ENTITY_META[entityType] || { icon: "🧩", label: entityType };
    const parts = Object.entries(counters).map(([a, n]) => `${n} ${ACTION_VERB[a] || a}`);
    lines.push(`${meta.icon} <b>${meta.label}</b>: ${parts.join(" · ")}`);
  }

  const details = events.slice(-6).reverse();
  if (details.length) {
    lines.push("", "<b>Latest</b>");
    for (const e of details) {
      const meta = ENTITY_META[e.entity_type] || { icon: "🧩", label: e.entity_type };
      const idShort = String(e.entity_id || "?").slice(0, 12);
      const who = e.actor_username ? ` · <i>${esc(e.actor_username)}</i>` : "";
      const note = e.message ? ` · ${esc(String(e.message).slice(0, 60))}` : "";
      lines.push(
        `• ${fmtTime(e.timestamp)} UTC${who} · ${meta.icon} ${ACTION_VERB[e.action] || e.action} <code>${esc(idShort)}</code>${note}`
      );
    }
    if (events.length > details.length) {
      lines.push(`… and ${events.length - details.length} more`);
    }
  }
  return lines.join("\n");
}

async function sendReport({ token, chatId, text }) {
  if (!token || token.includes("PLACEHOLDER")) return { sent: false, reason: "NO_TOKEN" };
  if (!chatId) return { sent: false, reason: "NO_CHAT_ID" };
  const res = await sendTelegramMessage({ token, chatId, text });
  if (!res.ok) {
    console.error("[appgroup changes] send failed:", res.error);
  }
  return { sent: res.ok, reason: res.ok ? null : res.error };
}

/**
 * Handler principal.
 * @param {object} params de ejecución de FUNCTION (request, user_data, server_data, ...).
 */
export async function fnAppGroupChanges(params) {
  const initial = { code: 200, data: undefined };
  try {
    const request = params?.request || {};
    const body = request.body || {};
    const query = request.query || {};
    const respondInline =
      body.respond_inline === true ||
      body.respond_inline === "true" ||
      query.respond_inline === "true" ||
      query.respond_inline === true;
    const chatIdFilter = String(body.chat_id || query.chat_id || "");

    const [token, enabledRaw] = await Promise.all([
      getAppVarValue("$_VAR_TELEGRAM_TOKEN"),
      getAppVarValue(ENABLED_VAR),
    ]);
    if (!token || token.includes("PLACEHOLDER")) {
      initial.data = { mode: "changes", status: "skipped", reason: "NO_TOKEN" };
      return initial;
    }
    if (enabledRaw === "off") {
      initial.data = { mode: "changes", status: "skipped", reason: "DISABLED" };
      return initial;
    }

    const map = parseJsonVar(await getAppVarValue(MAP_VAR), {});
    const cursor = parseJsonVar(await getAppVarValue(CURSOR_VAR), {});
    const now = Date.now();

    let entries = Object.entries(map);
    if (chatIdFilter) {
      entries = entries.filter(([chatId]) => chatId === chatIdFilter);
      if (!entries.length) {
        initial.data = { mode: "changes", status: "quiet", reason: "CHAT_NOT_LINKED" };
        return initial;
      }
    }

    const lastTsRaw = cursor?.last_ts ? Date.parse(cursor.last_ts) : NaN;
    const lastId = Number(cursor?.last_id) || 0;
    const from = Number.isFinite(lastTsRaw) ? lastTsRaw : now - DEFAULT_WINDOW_MINUTES * 60 * 1000;
    const to = now;

    const counts = { linked: entries.length, sent: 0, quiet: 0, skipped: 0 };
    const byGroup = [];
    let maxTs = Number.isFinite(lastTsRaw) ? lastTsRaw : 0;
    let maxId = lastId;

    for (const [chatId, entry] of entries) {
      const idapp = entry?.idapp;
      if (!idapp) {
        counts.skipped += 1;
        continue;
      }
      const environment = String(entry?.environment || ENV).toLowerCase();

      let events;
      try {
        const raw = await collectChanges({ idapp, from, to });
        events = raw.filter((e) => {
          const ts = new Date(e.timestamp).getTime();
          const ok = ts > from || (ts === from && Number(e.id) > lastId);
          if (!ok) return false;
          return e.environment == null || String(e.environment).toLowerCase() === environment;
        });
      } catch (error) {
        console.error(`[fnAppGroupChanges] collect ${chatId} -> ${idapp}:`, error.message);
        counts.skipped += 1;
        continue;
      }

      // Avanzar el cursor global con el último evento observado (aunque no se envíe).
      for (const e of events) {
        const ts = new Date(e.timestamp).getTime();
        if (ts > maxTs || (ts === maxTs && Number(e.id) > maxId)) {
          maxTs = ts;
          maxId = Number(e.id);
        }
      }

      if (entry.notify_changes === false) {
        counts.quiet += 1;
        byGroup.push({ chat_id: chatId, status: "quiet", reason: "NOTIFY_DISABLED" });
        continue;
      }

      const appName = await getAppName(idapp);
      const report = buildReport({ appName, events, from, to });

      if (!report) {
        counts.quiet += 1;
        byGroup.push({ chat_id: chatId, status: "quiet" });
        continue;
      }

      let delivery = { sent: false, reason: "inline" };
      if (!respondInline) {
        delivery = await sendReport({ token, chatId, text: report });
        if (delivery.sent) counts.sent += 1;
        else counts.skipped += 1;
      }
      byGroup.push({
        chat_id: chatId,
        idapp,
        environment,
        status: respondInline ? "inline" : delivery.sent ? "sent" : "skipped",
        events: events.length,
        ...(respondInline ? { report_html: report, html: true } : {}),
      });
    }

    // Persistir el cursor una sola vez (también en inline: el peek avanza el cursor).
    if (maxTs) {
      await setAppVarValue(CURSOR_VAR, JSON.stringify({ last_ts: iso(new Date(maxTs)), last_id: maxId }));
    }

    if (respondInline) {
      const inline = byGroup[0];
      initial.data = {
        mode: "changes",
        status: inline?.report_html ? "inline" : "quiet",
        chat_id: inline?.chat_id,
        counts: { sent: 0, quiet: inline?.report_html ? 0 : 1, skipped: 0, linked: entries.length },
        ...(inline?.report_html ? { report_html: inline.report_html, html: true } : {}),
      };
      return initial;
    }

    initial.data = {
      mode: "changes",
      status: counts.sent ? "sent" : "quiet",
      counts,
      groups: byGroup,
      scanned_from: iso(new Date(from)),
      scanned_to: iso(new Date(to)),
      cursor: maxTs ? { last_ts: iso(new Date(maxTs)), last_id: maxId } : undefined,
    };
  } catch (error) {
    console.error("[fnAppGroupChanges]", error);
    initial.data = { error: error.message };
    initial.code = 500;
  }
  return initial;
}