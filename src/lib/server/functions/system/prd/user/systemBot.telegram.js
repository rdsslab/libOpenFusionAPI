// Bot de Telegram unificado de OpenFusionAPI. NO se ejecuta aquí: este archivo
// es la fuente de control de versiones del script que se publica con
// `upsert_bot` (ofapi_bot.code).
//
// Reemplaza a los antiguos "Recovery Password Bot" y "Admin Notifications Bot",
// que compartían el mismo token y entraban en conflicto por el long polling.
//
// Restricciones del runtime (ver src/lib/server/bot-manager/worker.js):
//   - El worker envuelve el código: ya instancia `$BOT` (nunca `new grammy.Bot`).
//   - Nunca llamar `$BOT.start()` / `$BOT.stop()`.
//   - El script solo REGISTRA handlers; debe terminar en < 10 segundos (sin await top-level).
//   - Long polling fijo: allowed_updates = ["message", "callback_query"].
//   - Llamadas internas: uFetchAutoEnv.auto("/api/system<resource>/auto").
//
// Funciones por tipo de chat:
//
//  Chat privado (recuperación de cuenta):
//    /start            - Mensaje de bienvenida
//    /help             - Ayuda
//    /link             - Vincular este chat a la cuenta (registra el id del usuario)
//    /forgot           - Solicitar un OTP de un solo uso para resetear la clave
//    /reset            - Canjear el OTP con la nueva clave (cierra el ciclo)
//    /changepassword   - Cambiar la contraseña
//    /cancel           - Cancelar el flujo en curso
//
//  Comandos de sistema (chat privado y grupos):
//    /whoami           - Datos de la cuenta vinculada al usuario de Telegram
//    /myapps           - Grupos vinculados por este usuario
//    /listapps         - Lista las aplicaciones del servidor
//    /uptime           - Tiempo de actividad del servidor
//    /systeminfo       - Node, host, OS, CPU y RAM del servidor
//    /audit            - Últimos eventos del log de auditoría (admin)
//    /alerts           - pause | resume | status de las alertas de administración
//
//  Grupo no vinculado:
//    /start, /help, /health
//    /subscribe   - (admin) suscribe el grupo a las alertas de administración
//    /unsubscribe - (admin) cancela la suscripción
//
//  Grupo vinculado a una o varias aplicaciones ($_VAR_TELEGRAM_GROUPS por app):
//    /linkapp [app [entorno]]  - (usuario validado + admin) vincula el grupo a una app.
//        Sin argumentos muestra un selector en 2 pasos: app y luego entorno (dev|qa|prd)
//        de sus endpoints habilitados. Si ya estaba vinculada en otro entorno, pide
//        confirmación antes de cambiar. Apps sin endpoints habilitados se muestran
//        con aviso y no son vinculables.
//    /unlinkapp [app]  - (usuario validado + admin) desvincula el grupo de una app.
//        Sin argumentos muestra la lista de apps vinculadas (con su entorno); con
//        argumento desvincula directo (el picker si hay varias).
//    /appinfo          - Muestra las apps vinculadas a este grupo
//    /status           - Estatus general de las apps vinculadas
//    /apistats         - Uso de endpoints de las apps vinculadas (últimos 7 días)
//    /traceslow        - Peticiones más lentas de las apps vinculadas (últimas 24h)
//    /logs [error|warn|info] - Logs recientes de las apps vinculadas (default: error/5xx)
//    /changes [on|off] [app] - Notificaciones de cambios de configuración (peek; toggle (admin))
//    /activity         - Novedades recientes de las apps vinculadas (bajo demanda)
//    /errors           - Errores 5xx recientes de las apps vinculadas
//    /tasks            - Tareas de intervalo de las apps vinculadas
//    /taskrun <idtask> - (admin) ejecuta ahora una tarea de intervalo
//    /health           - Salud general del sistema
//
// Vínculos: cada aplicación guarda su propia $_VAR_TELEGRAM_GROUPS =
// { chat_id: { environment, linked_by, linked_at, notify_changes? } } y el bot
// consulta/escribe vía los endpoints internos /system/appgroup/links (lectura
// agregada chat -> apps) y /system/appgroup/link (escritura). Un mismo grupo
// puede estar vinculado a varias apps; los cursores de deduplicación siguen en
// la app system ($_VAR_GROUP_APP_CURSORS, $_VAR_GROUP_APP_CHANGES_CURSOR).
//
// Config via AppVars (env prd) de la app system:
//   - $_VAR_TELEGRAM_TOKEN        token del bot (placeholder = sin configurar)
//   - $_VAR_GROUP_APP_CURSORS     { chat_id: "ISO" } cursor por grupo (escritura del scan)
//   - $_VAR_ADMIN_GROUP_CHAT_ID   grupo de administración para alertas admin
//   - $_VAR_ADMIN_ALERTS_MODE     "on" | "paused" (control de /alerts sobre fnAdminAutoAlerts)
//   - $_VAR_GROUP_APP_CHANGES_CURSOR  cursor global del notificador /appgroup/changes
//   - $_VAR_GROUP_APP_CHANGES_ENABLED "on" | "off" para el notificador /appgroup/changes
//
// Los flujos de recuperación SOLO operan en chat privado. En grupos el bot solo
// responde comandos de estatus/vínculo.

const SYSTEM_APP_ID = "cfcd2084-95d5-65ef-66e7-dff9f98764da";
const ENV = "prd";
const ADMIN_GROUP_VAR = "$_VAR_ADMIN_GROUP_CHAT_ID";

// ── Estados de conversación (sin sesiones persistentes) ──────────────────────
const states = new Map();
const STATE = {
  LINK_USERNAME: "link:username",
  LINK_PASSWORD: "link:password",
  FORGOT_USERNAME: "forgot:username",
  RESET_USERNAME: "reset:username",
  RESET_OTP: "reset:otp",
  RESET_NEWPASSWORD: "reset:newpassword",
  RESET_CONFIRM: "reset:confirm",
  CHANGE_USERNAME: "change:username",
  CHANGE_PASSWORD: "change:password",
  CHANGE_NEWPASSWORD: "change:newpassword",
  CHANGE_CONFIRM: "change:confirm",
  LINKAPP_APP_PICK: "linkapp:app_pick",
  LINKAPP_ENV_PICK: "linkapp:env_pick",
  LINKAPP_CONFIRM: "linkapp:confirm",
  UNLINKAPP_PICK: "unlinkapp:pick",
};

const setState = (chatId, s) => {
  if (s === undefined || s === null) states.delete(String(chatId));
  else if (typeof s === "string") states.set(String(chatId), { step: s });
  else states.set(String(chatId), { ...s });
};
const getState = (chatId) => states.get(String(chatId));

const PRIVATE_HELP = [
  "I'm the OpenFusionAPI assistant for account recovery.",
  "",
  "Private chat commands:",
  "/link - Link this chat to your account",
  "/forgot - Request a one-time code to reset your password",
  "/reset - Redeem the code with a new password",
  "/changepassword - Change your password",
  "/whoami - Your linked account info",
  "/myapps - Applications you linked",
  "/listapps - List the applications in this server",
  "/uptime - System uptime",
  "/systeminfo - Node, host, OS and CPU details",
  "/health - System status (CPU/RAM/last logs)",
  "/audit - Recent audit events (admin)",
  "/alerts - Pause or resume admin alerts",
  "/cancel - Abort the current operation",
].join("\n");

const GROUP_HELP = [
  "I'm the OpenFusionAPI assistant for application groups.",
  "",
  "Group commands:",
  "/linkapp [app [env]] - Link this group to an application and environment (validated users only; picker without arguments)",
  "/unlinkapp [app] - Unlink this group (picker shows the linked apps)",
  "/appinfo - Show the linked application",
  "/status - General status of the linked application",
  "/apistats - Endpoint usage of the linked app",
  "/traceslow - Slowest requests of the linked app",
  "/logs [error|warn|info] - Recent logs of the linked app",
  "/changes [on|off] - Configuration change notifications (peek; toggle as admin)",
  "/activity - Recent activity of the linked application",
  "/errors - Recent 5xx errors of the linked application",
  "/tasks - List interval tasks of the linked app",
  "/taskrun <idtask> - Run an interval task now (admin)",
  "/myapps - Your linked applications",
  "/listapps - List the applications in this server",
  "/whoami - Your linked account info",
  "/uptime - System uptime",
  "/systeminfo - Node, host, OS and CPU details",
  "/health - System status",
  "/audit - Recent audit events (admin)",
  "/alerts - Pause or resume admin alerts",
  "/subscribe - (admin) Receive admin alerts here",
  "/unsubscribe - (admin) Stop admin alerts",
].join("\n");

// ── Llamadas internas a los endpoints de la app system ───────────────────────
const api = (path, method, { data, token, basic } = {}) => {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (basic) headers["Authorization"] = `Basic ${basic}`;
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

const scanToken = (ttlSeconds = 60 * 5) =>
  ofapi.genToken(
    { admin: { username: "openfusionapi", ctrl: { as_admin: true } } },
    ttlSeconds
  );

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const isPrivateChat = (chat) => chat?.type === "private";
const isGroupChat = (chat) => chat?.type === "group" || chat?.type === "supergroup";

const isGroupAdmin = async (chat, userId) => {
  try {
    const member = await $BOT.api.getChatMember(chat.id, userId);
    return ["administrator", "creator"].includes(member?.status);
  } catch (error) {
    return false;
  }
};

// ── AppVars de la app system (lectura/escritura vía API) ─────────────────────
const getSystemAppVars = async () => {
  const res = await api("/app/variables/idapp", "get", {
    token: scanToken(),
    data: { idapp: SYSTEM_APP_ID },
  });
  const { ok, body } = await parseBody(res);
  if (!ok || !Array.isArray(body?.data || body)) return [];
  const list = Array.isArray(body) ? body : body.data;
  return list.map((r) => (r?.toJSON ? r.toJSON() : r));
};

const findVar = async (name) => {
  const vars = await getSystemAppVars();
  return vars.find((r) => r.name === name && String(r.environment || "") === ENV);
};

const getVarValue = async (name) => {
  const row = await findVar(name);
  if (!row || row.value === null || row.value === undefined) return undefined;
  return row.value;
};

const writeVarValue = async (name, value, type = "string") => {
  const existing = await findVar(name);
  const res = await api("/app/var", "post", {
    token: scanToken(),
    data: {
      idapp: SYSTEM_APP_ID,
      name,
      environment: ENV,
      type: existing?.type || type,
      ...(existing?.idvar ? { idvar: existing.idvar } : {}),
      value,
    },
  });
  const r = await parseBody(res);
  if (!r.ok) ofapi.log({ message: `writeVarValue ${name}: HTTP ${r.status}` });
  return r.ok;
};

const parseJsonVar = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
};

