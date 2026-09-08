/**
 * Alertas proactivas de administración para Telegram.
 * Handler FUNCTION del endpoint interno `POST /system/admin/alerts` de la app
 * system. Se ejecuta por interval tasks (eventos cada ~5 min, digest cada hora)
 * y consulta de `ofapi_log` + `ofapi_bot_log` directamente en el proceso.
 *
 * Modos:
 *  - events  (default): devuelve por Telegram las intrusiones, errores 5xx,
 *    saturación 4xx y bots en cuarentena/auto-deshabilitados ocurridos desde el
 *    último scan (cursor en `$_VAR_ADMIN_ALERT_CURSOR`). En silencio si no hay nada.
 *  - digest:  resumen de salud del sistema (reusa fnGetSystemHealthStats) hacia
 *    el grupo configurado.
 *
 * Config vía AppVars (env prd):
 *  - $_VAR_TELEGRAM_TOKEN      token del bot (placeholder = sin configurar)
 *  - $_VAR_ADMIN_GROUP_CHAT_ID chat_id del grupo de administración
 *  - $_VAR_ALERT_4XX_THRESHOLD umbral de 4xx por ventana para alertar (default 20)
 *  - $_VAR_ADMIN_ALERT_CURSOR  cursor de deduplicación (JSON ISO), escritura interna
 */
import { getLogs } from "../../../../../db/log.js";
import { getBotLogs } from "../../../../../db/bot_log.js";
import {
  getAppVarsByIdApp,
  upsertAppVar,
  ensureAppVarOnce,
} from "../../../../../db/appvars.js";
import { fnGetSystemHealthStats } from "../logs/index.js";
import { sendTelegramMessage } from "../user/sendTelegramMessage.js";

const SYSTEM_APP_ID = "cfcd2084-95d5-65ef-66e7-dff9f98764da";
const ENV = "prd";

const ATTACK_TYPES = new Set(["possible_attack", "posible_ataque"]);
const BOT_EVENTS = "bot_auto_disabled,bot_quarantined,bot_platform_outage_suspected";

const DEFAULT_WINDOW_MINUTES = 15; // retroactivo si no hay cursor tras un reinicio
const DEFAULT_4XX_THRESHOLD = 20;

/** Escapa texto para no romper el HTML de Telegram. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

/** Lee un JSON serializado en AppVar tolerando valores incompletos. */
function parseCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const ts = Date.parse(parsed?.scanned_up_to);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

async function collectIntrusions({ from, to }) {
  try {
    const rows = await getLogs({
      start_date: iso(new Date(from)),
      end_date: iso(new Date(to)),
      status_code: "401,429",
      log_level: 3,
      lightweight: false,
      limit: 300,
      raw: true,
    });
    return rows.filter((r) => ATTACK_TYPES.has(r?.message?.type));
  } catch (error) {
    console.error("[admin alerts] intrusions query:", error.message);
    return [];
  }
}

async function collectServerErrors({ from, to }) {
  try {
    const rows = await getLogs({
      start_date: iso(new Date(from)),
      end_date: iso(new Date(to)),
      status_code: "5xx",
      lightweight: true,
      limit: 300,
      raw: true,
    });
    const byUrl = new Map();
    for (const r of rows) {
      const key = `${r.method || "?"} ${r.url || "?"}`;
      byUrl.set(key, (byUrl.get(key) || 0) + 1);
    }
    return [...byUrl.entries()].sort((a, b) => b[1] - a[1]);
  } catch (error) {
    console.error("[admin alerts] 5xx query:", error.message);
    return [];
  }
}

async function countClientErrors({ from, to }) {
  try {
    const rows = await getLogs({
      start_date: iso(new Date(from)),
      end_date: iso(new Date(to)),
      status_code: "4xx",
      lightweight: true,
      limit: 5000,
      raw: true,
    });
    return rows.length;
  } catch (error) {
    console.error("[admin alerts] 4xx query:", error.message);
    return 0;
  }
}

