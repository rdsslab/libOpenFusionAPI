/**
 * Novedades por-grupo para aplicaciones de OpenFusionAPI (digest de actividad
 * por logs). Handler FUNCTION del endpoint interno `POST /system/appgroup/scan`
 * de la app system. Se ejecuta por interval task (cada ~5 min) y bajo demanda
 * desde el bot con `respond_inline=true` (comando /activity del grupo).
 *
 * Los vínculos viven por-aplicación en `$_VAR_TELEGRAM_GROUPS` (ver
 * `./groupLinks.js`): un chat puede estar vinculado a varias apps y el digest
 * de un chat agrega la actividad de todas ellas. Los cursores de deduplicación
 * siguen en la app system:
 *
 * Config vía AppVars (env prd):
 *  - $_VAR_TELEGRAM_TOKEN       token del bot (placeholder = sin configurar)
 *  - $_VAR_GROUP_APP_CURSORS    { chat_id: "ISO" } cursor por grupo (escritura del scan)
 *
 * Endpoints internos adicionales:
 *  - POST /system/appgroup/links  (fnAppGroupLinks)  lee el agregado chat -> apps
 *  - POST /system/appgroup/link   (fnAppGroupLinkWrite) escribe/borra/ajusta vínculos
 */
import { getAppVarsByIdApp, upsertAppVar, ensureAppVarOnce } from "../../../../../db/appvars.js";
import { getLogs } from "../../../../../db/log.js";
import { Application } from "../../../../../db/models.js";
import { sendTelegramMessage } from "../user/sendTelegramMessage.js";
import {
  readAppGroupLinks,
  readGroupLinksByChat,
  writeAppGroupLink,
  removeAppGroupLink,
  setNotifyChanges,
} from "./groupLinks.js";

