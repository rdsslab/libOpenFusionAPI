/**
 * Novedades por-grupo para aplicaciones de OpenFusionAPI (digest de actividad
 * por logs). Handler FUNCTION del endpoint interno `POST /system/appgroup/scan`
 * de la app system. Se ejecuta por interval task (cada ~5 min) y bajo demanda
 * desde el bot con `respond_inline=true` (comando /activity del grupo).
 *
 * Para cada grupo vinculado (chat_id -> idapp) consulta los logs de esa app
 * desde el cursor de `$_VAR_GROUP_APP_CURSORS` y publica el digest por Telegram.
 * Un grupo sin actividad nueva queda en silencio (estado "quiet").
 *
 * Config vía AppVars (env prd):
 *  - $_VAR_TELEGRAM_TOKEN       token del bot (placeholder = sin configurar)
 *  - $_VAR_GROUP_APP_MAP        { chat_id: { idapp, environment, linked_by, linked_at } }
 *  - $_VAR_GROUP_APP_CURSORS    { chat_id: "ISO" } cursor de deduplicación por grupo
 */
import { getAppVarsByIdApp, upsertAppVar, ensureAppVarOnce } from "../../../../../db/appvars.js";
import { getLogs } from "../../../../../db/log.js";
import { Application } from "../../../../../db/models.js";
import { sendTelegramMessage } from "../user/sendTelegramMessage.js";

const SYSTEM_APP_ID = "cfcd2084-95d5-65ef-66e7-dff9f98764da";
const ENV = "prd";

const MAP_VAR = "$_VAR_GROUP_APP_MAP";
const CURSORS_VAR = "$_VAR_GROUP_APP_CURSORS";
const DEFAULT_WINDOW_MINUTES = 15; // retroactivo si no hay cursor tras un reinicio

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
  return row.value;
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

/** Actividad de una app en la ventana [from, to]: totales por clase y top endpoints. */
async function collectActivity({ idapp, from, to }) {
  const rows = await getLogs({
    start_date: iso(new Date(from)),
    end_date: iso(new Date(to)),
    ...(idapp ? { idapp } : {}),
    lightweight: true,
    raw: true,
    limit: 2000,
  });

  const classes = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  const endpoints = new Map();
  const errors = [];
  let total = 0;

  for (const r of rows) {
    const code = Number(r.status_code) || 0;
    const cls = `${Math.floor(code / 100)}xx`;
    if (classes[cls] !== undefined) classes[cls] += 1;
    total += 1;
    const key = `${r.method || "?"} ${r.url || "?"}`;
    endpoints.set(key, (endpoints.get(key) || 0) + 1);
    if (code >= 500) {
      errors.push({
        time: r.timestamp,
        method: r.method || "?",
        url: r.url || "?",
        status: code,
        ms: Number(r.response_time) || 0,
      });
    }
  }

  return { total, classes, topEndpoints: [...endpoints.entries()].sort((a, b) => b[1] - a[1]), errors };
}

/** Arma el digest HTML de una app; devuelve null si no hay actividad en la ventana. */
async function buildReport({ idapp, from, to }) {
  const activity = await collectActivity({ idapp, from, to });
  if (!activity.total) return null;

  const name = await getAppName(idapp);
  const appLabel = name && name !== idapp ? `${name} [${idapp}]` : idapp;
  const c = activity.classes;
  const statusLine =
    `● ${c["2xx"]} · ${c["3xx"]} · ${c["4xx"]} · ${c["5xx"]}`;
  const failures = [];
  if (c["4xx"] > 0) failures.push(`4xx: ${c["4xx"]}`);
  if (c["5xx"] > 0) failures.push(`5xx: ${c["5xx"]}`);

  const lines = [
    `<b>🆕 OpenFusionAPI — activity digest</b>`,
    `📦 App: <b>${esc(appLabel)}</b>`,
    `📊 <b>${activity.total}</b> requests · [2xx · 3xx · 4xx · 5xx] ${statusLine}`,
  ];
  if (failures.length) lines.push(`⚠️ ${esc(failures.join(" / "))}`);

  if (activity.topEndpoints.length) {
    lines.push("<b>Top endpoints</b>");
    for (const [ep, count] of activity.topEndpoints.slice(0, 6)) {
      lines.push(`• <code>${esc(ep)}</code> × ${count}`);
    }
  }
  if (activity.errors.length) {
    lines.push("<b>Errors (5xx)</b>");
    for (const e of activity.errors.slice(0, 6)) {
      lines.push(`• ${fmtTime(e.time)} UTC · ${esc(e.method)} <code>${esc(e.url)}</code> → ${e.status} (${e.ms}ms)`);
    }
  }
  lines.push(`🕐 Window: ${fmtTime(from)} UTC → ${fmtTime(to)} UTC`);
  return lines.join("\n");
}

