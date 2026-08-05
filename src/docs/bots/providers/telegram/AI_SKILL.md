# Telegram Bot Provider - AI Agent Skill Guide

## Role & Persona
You are an expert **Telegram Bot Developer** using the **grammY** library. You design responsive command handlers, callback flows, and middleware that run inside an OpenFusionAPI bot worker.

## Prerequisites

1. Call **`get_bot_skill`** first. It carries the bot data model, the CRUD workflow, the token/AppVar rules, the observability contract, and the shared JavaScript sandbox skill. This document only adds what is specific to Telegram.
2. Use `handler_library_documentation` with `handler=JS` to inspect any injected library you intend to use (`uFetchAutoEnv`, `luxon`, `ofapi`, …). The bot worker shares the same library pool as the JS handler.

---

## Injected sandbox

| Name | What it is |
|---|---|
| `$BOT` | A **already created** `grammy.Bot` instance built from the resolved token. Also available as `globalThis.$BOT`. Register your handlers on it. |
| `$BOT_TOKEN` | The **resolved** token string (AppVar references are already replaced). |
| `grammy` | The full grammY module namespace: `Bot`, `InlineKeyboard`, `Keyboard`, `GrammyError`, `HttpError`, … |
| `$_APP_VARS_` + direct names | The application variables of the bot's `environment`. |
| `params` keys | Every key of `ofapi_bot.params`, merged **over** the AppVars. |
| `idapp` | UUID of the owning application. |
| injected libraries | The same `functionsVars` pool as the JS handler (`ofapi`, `uFetchAutoEnv`, `luxon`, `console`, …). |

---

## Hard constraints

1. **Do not instantiate the bot.** `new grammy.Bot(...)` creates a second, unmanaged client. The runtime already did it for you.
2. **Do not call `$BOT.start()`** (or `stop()`). The runtime starts and supervises the bot after evaluating your code.
3. **Do not reassign `$BOT`** to anything that is not a grammY `Bot`. After evaluating your script the worker checks that `$BOT` exists and exposes a `.start` function; otherwise it fails with `Code did not define a valid $BOT instance.`
4. **Your script must finish within 10 000 ms.** It is a synchronous evaluation pass whose only job is registering handlers — no top-level `await`, no long work.

---

## What the runtime does after your code runs

In order:

1. Attaches its own error handler (`$BOT.catch`), which reports runtime failures as `BOT_ERROR` logs.
2. Calls `api.getMe()` to validate the token and learn the bot username.
3. Starts long polling with a **fixed** configuration:

```js
start({
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
  handleSignals: false,
})
```

**Two consequences you must respect and communicate to the user:**

- **`allowed_updates` is fixed.** Telegram will only deliver `message` and `callback_query` updates. Handlers registered for `inline_query`, `edited_message`, `my_chat_member`, `chat_member`, `poll`, `poll_answer`, `channel_post`, `edited_channel_post`, `shipping_query`, `pre_checkout_query`, `chat_join_request`, etc. **can never fire**. Do not propose a design that depends on them; say so explicitly instead of writing dead handlers.
- **`drop_pending_updates: true`.** Messages sent while the bot was stopped, restarting, or in cooldown are discarded. A bot restarts whenever its token, code or app variables change, so never design a flow that assumes no message is ever lost.

---

## Error taxonomy

| Type | Cause | Retry policy | Where you see it |
|---|---|---|---|
| `bot_token_error` | Empty token, or an AppVar reference that does not resolve for the bot's environment. The bot is not started. | permanent | log event, status 400 |
| `INVALID_TOKEN` | Telegram answered 401 to `getMe()` (`GrammyError`). Token wrong or revoked by @BotFather. | permanent | `bot_startup_error` |
| `CONNECTION_ERROR` | Network failure reaching the Telegram API (`HttpError`). | **transient** | `bot_startup_error` |
| `STARTUP_ERROR` | Your script threw, exceeded the 10 s budget, or left no valid `$BOT`. | permanent | `bot_startup_error` |
| `BOT_ERROR` | An update handler threw at runtime. The bot keeps running. | n/a | `bot_runtime_error` |

**Permanent** failures: three inside a 5-minute window auto-disable the bot row (`enabled = false`) and start a 5-minute cooldown, so a bad token or an invalid script stops retrying. Because the lifecycle retries every 10 s, that threshold is normally reached in **about 20–30 seconds** — check the logs promptly rather than waiting out the full window. Read them before re-enabling.

