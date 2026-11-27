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
| `$BOT` | An **already created and initialized** `grammy.Bot` instance built from the resolved token. Also available as `globalThis.$BOT`. Register your handlers on it; `bot.botInfo` and `ctx.me` are already populated. |
| `$BOT_TOKEN` | The **resolved** token string (AppVar references are already replaced). |
| `grammy` | The full grammY module namespace: `Bot`, `InlineKeyboard`, `Keyboard`, `GrammyError`, `HttpError`, plus built-ins `session`, `lazySession`, `MemorySessionStorage`, `Composer`, `matchFilter`, `InputFile`, `BotError`, `webhookCallback` (not usable here). |
| `grammyPlugins` | Official plugin namespace: `autoRetry`, `conversations`, `createConversation`, `Menu`, `I18n`, `fmt`, `hydrate`, `hydrateFiles`, `Router`, `emoji`. See "Official plugins" below. |
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
5. **Do not configure webhooks.** The worker owns long polling; calling `$BOT.api.setWebhook()` would stop `getUpdates` and break delivery. `grammy.webhookCallback` is injected but has no HTTP route to mount on.

---

## What the runtime does

In order:

1. Creates `$BOT`, calls `bot.init()` once (token validation + `botInfo`) and only then evaluates your code.
2. After your code runs, chains any `$BOT.catch(...)` handler you registered ahead of its own `BOT_ERROR` logger, so your handler is never overwritten.
3. Starts long polling with a **fixed** configuration:

```js
start({
  allowed_updates: [
    "message", "edited_message", "channel_post", "edited_channel_post",
    "business_connection", "business_message", "edited_business_message",
    "deleted_business_messages", "guest_message", "message_reaction",
    "message_reaction_count", "inline_query", "chosen_inline_result",
    "callback_query", "widget_query", "shared_widget_query", "shipping_query",
    "pre_checkout_query", "purchased_paid_media", "poll", "poll_answer",
    "my_chat_member", "chat_member", "chat_join_request", "chat_boost",
    "removed_chat_boost", "managed_bot", "subscription",
    "stopped_message_generation"
  ],
  drop_pending_updates: isRunningRestart ? false : true,
  handleSignals: false,
})
```

**Rules you must respect and communicate to the user:**

- **All 29 update types are subscribed** — the complete `Update` shape of `@grammyjs/types` 5.2.0. The list is explicit because Telegram excludes `chat_member`, `message_reaction` and `message_reaction_count` from its default. It is fixed: it cannot be narrowed from bot code or `params`. Handlers for any of those types can fire.
- **Subscription is not configuration.** Inline mode, payments, paid media, Business Messages and subscriptions must be enabled for the bot in @BotFather. `chat_member` and `message_reaction_count` require the bot to be a chat administrator. If Telegram does not send the update, no handler can make it arrive.
- **Reactions are push-only.** There is no Bot API method to read reactions added in the past. Subscribe with `$BOT.on("message_reaction", ...)` (`ctx.messageReaction`: `message_id`, `chat`, `actor`, `old_reaction`, `new_reaction`) and/or `$BOT.on("message_reaction_count", ...)` for anonymous aggregates. Only reactions that happen while the bot is running are observable; Telegram stores unread updates for at most 24 h.
- **Polls: only your own.** `poll_answer` arrives for **polls the bot created** (`ctx.replyWithPoll(...)`); Telegram never lets a bot read the results of a poll sent by a user or another bot. To show results, either track the `poll_answer` updates or call `ctx.api.stopPoll(chatId, messageId)`, which closes voting and returns the official counts.
- **`drop_pending_updates` is conditional.** `true` on a cold start, `false` on a hot restart caused by changing token, code or AppVars. Messages older than 24 h are discarded by Telegram anyway, so never design a flow that assumes no update is ever lost.

---

## Official plugins

The bot sandbox has no `require()`, so the runtime injects these official packages under `grammyPlugins`:

```javascript
$BOT.use(grammyPlugins.autoRetry());          // @grammyjs/auto-retry
$BOT.use(grammyPlugins.conversations());      // @grammyjs/conversations
$BOT.use(grammyPlugins.hydrate());            // @grammyjs/hydrate
$BOT.api.config.use(grammyPlugins.hydrateFiles($BOT_TOKEN)); // @grammyjs/files (API transformer)
$BOT.use(grammyPlugins.I18n({ defaultLocale: "es", locales: {} })); // @grammyjs/i18n
const menu = new grammyPlugins.Menu("main");  // @grammyjs/menu
$BOT.use(menu);
$BOT.use(new grammyPlugins.Router());         // @grammyjs/router

// @grammyjs/parse-mode: `fmt` is a formatting helper, not middleware.
$BOT.command("hi", async (ctx) => {
  await ctx.reply(grammyPlugins.fmt`Hello, ${ctx.from.first_name}!`);
});
```

Use `grammyPlugins.createConversation()` with `grammy.session()` for conversational flows. `menu` and `conversations` need session middleware; `grammy.MemorySessionStorage` is process-local and is lost on every restart, so choose a persistent store when state must survive. `@grammyjs/emoji` is exposed as `grammyPlugins.emoji`.

**Do not** propose `@grammyjs/runner`, webhooks, or importing any `@grammyjs/*` package yourself: only the keys above exist in the sandbox. Built-in grammY helpers (`session`, `lazySession`, `Keyboard`, `InlineKeyboard`, `InlineQueryResultBuilder`, `Composer`, `matchFilter`, `InputFile`) are on `grammy`, not on `grammyPlugins`.

---

## Error taxonomy

| Type | Cause | Retry policy | Where you see it |
|---|---|---|---|
| `bot_token_error` | Empty token, or an AppVar reference that does not resolve for the bot's environment. The bot is not started. | not retried | log event, status 400 |
| `INVALID_TOKEN` | Telegram answered 401 to `getMe()` (`GrammyError`). Token wrong or revoked by @BotFather. | permanent | `bot_startup_error` |
| `FORBIDDEN` | Telegram answered 403/404: the bot was blocked or deleted. | permanent | `bot_startup_error` |
| `CODE_ERROR` | Your script does not compile, or it left no valid `$BOT`. | permanent | `bot_startup_error` |
| `CONNECTION_ERROR` | Network failure reaching the Telegram API (`HttpError`, `ECONNRESET`, `EAI_AGAIN`, …). | **recoverable** | `bot_startup_error` |
| `RATE_LIMITED` | Telegram answered 429. The `retry_after` it sends is honoured. | **recoverable** | `bot_startup_error` |
| `PROVIDER_ERROR` | Telegram answered 5xx. | **recoverable** | `bot_startup_error` |
| `STARTUP_ERROR` / `WORKER_CRASH` / `WORKER_EXIT` | Unclassified failure. Treated as recoverable, but quarantined sooner. | **recoverable** | `bot_startup_error`, `bot_worker_crash` |
| `BOT_ERROR` | An update handler threw at runtime. The bot keeps running. | n/a | `bot_runtime_error` |

**Recoverable** failures never disable the bot. It stays `enabled` and is retried with exponential
backoff plus jitter (10 s → 5 min ceiling), logging `bot_start_retry_scheduled` per attempt and one
`bot_start_deferred` per wait. After 8 consecutive failures (4 if unclassified) it moves to
`QUARANTINED` and probes every 15/30/60 minutes **forever**, so it comes back on its own when the
network does. `CONNECTION_ERROR` means the runtime never reached Telegram, so the token was never
even checked: diagnose the network (proxy, TLS inspection, egress rules) instead of editing `token`
or `code`. Verify from the host with `curl -sS https://api.telegram.org/bot<token>/getMe`; a TCP
connect that succeeds and then fails during the TLS handshake means the host is blocked, not that the
credential is wrong.

**Permanent** failures: three consecutive ones disable the row (`enabled = false`,
`runtime_status = DISABLED_ERROR`, `disabled_by = 'system'`), because retrying a revoked token or a
script that does not compile is pure waste. Since the lifecycle retries every 10 s, expect this
within **20–30 seconds** of saving a bad configuration. **Fix the token or the code with `upsert_bot`
and the bot is re-enabled automatically** — do not call `enable_disable_bot`.

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

## Middleware & callback chains (grammY)

All handlers registered for the **same update type** form a single middleware chain. grammY runs them in registration order; a handler that does a bare `return;` **without calling `next()` halts the chain silently** — every handler registered after it is skipped, no error is raised, no log is written, and Telegram only shows the button "spinning" and then nothing. This is indistinguishable from "the update never arrived", so it is one of the most misleading grammY failures to debug.

