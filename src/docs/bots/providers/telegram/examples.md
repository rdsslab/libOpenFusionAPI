# Telegram Bot Examples

Every snippet below goes in the `code` field of a bot row (`upsert_bot`). The runtime already created the client:

- `$BOT` — an initialized `grammy.Bot` instance built from the resolved token; `bot.botInfo` is already available
- `$BOT_TOKEN` — the resolved token
- `grammy` — the grammY module namespace, including built-ins such as `session` and `InlineKeyboard`
- `grammyPlugins` — official plugins: `autoRetry`, `conversations`, `createConversation`, `Menu`, `I18n`, `fmt`, `hydrate`, `hydrateFiles`, `Router`, `emoji`

Never call `new grammy.Bot(...)`, `$BOT.start()` or `$BOT.api.setWebhook()`; the runtime owns the bot and its long polling loop.

## Minimal bot

```javascript
$BOT.command("start", async (ctx) => {
  await ctx.reply("Bot active since OpenFusionAPI");
});
```

## Echo

```javascript
$BOT.command("start", async (ctx) => {
  await ctx.reply("Send me any text and I will repeat it.");
});

$BOT.on("message:text", async (ctx) => {
  await ctx.reply(`Received: ${ctx.message.text}`);
});
```

Use it as a smoke test: it confirms the token resolved, the worker started, and updates are flowing.

## Inline buttons and callbacks

```javascript
$BOT.command("start", async (ctx) => {
  const keyboard = new grammy.InlineKeyboard()
    .text("Accept", "accept")
    .text("Cancel", "cancel");

  await ctx.reply("Do you want to continue?", { reply_markup: keyboard });
});

$BOT.on("callback_query:data", async (ctx) => {
  const action = ctx.callbackQuery.data;

  if (action === "accept") {
    await ctx.answerCallbackQuery({ text: "Accepted" });
    await ctx.editMessageText("Operation confirmed");
    return;
  }

  if (action === "cancel") {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.editMessageText("Operation cancelled");
  }
});
```

`callback_query` is one of the 29 update types the runtime subscribes to, so these handlers do fire. Pattern filters (`callbackQuery("literal")`, `/regex/`) are preferred over guard-and-return handlers: a bare `return` halts the whole middleware chain.

## Using application variables

```javascript
// Both forms work: direct name and via $_APP_VARS_.
const allowedChatId = $_APP_VARS_["$_VAR_ALLOWED_CHAT_ID"];

$BOT.on("message:text", async (ctx) => {
  if (String(ctx.chat.id) !== String(allowedChatId)) {
    await ctx.reply("No autorizado");
    return;
  }

  await ctx.reply("Acceso permitido");
});
```

Use application variables for environment-specific identifiers, feature flags, URLs, and secrets. Use `params` for non-sensitive per-bot configuration — remember `params` overrides AppVars with the same key.

## Calling internal OpenFusionAPI endpoints

```javascript
$BOT.command("status", async (ctx) => {
  // Replace the environment suffix of the path with `auto`; uFetchAutoEnv
  // substitutes the caller's environment at runtime.
  const uF = uFetchAutoEnv.auto("/api/system/api/apps-list/auto", true);
  const response = await uF.get();
  const data = await response.json();

  await ctx.reply(`Aplicaciones detectadas: ${Array.isArray(data) ? data.length : 0}`);
});
```

## Handling platform errors

```javascript
$BOT.on("message:text", async (ctx) => {
  try {
    await ctx.reply("ok");
  } catch (error) {
    if (error instanceof grammy.GrammyError) {
      ofapi.log({ message: `Telegram rejected the call: ${error.description}` });
    } else if (error instanceof grammy.HttpError) {
      ofapi.log({ message: `Could not reach Telegram: ${error.message}` });
    } else {
      throw error;
    }
  }
});
```

Uncaught handler errors are reported by the runtime as `bot_runtime_error`; the bot keeps running. A handler you register with `$BOT.catch(...)` runs first; the runtime appends its own `BOT_ERROR` logger, so you do not lose observability by handling errors yourself.

## Official plugins

```javascript
$BOT.use(grammyPlugins.autoRetry());
$BOT.use(grammyPlugins.conversations());
$BOT.use(grammyPlugins.hydrate());
$BOT.api.config.use(grammyPlugins.hydrateFiles($BOT_TOKEN));

const menu = new grammyPlugins.Menu("menu")
  .text("One", "one")
  .row()
  .text("Two", "two");
$BOT.use(menu);

$BOT.command("menu", async (ctx) => {
  await ctx.reply("Choose:", { reply_markup: menu });
});
```

`menu` and `conversations` require session middleware; `grammy.session()` with `grammy.MemorySessionStorage` is available but its state disappears on restart. ``fmt`` from `@grammyjs/parse-mode` is a formatting helper used as `` grammyPlugins.fmt`text` ``, not middleware. `@grammyjs/runner` and webhooks are not available: the worker owns the polling loop.

## New update types

```javascript
$BOT.on("edited_message", async (ctx) => {
  await ctx.reply("I saw your edit");
});

$BOT.on("inline_query", async (ctx) => {
  // Requires inline mode enabled in @BotFather.
  await ctx.answerInlineQuery([]);
});

$BOT.on("my_chat_member", async (ctx) => {
  // Bot added/removed/updated in a group.
});

$BOT.on("chat_join_request", async (ctx) => {
  await ctx.approveChatJoinRequest(ctx.from.id);
});
```

Telegram only sends these if the bot is configured for them (inline mode, payments, business) or has the required admin rights (`chat_member`, aggregate reactions).

## Token storage

Recommended: keep the token in an application variable and reference it from the bot row.

```json
{
  "idapp": "<application uuid>",
  "name": "My Telegram Bot",
  "provider": "telegram",
  "environment": "dev",
  "token": "$_VAR_TELEGRAM_TOKEN",
  "code": "$BOT.command(\"start\", async (ctx) => { await ctx.reply(\"ok\"); });"
}
```

The runtime resolves `$_VAR_TELEGRAM_TOKEN` against the AppVars of the bot's `environment` before creating the client. A literal token (anything not starting with `$_`) is also accepted.

## Notes

- All 29 update types of `@grammyjs/types` 5.2.0 are subscribed — the runtime fixes the full `allowed_updates` list. Telegram still has to send them: inline mode, payments and business features need BotFather configuration, and `chat_member` / aggregate reactions need admin rights.
- `message_reaction` exposes `ctx.messageReaction` (`message_id`, `chat`, `actor`, `old_reaction`, `new_reaction`). Telegram has no `getMessageReactions` method: only live updates are observable, so reactions added while the bot is stopped cannot be recovered.
- `poll_answer` only arrives for polls the bot created; a bot can never read a foreign poll. `stopPoll(chatId, messageId)` closes your poll and returns the official counts.
- `drop_pending_updates` is `true` on cold start and `false` on hot restart (token/code/variable change). Updates older than 24 h are discarded by Telegram regardless.
- Keep the top level of the script limited to registering handlers; it has a 10 s evaluation budget and no top-level `await`.
- `$_RETURN_DATA_` is not read for bots. There is no HTTP response.
- Verify a change in the logs (`get_system_logs` filtering `idendpoint = <idbot>`, event `bot_started`), not just in the tool response.
- Confirm `runtime_status` after testing, not `enabled`. `BACKOFF`/`QUARANTINED` means a recoverable failure that retries on its own; `DISABLED_ERROR` means three permanent failures (bad token or code that does not compile) — fix the cause with `upsert_bot` and the bot re-enables itself.
