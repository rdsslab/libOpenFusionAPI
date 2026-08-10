# Messaging Bots

Long-running messaging bots are first-class entities in OpenFusionAPI, stored in the dedicated table `ofapi_bot`. They are **not** endpoints: nothing calls them over HTTP, and they have no `resource`, `method` or `access`.

There is no bot endpoint handler: a bot is a row in `ofapi_bot`, managed exclusively through the bot tools.

## Architecture

```
ofapi_bot row (enabled = user intent)
      │
      │  every 10 s: getActiveBots() + app AppVars for bot.environment
      ▼
BotLifecycleTask ──────────────► BotManager ──────────────► Worker (one per bot)
 src/lib/server/runtime/          src/lib/server/            src/lib/server/
 BotLifecycleTask.js              bot-manager/manager.js     bot-manager/worker.js
      │                                 │  + failurePolicy.js      │
      │ starts / stops / restarts       │ config hash + failure     │ node:vm sandbox,
      │ persists runtime_status         │ classification, backoff   │ provider client
      │ detects platform outages        │ quarantine, disable       │
      ▼
 log table (method = BOT, idendpoint = idbot)
```

- **One Worker thread per enabled bot.** A crashing bot cannot take the API down.
- **Restart on change.** The manager hashes `token` + `code` + app variables; any change restarts that bot on the next poll.
- **`enabled` is intent, `runtime_status` is reality.** The runtime never clears `enabled` for a recoverable failure. Observed health lives in its own columns (`runtime_status`, `failure_count`, `last_error_type`, `next_retry_at`, …), persisted so it survives a process restart.
- **Recoverable failures never disable.** Network, DNS, `429` and provider `5xx` produce exponential backoff with jitter (10 s → 5 min), then quarantine (15/30/60 min) that probes **indefinitely**. The bot recovers on its own once the cause clears.
- **Permanent failures do disable — reversibly.** A revoked token or code that does not compile disables the row after 3 attempts with `disabled_by = 'system'`. Correcting the token or code via `upsert_bot` re-enables it automatically.
- **Stability window.** A start counts as consolidated only after 60 s up, so a bot that crash-loops accumulates failures instead of resetting its streak on every restart.
- **Platform outages.** If ≥3 bots exist and half or more fail with recoverable errors at once, the runtime logs one `bot_platform_outage_suspected`, freezes quarantine escalation and pins the backoff at 5 min until any bot starts.

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

Events: `bot_started`, `bot_token_error`, `bot_startup_error`, `bot_runtime_error`, `bot_worker_crash`, `bot_start_retry_scheduled`, `bot_start_deferred`, `bot_quarantined`, `bot_auto_disabled`, `bot_restarting`, `bot_manage_error`, `bot_platform_outage_suspected`, `bot_platform_outage_cleared`. Each worker run shares a single `trace_id`.

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

### Per-bot version history

Every bot keeps its own change history in `ofapi_bot_bkp` (`src/lib/db/bot_backup.js`), the same strategy the `endpoint` model uses with `ofapi_endpoint_bkp`:

- A version is written on every `upsertBot` and immediately **before** every `deleteBot`.
- Versions are deduplicated by a sha256 hash of the snapshot, so saving the same configuration twice does not create a new row. There is no pruning: the history grows only when the configuration really changes.
- The observed runtime state (`runtime_status`, `failure_count`, `last_error_*`, …) is stripped from the snapshot. It is diagnostics written by the `BotLifecycleTask`, not configuration — including it would create a version on every telemetry heartbeat and a restore would overwrite the bot's current health with a stale one.
- The table has **no foreign key** against `ofapi_bot` on purpose: the history survives the deletion of the bot, so `restoreBotFromBackup` can recreate a deleted bot with the same `idbot`.
- The snapshot stores the bot's `token`, which is why the history endpoints are admin-only (`access: 2`) and why `bot_change_history` is lightweight by default.

Restoring re-runs the upsert, records the restore as one more version (so the configuration you replaced is still recoverable), and clears the manager backoff so the worker restarts right away.

MCP tools: `bot_change_history` (list versions) and `bot_restore_version` (roll back to an `idbackup`). In the GUI, the bot editor has a **Backups** section that loads a version into the form so you can review it before saving.

### Application backups

Application backups also carry their bots: `restoreAppFromBackup` restores `app.bots` through `upsertBot`, so a bot definition travels with its application (see `src/lib/db/app.js`). Because it goes through `upsertBot`, each restored bot also gets a version in its own history.