async function collectBotIncidents({ from, to }) {
  try {
    return await getBotLogs({
      start_date: iso(new Date(from)),
      end_date: iso(new Date(to)),
      event: BOT_EVENTS,
      lightweight: false,
      limit: 200,
    });
  } catch (error) {
    console.error("[admin alerts] bot incidents query:", error.message);
    return [];
  }
}

const fmtTime = (d) => {
  try {
    return new Date(d).toLocaleString("en-GB", { timeZone: "UTC", hour12: false });
  } catch {
    return String(d ?? "");
  }
};

function formatIntrusions(intrusions) {
  if (!intrusions.length) return null;
  const lines = [];
  for (const r of intrusions.slice(0, 10)) {
    const m = r.message || {};
    const ip = esc(m.ip || r.client || "?");
    const username = m.username ? ` (${esc(m.username)})` : "";
    const reason = m.reason ? ` <i>${esc(m.reason)}</i>` : "";
    lines.push(`• ${fmtTime(r.timestamp)} UTC · <code>${ip}</code>${username}${reason}`);
  }
  return [
    `<b>🚨 Intrusion attempts</b> (${intrusions.length} in window)`,
    ...lines,
  ].join("\n");
}

function formatServerErrors(pairs) {
  if (!pairs.length) return null;
  const lines = pairs
    .slice(0, 8)
    .map(([key, count]) => `• <code>${esc(key)}</code> × ${count}`);
  return ["<b>🔥 Server errors (5xx)</b>", ...lines].join("\n");
}

function formatBotIncidents(incidents) {
  if (!incidents.length) return null;
  const lines = [];
  for (const r of incidents.slice(0, 8)) {
    const event = esc(r.event || "?");
    const idbot = esc(r.idbot || "?");
    const env = r.environment ? ` [${esc(r.environment)}]` : "";
    const error = r.error_type ? ` · <i>${esc(r.error_type)}</i>` : "";
    lines.push(`• <b>${event}</b>${env} <code>${idbot}</code>${error}`);
  }
  return ["<b>🤖 Bots at risk</b>", ...lines].join("\n");
}

/** Eventos ocurridos en la ventana y composición del mensaje. */
async function runEventsMode() {
  const endDate = Date.now();
  const cursor = parseCursor(await getAppVarValue("$_VAR_ADMIN_ALERT_CURSOR"));
  const fromDate = cursor && cursor < endDate
    ? cursor
    : endDate - DEFAULT_WINDOW_MINUTES * 60 * 1000;

  const [intrusions, serverErrors, clientCount, botIncidents] = await Promise.all([
    collectIntrusions({ from: fromDate, to: endDate }),
    collectServerErrors({ from: fromDate, to: endDate }),
    countClientErrors({ from: fromDate, to: endDate }),
    collectBotIncidents({ from: fromDate, to: endDate }),
  ]);

  const threshold = Math.max(
    1,
    Number(await getAppVarValue("$_VAR_ALERT_4XX_THRESHOLD")) || DEFAULT_4XX_THRESHOLD,
  );

  const sections = [];
  if (intrusions.length) sections.push(formatIntrusions(intrusions));
  if (serverErrors.length) sections.push(formatServerErrors(serverErrors));
  if (clientCount >= threshold) {
    sections.push(`<b>⚠️ Elevated client errors (4xx)</b>\n• ${clientCount} responses in window (threshold ${threshold})`);
  }
  if (botIncidents.length) sections.push(formatBotIncidents(botIncidents));

  // Avanzar el cursor aunque no se envíe nada: evita re-reportar la misma ventana.
  await setAppVarValue(
    "$_VAR_ADMIN_ALERT_CURSOR",
    JSON.stringify({ scanned_up_to: iso(new Date(endDate)) }),
  );

  const counts = {
    intrusions: intrusions.length,
    server_errors: serverErrors.length,
    by_url_5xx: serverErrors.length,
    client_errors_4xx: clientCount,
    bot_incidents: botIncidents.length,
  };

  if (!sections.length) {
    return { alerted: false, sent: false, counts, from: fromDate, to: endDate };
  }

  const title = "<b>🛡 OpenFusionAPI — admin alert</b>";
  return {
    alerted: true,
    counts,
    from: fromDate,
    to: endDate,
    message: [title, ...sections].join("\n\n"),
  };
}

