// Bot de Telegram para notificaciones de administración de OpenFusionAPI.
// NO se ejecuta aquí: este archivo es la fuente de control de versiones del
// script que se publica con `upsert_bot` (ofapi_bot.code).
//
// Restricciones del runtime (ver src/lib/server/bot-manager/worker.js):
//   - El worker envuelve el código: ya instancia `$BOT` (nunca `new grammy.Bot`).
//   - Nunca llamar `$BOT.start()` / `$BOT.stop()`.
//   - El script solo REGISTRA handlers; debe terminar en < 10 segundos.
//   - Long polling fijo: allowed_updates = ["message", "callback_query"].
//   - Llamadas internas: uFetchAutoEnv.auto("/api/system<resource>/auto").
//
// Comandos:
//   /help        - Lista de comandos
//   /subscribe   - Suscribe este chat (grupo) a las alertas de administración
//   /unsubscribe - Cancela la suscripción
//   /health      - Resumen de salud del sistema (bajo demanda)
//   /errors      - Errores 5xx recientes
//   /intrusions  - Intentos de intrusión recientes
//   /logs        - Resumen de los últimos requests registrados
//
// Las alertas proactivas (eventos cada ~5 min y digest cada hora) las publican
// los interval tasks del endpoint interno `POST /system/admin/alerts`; este bot
// solo responde on-demand y gestiona la suscripción del grupo.

const SYSTEM_APP_ID = "cfcd2084-95d5-65ef-66e7-dff9f98764da";
const GROUP_VAR = "$_VAR_ADMIN_GROUP_CHAT_ID";

const HELP_TEXT = [
  "I'm the OpenFusionAPI admin notification bot.",
  "",
  "Commands:",
  "/subscribe - Subscribe this chat to admin alerts",
  "/unsubscribe - Unsubscribe this chat",
  "/health - System health summary",
  "/errors - Recent 5xx server errors",
  "/intrusions - Recent intrusion attempts",
  "/logs - Latest request log summary",
  "",
  "Add me to a group, give me admin rights, then run /subscribe there.",
].join("\n");

const scanToken = (ttlSeconds = 60 * 5) =>
  ofapi.genToken(
    { admin: { username: "openfusionapi", ctrl: { as_admin: true } } },
    ttlSeconds
  );

const api = (path, method, { data, token } = {}) => {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return uFetchAutoEnv.auto(`/api/system${path}/auto`)[method]({
    ...(data !== undefined ? { data } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  });
};

const parseBody = async (res) => {
  try {
    const body = await res.json();
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body };
  } catch (error) {
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: null };
  }
};

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const isGroupAdmin = async (chat, userId) => {
  try {
    const member = await $BOT.api.getChatMember(chat.id, userId);
    return ["administrator", "creator"].includes(member?.status);
  } catch (error) {
    return false;
  }
};

// ── Comandos ────────────────────────────────────────────────────────────────
$BOT.command("start", async (ctx) => {
  await ctx.reply([
    "Hello, I'm the OpenFusionAPI admin notification bot.",
    "",
    HELP_TEXT,
  ].join("\n"));
});

$BOT.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT);
});

$BOT.command("subscribe", async (ctx) => {
  const chat = ctx.chat;
  if (!chat) return;

  if (chat.type === "group" || chat.type === "supergroup") {
    const allowed = await isGroupAdmin(chat, ctx.from.id);
    if (!allowed) {
      await ctx.reply("Only group administrators can subscribe this group to admin notifications.");
      return;
    }
  }

  try {
    const token = scanToken();
    const res = await api("/app/var", "post", {
      token,
      data: {
        idapp: SYSTEM_APP_ID,
        name: GROUP_VAR,
        environment: "prd",
        type: "string",
        value: String(chat.id),
      },
    });
    const { ok } = await parseBody(res);
    if (ok) {
      await ctx.reply("This chat is now subscribed to admin alerts. Notifications will arrive here periodically.");
    } else {
      await ctx.reply("Could not subscribe this chat. Make sure the bot has admin rights and try again.");
    }
  } catch (error) {
    ofapi.log({ message: `subscribe: ${error?.message}` });
    await ctx.reply("An unexpected error occurred. Try again.");
  }
});

$BOT.command("unsubscribe", async (ctx) => {
  try {
    const token = scanToken();
    const res = await api("/app/var", "post", {
      token,
      data: {
        idapp: SYSTEM_APP_ID,
        name: GROUP_VAR,
        environment: "prd",
        type: "string",
        value: "",
      },
    });
    const { ok } = await parseBody(res);
    if (ok) await ctx.reply("This chat is no longer subscribed to admin alerts.");
    else await ctx.reply("Could not unsubscribe. Try again.");
  } catch (error) {
    ofapi.log({ message: `unsubscribe: ${error?.message}` });
    await ctx.reply("An unexpected error occurred. Try again.");
  }
});