async function sendReport({ token, chatId, text }) {
  if (!token || token.includes("PLACEHOLDER")) return { sent: false, reason: "NO_TOKEN" };
  if (!chatId) return { sent: false, reason: "NO_CHAT_ID" };
  const res = await sendTelegramMessage({ token, chatId, text });
  if (!res.ok) {
    console.error("[appgroup scan] send failed:", res.error);
  }
  return { sent: res.ok, reason: res.ok ? null : res.error };
}

/**
 * Handler principal.
 * @param {object} params de ejecución de FUNCTION (request, user_data, server_data, ...).
 */
export async function fnAppGroupScan(params) {
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

    const token = await getAppVarValue("$_VAR_TELEGRAM_TOKEN");
    if (!token || token.includes("PLACEHOLDER")) {
      initial.data = { mode: "scan", status: "skipped", reason: "NO_TOKEN" };
      return initial;
    }

    const map = parseJsonVar(await getAppVarValue(MAP_VAR), {});
    const cursors = parseJsonVar(await getAppVarValue(CURSORS_VAR), {});
    const now = Date.now();

    let entries = Object.entries(map);
    if (chatIdFilter) {
      entries = entries.filter(([chatId]) => chatId === chatIdFilter);
      if (!entries.length) {
        initial.data = { mode: "scan", status: "quiet", reason: "CHAT_NOT_LINKED" };
        return initial;
      }
    }

    const counts = { linked: entries.length, sent: 0, quiet: 0, skipped: 0 };
    const byGroup = [];

    for (const [chatId, entry] of entries) {
      const idapp = entry?.idapp;
      const environment = String(entry?.environment || ENV);
      if (!idapp) {
        counts.skipped += 1;
        continue;
      }
      const cursorRaw = cursors[chatId];
      const cursorTs = cursorRaw ? Date.parse(cursorRaw) : NaN;
      const from = Number.isFinite(cursorTs) && cursorTs < now
        ? cursorTs
        : now - DEFAULT_WINDOW_MINUTES * 60 * 1000;

      let report;
      try {
        report = await buildReport({ idapp, environment, from, to: now });
      } catch (error) {
        console.error(`[fnAppGroupScan] collect ${chatId} -> ${idapp}:`, error.message);
        counts.skipped += 1;
        continue;
      }

      // Avanzar el cursor aunque no se envíe nada: evita re-reportar la misma ventana.
      cursors[chatId] = iso(new Date(now));

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
        status: respondInline ? "inline" : delivery.sent ? "sent" : "skipped",
        ...(respondInline ? { report_html: report, html: true } : {}),
      });
    }

    // Persistir cursores una sola vez (también en inline: el peek avanza el cursor).
    await setAppVarValue(CURSORS_VAR, JSON.stringify(cursors));

    if (respondInline) {
      const inline = byGroup[0];
      initial.data = {
        mode: "scan",
        status: inline?.report_html ? "inline" : "quiet",
        chat_id: inline?.chat_id,
        counts: { sent: 0, quiet: inline?.report_html ? 0 : 1, skipped: 0, linked: entries.length },
        ...(inline?.report_html ? { report_html: inline.report_html, html: true } : {}),
      };
      return initial;
    }

    initial.data = {
      mode: "scan",
      status: counts.sent ? "sent" : "quiet",
      counts,
      groups: byGroup,
      scanned_to: iso(new Date(now)),
    };
  } catch (error) {
    console.error("[fnAppGroupScan]", error);
    initial.data = { error: error.message };
    initial.code = 500;
  }
  return initial;
}