/** Resumen periódico de salud del sistema. */
async function runDigestMode(ctx) {
  const windowHours = Math.max(
    1,
    Number(ctx?.window_hours) || Number(ctx?.last_hours) || 24,
  );
  const statsR = await fnGetSystemHealthStats({
    request: { query: { last_hours: windowHours } },
  });
  if (statsR.code !== 200) {
    return { alerted: false, sent: false, counts: {}, error: statsR.data?.error };
  }
  const s = statsR.data || {};
  const logs = s.logs || {};
  const byStatus = Object.entries(logs.by_status_code || {})
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => `${code}:${count}`)
    .join(" · ");

  const title = "<b>🛡 OpenFusionAPI — system digest</b>";
  const lines = [
    `📅 Window: last ${windowHours}h (${esc(s.timestamp || "")} UTC)`,
    `📦 Apps: <b>${s.apps?.total ?? "?"}</b>`,
    `🔌 Endpoints: <b>${s.endpoints?.total ?? "?"}</b> (${s.endpoints?.enabled ?? "?"} enabled, ${s.endpoints?.mcp_enabled ?? "?"} MCP)`,
    `📊 Logs: <b>${logs.total_in_window ?? "?"}</b> in window, <b>${logs.errors_in_window ?? "?"}</b> errors`,
    byStatus ? `   ${esc(byStatus)}` : "",
  ].filter(Boolean).join("\n");

  return { alerted: true, counts: { window_hours: windowHours }, message: [title, lines].join("\n\n") };
}

async function sendReport(report, token, chatId) {
  if (!chatId) return { sent: false, reason: "NO_CHAT_ID" };
  if (!token || token.includes("PLACEHOLDER")) return { sent: false, reason: "NO_TOKEN" };
  const res = await sendTelegramMessage({ token, chatId, text: report.message });
  if (!res.ok) {
    console.error("[admin alerts] send failed:", res.error);
  }
  return { sent: res.ok, reason: res.ok ? null : res.error };
}

/**
 * Handler principal.
 * @param {object} params de ejecución de FUNCTION (request, user_data, server_data, ...).
 */
export async function fnAdminAutoAlerts(params) {
  const request = params?.request || {};
  const body = request.body || {};
  const query = request.query || {};
  const mode = String(body.mode || query.mode || "events").trim();
  const respondInline =
    body.respond_inline === true ||
    body.respond_inline === "true" ||
    query.respond_inline === "true" ||
    query.respond_inline === true;

  const initial = { code: 200, data: undefined };
  try {
    const [token, chatId] = await Promise.all([
      getAppVarValue("$_VAR_TELEGRAM_TOKEN"),
      getAppVarValue("$_VAR_ADMIN_GROUP_CHAT_ID"),
    ]);

    const report =
      mode === "digest"
        ? await runDigestMode({ ...query, ...body })
        : await runEventsMode();

    if (!report.alerted) {
      initial.data = {
        mode,
        status: "quiet",
        scanned_from: report.from ? iso(new Date(report.from)) : undefined,
        scanned_to: report.to ? iso(new Date(report.to)) : undefined,
        counts: report.counts || {},
      };
      return initial;
    }

    const delivery = respondInline
      ? { sent: false, reason: "inline" }
      : await sendReport(report, token, chatId);
    initial.data = {
      mode,
      status: respondInline ? "inline" : delivery.sent ? "sent" : "skipped",
      reason: delivery.reason || null,
      counts: report.counts || {},
      scanned_from: report.from ? iso(new Date(report.from)) : undefined,
      scanned_to: report.to ? iso(new Date(report.to)) : undefined,
    };
    if (respondInline && report.message) {
      initial.data.report_text = report.message;
      initial.data.html = true;
    }
  } catch (error) {
    console.error("[fnAdminAutoAlerts]", error);
    initial.data = { error: error.message };
    initial.code = 500;
  }
  return initial;
}