### Choosing a registration style

| Style | When to use |
|---|---|
| `$BOT.callbackQuery("literal"` / `/regex/`, fn) — **pattern filters** | **Default for anything split by `callback_data`.** Non-matching data is skipped automatically, the chain never halts, and each handler stays small and declarative. |
| `$BOT.command("name", fn)` | Commands. Already safe: every command has its own filter, non-matching ones are skipped automatically. |
| `$BOT.on("callback_query:data", async (ctx, next) => ...)` | Only for a single handler that must see **every** callback (e.g. audit). It must then call `await next()` unconditionally at the end. Prefer `$BOT.use(...)` or `$BOT.filter(...)` instead: identical semantics with no way to forget `next()`. |
| `$BOT.on("message:...", fn)` typed filters | Safe: they are pattern filters too, non-matching updates are skipped automatically. |

**Rules for `callback_query:data`:**

1. Never split one update type with guard-and-return handlers (`if (!data.startsWith("x:")) return;`). If a handler returns without `next()`, every handler registered after it is dead code: the button spins and nothing happens — with zero logs.
2. If you must use `on(...)`, accept the `next` parameter and propagate it: `if (!data.startsWith("x:")) { await next(); return; }`.
3. `command()` and `on("message:...")` are **not** affected: each handler has its own filter, so grammY skips non-matching handlers by itself. The hazard exists only when several handlers share one update type.

**Diagnosis:** the symptom "button spins, nothing happens, zero logs and zero errors" points first at a halted callback chain.

**Positive-control rule (debugging):** register your diagnostic probe as the FIRST handler, or with `$BOT.use(...)` — never at the end of the same chain you suspect is halted. A probe placed after a halting handler stays blind with exactly the same failure, and you will wrongly conclude that the update never arrived.

The platform's own system bot (`src/lib/server/functions/system/prd/user/systemBot.telegram.js`) is the **reference implementation**: every callback uses `$BOT.callbackQuery(pattern, ...)` with zero guard-and-return handlers. When in doubt, mirror it.

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
  await ctx.reply("Send me any text and I will repeat it.");
});

$BOT.on("message:text", async (ctx) => {
  await ctx.reply(`Received: ${ctx.message.text}`);
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
    await ctx.reply("Not authorized");
    return;
  }

  const keyboard = new grammy.InlineKeyboard()
    .text("View status", "status")
    .text("Cancel", "cancel");

  await ctx.reply("What do you want to do?", { reply_markup: keyboard });
});

// Pattern filters: grammY matches the data and skips the other handler
// automatically, so the middleware chain can never be halted by a guard.
$BOT.callbackQuery("cancel", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Cancelled" });
  await ctx.editMessageText("Operation cancelled");
});

$BOT.callbackQuery("status", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    // Same-instance call: replace the environment suffix with `auto`.
    const uF = uFetchAutoEnv.auto("/api/system/api/apps-list/auto", true);
    const response = await uF.get();
    const data = await response.json();
    const total = Array.isArray(data) ? data.length : 0;
    await ctx.editMessageText(`Detected applications: ${total}`);
  } catch (error) {
    ofapi.log({ message: `status command failed: ${error?.message}` });
    await ctx.editMessageText("Could not get the status.");
  }
});
```

---

## Verification checklist

0. You resolved `idapp` from `apps_list` rather than guessing it.
1. `upsert_bot` returned success. If it returned a `warning`, create the missing AppVar with `appvar_upsert` first.
2. Wait ~10 seconds, then `get_system_logs` filtering `idendpoint = <idbot>` and `event = bot_started`. Expect the bot username. If nothing comes back, re-query with `event = bot_token_error,bot_startup_error,bot_auto_disabled,bot_start_retry_scheduled,bot_quarantined` and read the message before changing anything.
3. `list_bots` shows `runtime_status: RUNNING`. `BACKOFF` or `QUARANTINED` means a recoverable failure and needs no action — check `next_retry_at`. `DISABLED_ERROR` means a permanent one: fix the token or code with `upsert_bot`, which re-enables the bot by itself.
4. Send `/start` in Telegram and confirm the reply.

Do not report the bot as working before step 4. If step 4 is impossible because Telegram is unreachable from this host, say exactly that — an unreachable platform is not a working bot, and it is not a bot defect either.
