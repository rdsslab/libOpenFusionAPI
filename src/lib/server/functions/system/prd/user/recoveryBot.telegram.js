// Bot de Telegram para la recuperación y cambio de contraseña de usuarios
// internos. NO se ejecuta aquí: este archivo es la fuente de control de
// versiones del script que se publica con `upsert_bot` (ofapi_bot.code).
//
// Restricciones del runtime (ver src/lib/server/bot-manager/worker.js):
//   - El worker envuelve el código: ya instancia `$BOT` (nunca `new grammy.Bot`).
//   - Nunca llamar `$BOT.start()` / `$BOT.stop()`.
//   - El script solo REGISTRA handlers; debe terminar en < 10 segundos (sin await top-level).
//   - Long polling fijo: allowed_updates = ["message", "callback_query"].
//   - Llamadas internas: uFetchAutoEnv.auto("/api/system<resource>/auto").
//   - Nada de esto debe fallar si el app tiene $_VAR_RESET_TELEGRAM_ENABLED = false:
//     entrega = true es coherente con el endpoint; si el flag se apaga, el bot
//     contesta igual pero la entrega la decide el servidor.

// ── Estados de conversación (sin sesiones persistentes) ──────────────────────
const states = new Map();
const STATE = {
  LINK_USERNAME: "link:username",
  LINK_PASSWORD: "link:password",
  FORGOT_USERNAME: "forgot:username",
  CHANGE_USERNAME: "change:username",
  CHANGE_PASSWORD: "change:password",
  CHANGE_NEWPASSWORD: "change:newpassword",
  CHANGE_CONFIRM: "change:confirm",
};

const setState = (chatId, s) => {
  if (s) states.set(String(chatId), { step: s, username: "" });
  else states.delete(String(chatId));
};
const getState = (chatId) => states.get(String(chatId));

const HELP_TEXT = [
  "Soy el asistente de recuperación de cuenta.",
  "",
  "Comandos:",
  "/link - Vincular este chat a tu cuenta",
  "/forgot - Pedir un código para restablecer la contraseña",
  "/changepassword - Cambiar tu contraseña",
  "/health - Estado del sistema",
  "",
  "Usa estos comandos en un chat privado conmigo.",
].join("\n");

// ── Llamadas internas a los endpoints del app system ─────────────────────────
const api = (path, method, { data, token, basic } = {}) => {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (basic) headers["Authorization"] = `Basic ${basic}`;
  return uFetchAutoEnv.auto(`/api/system${path}/auto`)[method]({
    ...(data !== undefined ? { data } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  });
};

const login = async (username, password) => {
  const basic = Buffer.from(`${username}:${password}`).toString("base64");
  const r = await api("/system/login", "post", { basic });
  if (r.status >= 200 && r.status < 300) return { ok: true, ...(await r.json()) };
  return { ok: false, status: r.status };
};

const linkTelegram = async (token, chatId) => {
  const r = await api("/user/linktelegram", "post", { token, data: { chat_id: String(chatId) } });
  try {
    const body = await r.json();
    return { ok: r.status < 300, status: r.status, body };
  } catch (e) {
    return { ok: false, status: r.status };
  }
};

const forgotPassword = async (username) => {
  const r = await api("/user/forgotpassword", "post", { data: { username } });
  try {
    return { ok: r.status < 300, status: r.status, body: await r.json() };
  } catch (e) {
    return { ok: false, status: r.status };
  }
};

const changePassword = async (token, username, oldPassword, newPassword) => {
  const r = await api("/user/changepassword", "post", {
    token,
    data: { username, oldPassword, newPassword },
  });
  try {
    return { ok: r.status < 300, status: r.status, body: await r.json() };
  } catch (e) {
    return { ok: false, status: r.status };
  }
};

// ── Comandos ────────────────────────────────────────────────────────────────
$BOT.command("start", async (ctx) => {
  setState(ctx.chat.id, null);
  await ctx.reply(
    [
      "Hola, soy el asistente de recuperación de contraseña de OpenFusionAPI.",
      "",
      HELP_TEXT,
    ].join("\n")
  );
});

$BOT.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT);
});

$BOT.command("cancel", async (ctx) => {
  setState(ctx.chat.id, null);
  await ctx.reply("Operación cancelada.");
});

$BOT.command("link", async (ctx) => {
  setState(ctx.chat.id, STATE.LINK_USERNAME);
  await ctx.reply("Vamos a vincular este chat a tu cuenta.\nEscribí tu nombre de usuario:");
});

