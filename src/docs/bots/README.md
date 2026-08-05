# Messaging Bots

Long-running messaging bots are first-class entities in OpenFusionAPI, stored in the dedicated table `ofapi_bot`. They are **not** endpoints: nothing calls them over HTTP, and they have no `resource`, `method` or `access`.

There is no bot endpoint handler: a bot is a row in `ofapi_bot`, managed exclusively through the bot tools.

## Architecture

```
ofapi_bot row (enabled)
      │
      │  every 10 s: getActiveBots() + app AppVars for bot.environment
      ▼
BotLifecycleTask ──────────────► BotManager ──────────────► Worker (one per bot)
 src/lib/server/runtime/          src/lib/server/            src/lib/server/
 BotLifecycleTask.js              bot-manager/manager.js     bot-manager/worker.js
      │                                 │                          │
      │ starts / stops / restarts       │ config hash + failure     │ node:vm sandbox,
      │ auto-disables on repeat fail    │ policy (3 fails / 5 min)  │ provider client
      ▼
 log table (method = BOT, idendpoint = idbot)
```

- **One Worker thread per enabled bot.** A crashing bot cannot take the API down.
- **Restart on change.** The manager hashes `token` + `code` + app variables; any change restarts that bot on the next poll.
- **Auto-disable.** Three failures inside a 5-minute window set `enabled = false` on the row and apply a cooldown.

## Providers

| Provider | Status | Executed by the runtime | Library |
|---|---|---|---|
| `telegram` | active | yes | [grammY](providers/telegram/README.md) |
| `whatsapp` | planned | no | — |
| `ms_teams` | planned | no | — |

The `provider` column accepts any string, but only the providers listed as executed have a worker implementation. A row with any other provider is stored and listed, never started. The authoritative list lives in `manifest.json` (`providers[]`) and in `src/lib/server/bot-manager/providers.js` (`RUNTIME_SUPPORTED_PROVIDERS`).

## REST surface

All bot management goes through the system application (`idapp` `cfcd2084-95d5-65ef-66e7-dff9f98764da`). Routes are built as `/api/<app><resource>/<environment>`:

| Operation | Route | MCP tool |
|---|---|---|
| List / get | `GET /api/system/bots/prd` | `list_bots` |
| Create / update | `POST /api/system/bots/prd` | `upsert_bot` |
| Delete | `DELETE /api/system/bots/prd` | `delete_bot` |
| Enable / disable | `PATCH /api/system/bots/status/prd` | `enable_disable_bot` |
| General AI skill | `GET /api/system/bots/skill/prd` | `get_bot_skill` |
| Provider AI skill | `GET /api/system/bots/skill/provider/prd?provider=telegram` | `get_bot_provider_skill` |

## Token resolution

`ofapi_bot.token` accepts either a literal credential or a reference to an application variable — any value starting with `$_`, e.g. `$_VAR_TELEGRAM_TOKEN`. The runtime resolves the reference against the AppVars of the bot's `environment` right before starting the worker. A missing variable or an empty token produces a `bot_token_error` log and the bot is not started.

## Observability

Bot activity lands in the normal log table, so the usual tooling works:

- `method` = `BOT`
- `idendpoint` = the bot's `idbot`
- `url` = `telegram://bot/<username|idbot>`
- `client` = `telegram-api`
- `log_level` = 3 (full)

Events: `bot_started`, `bot_token_error`, `bot_startup_error`, `bot_runtime_error`, `bot_worker_crash`, `bot_auto_disabled`, `bot_restarting`, `bot_manage_error`. Each worker run shares a single `trace_id`.

Inside bot code, `ofapi.log(...)` is routed to the same table.

## Documentation layout

```
src/docs/bots/
  README.md            this file
  manifest.json        namespace contract + provider registry
  AI_SKILL.md          served by get_bot_skill
  providers/
    telegram/
      README.md        human guide
      manifest.json    provider contract
      AI_SKILL.md      served by get_bot_provider_skill
      examples.md      copy-paste bot code
```

`AI_SKILL.md` embeds the shared JavaScript core with `<!-- include: skills/JS_CORE.md -->`, expanded at read time by `src/lib/server/docsInclude.js`, so an agent gets one self-contained document per tool call.

## Backup and restore

Application backups carry their bots: `restoreAppFromBackup` restores `app.bots` through `upsertBot`, so a bot definition travels with its application (see `src/lib/db/app.js`).