**Transient** failures (`CONNECTION_ERROR`) never disable the bot. It stays `enabled` and is retried with escalating backoff (10 s → 30 s → 60 s → 2 min → 5 min), logging `bot_start_retry_scheduled` per attempt and one `bot_start_deferred` per wait. `CONNECTION_ERROR` means the runtime never reached Telegram, so the token was never even checked: diagnose the network (proxy, TLS inspection, egress rules) instead of editing `token` or `code`. Verify from the host with `curl -sS https://api.telegram.org/bot<token>/getMe`; a TCP connect that succeeds and then fails during the TLS handshake means the host is blocked, not that the credential is wrong.

To check the code before saving it, call `validate_endpoint_code` with `handler: "JS"` and `dry_run: false` (a dry run would execute the script where `$BOT` does not exist).

You can catch platform errors yourself for better messages:

```javascript
try {
  await ctx.reply("...");
} catch (error) {
  if (error instanceof grammy.GrammyError) {
    ofapi.log({ message: `Telegram rejected the call: ${error.description}` });
  } else if (error instanceof grammy.HttpError) {
    ofapi.log({ message: `Could not reach Telegram: ${error.message}` });
  } else {
    throw error;
  }
}
```

---

## Logging from bot code

`ofapi.log(...)` works inside bot code and lands in the normal log table with `method = BOT` and `idendpoint = <idbot>`. Those logs share the `trace_id` of the current run — the same one carried by that run's `bot_started` event — so you can go from a startup event to everything the bot logged in that run. Use `idendpoint = <idbot>` for the bot's whole history across runs.

---

## Templates

### (a) Minimal

```javascript
$BOT.command("start", async (ctx) => {
  await ctx.reply("Bot activo desde OpenFusionAPI");
});
```

### (b) Echo

```javascript
$BOT.command("start", async (ctx) => {
  await ctx.reply("Envíame cualquier texto y te lo repito.");
});

$BOT.on("message:text", async (ctx) => {
  await ctx.reply(`Recibido: ${ctx.message.text}`);
});
```

Useful as a smoke test: it confirms the token resolved, the worker started, and updates are being processed.

### (c) Realistic — commands, inline keyboard, callbacks, internal API call, logging

```javascript
const allowedChatId = $_APP_VARS_["$_VAR_ALLOWED_CHAT_ID"];

const isAuthorized = (ctx) =>
  !allowedChatId || String(ctx.chat?.id) === String(allowedChatId);

$BOT.command("start", async (ctx) => {
  if (!isAuthorized(ctx)) {
    await ctx.reply("No autorizado");
    return;
  }

  const keyboard = new grammy.InlineKeyboard()
    .text("Ver estado", "status")
    .text("Cancelar", "cancel");

  await ctx.reply("¿Qué deseas hacer?", { reply_markup: keyboard });
});

$BOT.on("callback_query:data", async (ctx) => {
  const action = ctx.callbackQuery.data;

  if (action === "cancel") {
    await ctx.answerCallbackQuery({ text: "Cancelado" });
    await ctx.editMessageText("Operación cancelada");
    return;
  }

  if (action === "status") {
    await ctx.answerCallbackQuery();
    try {
      // Same-instance call: replace the environment suffix with `auto`.
      const uF = uFetchAutoEnv.auto("/api/system/api/apps-list/auto", true);
      const response = await uF.get();
      const data = await response.json();
      const total = Array.isArray(data) ? data.length : 0;
      await ctx.editMessageText(`Aplicaciones detectadas: ${total}`);
    } catch (error) {
      ofapi.log({ message: `status command failed: ${error?.message}` });
      await ctx.editMessageText("No se pudo consultar el estado.");
    }
  }
});
```

---

## Verification checklist

0. You resolved `idapp` from `apps_list` rather than guessing it.
1. `upsert_bot` returned success. If it returned a `warning`, create the missing AppVar with `appvar_upsert` first.
2. Wait ~10 seconds, then `get_system_logs` filtering `idendpoint = <idbot>` and `event = bot_started`. Expect the bot username. If nothing comes back, re-query with `event = bot_token_error,bot_startup_error,bot_auto_disabled,bot_start_retry_scheduled` and read the message before changing anything.
3. `list_bots` still shows the bot as `enabled: true` (a bot failing permanently gets auto-disabled; one failing on `CONNECTION_ERROR` stays enabled and keeps retrying).
4. Send `/start` in Telegram and confirm the reply.

Do not report the bot as working before step 4. If step 4 is impossible because Telegram is unreachable from this host, say exactly that — an unreachable platform is not a working bot, and it is not a bot defect either.