// ── Vínculos grupo↔apps (per-app vía endpoints internos) ─────────────────────
// Lectura agregada: { links: [{chat_id, idapp, environment, linked_by, linked_at, notify_changes?}],
//                     by_chat: { chat_id: [link, ...] } }
const readGroupLinksData = async () => {
  try {
    const res = await api("/appgroup/links", "post", { token: scanToken(), data: {} });
    const { ok, body } = await parseBody(res);
    if (!ok) return { links: [], by_chat: {} };
    const d = body?.data ?? body ?? {};
    return {
      links: Array.isArray(d.links) ? d.links : [],
      by_chat: (d.by_chat && typeof d.by_chat === "object") ? d.by_chat : {},
    };
  } catch (error) {
    ofapi.log({ message: `readGroupLinksData: ${error?.message}` });
    return { links: [], by_chat: {} };
  }
};

const readChatLinks = async (chatId) => {
  const data = await readGroupLinksData();
  return (data.by_chat[String(chatId)] || []).map((l) => ({ ...l, idapp: String(l.idapp) }));
};

const writeAppGroupLink = async (idapp, chatId, linkedBy, environment) => {
  const data = { action: "link", chat_id: String(chatId), idapp: String(idapp), linked_by: linkedBy };
  if (environment) data.environment = environment;
  const res = await api("/appgroup/link", "post", { token: scanToken(), data });
  const r = await parseBody(res);
  return !!r.ok;
};

const unlinkAppFromGroup = async (idapp, chatId) => {
  const res = await api("/appgroup/link", "post", {
    token: scanToken(),
    data: { action: "unlink", chat_id: String(chatId), idapp: String(idapp) },
  });
  const r = await parseBody(res);
  return !!r.ok;
};

const setGroupNotify = async (idapp, chatId, flag) => {
  const res = await api("/appgroup/link", "post", {
    token: scanToken(),
    data: { action: "set_notify", chat_id: String(chatId), idapp: String(idapp), notify_changes: !!flag },
  });
  const r = await parseBody(res);
  return !!r.ok;
};

// ── Catálogo de apps para resolver idapp → nombre ────────────────────────────
const getAppsIndex = async () => {
  try {
    const res = await api("/api/apps/catalog", "post", { token: scanToken(), data: {} });
    const { ok, body } = await parseBody(res);
    const list = Array.isArray(body) ? body : body?.data;
    if (!ok || !Array.isArray(list)) return new Map();
    const index = new Map();
    for (const app of list) {
      if (app?.idapp) index.set(String(app.idapp), app.app || app.name || app.idapp);
    }
    return index;
  } catch (error) {
    ofapi.log({ message: `getAppsIndex: ${error?.message}` });
    return new Map();
  }
};

const ENV_ORDER = ["dev", "qa", "prd"];
const sortEnvs = (envs) =>
  [...envs].sort((a, b) => {
    const ia = ENV_ORDER.indexOf(a);
    const ib = ENV_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || String(a).localeCompare(String(b));
  });

// Índice rico: idapp -> { name, environments } (entornos con endpoints habilitados).
// Usado por el selector de /linkapp y las confirmaciones de entorno.
const getAppsEnvIndex = async () => {
  try {
    const res = await api("/api/apps/catalog", "post", { token: scanToken(), data: {} });
    const { ok, body } = await parseBody(res);
    const list = Array.isArray(body) ? body : body?.data;
    if (!ok || !Array.isArray(list)) return new Map();
    const index = new Map();
    for (const app of list) {
      if (!app?.idapp) continue;
      const envs = Array.isArray(app.environments)
        ? app.environments.filter((e) => e && typeof e === "string")
        : [];
      index.set(String(app.idapp), {
        name: app.app || app.name || app.idapp,
        environments: sortEnvs(envs),
      });
    }
    return index;
  } catch (error) {
    ofapi.log({ message: `getAppsEnvIndex: ${error?.message}` });
    return new Map();
  }
};

// ── Validación server-side del usuario de Telegram ───────────────────────────
const validateUser = async (telegramUserId) => {
  try {
    const res = await api("/user/telegram/validate", "post", {
      token: scanToken(),
      data: { telegram_user_id: String(telegramUserId) },
    });
    const { ok, status, body } = await parseBody(res);
    if (!ok || !body?.valid) return { valid: false, status };
    return { valid: true, status, ...(body.data || body) };
  } catch (error) {
    ofapi.log({ message: `validateUser: ${error?.message}` });
    return { valid: false };
  }
};

// ── Helpers de login / recovery (reutilizan los handlers de /user) ───────────
const login = async (username, password) => {
  const basic = Buffer.from(`${username}:${password}`).toString("base64");
  const r = await api("/system/login", "post", { basic });
  if (r.status >= 200 && r.status < 300) return { ok: true, ...(await r.json()) };
  return { ok: false, status: r.status };
};

const linkTelegram = async (token, chatId) => {
  const r = await api("/user/linktelegram", "post", { token, data: { chat_id: String(chatId) } });
  return parseBody(r);
};

const forgotPassword = async (username) => {
  const r = await api("/user/forgotpassword", "post", { data: { username } });
  return parseBody(r);
};

const resetPasswordConfirm = async (username, otp, newPassword) => {
  const r = await api("/user/resetpassword/confirm", "post", {
    data: { username, otp, newPassword },
  });
  return parseBody(r);
};

const changePassword = async (token, username, oldPassword, newPassword) => {
  const r = await api("/user/changepassword", "post", {
    token,
    data: { username, oldPassword, newPassword },
  });
  return parseBody(r);
};

// ── Comandos compartidos ─────────────────────────────────────────────────────
$BOT.command("start", async (ctx) => {
  setState(ctx.chat.id, null);
  const header = isPrivateChat(ctx.chat)
    ? ["Hello, I'm the OpenFusionAPI assistant.", "", PRIVATE_HELP]
    : ["Hello, I'm the OpenFusionAPI assistant.", "", GROUP_HELP];
  const lines = [...header];
  try {
    const res = await api("/server/version", "get", { token: scanToken() });
    const { ok, body } = await parseBody(res);
    const d = body?.data ?? body;
    if (ok && d?.version) {
      lines.push("", `🤖 OpenFusionAPI runtime: <b>v${esc(d.version)}</b>`);
    }
  } catch (error) {
    ofapi.log({ message: `start: version: ${error?.message}` });
  }
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
});

$BOT.command("help", async (ctx) => {
  await ctx.reply(isPrivateChat(ctx.chat) ? PRIVATE_HELP : GROUP_HELP);
});

$BOT.command("cancel", async (ctx) => {
  setState(ctx.chat.id, null);
  await ctx.reply("Operation cancelled.");
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
    const sys = d.system || {};
    const byStatus = Object.entries(logs.by_status_code || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([c, n]) => `${c}: ${n}`)
      .join(", ");
    const cpuLine = sys.cpu_usage !== undefined && sys.cpu_usage !== null
      ? `🖥 CPU: <b>${sys.cpu_usage}%</b>`
      : "";
    const memLine = sys.memory_total_gb
      ? `🧠 RAM: <b>${sys.memory_used_gb} / ${sys.memory_total_gb} GB</b> (${sys.memory_used_pct}%)`
      : "";
    const msg = [
      "🛡 <b>OpenFusionAPI — health</b>",
      `📊 Logs (${d.window_hours ?? 1}h): <b>${logs.total_in_window ?? 0}</b> total, <b>${logs.errors_in_window ?? 0}</b> errors`,
      byStatus ? `   ${esc(byStatus)}` : "",
      `🔌 Endpoints: <b>${d.endpoints?.total ?? 0}</b> (${d.endpoints?.enabled ?? 0} enabled, ${d.endpoints?.mcp_enabled ?? 0} MCP)`,
      `📦 Apps: <b>${d.apps?.total ?? 0}</b>`,
      cpuLine,
      memLine,
    ].filter(Boolean).join("\n");
    await ctx.reply(msg, { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `health: ${error?.message}` });
    await ctx.reply("Could not query the system status.");
  }
});

// ── Información de sistema (información estática/dinámica) ───────────────────
const getSystemInfoStatic = async () => {
  try {
    const res = await api("/information/static", "get", { token: scanToken() });
    const { ok, body } = await parseBody(res);
    if (!ok) return null;
    return body?.data ?? body;
  } catch (error) {
    ofapi.log({ message: `getSystemInfoStatic: ${error?.message}` });
    return null;
  }
};

const getSystemInfoDynamic = async () => {
  try {
    const res = await api("/information/dynamic", "get", { token: scanToken() });
    const { ok, body } = await parseBody(res);
    if (!ok) return null;
    return body?.data ?? body;
  } catch (error) {
    ofapi.log({ message: `getSystemInfoDynamic: ${error?.message}` });
    return null;
  }
};

const requireValidated = async (ctx) => {
  const user = await validateUser(ctx.from.id);
  if (!user.valid) {
    await ctx.reply("You are not a validated OpenFusionAPI user. First run /link in a private chat with me to link your account.");
  }
  return user.valid ? user : null;
};

$BOT.command("uptime", async (ctx) => {
  try {
    const st = await getSystemInfoStatic();
    const lines = ["⏱ <b>OpenFusionAPI — uptime</b>"];
    if (st?.uptime?.formatted) {
      lines.push(`• Server: <b>${esc(st.uptime.formatted)}</b>`);
      if (st.uptime.startTime) {
        lines.push(`• Since: <code>${esc(String(st.uptime.startTime).replace("T", " ").slice(0, 19))} UTC</code>`);
      }
      lines.push(`• Server time: <code>${esc(new Date().toISOString().replace("T", " ").slice(0, 19))} UTC</code>`);
    }
    if (isGroupChat(ctx.chat)) {
      const entries = await getLinkedEntries(ctx.chat);
      if (entries.length) {
        const entry = entries.reduce((a, b) =>
          Date.parse(b.linked_at || 0) > Date.parse(a.linked_at || 0) ? b : a
        );
        if (entry?.linked_at) {
          const days = Math.max(0, Math.floor((Date.now() - Date.parse(entry.linked_at)) / 86400000));
          const hours = Math.max(0, Math.floor(((Date.now() - Date.parse(entry.linked_at)) % 86400000) / 3600000));
          lines.push(`• This group linked: <b>${days}d ${hours}h</b> ago (${entries.length} app${entries.length === 1 ? "" : "s"})`);
        }
      }
    }
    if (lines.length === 1) lines.push("No uptime data available.");
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `uptime: ${error?.message}` });
    await ctx.reply("Could not query the system uptime.");
  }
});