$BOT.command("health", async (ctx) => {
  try {
    const res = await api("/system/health/stats", "get", {
      token: scanToken(),
      data: { last_hours: 1 },
    });
    const { ok, status, body } = await parseBody(res);
    if (!ok) {
      await ctx.reply(`Health check failed (HTTP ${status}).`);
      return;
    }
    const d = body?.data ?? body;
    if (!d) {
      await ctx.reply("Health check returned no data.");
      return;
    }
    const logs = d.logs || {};
    const byStatus = Object.entries(logs.by_status_code || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([c, n]) => `${c}: ${n}`)
      .join(", ");
    const msg = [
      "🛡 <b>OpenFusionAPI — health</b>",
      `📊 Logs (${d.window_hours ?? 1}h): <b>${logs.total_in_window ?? 0}</b> total, <b>${logs.errors_in_window ?? 0}</b> errors`,
      byStatus ? `   ${esc(byStatus)}` : "",
      `🔌 Endpoints: <b>${d.endpoints?.total ?? 0}</b> (${d.endpoints?.enabled ?? 0} enabled, ${d.endpoints?.mcp_enabled ?? 0} MCP)`,
      `📦 Apps: <b>${d.apps?.total ?? 0}</b>`,
    ].filter(Boolean).join("\n");
    await ctx.reply(msg, { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `health: ${error?.message}` });
    await ctx.reply("Could not query the system status.");
  }
});

$BOT.command("errors", async (ctx) => {
  try {
    const res = await api("/system/log", "get", {
      token: scanToken(),
      data: { status_code: "5xx", last_hours: 6, limit: "10" },
    });
    const { ok, status, body } = await parseBody(res);
    if (!ok) {
      await ctx.reply(`Could not read logs (HTTP ${status}).`);
      return;
    }
    const rows = Array.isArray(body) ? body : body?.data;
    if (!rows || !rows.length) {
      await ctx.reply("No 5xx server errors in the last 6 hours. 👍");
      return;
    }
    const lines = rows.map((r) => {
      const time = (r.timestamp || "").replace("T", " ").slice(0, 19);
      return `• <code>${esc(time)}</code> ${esc(r.method || "?")} <code>${esc(r.url || "?")}</code> → ${r.status_code ?? "?"} (${r.response_time ?? 0}ms)`;
    });
    await ctx.reply([`<b>🔥 Server errors (5xx, last 6h)</b>`, ...lines].join("\n"), { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `errors: ${error?.message}` });
    await ctx.reply("Could not read the error logs.");
  }
});

$BOT.command("intrusions", async (ctx) => {
  try {
    const res = await api("/system/admin/alerts", "post", {
      token: scanToken(),
      data: { mode: "events", respond_inline: true },
    });
    const { ok, status, body } = await parseBody(res);
    if (!ok) {
      await ctx.reply(`Could not scan for intrusions (HTTP ${status}).`);
      return;
    }
    const d = body?.data ?? body;
    const quiet = !d || (!d.report_text && d.status === "quiet");
    if (quiet) {
      await ctx.reply("No intrusion attempts or incidents in the last minutes. 👍");
      return;
    }
    await ctx.reply(d.report_text || "No incidents detected.", { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `intrusions: ${error?.message}` });
    await ctx.reply("Could not scan for intrusions.");
  }
});

$BOT.command("logs", async (ctx) => {
  try {
    const res = await api("/system/log", "get", {
      token: scanToken(),
      data: { last_hours: 1, limit: "8" },
    });
    const { ok, status, body } = await parseBody(res);
    if (!ok) {
      await ctx.reply(`Could not read logs (HTTP ${status}).`);
      return;
    }
    const rows = Array.isArray(body) ? body : body?.data;
    if (!rows || !rows.length) {
      await ctx.reply("No requests logged in the last hour.");
      return;
    }
    const lines = rows.map((r) => {
      const time = (r.timestamp || "").replace("T", " ").slice(0, 19);
      const flag = r.status_code >= 400 ? " ⚠️" : "";
      return `• <code>${esc(time)}</code> ${esc(r.method || "?")} <code>${esc(r.url || "?")}</code> → ${r.status_code ?? "?"}${flag}`;
    });
    await ctx.reply([`<b>📋 Latest requests (1h)</b>`, ...lines].join("\n"), { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `logs: ${error?.message}` });
    await ctx.reply("Could not read the request logs.");
  }
});