const SYSTEM_APP_ID = "cfcd2084-95d5-65ef-66e7-dff9f98764da";
const ENV = "prd";

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
  const statusLine = `● ${c["2xx"]} · ${c["3xx"]} · ${c["4xx"]} · ${c["5xx"]}`;
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
 * Handler principal del scan.
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

    // Vínculos por-aplicación agregados: chat -> [{ idapp, ... }].
    let byChat = await readGroupLinksByChat();
    if (chatIdFilter) {
      const filtered = new Map();
      if (byChat.has(chatIdFilter)) filtered.set(chatIdFilter, byChat.get(chatIdFilter));
      byChat = filtered;
      if (!byChat.size) {
        initial.data = { mode: "scan", status: "quiet", reason: "CHAT_NOT_LINKED" };
        return initial;
      }
    }

    const cursors = parseJsonVar(await getAppVarValue(CURSORS_VAR), {});
    const now = Date.now();

    const counts = { linked: byChat.size, sent: 0, quiet: 0, skipped: 0 };
    const byGroup = [];

    for (const [chatId, links] of byChat) {
      const cursorRaw = cursors[chatId];
      const cursorTs = cursorRaw ? Date.parse(cursorRaw) : NaN;
      const from = Number.isFinite(cursorTs) && cursorTs < now
        ? cursorTs
        : now - DEFAULT_WINDOW_MINUTES * 60 * 1000;

      // Digest por app y agregado por chat (un chat puede tener varias apps).
      const reports = [];
      const appsInChat = [];
      for (const link of links) {
        const idapp = link?.idapp;
        if (!idapp) {
          counts.skipped += 1;
          continue;
        }
        appsInChat.push(idapp);
        try {
          const report = await buildReport({ idapp, environment: link.environment || ENV, from, to: now });
          if (report) reports.push(report);
        } catch (error) {
          console.error(`[fnAppGroupScan] collect ${chatId} -> ${idapp}:`, error.message);
          counts.skipped += 1;
        }
      }

      // Avanzar el cursor aunque no se envíe nada: evita re-reportar la misma ventana.
      cursors[chatId] = iso(new Date(now));

      if (!reports.length) {
        counts.quiet += 1;
        byGroup.push({ chat_id: chatId, status: "quiet", apps: appsInChat });
        continue;
      }

      const combined = reports.join("\n\n");
      let delivery = { sent: false, reason: "inline" };
      if (!respondInline) {
        delivery = await sendReport({ token, chatId, text: combined });
        if (delivery.sent) counts.sent += 1;
        else counts.skipped += 1;
      }
      byGroup.push({
        chat_id: chatId,
        idapp: appsInChat[0],
        apps: appsInChat,
        status: respondInline ? "inline" : delivery.sent ? "sent" : "skipped",
        ...(respondInline ? { report_html: combined, html: true } : {}),
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
        counts: { sent: 0, quiet: inline?.report_html ? 0 : 1, skipped: 0, linked: byChat.size },
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

/**
 * Agregador de vínculos chat -> apps para el bot (y MCP). Solo lectura.
 * Respuesta: { links: [{ chat_id, idapp, environment, linked_by, linked_at, notify_changes? }],
 *              by_chat: { chat_id: [link, ...] } }.
 */
export async function fnAppGroupLinks(params) {
  const initial = { code: 200, data: undefined };
  try {
    const links = await readAppGroupLinks();
    const byChat = {};
    for (const link of links) {
      if (!byChat[link.chat_id]) byChat[link.chat_id] = [];
      byChat[link.chat_id].push(link);
    }
    initial.data = { links, by_chat: byChat };
  } catch (error) {
    console.error("[fnAppGroupLinks]", error);
    initial.data = { error: error.message };
    initial.code = 500;
  }
  return initial;
}

/**
 * Escritura de vínculos desde el bot (y MCP). Único punto que toca la AppVar
 * `$_VAR_TELEGRAM_GROUPS` de la app destino, vía capa DB (sin borrar caché).
 *
 * Body:
 *   { action: "link"|"unlink"|"set_notify", chat_id, idapp, linked_by?, environment?, notify_changes? }
 */
export async function fnAppGroupLinkWrite(params) {
  const initial = { code: 200, data: undefined };
  try {
    const body = params?.request?.body || {};
    const action = String(body.action || "").toLowerCase();
    const chatId = String(body.chat_id || "").trim();
    const idappRaw = String(body.idapp || "").trim();

    if (!chatId) {
      initial.data = { error: "chat_id is required" };
      initial.code = 400;
      return initial;
    }

    if (action === "link") {
      if (!idappRaw) {
        initial.data = { error: "idapp is required for action 'link'" };
        initial.code = 400;
        return initial;
      }
      const app = await Application.findByPk(idappRaw);
      if (!app) {
        initial.data = { error: "application not found", idapp: idappRaw };
        initial.code = 404;
        return initial;
      }
      // Cadena vacía/undefined => la capa DB decide (conserva el entorno previo o usa ENV).
      const envRaw = typeof body.environment === "string" ? body.environment.trim() : body.environment;
      await writeAppGroupLink({
        idapp: idappRaw,
        chat_id: chatId,
        linked_by: body.linked_by,
        environment: envRaw || undefined,
        notify_changes: body.notify_changes,
      });
      initial.data = { ok: true, action, chat_id: chatId, idapp: idappRaw };
      return initial;
    }

    if (action === "unlink") {
      if (!idappRaw) {
        initial.data = { error: "idapp is required for action 'unlink'" };
        initial.code = 400;
        return initial;
      }
      const removed = await removeAppGroupLink({ idapp: idappRaw, chat_id: chatId });
      initial.data = { ok: removed, action, chat_id: chatId, idapp: idappRaw };
      return initial;
    }

    if (action === "set_notify") {
      if (!idappRaw) {
        initial.data = { error: "idapp is required for action 'set_notify'" };
        initial.code = 400;
        return initial;
      }
      const updated = await setNotifyChanges({
        idapp: idappRaw,
        chat_id: chatId,
        notify_changes: body.notify_changes === true || body.notify_changes === "true",
      });
      initial.data = {
        ok: updated,
        action,
        chat_id: chatId,
        idapp: idappRaw,
        notify_changes: body.notify_changes === true || body.notify_changes === "true",
      };
      return initial;
    }

    initial.data = { error: `unknown action "${action}" (expected link|unlink|set_notify)` };
    initial.code = 400;
  } catch (error) {
    console.error("[fnAppGroupLinkWrite]", error);
    initial.data = { error: error.message };
    initial.code = 500;
  }
  return initial;
}