$BOT.command("systeminfo", async (ctx) => {
  try {
    const [st, dyn] = await Promise.all([getSystemInfoStatic(), getSystemInfoDynamic()]);
    const lines = ["🖥 <b>OpenFusionAPI — system info</b>"];
    if (st) {
      if (st.nodeVersion) lines.push(`• Node: <code>${esc(st.nodeVersion)}</code>`);
      if (st.hostname) {
        lines.push(`• Host: <code>${esc(st.hostname)}</code>${st.localIp && st.localIp !== "N/A" ? ` (<code>${esc(st.localIp)}</code>)` : ""}`);
      }
      if (st.platform) lines.push(`• OS: <b>${esc(st.platform)}</b> ${esc(st.architecture || "")}${st.osRelease ? ` (${esc(st.osRelease)})` : ""}`);
      if (st.cpuModel) lines.push(`• CPU: <b>${esc(st.cpuModel)}</b> × ${st.cpuCores ?? "?"}${st.cpuSpeed ? ` @ ${esc(st.cpuSpeed)}` : ""}`);
      if (st.uptime?.formatted) lines.push(`• Uptime: <b>${esc(st.uptime.formatted)}</b>`);
    }
    if (dyn) {
      if (dyn.cpuUsage !== undefined) lines.push(`• CPU load: <b>${dyn.cpuUsage}%</b>`);
      if (dyn.memoryUsage !== undefined) lines.push(`• RAM: <b>${dyn.usedMemory} / ${dyn.totalMemory} GB</b> (${dyn.memoryUsage}%)`);
    }
    if (lines.length === 1) lines.push("No system info available.");
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `systeminfo: ${error?.message}` });
    await ctx.reply("Could not query the system information.");
  }
});

$BOT.command("whoami", async (ctx) => {
  try {
    const user = await validateUser(ctx.from.id);
    if (!user.valid) {
      await ctx.reply("You are not a validated OpenFusionAPI user. First run /link in a private chat with me to link your account.");
      return;
    }
    await ctx.reply(
      [
        "👤 <b>Your account</b>",
        `• Telegram id: <code>${ctx.from.id}</code>`,
        `• Username: <b>${esc(user.username || "?")}</b>`,
        user.name ? `• Name: <b>${esc(user.name)}</b>` : "",
        `• iduser: <code>${esc(String(user.iduser ?? "?"))}</code>`,
        `• Role: ${user.admin === true ? "<b>Administrator</b>" : "user"}`,
      ].filter(Boolean).join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (error) {
    ofapi.log({ message: `whoami: ${error?.message}` });
    await ctx.reply("Could not resolve your account.");
  }
});

$BOT.command("listapps", async (ctx) => {
  try {
    const apps = await getAppsIndex();
    const entries = [...apps.entries()];
    if (!entries.length) {
      await ctx.reply("There are no applications in this server yet.");
      return;
    }
    const lines = entries.slice(0, 40).map(([idapp, name], i) => `  ${i + 1}. <b>${esc(name || "?")}</b> (<code>${esc(String(idapp).slice(0, 8))}</code>)`);
    await ctx.reply(
      [
        `📦 <b>Applications (${entries.length})</b>`,
        "",
        ...lines,
        entries.length > 40 ? `… and ${entries.length - 40} more` : "",
        "",
        "Use /linkapp in a group to link one.",
      ].filter(Boolean).join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (error) {
    ofapi.log({ message: `listapps: ${error?.message}` });
    await ctx.reply("Could not list the applications.");
  }
});

$BOT.command("audit", async (ctx) => {
  if (isGroupChat(ctx.chat) && !(await isGroupAdmin(ctx.chat, ctx.from.id))) {
    await ctx.reply("Only group administrators can read the audit log here.");
    return;
  }
  const user = await validateUser(ctx.from.id);
  if (!user.valid || user.admin !== true) {
    await ctx.reply("This command requires an administrator account.");
    return;
  }
  try {
    const res = await api("/system/audit/log", "get", {
      token: scanToken(),
      data: { limit: 10 },
    });
    const { ok, status, body } = await parseBody(res);
    if (!ok) {
      await ctx.reply(`Could not read the audit log (HTTP ${status}).`);
      return;
    }
    const d = body?.data ?? body;
    const rows = d?.rows || (Array.isArray(d) ? d : []);
    if (!rows.length) {
      await ctx.reply("No audit events found.");
      return;
    }
    const lines = ["🕵️ <b>Recent audit events</b>"];
    for (const r of rows.slice(0, 10)) {
      const time = String(r.timestamp || "").replace("T", " ").slice(0, 19);
      const badge = r.status === false ? "❌" : "✅";
      const detail = [
        `<code>${esc(time)}</code>`,
        `<b>${esc(r.action || "?")}</b>`,
        esc(r.entity_type || ""),
        r.actor_username ? `· ${esc(r.actor_username)}` : "",
      ].join(" ");
      lines.push(`• ${badge} ${detail.trim()}`);
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `audit: ${error?.message}` });
    await ctx.reply("Could not read the audit log.");
  }
});

const ADMIN_ALERTS_MODE_VAR = "$_VAR_ADMIN_ALERTS_MODE";

$BOT.command("alerts", async (ctx) => {
  const chat = ctx.chat;
  if (!chat) return;
  if (isGroupChat(chat)) {
    if (!(await isGroupAdmin(chat, ctx.from.id))) {
      await ctx.reply("Only group administrators can control admin alerts.");
      return;
    }
  } else if (!(await requireValidated(ctx))) {
    return;
  }
  const arg = String((ctx.message?.text || "").split(/\s+/)[1] || "").trim().toLowerCase();
  try {
    const current = await getVarValue(ADMIN_ALERTS_MODE_VAR);
    const paused = current === "paused";
    if (!arg || arg === "status") {
      await ctx.reply(
        `Admin alerts are currently <b>${paused ? "paused ⏸" : "running ▶️"}</b>.\nUse /alerts pause or /alerts resume.`,
        { parse_mode: "HTML" }
      );
      return;
    }
    if (arg === "pause") {
      const ok = await writeVarValue(ADMIN_ALERTS_MODE_VAR, "paused");
      await ctx.reply(ok ? "Admin alerts are now <b>paused</b>. The subscription stays active; use /alerts resume to enable them again." : "Could not pause admin alerts.");
      return;
    }
    if (arg === "resume") {
      const ok = await writeVarValue(ADMIN_ALERTS_MODE_VAR, "on");
      await ctx.reply(ok ? "Admin alerts are now <b>running</b> again." : "Could not resume admin alerts.");
      return;
    }
    await ctx.reply("Usage: /alerts pause | resume | status");
  } catch (error) {
    ofapi.log({ message: `alerts: ${error?.message}` });
    await ctx.reply("An unexpected error occurred. Try again.");
  }
});

// ── Recuperación de contraseña (solo chat privado) ───────────────────────────
$BOT.command("link", async (ctx) => {
  if (!isPrivateChat(ctx.chat)) {
    await ctx.reply("Run /link in a private chat with me.");
    return;
  }
  setState(ctx.chat.id, STATE.LINK_USERNAME);
  await ctx.reply("Let's link this chat to your account.\nType your username:");
});

$BOT.command("forgot", async (ctx) => {
  if (!isPrivateChat(ctx.chat)) {
    await ctx.reply("Run /forgot in a private chat with me.");
    return;
  }
  setState(ctx.chat.id, STATE.FORGOT_USERNAME);
  await ctx.reply("Type your username and I will send you a one-time code:");
});

$BOT.command("reset", async (ctx) => {
  if (!isPrivateChat(ctx.chat)) {
    await ctx.reply("Run /reset in a private chat with me.");
    return;
  }
  setState(ctx.chat.id, STATE.RESET_USERNAME);
  await ctx.reply("Password reset flow.\nType your username:");
});

$BOT.command("changepassword", async (ctx) => {
  if (!isPrivateChat(ctx.chat)) {
    await ctx.reply("Run /changepassword in a private chat with me.");
    return;
  }
  setState(ctx.chat.id, STATE.CHANGE_USERNAME);
  await ctx.reply("Let's change your password.\nType your username:");
});

// ── Vinculación de grupos a aplicaciones ─────────────────────────────────────
const MAX_PICKER = 20;

const searchApps = (entries, query) => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return entries;
  const exact = entries.find(([id]) => String(id).toLowerCase() === q);
  if (exact) return [exact];
  return entries.filter(
    ([id, name]) =>
      String(name || "").toLowerCase().includes(q) ||
      String(id).toLowerCase().includes(q)
  );
};

// Muestra/edit el mensaje de flujo: en un callback edita el mensaje actual de
// Telegram (sin dejar menús huérfanos); en un comando por texto responde normal.
const sendFlowMessage = async (ctx, text, extra = {}) => {
  const opts = { parse_mode: "HTML", ...extra };
  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, opts);
    } catch (_error) {
      /* el mensaje no era editable: cae al reply */
    }
  }
  return await ctx.reply(text, opts);
};

const performLink = async (chatId, idapp, linkedBy, environment) =>
  writeAppGroupLink(idapp, chatId, linkedBy, environment);

const finishLink = async (ctx, idapp, environment, name, linkedBy) => {
  const ok = await performLink(String(ctx.chat.id), String(idapp), linkedBy, environment);
  setState(ctx.chat.id, null);
  const label = `${esc(name || "?")} · <code>${esc(environment)}</code>`;
  await sendFlowMessage(
    ctx,
    ok
      ? `✅ This group is now linked to <b>${label}</b>.\nUse /status, /apistats or /activity to query the application.`
      : "Could not save the link. Check the bot token and permissions, then try again."
  );
  return ok;
};