$BOT.command("forgot", async (ctx) => {
  setState(ctx.chat.id, STATE.FORGOT_USERNAME);
  await ctx.reply("Escribí tu nombre de usuario y te enviaré un código de verificación:");
});

$BOT.command("changepassword", async (ctx) => {
  setState(ctx.chat.id, STATE.CHANGE_USERNAME);
  await ctx.reply("Vamos a cambiar tu contraseña.\nEscribí tu nombre de usuario:");
});

$BOT.command("health", async (ctx) => {
  try {
    const r = await api("/system/health/stats", "get");
    await ctx.reply(`Estado del sistema (HTTP ${r.status}).`);
  } catch (error) {
    ofapi.log({ message: `health: ${error?.message}` });
    await ctx.reply("No se pudo consultar el estado del sistema.");
  }
});

// ── Flujo de texto ──────────────────────────────────────────────────────────
$BOT.on("message:text", async (ctx) => {
  const s = getState(ctx.chat.id);
  if (!s) {
    await ctx.reply("Enviá /start para ver los comandos disponibles.");
    return;
  }
  const text = String(ctx.message.text || "").trim();

  switch (s.step) {
    case STATE.LINK_USERNAME:
      s.username = text.replace(/\s+/g, "");
      s.step = STATE.LINK_PASSWORD;
      await ctx.reply("Ahora tu contraseña (si es posible) o /cancel:");
      break;

    case STATE.LINK_PASSWORD: {
      const username = s.username;
      setState(ctx.chat.id, null);
      try {
        const l = await login(username, text);
        if (!l.ok) {
          await ctx.reply("No se pudo iniciar sesión. Verificá tus credenciales.");
          return;
        }
        const token = l.data?.token || l.token;
        const res = await linkTelegram(token, ctx.chat.id);
        if (res.ok) await ctx.reply("Chat vinculado a tu cuenta correctamente.");
        else await ctx.reply("No se pudo vincular el chat. Verificá que tu cuenta esté activa.");
      } catch (error) {
        ofapi.log({ message: `link flow: ${error?.message}` });
        await ctx.reply("Ocurrió un error inesperado. Intentalo de nuevo.");
      }
      break;
    }

    case STATE.FORGOT_USERNAME: {
      const username = text.replace(/\s+/g, "");
      setState(ctx.chat.id, null);
      try {
        const res = await forgotPassword(username);
        if (res.ok) {
          if (res.body?.channel === "telegram") {
            await ctx.reply("Te enviamos un código de verificación por este chat.");
          } else {
            await ctx.reply(
              "Si la cuenta existe y un canal está disponible, recibirás el código por ese canal."
            );
          }
        } else {
          await ctx.reply(
            "Si la cuenta existe y un canal está disponible, recibirás el código por ese canal."
          );
        }
      } catch (error) {
        ofapi.log({ message: `forgot flow: ${error?.message}` });
        await ctx.reply("Ocurrió un error inesperado. Intentalo de nuevo.");
      }
      break;
    }

    case STATE.CHANGE_USERNAME:
      s.username = text.replace(/\s+/g, "");
      s.step = STATE.CHANGE_PASSWORD;
      await ctx.reply("Tu contraseña actual:");
      break;

    case STATE.CHANGE_PASSWORD:
      s.oldPassword = text;
      s.step = STATE.CHANGE_NEWPASSWORD;
      await ctx.reply("La nueva contraseña (mínimo 8 caracteres):");
      break;

    case STATE.CHANGE_NEWPASSWORD:
      s.newPassword = text;
      s.step = STATE.CHANGE_CONFIRM;
      await ctx.reply("Confirmá la nueva contraseña:");
      break;

    case STATE.CHANGE_CONFIRM: {
      if (text !== s.newPassword) {
        await ctx.reply("Las contraseñas no coinciden. Cancelá y volvé a intentarlo.");
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
          await ctx.reply("Credenciales incorrectas. No se cambió la contraseña.");
          return;
        }
        const token = l.data?.token || l.token;
        const res = await changePassword(token, username, oldPassword, newPassword);
        if (res.ok) await ctx.reply("Contraseña actualizada correctamente.");
        else await ctx.reply("No se pudo cambiar la contraseña. Verificá los requisitos de seguridad.");
      } catch (error) {
        ofapi.log({ message: `change flow: ${error?.message}` });
        await ctx.reply("Ocurrió un error inesperado. Intentalo de nuevo.");
      }
      break;
    }

    default:
      setState(ctx.chat.id, null);
      await ctx.reply("Operación cancelada. Enviá /start para los comandos.");
  }
});