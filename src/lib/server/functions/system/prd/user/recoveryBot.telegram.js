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
  "I'm the account recovery assistant.",
  "",
  "Commands:",
  "/link - Link this chat to your account",
  "/forgot - Request a code to reset your password",
  "/changepassword - Change your password",
  "/health - System status",
  "",
  "Use these commands in a private chat with me.",
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
      "Hello, I'm the OpenFusionAPI password recovery assistant.",
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
  await ctx.reply("Operation cancelled.");
});

$BOT.command("link", async (ctx) => {
  setState(ctx.chat.id, STATE.LINK_USERNAME);
  await ctx.reply("Let's link this chat to your account.\nType your username:");
});

$BOT.command("forgot", async (ctx) => {
  setState(ctx.chat.id, STATE.FORGOT_USERNAME);
  await ctx.reply("Type your username and I will send you a verification code:");
});

$BOT.command("changepassword", async (ctx) => {
  setState(ctx.chat.id, STATE.CHANGE_USERNAME);
  await ctx.reply("Let's change your password.\nType your username:");
});

$BOT.command("health", async (ctx) => {
  try {
    const sysToken = ofapi.genToken(
      {
        admin: {
          username: "openfusionapi",
          ctrl: { as_admin: true },
        },
      },
      60 * 5
    );
    const r = await api("/system/health/stats", "get", { token: sysToken });
    await ctx.reply(`System status (HTTP ${r.status}).`);
  } catch (error) {
    ofapi.log({ message: `health: ${error?.message}` });
    await ctx.reply("Could not query the system status.");
  }
});

// ── Flujo de texto ──────────────────────────────────────────────────────────
$BOT.on("message:text", async (ctx) => {
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
        if (res.ok) {
          if (res.body?.channel === "telegram") {
            await ctx.reply("We sent you a verification code to this chat.");
          } else {
            await ctx.reply(
              "If the account exists and a channel is available, you will receive the code on that channel."
            );
          }
        } else {
          await ctx.reply(
            "If the account exists and a channel is available, you will receive the code on that channel."
          );
        }
      } catch (error) {
        ofapi.log({ message: `forgot flow: ${error?.message}` });
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
        if (res.ok) await ctx.reply("Password updated successfully.");
        else await ctx.reply("Could not change the password. Check the security requirements.");
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