// Vincula (app, entorno) Respeta el modelo de 1 entorno por app por grupo:
//   - misma (app, env) ya vinculada -> solo informa.
//   - app vinculada en OTRO entorno -> pide confirmación antes de cambiar.
//   - sin vínculo previo -> vincula directo.
const linkAppWithEnv = async (ctx, idapp, environment, name, linkedBy) => {
  try {
    const links = await readChatLinks(String(ctx.chat.id));
    const existing = links.find((l) => l.idapp === String(idapp));
    const env = String(environment);
    if (existing && existing.environment && existing.environment !== env) {
      setState(String(ctx.chat.id), {
        step: STATE.LINKAPP_CONFIRM,
        idapp: String(idapp),
        environment: env,
        name: name || String(idapp),
        linkedBy,
        fromId: ctx.from.id,
      });
      await sendFlowMessage(
        ctx,
        `⚠️ <b>${esc(name || idapp)}</b> is already linked to this group in environment <b>${esc(existing.environment)}</b>.\n\nSwitch it to <b>${esc(env)}</b>?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: `✅ Switch to ${env}`, callback_data: `linkapp-switch:${idapp}:${env}` }],
              [{ text: "Cancel", callback_data: "linkapp-cancel" }],
            ],
          },
        }
      );
      return;
    }
    if (existing && existing.environment === env) {
      setState(String(ctx.chat.id), null);
      await sendFlowMessage(ctx, `🔗 <b>${esc(name || idapp)}</b> is already linked in <b>${esc(env)}</b>.`);
      return;
    }
    await finishLink(ctx, String(idapp), env, name, linkedBy);
  } catch (error) {
    ofapi.log({ message: `linkapp env: ${error?.message}` });
    setState(String(ctx.chat.id), null);
    await sendFlowMessage(ctx, "An unexpected error occurred. Try again.");
  }
};

// ── Paso 1: elegir aplicación (botones + reply numérico/nombre) ──────────────
const sendAppPicker = async (ctx, index, linkedBy, fromId, links) => {
  const rows = [];
  for (const [idapp, info] of index.entries()) {
    const link = (links || []).find((l) => l.idapp === String(idapp));
    rows.push({
      idapp: String(idapp),
      name: info.name,
      environments: info.environments,
      linkEnv: link?.environment || undefined,
    });
  }
  const entries = rows.slice(0, MAX_PICKER);
  setState(ctx.chat.id, { step: STATE.LINKAPP_APP_PICK, entries, linkedBy, fromId });
  const lines = entries.map((r, i) => {
    const badges = [
      r.linkEnv ? `🔗(${esc(r.linkEnv)})` : "",
      r.environments.length === 0 ? "⚠️" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `  ${i + 1}. <b>${esc(r.name || "?")}</b>${badges ? ` ${badges}` : ""} (<code>${esc(r.idapp.slice(0, 8))}</code>)`;
  });
  const text = [
    "📋 <b>Step 1 — choose the application:</b>",
    "⚠️ no enabled endpoints · 🔗 already linked",
    "",
    ...lines,
    "",
    "Press a button, or reply with the number or the name of the application.",
    "Apps with a single environment link in one tap; the rest ask for the environment next.",
    "Send /cancel to abort.",
  ].join("\n");
  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: entries.map((r) => [
        {
          text: `${r.name}${r.linkEnv ? ` (${r.linkEnv}) 🔗` : ""}${r.environments.length === 0 ? " ⚠️" : ""}`.slice(0, 100),
          callback_data: `appsel:${r.idapp}`,
        },
      ]),
    },
  });
};

const handleAppPick = async (ctx) => {
  const s = getState(ctx.chat.id);
  if (!s || s.step !== STATE.LINKAPP_APP_PICK) return false;
  if (s.fromId && s.fromId !== ctx.from.id) return false;
  const text = String(ctx.message.text || "").trim();
  if (text.startsWith("/")) return false;
  try {
    if (!(await isGroupAdmin(ctx.chat, ctx.from.id))) {
      setState(ctx.chat.id, null);
      await ctx.reply("Only group administrators can link this group.");
      return true;
    }
    const user = await validateUser(ctx.from.id);
    if (!user.valid) {
      setState(ctx.chat.id, null);
      await ctx.reply("You are not a validated OpenFusionAPI user.");
      return true;
    }
    const linkedBy = user.username || String(ctx.from.id);
    const entries = Array.isArray(s.entries) ? s.entries : [];
    let picked = null;
    if (/^\d+$/.test(text)) {
      const idx = parseInt(text, 10) - 1;
      if (idx >= 0 && idx < entries.length) picked = entries[idx];
      else {
        await ctx.reply(`Enter a number between 1 and ${entries.length}, or type the application name.`);
        return true;
      }
    } else {
      const q = String(text).trim().toLowerCase();
      const idx = entries.findIndex(
        (r) => String(r.name || "").toLowerCase().includes(q) || String(r.idapp).toLowerCase().includes(q)
      );
      if (idx === -1) {
        await ctx.reply(`No application matches "<b>${esc(text)}</b>". Reply with a number from the list or a name, or send /cancel.`, { parse_mode: "HTML" });
        return true;
      }
      picked = entries[idx];
    }
    if (!picked) return true;
    if (picked.environments.length === 0) {
      setState(ctx.chat.id, null);
      await ctx.reply(
        `⚠️ <b>${esc(picked.name)}</b> has no enabled endpoints in any environment, so it cannot be linked.`,
        { parse_mode: "HTML" }
      );
      return true;
    }
    if (picked.environments.length === 1) {
      setState(ctx.chat.id, null);
      await linkAppWithEnv(ctx, picked.idapp, picked.environments[0], picked.name, linkedBy);
      return true;
    }
    await sendEnvPicker(ctx, picked, linkedBy, ctx.from.id);
    return true;
  } catch (error) {
    ofapi.log({ message: `linkapp step1: ${error?.message}` });
    setState(ctx.chat.id, null);
    await ctx.reply("An unexpected error occurred. Try again.");
    return true;
  }
};

// ── Paso 2: elegir entorno (botones + reply dev|qa|prd) ──────────────────────
const sendEnvPicker = async (ctx, appInfo, linkedBy, fromId) => {
  setState(ctx.chat.id, {
    step: STATE.LINKAPP_ENV_PICK,
    idapp: String(appInfo.idapp),
    name: appInfo.name,
    environments: appInfo.environments,
    linkedBy,
    fromId,
  });
  const lines = appInfo.environments.map(
    (env, i) => `  ${i + 1}. <code>${esc(env)}</code>${appInfo.linkEnv === env ? " (current) 🔗" : ""}`
  );
  const text = [
    `📍 <b>Step 2 — environment for ${esc(appInfo.name)}:</b>`,
    "",
    ...lines,
    appInfo.linkEnv ? `\nCurrently linked: <b>${esc(appInfo.linkEnv)}</b>. Choose another environment to switch.` : "",
    "",
    "Press a button, or reply with the environment name (dev, qa, prd).",
    "Send /cancel to abort.",
  ].join("\n");
  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: appInfo.environments.map((env) => [
        { text: env === appInfo.linkEnv ? `${env} 🔗 (current)` : env, callback_data: `linkapp:${appInfo.idapp}:${env}` },
      ]),
    },
  });
};

const handleEnvPick = async (ctx) => {
  const s = getState(ctx.chat.id);
  if (!s || s.step !== STATE.LINKAPP_ENV_PICK) return false;
  if (s.fromId && s.fromId !== ctx.from.id) return false;
  const text = String(ctx.message.text || "").trim().toLowerCase();
  if (text.startsWith("/")) return false;
  try {
    if (!(await isGroupAdmin(ctx.chat, ctx.from.id))) {
      setState(ctx.chat.id, null);
      await ctx.reply("Only group administrators can link this group.");
      return true;
    }
    const user = await validateUser(ctx.from.id);
    if (!user.valid) {
      setState(ctx.chat.id, null);
      await ctx.reply("You are not a validated OpenFusionAPI user.");
      return true;
    }
    const envs = Array.isArray(s.environments) ? s.environments : [];
    let env = null;
    if (/^\d+$/.test(text)) {
      const idx = parseInt(text, 10) - 1;
      if (idx >= 0 && idx < envs.length) env = envs[idx];
    } else {
      env = envs.find((e) => String(e).toLowerCase() === text);
    }
    if (!env) {
      await ctx.reply(`Enter a valid environment (${envs.join(", ")}), or send /cancel.`);
      return true;
    }
    setState(ctx.chat.id, null);
    await linkAppWithEnv(ctx, s.idapp, env, s.name, user.username || String(ctx.from.id));
    return true;
  } catch (error) {
    ofapi.log({ message: `linkapp step2: ${error?.message}` });
    setState(ctx.chat.id, null);
    await ctx.reply("An unexpected error occurred. Try again.");
    return true;
  }
};

const sendUnlinkPicker = async (ctx, links, apps) => {
  setState(ctx.chat.id, {
    step: STATE.UNLINKAPP_PICK,
    entries: links.map((l) => ({ idapp: l.idapp, environment: l.environment })),
    fromId: ctx.from.id,
  });
  const lines = links.map(
    (l, i) => `  ${i + 1}. <b>${esc(apps.get(String(l.idapp)) || l.idapp)}</b> — <code>${esc(l.environment || ENV)}</code> (<code>${esc(String(l.idapp).slice(0, 8))}</code>)`
  );
  const text = [
    "🔗 <b>This group is linked to several applications. Pick which one to unlink:</b>",
    "",
    ...lines,
    "",
    "Press a button, or reply with the number of the application.",
    "Send /cancel to abort.",
  ].join("\n");
  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: links.map((l) => [
        {
          text: `${apps.get(String(l.idapp)) || l.idapp} — ${l.environment || ENV}`.slice(0, 100),
          callback_data: `unlinkapp:${l.idapp}`,
        },
      ]),
    },
  });
};

const handleUnlinkPick = async (ctx) => {
  const s = getState(ctx.chat.id);
  if (!s || s.step !== STATE.UNLINKAPP_PICK) return;
  if (s.fromId && s.fromId !== ctx.from.id) return;
  const entries = Array.isArray(s.entries) ? s.entries : [];
  const text = String(ctx.message.text || "").trim();
  if (text.startsWith("/")) return;
  try {
    if (!(await isGroupAdmin(ctx.chat, ctx.from.id))) {
      setState(ctx.chat.id, null);
      await ctx.reply("Only group administrators can unlink this group.");
      return;
    }
    const idx = parseInt(text, 10) - 1;
    if (!/^\d+$/.test(text) || idx < 0 || idx >= entries.length) {
      setState(ctx.chat.id, null);
      await ctx.reply("Send /unlinkapp again with a valid number.");
      return;
    }
    setState(ctx.chat.id, null);
    const target = entries[idx];
    const ok = await unlinkAppFromGroup(target.idapp, String(ctx.chat.id));
    await ctx.reply(ok
      ? "✅ This group is no longer linked to that application."
      : "Could not unlink the group. Try again.");
  } catch (error) {
    ofapi.log({ message: `unlinkapp pick: ${error?.message}` });
    setState(ctx.chat.id, null);
    await ctx.reply("An unexpected error occurred. Try again.");
  }
};

$BOT.command("linkapp", async (ctx) => {
  const chat = ctx.chat;
  if (!chat || !isGroupChat(chat)) {
    await ctx.reply("This command only works in a group where I have admin rights.");
    return;
  }
  if (!(await isGroupAdmin(chat, ctx.from.id))) {
    await ctx.reply("Only group administrators can link this group to an application.");
    return;
  }
  const user = await validateUser(ctx.from.id);
  if (!user.valid) {
    await ctx.reply("You are not a validated OpenFusionAPI user. First run /link in a private chat with me to link your account.");
    return;
  }
  const tokens = String(ctx.message?.text || "").split(/\s+/).slice(1).filter(Boolean);
  const linkedBy = user.username || String(ctx.from.id);
  setState(ctx.chat.id, null);
  try {
    const apps = await getAppsIndex();
    const index = await getAppsEnvIndex();
    if (!apps.size) {
      await ctx.reply("There are no applications in this server yet.");
      return;
    }
    // Soporta la sintaxis opcional: /linkapp <app> <entorno>
    let appQuery = tokens.join(" ").trim().toLowerCase();
    let envArg = undefined;
    if (tokens.length >= 2) {
      const last = tokens[tokens.length - 1].toLowerCase();
      if (last === "dev" || last === "qa" || last === "prd") {
        envArg = last;
        appQuery = tokens.slice(0, -1).join(" ").trim().toLowerCase();
      }
    }
    if (!appQuery) {
      const links = await readChatLinks(chat.id);
      await sendAppPicker(ctx, index, linkedBy, ctx.from.id, links);
      return;
    }
    const matches = searchApps([...apps.entries()], appQuery);
    if (matches.length === 0) {
      await ctx.reply(`No application matches "<b>${esc(appQuery)}</b>". Use /linkapp to pick from the list.`, { parse_mode: "HTML" });
      return;
    }
    if (matches.length > 1) {
      const links = await readChatLinks(chat.id);
      await sendAppPicker(ctx, index, linkedBy, ctx.from.id, links);
      return;
    }
    const [idapp, name] = matches[0];
    const info = index.get(String(idapp)) || { name, environments: [] };
    if (envArg) {
      if (!info.environments.includes(envArg)) {
        const available = info.environments.length
          ? info.environments.join(", ")
          : "none";
        await ctx.reply(
          `⚠️ <b>${esc(name)}</b> has no enabled endpoints in <b>${esc(envArg)}</b>.\nAvailable environments: ${esc(available)}`,
          { parse_mode: "HTML" }
        );
        return;
      }
      await linkAppWithEnv(ctx, String(idapp), envArg, name, linkedBy);
      return;
    }
    if (info.environments.length === 0) {
      await ctx.reply(
        `⚠️ <b>${esc(name)}</b> has no enabled endpoints in any environment, so it cannot be linked.`,
        { parse_mode: "HTML" }
      );
      return;
    }
    if (info.environments.length === 1) {
      await linkAppWithEnv(ctx, String(idapp), info.environments[0], name, linkedBy);
      return;
    }
    const links = await readChatLinks(chat.id);
    const link = links.find((l) => l.idapp === String(idapp));
    await sendEnvPicker(
      ctx,
      { idapp: String(idapp), name, environments: info.environments, linkEnv: link?.environment },
      linkedBy,
      ctx.from.id
    );
  } catch (error) {
    ofapi.log({ message: `linkapp: ${error?.message}` });
    await ctx.reply("An unexpected error occurred. Try again.");
  }
});

// ── Paso 1 (callback): elegir aplicación ─────────────────────────────────────
$BOT.callbackQuery(/^appsel:/, async (ctx) => {
  const data = String(ctx.callbackQuery?.data || "");
  const idapp = data.slice("appsel:".length);
  const chat = ctx.chat;
  if (!chat || !isGroupChat(chat)) return;
  try {
    if (!(await isGroupAdmin(chat, ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "Only group administrators can link this group." });
      return;
    }
    const user = await validateUser(ctx.from.id);
    if (!user.valid) {
      await ctx.answerCallbackQuery({ text: "You are not a validated OpenFusionAPI user." });
      return;
    }
    const index = await getAppsEnvIndex();
    const entry = index.get(String(idapp));
    if (!entry) {
      await ctx.answerCallbackQuery({ text: "That application no longer exists in this server." });
      return;
    }
    const linkedBy = user.username || String(ctx.from.id);
    if (entry.environments.length === 0) {
      await ctx.answerCallbackQuery({ text: `${entry.name} has no enabled endpoints in any environment.` });
      return;
    }
    const links = await readChatLinks(chat.id);
    const link = links.find((l) => l.idapp === String(idapp));
    if (entry.environments.length === 1) {
      await ctx.answerCallbackQuery({ text: `Linking ${entry.name}…` });
      await linkAppWithEnv(ctx, String(idapp), entry.environments[0], entry.name, linkedBy);
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `📍 <b>Step 2 — environment for ${esc(entry.name)}:</b>\n\n${entry.environments
        .map((env, i) => `  ${i + 1}. <code>${esc(env)}</code>${link?.environment === env ? " (current) 🔗" : ""}`)
        .join("\n")}${link?.environment ? `\n\nCurrently linked: <b>${esc(link.environment)}</b>. Choose another environment to switch.` : ""}\n\nPress a button to link.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: entry.environments.map((env) => [
            {
              text: env === link?.environment ? `${env} 🔗 (current)` : env,
              callback_data: `linkapp:${idapp}:${env}`,
            },
          ]),
        },
      }
    );
  } catch (error) {
    ofapi.log({ message: `appsel callback: ${error?.message}` });
    await ctx.answerCallbackQuery({ text: "An unexpected error occurred." });
  }
});

