# Telegram Bot Provider

Telegram is the only bot provider the OpenFusionAPI runtime executes today. Bots are implemented with [grammY](https://grammy.dev) and run in a dedicated Worker thread per bot.

See the [bots namespace README](../../README.md) for the storage model, the lifecycle and the REST/MCP surface shared by every provider.

## How a Telegram bot starts

1. `BotLifecycleTask` picks up an enabled `ofapi_bot` row whose `provider` is `telegram`.
2. It resolves `token`: a value starting with `$_` is replaced by the application variable of the bot's `environment`; anything else is used literally. An empty token or a missing variable produces a `bot_token_error` log and the bot is not started.
3. It builds the sandbox variables as `{ ...appVars[environment], ...params, idapp }`.
4. `BotManager` spawns a Worker with `{ token, code, environment, app_env_vars }`.
5. The worker creates the `grammy.Bot` instance, injects it as `$BOT` / `globalThis.$BOT`, calls `bot.init()` once (which validates the token), and then evaluates the bot `code` in a `node:vm` context with a **10 000 ms** budget. Because `init()` happens first, `bot.botInfo` and `ctx.me` are available while handlers are registered.
6. It verifies the script left a valid `$BOT`, chains the bot's own `$BOT.catch` (if any) ahead of the runtime `BOT_ERROR` logger, and starts long polling.

## Fixed polling configuration

The runtime starts the bot with a configuration you cannot override from bot code:

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

- The list is the complete `Update` shape of `@grammyjs/types` 5.2.0. It is explicit because Telegram silently omits `chat_member`, `message_reaction` and `message_reaction_count` from its default list. It cannot be overridden from bot code or `params`.
- Receiving an update type still requires Telegram to send it: inline mode, payments, Business Messages and some subscription events must be enabled for the bot in @BotFather; `chat_member` and aggregate reactions require the bot to be an administrator.
- Reactions are push-only (`ctx.messageReaction` / `ctx.messageReactionCount`); Bot API cannot read reactions added earlier, so only reactions received while the bot is running are visible.
- `poll_answer` is sent only for polls **the bot created**. Telegram does not expose the votes of polls sent by users or other bots; `stopPoll(chatId, messageId)` closes one of your polls and returns the official counts.
- `drop_pending_updates` is `true` on a cold start and `false` on a hot restart (token/code/variable change), so messages arriving during a configuration restart are not thrown away. Updates older than 24 h are discarded by Telegram regardless.
- Webhooks are not supported: the worker owns long polling and calling `setWebhook` would stop `getUpdates`.

## Sandbox surface

| Name | Description |
|---|---|
| `$BOT` | Pre-created `grammy.Bot`. Register handlers here. Never instantiate or start it yourself. |
| `$BOT_TOKEN` | Resolved token string. |
| `grammy` | Full module namespace: `Bot`, `InlineKeyboard`, `Keyboard`, `GrammyError`, `HttpError`, plus built-in helpers `session`, `lazySession`, `webhookCallback`, `Composer`, `matchFilter`, `InputFile`, `BotError`. |
| `grammyPlugins` | Official plugins injected as one namespace: `autoRetry`, `conversations`, `createConversation`, `Menu`, `I18n`, `fmt`, `hydrate`, `hydrateFiles`, `Router`, `emoji`. |
| `$_APP_VARS_` and direct names | Application variables for the bot's environment. |
| `params` keys | Merged over the AppVars — `params` wins on key collisions. |
| `idapp` | Owning application UUID. |
| Injected libraries | Same pool as the JS handler (`ofapi`, `uFetchAutoEnv`, `luxon`, …). Inspect with `handler_library_documentation` using `handler=JS`. |

## Official plugins

`grammyPlugins` gives access to the official packages that are installed in the runtime. Register them on `$BOT` as usual:

```js
$BOT.use(grammyPlugins.autoRetry());
$BOT.use(grammyPlugins.hydrate());
$BOT.api.config.use(grammyPlugins.hydrateFiles($BOT_TOKEN));
const menu = new grammyPlugins.Menu("main");
$BOT.use(menu);

// fmt is a formatting helper, not middleware. Use it inside a handler.
$BOT.command("hi", async (ctx) => {
  await ctx.reply(grammyPlugins.fmt`Hello, ${ctx.from.first_name}!`);
});
```

| Key | Package | Purpose |
|---|---|---|
| `autoRetry` | `@grammyjs/auto-retry` | Retry `429` responses respecting `retry_after`. |
| `conversations`, `createConversation` | `@grammyjs/conversations` | Multi-step conversational handlers. |
| `Menu` | `@grammyjs/menu` | Persistent inline menus. |
| `I18n` | `@grammyjs/i18n` | Localisation. |
| `fmt` | `@grammyjs/parse-mode` | Safe HTML/MarkdownV2 formatting. |
| `hydrate` | `@grammyjs/hydrate` | Add helper methods to `ctx` entities. |
| `hydrateFiles` | `@grammyjs/files` | Download files through the Bot API. |
| `Router` | `@grammyjs/router` | Route updates by custom state. |
| `emoji` | `@grammyjs/emoji` | Telegram emoji helpers. |

`menu` and `conversations` need session middleware (`grammy.session()` with `grammy.MemorySessionStorage`); that state lives in the worker process and is lost on restart. Use your own SQL-backed storage if the flow must survive a restart. `@grammyjs/runner` is deliberately excluded because the worker owns the polling loop.

## Failure handling

| Error type | Cause |
|---|---|
| `bot_token_error` | Empty token or unresolved AppVar reference. Bot not started. |
| `INVALID_TOKEN` | Telegram answered 401 to `getMe()`. Token wrong or revoked. |
| `FORBIDDEN` | Telegram answered 403/404. The bot was blocked or deleted. |
| `CODE_ERROR` | Script does not compile, or left no valid `$BOT`. |
| `CONNECTION_ERROR` | Network failure reaching the Telegram API. |
| `RATE_LIMITED` | Telegram answered 429. Its `retry_after` is honoured. |
| `PROVIDER_ERROR` | Telegram answered 5xx. |
| `STARTUP_ERROR` | Unclassified startup failure. |
| `BOT_ERROR` | An update handler threw. The bot keeps running. |

Recoverable failures (`CONNECTION_ERROR`, `RATE_LIMITED`, `PROVIDER_ERROR`, `STARTUP_ERROR`) never
disable the bot: it is retried with backoff and then quarantined with slow probing, indefinitely.
Three consecutive permanent failures (`INVALID_TOKEN`, `FORBIDDEN`, `CODE_ERROR`) set
`enabled = false` with `disabled_by = 'system'`; correcting the token or code via `upsert_bot`
re-enables it automatically.

## Creating a bot

1. Get a token from [@BotFather](https://t.me/BotFather).
2. Store it as an application variable (recommended), e.g. `$_VAR_TELEGRAM_TOKEN`, for the target environment.
3. Create the bot row with `upsert_bot`, referencing the variable in `token`.
4. Wait ~10 s and check the logs (`get_system_logs`, `idendpoint = <idbot>`) for `bot_started`.
5. Send `/start` in Telegram.

Ready-to-use `code` snippets are in [examples.md](./examples.md). The agent-facing guide is [AI_SKILL.md](./AI_SKILL.md), served by the `get_bot_provider_skill` MCP tool.
