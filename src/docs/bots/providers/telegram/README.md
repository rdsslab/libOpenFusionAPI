# Telegram Bot Provider

Telegram is the only bot provider the OpenFusionAPI runtime executes today. Bots are implemented with [grammY](https://grammy.dev) and run in a dedicated Worker thread per bot.

See the [bots namespace README](../../README.md) for the storage model, the lifecycle and the REST/MCP surface shared by every provider.

## How a Telegram bot starts

1. `BotLifecycleTask` picks up an enabled `ofapi_bot` row whose `provider` is `telegram`.
2. It resolves `token`: a value starting with `$_` is replaced by the application variable of the bot's `environment`; anything else is used literally. An empty token or a missing variable produces a `bot_token_error` log and the bot is not started.
3. It builds the sandbox variables as `{ ...appVars[environment], ...params, idapp }`.
4. `BotManager` spawns a Worker with `{ token, code, environment, app_env_vars }`.
5. The worker creates `globalThis.$BOT = new grammy.Bot($BOT_TOKEN)` and then evaluates the bot `code` in a `node:vm` context, with a **10 000 ms** budget for that evaluation.
6. It verifies the script left a valid `$BOT`, attaches its error handler, calls `api.getMe()` to validate the token, and starts long polling.

## Fixed polling configuration

The runtime starts the bot with a configuration you cannot override from bot code:

```js
start({
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
  handleSignals: false,
})
```

- Only `message` and `callback_query` updates are delivered. Handlers for `inline_query`, `edited_message`, `my_chat_member`, `poll`, `channel_post` and the rest **never fire**.
- Updates received while the bot was stopped, restarting or in cooldown are dropped.

## Sandbox surface

| Name | Description |
|---|---|
| `$BOT` | Pre-created `grammy.Bot`. Register handlers here. Never instantiate or start it yourself. |
| `$BOT_TOKEN` | Resolved token string. |
| `grammy` | Module namespace: `Bot`, `InlineKeyboard`, `Keyboard`, `GrammyError`, `HttpError`, … |
| `$_APP_VARS_` and direct names | Application variables for the bot's environment. |
| `params` keys | Merged over the AppVars — `params` wins on key collisions. |
| `idapp` | Owning application UUID. |
| Injected libraries | Same pool as the JS handler (`ofapi`, `uFetchAutoEnv`, `luxon`, …). Inspect with `handler_library_documentation` using `handler=JS`. |

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