// ── Paso 2 (callback): vincular (app, entorno) ───────────────────────────────
$BOT.callbackQuery(/^linkapp:/, async (ctx) => {
  const data = String(ctx.callbackQuery?.data || "");
  const rest = data.slice("linkapp:".length);
  const sep = rest.indexOf(":");
  const idapp = sep === -1 ? rest : rest.slice(0, sep);
  const environment = sep === -1 ? undefined : rest.slice(sep + 1);
  const chat = ctx.chat;
  if (!chat || !isGroupChat(chat)) return;
  try {
    if (!(await isGroupAdmin(chat, ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "Only group administrators can link this group." });
      return;
    }
    const user = await validateUser(ctx.from.id);
    if (!user.valid) {
      await ctx.answerCallbackQuery({ text: "You are not a validated OpenFusionAPI user." });
      return;
    }
    const index = await getAppsEnvIndex();
    const entry = index.get(String(idapp));
    if (!entry) {
      await ctx.answerCallbackQuery({ text: "That application no longer exists in this server." });
      return;
    }
    let env = environment;
    if (!env) {
      // Callback legacy (linkapp:<idapp> sin entorno): resuelve si hay 1 solo entorno.
      if (entry.environments.length === 1) env = entry.environments[0];
      else {
        await ctx.answerCallbackQuery({ text: "Pick the environment again — run /linkapp." });
        return;
      }
    }
    env = String(env);
    if (!entry.environments.includes(env)) {
      await ctx.answerCallbackQuery({ text: `Invalid environment for ${entry.name}.` });
      return;
    }
    await ctx.answerCallbackQuery({ text: `Linking ${entry.name}…`, show_alert: false });
    await linkAppWithEnv(ctx, String(idapp), env, entry.name, user.username || String(ctx.from.id));
  } catch (error) {
    ofapi.log({ message: `linkapp callback: ${error?.message}` });
    await ctx.answerCallbackQuery({ text: "An unexpected error occurred." });
  }
});

// ── Confirmación de cambio de entorno ────────────────────────────────────────
$BOT.callbackQuery(/^linkapp-switch:/, async (ctx) => {
  const data = String(ctx.callbackQuery?.data || "");
  const rest = data.slice("linkapp-switch:".length);
  const sep = rest.indexOf(":");
  const idapp = rest.slice(0, sep);
  const environment = rest.slice(sep + 1);
  const chat = ctx.chat;
  if (!chat || !isGroupChat(chat)) return;
  try {
    if (!(await isGroupAdmin(chat, ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "Only group administrators can link this group." });
      return;
    }
    const user = await validateUser(ctx.from.id);
    if (!user.valid) {
      await ctx.answerCallbackQuery({ text: "You are not a validated OpenFusionAPI user." });
      return;
    }
    const index = await getAppsEnvIndex();
    const entry = index.get(String(idapp));
    if (!entry || !entry.environments.includes(String(environment))) {
      await ctx.answerCallbackQuery({ text: "Invalid environment. Run /linkapp again." });
      return;
    }
    const name = entry.name;
    await ctx.answerCallbackQuery();
    await finishLink(ctx, String(idapp), String(environment), name, user.username || String(ctx.from.id));
  } catch (error) {
    ofapi.log({ message: `linkapp-switch callback: ${error?.message}` });
    await ctx.answerCallbackQuery({ text: "An unexpected error occurred." });
  }
});

$BOT.callbackQuery("linkapp-cancel", async (ctx) => {
  const chat = ctx.chat;
  setState(chat?.id, null);
  try {
    await ctx.answerCallbackQuery({ text: "Cancelled." });
    if (chat) await ctx.editMessageText("❌ Cancelled.");
  } catch (_) {
    /* ignore */
  }
});

$BOT.callbackQuery(/^unlinkapp:/, async (ctx) => {
  const data = String(ctx.callbackQuery?.data || "");
  const idapp = data.slice("unlinkapp:".length);
  const chat = ctx.chat;
  if (!chat || !isGroupChat(chat)) return;
  try {
    if (!(await isGroupAdmin(chat, ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "Only group administrators can unlink this group." });
      return;
    }
    const links = await readChatLinks(chat.id);
    const target = links.find((l) => l.idapp === String(idapp));
    if (!target) {
      await ctx.answerCallbackQuery({ text: "That application is not linked to this group." });
      return;
    }
    const apps = await getAppsIndex();
    const name = apps.get(String(idapp)) || idapp;
    const ok = await unlinkAppFromGroup(String(idapp), String(chat.id));
    setState(chat.id, null);
    await ctx.answerCallbackQuery();
    if (ok) {
      await ctx.editMessageText(
        `This group is no longer linked to <b>${esc(name)}</b>.`,
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.editMessageText("Could not unlink the group. Try again.");
    }
  } catch (error) {
    ofapi.log({ message: `unlinkapp callback: ${error?.message}` });
    await ctx.answerCallbackQuery({ text: "An unexpected error occurred." });
  }
});

$BOT.command("unlinkapp", async (ctx) => {
  const chat = ctx.chat;
  if (!isGroupChat(chat)) {
    await ctx.reply("This command only works in a group where I have admin rights.");
    return;
  }
  if (!(await isGroupAdmin(chat, ctx.from.id))) {
    await ctx.reply("Only group administrators can unlink this group.");
    return;
  }
  const user = await validateUser(ctx.from.id);
  if (!user.valid) {
    await ctx.reply("You are not a validated OpenFusionAPI user.");
    return;
  }
  const query = String((ctx.message?.text || "").split(/\s+/)[1] || "").trim().toLowerCase();
  try {
    const links = await readChatLinks(chat.id);
    if (!links.length) {
      await ctx.reply("This group is not linked to any application.");
      return;
    }
    const apps = await getAppsIndex();
    let target = null;
    if (query) {
      const matches = searchApps([...apps.entries()], query);
      if (matches.length === 1) {
        const id = String(matches[0][0]);
        target = links.find((l) => l.idapp === id) || null;
      }
    }
    if (!target && links.length === 1) target = links[0];
    if (!target) {
      await sendUnlinkPicker(ctx, links, apps);
      return;
    }
    const ok = await unlinkAppFromGroup(target.idapp, String(chat.id));
    const name = apps.get(String(target.idapp)) || target.idapp;
    await ctx.reply(ok
      ? `This group is no longer linked to <b>${esc(name)}</b>.`
      : "Could not unlink the group. Try again.",
      { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `unlinkapp: ${error?.message}` });
    await ctx.reply("An unexpected error occurred. Try again.");
  }
});

$BOT.command("appinfo", async (ctx) => {
  const chat = ctx.chat;
  if (!isGroupChat(chat)) {
    await ctx.reply("This command only works in a group.");
    return;
  }
  const entries = await getLinkedEntries(chat);
  if (!entries.length) {
    await ctx.reply("This group is not linked to any application. An administrator can run /linkapp to pick one.");
    return;
  }
  const apps = await getAppsIndex();
  const lines = [
    entries.length === 1
      ? `<b>🔗 Linked application</b>`
      : `<b>🔗 Linked applications (${entries.length})</b>`,
  ];
  for (const entry of entries) {
    const name = apps.get(String(entry.idapp)) || entry.idapp;
    lines.push(
      `• <b>${esc(name)}</b> — <code>${esc(entry.idapp)}</code>`,
      `  Environment: ${esc(entry.environment || ENV)} · Linked by: ${esc(entry.linked_by || "?")} · ${esc(String(entry.linked_at || "?").replace("T", " ").slice(0, 19))} UTC` +
        (entry.notify_changes === false ? "\n  🔕 change notifications disabled" : "")
    );
  }
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
});

// ── Estatus bajo demanda de las apps vinculadas ──────────────────────────────
const getLinkedEntries = async (chat) => readChatLinks(chat?.id);

const queryAppSummary = async (idapp, lastDays = 1, environment) => {
  const res = await api("/log/app/summary", "get", {
    token: scanToken(),
    data: { idapp, environment: environment || ENV, last_days: lastDays },
  });
  const { ok, body } = await parseBody(res);
  if (!ok) return { ok: false, status: res.status, rows: [] };
  const rows = Array.isArray(body) ? body : body?.data;
  return { ok: true, rows: Array.isArray(rows) ? rows : [] };
};

$BOT.command("status", async (ctx) => {
  const chat = ctx.chat;
  if (!isGroupChat(chat)) {
    await ctx.reply("This command only works in a linked group.");
    return;
  }
  const entries = await getLinkedEntries(chat);
  if (!entries.length) {
    await ctx.reply("This group is not linked to an application. Run /linkapp <idapp>.");
    return;
  }
  const apps = await getAppsIndex();
  const parts = [];
  for (const entry of entries) {
    try {
      const { ok, rows } = await queryAppSummary(entry.idapp, 1, entry.environment);
      if (!ok) {
        parts.push(`⚠️ <b>${esc(apps.get(String(entry.idapp)) || entry.idapp)}</b>: could not read the activity.`);
        continue;
      }
      const classes = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
      const activeEndpoints = new Set();
      let total = 0;
      for (const row of rows) {
        const code = Number(row.status_code) || 0;
        const cls = `${Math.floor(code / 100)}xx`;
        if (classes[cls] !== undefined) classes[cls] += Number(row.recordCount) || 0;
        if (row.idendpoint) activeEndpoints.add(row.idendpoint);
        total += Number(row.recordCount) || 0;
      }
      const failures = ["4xx", "5xx"].filter((c) => classes[c] > 0)
        .map((c) => `${c}: ${classes[c]}`).join(", ");
      const lines = [
        `📊 <b>${esc(apps.get(String(entry.idapp)) || entry.idapp)}</b> · <code>${esc(entry.environment || ENV)}</code> — status (last 24h)`,
        `• Endpoints with activity: <b>${activeEndpoints.size}</b>`,
        `• Requests: <b>${total}</b>` +
          (classes["2xx"] ? ` · 2xx: ${classes["2xx"]}` : "") +
          (classes["3xx"] ? ` · 3xx: ${classes["3xx"]}` : "") +
          (classes["4xx"] ? ` · 4xx: ${classes["4xx"]}` : "") +
          (classes["5xx"] ? ` · 5xx: ${classes["5xx"]}` : ""),
        failures ? `⚠️ ${esc(failures)}` : "",
      ].filter(Boolean);
      parts.push(lines.join("\n"));
    } catch (error) {
      ofapi.log({ message: `status: ${error?.message}` });
      parts.push(`⚠️ <b>${esc(apps.get(String(entry.idapp)) || entry.idapp)}</b>: could not query the status.`);
    }
  }
  await ctx.reply(parts.join("\n\n"), { parse_mode: "HTML" });
});

$BOT.command("errors", async (ctx) => {
  const chat = ctx.chat;
  if (!isGroupChat(chat)) {
    await ctx.reply("This command only works in a linked group.");
    return;
  }
  const entries = await getLinkedEntries(chat);
  if (!entries.length) {
    await ctx.reply("This group is not linked to an application. Run /linkapp <idapp>.");
    return;
  }
  const apps = await getAppsIndex();
  const parts = [];
  for (const entry of entries) {
    try {
      const res = await api("/system/log", "get", {
        token: scanToken(),
        data: { idapp: entry.idapp, environment: entry.environment || ENV, status_code: "5xx", last_hours: 6, limit: 10 },
      });
      const { ok, status, body } = await parseBody(res);
      if (!ok) {
        parts.push(`⚠️ <b>${esc(apps.get(String(entry.idapp)) || entry.idapp)}</b>: could not read logs (HTTP ${status}).`);
        continue;
      }
      const rows = Array.isArray(body) ? body : body?.data;
      const name = apps.get(String(entry.idapp)) || entry.idapp;
      if (!rows || !rows.length) {
        parts.push(`✅ <b>${esc(name)}</b>: no 5xx errors in the last 6h. 👍`);
        continue;
      }
      const lines = rows.map((r) => {
        const time = (r.timestamp || "").replace("T", " ").slice(0, 19);
        return `• <code>${esc(time)}</code> ${esc(r.method || "?")} <code>${esc(r.url || "?")}</code> → ${r.status_code ?? "?"} (${r.response_time ?? 0}ms)`;
      });
      parts.push([`🔥 <b>${esc(name)} — server errors (5xx, last 6h)</b>`, ...lines].join("\n"));
    } catch (error) {
      ofapi.log({ message: `errors: ${error?.message}` });
      parts.push(`⚠️ <b>${esc(apps.get(String(entry.idapp)) || entry.idapp)}</b>: could not read the error logs.`);
    }
  }
  await ctx.reply(parts.join("\n\n"), { parse_mode: "HTML" });
});

$BOT.command("activity", async (ctx) => {
  const chat = ctx.chat;
  if (!isGroupChat(chat)) {
    await ctx.reply("This command only works in a linked group.");
    return;
  }
  const entries = await getLinkedEntries(chat);
  if (!entries.length) {
    await ctx.reply("This group is not linked to an application. Run /linkapp <idapp>.");
    return;
  }
  try {
    const res = await api("/appgroup/scan", "post", {
      token: scanToken(),
      data: { respond_inline: true, chat_id: String(chat.id) },
    });
    const { ok, status, body } = await parseBody(res);
    if (!ok) {
      await ctx.reply(`Could not scan the application activity (HTTP ${status}).`);
      return;
    }
    const d = body?.data ?? body;
    const quiet = !d || (!d.report_html && d.status === "quiet");
    if (quiet) {
      await ctx.reply("No new activity for these applications since the last scan. 👍");
      return;
    }
    await ctx.reply(d.report_html || "No new activity detected.", { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `activity: ${error?.message}` });
    await ctx.reply("Could not scan the application activity.");
  }
});

// ── Comandos de las apps vinculadas: apistats / traceslow / logs / tasks ─────
const linkedEntries = async (ctx) => {
  if (!isGroupChat(ctx.chat)) {
    await ctx.reply("This command only works in a linked group.");
    return [];
  }
  const entries = await getLinkedEntries(ctx.chat);
  if (!entries.length) {
    await ctx.reply("This group is not linked to any application. An administrator can run /linkapp to pick one.");
    return [];
  }
  return entries;
};

const fmtTime = (value) => String(value || "").replace("T", " ").slice(0, 19);

$BOT.command("myapps", async (ctx) => {
  try {
    const user = await validateUser(ctx.from.id);
    if (!user.valid) {
      await ctx.reply("You are not a validated OpenFusionAPI user. First run /link in a private chat with me to link your account.");
      return;
    }
    const who = user.username || String(ctx.from.id);
    const data = await readGroupLinksData();
    const mine = data.links.filter((l) => String(l.linked_by || "") === String(who));
    if (!mine.length) {
      await ctx.reply(
        "You haven't linked any group to an application yet. Go to a group you administer and run /linkapp there."
      );
      return;
    }
    const apps = await getAppsIndex();
    const lines = ["🔗 <b>Groups you linked</b>"];
    for (const link of mine.slice(0, 20)) {
      const name = apps.get(String(link.idapp)) || link.idapp;
      lines.push(`• <b>${esc(name)}</b> — chat <code>${esc(link.chat_id)}</code>${link.linked_at ? ` · ${esc(fmtTime(link.linked_at))}` : ""}`);
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `myapps: ${error?.message}` });
    await ctx.reply("Could not list your linked applications.");
  }
});

$BOT.command("apistats", async (ctx) => {
  const entries = await linkedEntries(ctx);
  if (!entries.length) return;
  const apps = await getAppsIndex();
  const parts = [];
  for (const entry of entries) {
    const name = apps.get(String(entry.idapp)) || entry.idapp;
    try {
      const res = await api("/system/log/app/endpoints/usage", "get", {
        token: scanToken(),
        data: { idapp: entry.idapp, environment: entry.environment || ENV, last_days: 7, top: 5 },
      });
      const { ok, status, body } = await parseBody(res);
      if (!ok) {
        parts.push(`⚠️ <b>${esc(name)}</b>: could not read the usage stats (HTTP ${status}).`);
        continue;
      }
      const d = body?.data ?? body;
      const lines = [
        `📈 <b>${esc(name)} — endpoint usage</b> (${(d.window?.last_days ?? 7)}d)`,
        `• Requests: <b>${d.totals?.total_requests_in_window ?? 0}</b> · endpoints: <b>${d.totals?.total_endpoints ?? 0}</b>`,
      ];
      const most = (d.most_used || []).slice(0, 5);
      if (most.length) {
        lines.push("", "<b>Most used</b>");
        for (const e of most) {
          lines.push(`  <code>${esc(e.method || "?")}</code> ${esc(e.resource || "?")} → <b>${e.requestCount ?? 0}</b>`);
        }
      }
      parts.push(lines.join("\n"));
    } catch (error) {
      ofapi.log({ message: `apistats: ${error?.message}` });
      parts.push(`⚠️ <b>${esc(name)}</b>: could not read the usage stats.`);
    }
  }
  await ctx.reply(parts.join("\n\n"), { parse_mode: "HTML" });
});

$BOT.command("traceslow", async (ctx) => {
  const entries = await linkedEntries(ctx);
  if (!entries.length) return;
  const apps = await getAppsIndex();
  const parts = [];
  for (const entry of entries) {
    const name = apps.get(String(entry.idapp)) || entry.idapp;
    try {
      const res = await api("/system/log", "get", {
        token: scanToken(),
        data: {
          idapp: entry.idapp,
          environment: entry.environment || ENV,
          last_hours: 24,
          order: "response_time",
          orderDirection: "DESC",
          limit: 10,
        },
      });
      const { ok, status, body } = await parseBody(res);
      if (!ok) {
        parts.push(`⚠️ <b>${esc(name)}</b>: could not read the logs (HTTP ${status}).`);
        continue;
      }
      const rows = Array.isArray(body) ? body : body?.data;
      if (!rows || !rows.length) {
        parts.push(`✅ <b>${esc(name)}</b>: no requests in the last 24h. 👍`);
        continue;
      }
      const lines = [`🐢 <b>${esc(name)} — slowest requests (last 24h)</b>`];
      for (const r of rows.slice(0, 10)) {
        lines.push(`• <code>${esc(fmtTime(r.timestamp))}</code> ${esc(r.method || "?")} <code>${esc(r.url || "?")}</code> → <b>${r.response_time ?? 0}ms</b>`);
      }
      parts.push(lines.join("\n"));
    } catch (error) {
      ofapi.log({ message: `traceslow: ${error?.message}` });
      parts.push(`⚠️ <b>${esc(name)}</b>: could not read the slow request trace.`);
    }
  }
  await ctx.reply(parts.join("\n\n"), { parse_mode: "HTML" });
});

$BOT.command("logs", async (ctx) => {
  const entries = await linkedEntries(ctx);
  if (!entries.length) return;
  const arg = String((ctx.message?.text || "").split(/\s+/)[1] || "").trim().toLowerCase();
  const statusMap = { error: "5xx", warn: "4xx", warning: "4xx", info: "2xx" };
  const statusCode = statusMap[arg] || "5xx";
  const apps = await getAppsIndex();
  const parts = [];
  for (const entry of entries) {
    const name = apps.get(String(entry.idapp)) || entry.idapp;
    try {
      const res = await api("/system/log", "get", {
        token: scanToken(),
        data: {
          idapp: entry.idapp,
          environment: entry.environment || ENV,
          status_code: statusCode,
          last_hours: 24,
          limit: 10,
        },
      });
      const { ok, status, body } = await parseBody(res);
      if (!ok) {
        parts.push(`⚠️ <b>${esc(name)}</b>: could not read the logs (HTTP ${status}).`);
        continue;
      }
      const rows = Array.isArray(body) ? body : body?.data;
      const label = arg || "error";
      if (!rows || !rows.length) {
        parts.push(`✅ <b>${esc(name)}</b>: no <b>${esc(label)}</b> logs in the last 24h. 👍`);
        continue;
      }
      const lines = [`📜 <b>${esc(name)} — ${esc(label)} logs (last 24h)</b>`];
      for (const r of rows.slice(0, 10)) {
        lines.push(`• <code>${esc(fmtTime(r.timestamp))}</code> ${esc(r.method || "?")} <code>${esc(r.url || "?")}</code> → HTTP <b>${r.status_code ?? r.status ?? "?"}</b> (${r.response_time ?? 0}ms)`);
      }
      parts.push(lines.join("\n"));
    } catch (error) {
      ofapi.log({ message: `logs: ${error?.message}` });
      parts.push(`⚠️ <b>${esc(name)}</b>: could not read the logs.`);
    }
  }
  await ctx.reply(parts.join("\n\n"), { parse_mode: "HTML" });
});

$BOT.command("tasks", async (ctx) => {
  const entries = await linkedEntries(ctx);
  if (!entries.length) return;
  const apps = await getAppsIndex();
  const parts = [];
  for (const entry of entries) {
    const name = apps.get(String(entry.idapp)) || entry.idapp;
    try {
      const res = await api("/interval_tasks/byidapp", "get", {
        token: scanToken(),
        data: { idapp: entry.idapp },
      });
      const { ok, status, body } = await parseBody(res);
      if (!ok) {
        parts.push(`⚠️ <b>${esc(name)}</b>: could not read the interval tasks (HTTP ${status}).`);
        continue;
      }
      const rows = Array.isArray(body) ? body : body?.data;
      if (!rows || !rows.length) {
        parts.push(`✅ <b>${esc(name)}</b>: no interval tasks.`);
        continue;
      }
      const lines = [`🗓 <b>${esc(name)} — interval tasks</b>`];
      for (const t of rows.slice(0, 15)) {
        const badge = t.task_enabled === false ? "🔴" : "🟢";
        const schedule = t.schedule_mode === "cron"
          ? `\`${esc(t.cron || "?")}\``
          : `${t.interval ? `${t.interval}s` : ""}`;
        const next = t.next_run ? ` · next ${esc(fmtTime(t.next_run))}` : "";
        lines.push(`${badge} <code>${esc(String(t.idtask).slice(0, 8))}</code> <b>${esc(t.resource || "?")}</b> (${schedule})${next}`);
        if (t.note) lines.push(`   <i>${esc(String(t.note).slice(0, 80))}</i>`);
      }
      lines.push("", "Run one with /taskrun &lt;idtask&gt; (copy the full id below first).", "");
      for (const t of rows.slice(0, 15)) {
        lines.push(`<code>${esc(t.idtask)}</code>`);
      }
      parts.push(lines.join("\n"));
    } catch (error) {
      ofapi.log({ message: `tasks: ${error?.message}` });
      parts.push(`⚠️ <b>${esc(name)}</b>: could not read the interval tasks.`);
    }
  }
  await ctx.reply(parts.join("\n\n"), { parse_mode: "HTML" });
});

$BOT.command("taskrun", async (ctx) => {
  const entries = await linkedEntries(ctx);
  if (!entries.length) return;
  if (!(await isGroupAdmin(ctx.chat, ctx.from.id))) {
    await ctx.reply("Only group administrators can trigger interval tasks.");
    return;
  }
  const user = await validateUser(ctx.from.id);
  if (!user.valid) {
    await ctx.reply("You are not a validated OpenFusionAPI user. First run /link in a private chat with me to link your account.");
    return;
  }
  const idtask = String((ctx.message?.text || "").split(/\s+/)[1] || "").trim();
  if (!idtask) {
    await ctx.reply("Usage: /taskrun <idtask>\nSend /tasks to list the available tasks of the linked apps.");
    return;
  }
  const parts = [];
  for (const entry of entries) {
    try {
      const res = await api("/interval_tasks/run_now", "post", {
        token: scanToken(),
        data: { idtask },
      });
      const { ok, status, body } = await parseBody(res);
      if (!ok) {
        parts.push(`⚠️ <code>${esc(idtask)}</code>: could not trigger (HTTP ${status}).`);
        continue;
      }
      const d = body?.data ?? body;
      const msg = d?.message
        ? `✅ Task <code>${esc(idtask)}</code> triggered — ${esc(d.message)}`
        : `✅ Task <code>${esc(idtask)}</code> triggered — it will run on the next scheduler cycle.`;
      parts.push(msg);
    } catch (error) {
      ofapi.log({ message: `taskrun: ${error?.message}` });
      parts.push(`⚠️ <code>${esc(idtask)}</code>: could not trigger the task.`);
    }
  }
  await ctx.reply(parts.join("\n"), { parse_mode: "HTML" });
});

$BOT.command("changes", async (ctx) => {
  const entries = await linkedEntries(ctx);
  if (!entries.length) return;
  const arg = String((ctx.message?.text || "").split(/\s+/)[1] || "").trim().toLowerCase();
  if (arg === "on" || arg === "off") {
    if (!(await isGroupAdmin(ctx.chat, ctx.from.id))) {
      await ctx.reply("Only group administrators can change the notification flag.");
      return;
    }
    const user = await validateUser(ctx.from.id);
    if (!user.valid) {
      await ctx.reply("You are not a validated OpenFusionAPI user. First run /link in a private chat with me to link your account.");
      return;
    }
    const flag = arg === "on";
    const appArg = String((ctx.message?.text || "").split(/\s+/)[2] || "").trim().toLowerCase();
    try {
      let targets = entries;
      if (appArg) {
        const apps = await getAppsIndex();
        const matches = searchApps([...apps.entries()], appArg);
        if (!matches.length) {
          await ctx.reply(`No application matches "<b>${esc(appArg)}</b>". Use /appinfo to list the linked apps.`, { parse_mode: "HTML" });
          return;
        }
        if (matches.length > 1) {
          await ctx.reply("More than one application matches. Use the full idapp of the application.");
          return;
        }
        const id = String(matches[0][0]);
        targets = entries.filter((e) => e.idapp === id);
        if (!targets.length) {
          await ctx.reply("This group is not linked to that application.");
          return;
        }
      }
      let changed = 0;
      let failed = 0;
      for (const t of targets) {
        const ok = await setGroupNotify(t.idapp, String(ctx.chat.id), flag);
        ok ? (changed += 1) : (failed += 1);
      }
      const label = targets.length === 1
        ? "this application"
        : `${changed} application${changed === 1 ? "" : "s"}`;
      await ctx.reply(failed
        ? `Configuration change notifications: ${changed} updated, ${failed} failed.`
        : `Configuration change notifications are now <b>${flag ? "enabled" : "disabled"}</b> for ${label}.`,
        { parse_mode: "HTML" });
    } catch (error) {
      ofapi.log({ message: `changes toggle: ${error?.message}` });
      await ctx.reply("An unexpected error occurred. Try again.");
    }
    return;
  }
  try {
    const res = await api("/appgroup/changes", "post", {
      token: scanToken(),
      data: { respond_inline: true, chat_id: String(ctx.chat.id) },
    });
    const { ok, status, body } = await parseBody(res);
    if (!ok) {
      await ctx.reply(`Could not scan the configuration changes (HTTP ${status}).`);
      return;
    }
    const d = body?.data ?? body;
    const quiet = !d || (!d.report_html && d.status === "quiet");
    if (quiet) {
      await ctx.reply("No configuration changes since the last scan. 👍");
      return;
    }
    await ctx.reply(d.report_html || "No configuration changes detected.", { parse_mode: "HTML" });
  } catch (error) {
    ofapi.log({ message: `changes: ${error?.message}` });
    await ctx.reply("Could not scan the configuration changes.");
  }
});

// ── Suscripción a alertas de administración (grupo de administración) ────────
$BOT.command("subscribe", async (ctx) => {
  const chat = ctx.chat;
  if (!chat) return;
  if (isGroupChat(chat)) {
    if (!(await isGroupAdmin(chat, ctx.from.id))) {
      await ctx.reply("Only group administrators can subscribe this group to admin alerts.");
      return;
    }
  } else {
    const user = await validateUser(ctx.from.id);
    if (!user.valid) {
      await ctx.reply("You are not a validated OpenFusionAPI user.");
      return;
    }
  }
  try {
    const ok = await writeVarValue(ADMIN_GROUP_VAR, String(chat.id));
    await ctx.reply(ok
      ? "This chat is now subscribed to admin alerts."
      : "Could not subscribe this chat.");
  } catch (error) {
    ofapi.log({ message: `subscribe: ${error?.message}` });
    await ctx.reply("An unexpected error occurred. Try again.");
  }
});

$BOT.command("unsubscribe", async (ctx) => {
  const chat = ctx.chat;
  if (!chat) return;
  if (isGroupChat(chat)) {
    if (!(await isGroupAdmin(chat, ctx.from.id))) {
      await ctx.reply("Only group administrators can unsubscribe this group.");
      return;
    }
  } else {
    const user = await validateUser(ctx.from.id);
    if (!user.valid) {
      await ctx.reply("You are not a validated OpenFusionAPI user.");
      return;
    }
  }
  try {
    const ok = await writeVarValue(ADMIN_GROUP_VAR, "");
    await ctx.reply(ok
      ? "This chat is no longer subscribed to admin alerts."
      : "Could not unsubscribe. Try again.");
  } catch (error) {
    ofapi.log({ message: `unsubscribe: ${error?.message}` });
    await ctx.reply("An unexpected error occurred. Try again.");
  }
});

// ── Flujo de texto (solo chat privado) ───────────────────────────────────────
$BOT.on("message:text", async (ctx) => {
  if (!isPrivateChat(ctx.chat)) {
    if (isGroupChat(ctx.chat)) {
      const appConsumed = await handleAppPick(ctx);
      if (!appConsumed) await handleEnvPick(ctx);
      await handleUnlinkPick(ctx);
    }
    return;
  }
  const s = getState(ctx.chat.id);
  if (!s) {
    await ctx.reply("Send /start to see the available commands.");
    return;
  }
  const text = String(ctx.message.text || "").trim();

  switch (s.step) {
    case STATE.LINK_USERNAME:
      s.username = text.replace(/\s+/g, "");
      s.step = STATE.LINK_PASSWORD;
      await ctx.reply("Now your password (if possible) or /cancel:");
      break;

    case STATE.LINK_PASSWORD: {
      const username = s.username;
      setState(ctx.chat.id, null);
      try {
        const l = await login(username, text);
        if (!l.ok) {
          await ctx.reply("Login failed. Check your credentials.");
          return;
        }
        const token = l.data?.token || l.token;
        const res = await linkTelegram(token, ctx.chat.id);
        if (res.ok) await ctx.reply("Chat linked to your account successfully.");
        else await ctx.reply("Could not link the chat. Make sure your account is active.");
      } catch (error) {
        ofapi.log({ message: `link flow: ${error?.message}` });
        await ctx.reply("An unexpected error occurred. Try again.");
      }
      break;
    }

    case STATE.FORGOT_USERNAME: {
      const username = text.replace(/\s+/g, "");
      setState(ctx.chat.id, null);
      try {
        const res = await forgotPassword(username);
        if (res.ok && res.body?.channel === "telegram") {
          await ctx.reply("We sent you a one-time code to this chat. Send /reset to confirm your new password.");
        } else {
          await ctx.reply(
            "If the account exists and a channel is available, you will receive the code on that channel. Send /reset to confirm."
          );
        }
      } catch (error) {
        ofapi.log({ message: `forgot flow: ${error?.message}` });
        await ctx.reply("An unexpected error occurred. Try again.");
      }
      break;
    }

    case STATE.RESET_USERNAME:
      s.username = text.replace(/\s+/g, "");
      s.step = STATE.RESET_OTP;
      await ctx.reply("Type the one-time code you received:");
      break;

    case STATE.RESET_OTP:
      s.otp = text.trim();
      s.step = STATE.RESET_NEWPASSWORD;
      await ctx.reply("Type the new password (minimum 8 characters):");
      break;

    case STATE.RESET_NEWPASSWORD:
      s.newPassword = text;
      s.step = STATE.RESET_CONFIRM;
      await ctx.reply("Confirm the new password:");
      break;

    case STATE.RESET_CONFIRM: {
      if (text !== s.newPassword) {
        await ctx.reply("Passwords do not match. Cancel and try again.");
        setState(ctx.chat.id, null);
        return;
      }
      const username = s.username;
      const otp = s.otp;
      const newPassword = s.newPassword;
      setState(ctx.chat.id, null);
      try {
        const res = await resetPasswordConfirm(username, otp, newPassword);
        if (res.ok && res.body?.success) await ctx.reply("Password updated successfully.");
        else await ctx.reply("Could not redeem the code. Check the code, the username and the password requirements.");
      } catch (error) {
        ofapi.log({ message: `reset flow: ${error?.message}` });
        await ctx.reply("An unexpected error occurred. Try again.");
      }
      break;
    }

    case STATE.CHANGE_USERNAME:
      s.username = text.replace(/\s+/g, "");
      s.step = STATE.CHANGE_PASSWORD;
      await ctx.reply("Your current password:");
      break;

    case STATE.CHANGE_PASSWORD:
      s.oldPassword = text;
      s.step = STATE.CHANGE_NEWPASSWORD;
      await ctx.reply("The new password (minimum 8 characters):");
      break;

    case STATE.CHANGE_NEWPASSWORD:
      s.newPassword = text;
      s.step = STATE.CHANGE_CONFIRM;
      await ctx.reply("Confirm the new password:");
      break;

    case STATE.CHANGE_CONFIRM: {
      if (text !== s.newPassword) {
        await ctx.reply("Passwords do not match. Cancel and try again.");
        setState(ctx.chat.id, null);
        return;
      }
      const username = s.username;
      const oldPassword = s.oldPassword;
      const newPassword = s.newPassword;
      setState(ctx.chat.id, null);
      try {
        const l = await login(username, oldPassword);
        if (!l.ok) {
          await ctx.reply("Incorrect credentials. The password was not changed.");
          return;
        }
        const token = l.data?.token || l.token;
        const res = await changePassword(token, username, oldPassword, newPassword);
        const success = res.ok && res.body?.success !== false;
        const errorMsg = typeof res.body?.error === "string" ? res.body.error : "";
        if (success) await ctx.reply("Password updated successfully.");
        else await ctx.reply(errorMsg ? `Could not change the password: ${esc(errorMsg)}` : "Could not change the password. Check the security requirements.");
      } catch (error) {
        ofapi.log({ message: `change flow: ${error?.message}` });
        await ctx.reply("An unexpected error occurred. Try again.");
      }
      break;
    }

    default:
      setState(ctx.chat.id, null);
      await ctx.reply("Operation cancelled. Send /start for the available commands.");
  }
});