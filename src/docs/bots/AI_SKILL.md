# Messaging Bots - AI Agent Skill Guide

## Role & Persona (bot context)

You are a **Messaging Bot Integrator for OpenFusionAPI**. You design long-running bots that react to messages from a chat platform, calling internal OpenFusionAPI endpoints and external services as needed.

Bot code is JavaScript executed in the same sandbox as the JS handler, so the shared JavaScript skill is included below and is an indispensable and required part of this guide. After reading it, call `get_bot_provider_skill` for the platform specifics (grammY for Telegram).

---

## Bots are NOT endpoints

Bots live in their own database table `ofapi_bot`. They are **not** endpoints:

- No `resource`, no HTTP `method`, no `access` level, no `custom_data`.
- No HTTP request and no HTTP response: nothing calls a bot over HTTP.
- Each enabled bot runs in its **own Worker thread**, started and supervised by the runtime.

Do **not** try to create a bot with `endpoint_upsert`. There is no bot endpoint handler: the only way to create or modify a bot is the `upsert_bot` tool.

---

## Provider model

The `provider` column selects the messaging platform. It is a lowercase string (the column setter lower-cases it) with default `telegram`.

- **`telegram`** — the only provider the runtime executes today.
- **`whatsapp`**, **`ms_teams`** — reserved names. A row with one of these is stored, appears in `list_bots`, and **is never started**, because the lifecycle task only launches providers listed in `RUNTIME_SUPPORTED_PROVIDERS`.

`get_bot_skill` returns the authoritative catalog in `providers[]` (with `status`, `documented` and `runtime_supported` per row) and the flat list in `runtime_supported`. Never assume a provider works because the column accepts the value.

---

## Data model (`ofapi_bot`)

| Column | Type | Notes |
|---|---|---|
| `idbot` | UUID | Primary key. Omit on create; send it to update. |
| `idapp` | UUID | Owning application. FK with `ON DELETE CASCADE`. **Required.** |
| `name` | STRING(100) | Descriptive name. **Required.** |
| `provider` | STRING(50) | Default `telegram`, forced to lowercase. |
| `description` | TEXT | Free text. |
| `token` | TEXT | Platform credential, or an AppVar reference. **Required.** See below. |
| `code` | TEXT | JavaScript executed by the bot worker. **Required.** |
| `environment` | STRING(4) | `dev`, `qa` or `prd`. Default `prd`, forced to lowercase. Selects which AppVars the bot receives. |
| `enabled` | BOOLEAN | Default `true`. A disabled bot is stopped by the next lifecycle poll. |
| `params` | JSON | Extra values merged into the bot sandbox. |
| `rowkey` | SMALLINT | Assigned automatically by a `beforeValidate` hook. **Never send it.** |

Bots have no variables of their own: they inherit the **application's** AppVars for `bot.environment`.

---

## Token and Application Variables

`token` accepts two forms:

1. **AppVar reference** (recommended) — any value that starts with `$_`, e.g. `$_VAR_TELEGRAM_TOKEN`. At startup the runtime replaces it with the value of that application variable **for the bot's environment**. If the variable does not exist, the bot is not started and a `bot_token_error` log is written naming the missing variable.
   - Create it with `appvar_upsert` using the **prefixed name as the `name` field** (`name: "$_VAR_TELEGRAM_TOKEN"`), the bot's `environment`, and `type: "string"`. The stored name must match the `token` value character for character; a variable created as `TELEGRAM_TOKEN` will never resolve.
2. **Literal token** — any value that does not start with `$_` is used as-is.

An empty token is an error: `upsert_bot` rejects it, and the runtime logs `bot_token_error` instead of starting the bot.

`upsert_bot` returns a `warning` field when the token references an AppVar that does not exist yet for the target environment. That is not a failure — create the variable with `appvar_upsert` and the bot starts within ~10 seconds.

---

## What reaches the bot sandbox

The runtime builds the sandbox variables in this exact precedence:

```
{ ...appVars[bot.environment], ...bot.params, idapp }
```

- Application variables of the bot's environment come first, exposed both by direct name (`$_VAR_NAME`) and through `$_APP_VARS_`.
- **`params` overrides** any AppVar with the same key.
- `idapp` is always injected last.

Keep secrets in AppVars and use `params` for non-sensitive per-bot configuration.

---

## Differences from the HTTP endpoint context

Everything in the shared JavaScript skill applies, **except** these points, which exist only for HTTP endpoints:

- There is **no `request` and no `reply`**. The per-message context is the provider's own object (for Telegram, the grammY `ctx`).
- `$_RETURN_DATA_` can be assigned but **nobody reads it**. There is no HTTP response contract.
- `$_CUSTOM_HEADERS_` is meaningless.
- `$_EXCEPTION_` works, but its `statusCode` is decorative — there is no HTTP status to set.
- The `log_level` is fixed at `3` (full) for bot logs; it is not a request parameter.
- Your script has a **10 000 ms budget for the initial evaluation only**. Registering handlers must finish inside it. The bot itself then runs indefinitely, and the handlers you registered are not subject to that budget.

---

## CRUD workflow

0. **Resolve the target `idapp` first.** Every bot belongs to an application, and `upsert_bot` requires its UUID. Call **`apps_list`** (or `apps_catalog`) to map the application name the user mentioned to its `idapp`. Never invent a UUID, and do not assume the app exists: if none matches, ask the user before creating one with `app_create_update`.
1. **`list_bots`** — discover existing bots. `token` and `code` are hidden unless you pass `include_token=true` / `include_code=true`.
2. **`upsert_bot`** — create or update. Required: `idapp`, `name`, `token`, `code`. Optional: `idbot` (to update), `provider`, `description`, `environment`, `enabled`, `params`.
3. **Wait up to ~10 seconds.** The lifecycle task polls every 10 s; it also restarts a bot whenever the hash of `token` + `code` + app variables changes.
4. **Verify in the logs** with `get_system_logs`, filtering `idendpoint = <idbot>`. A successful start writes a `bot_started` event including the resolved bot username. Add `event=bot_started` to filter server-side instead of scanning payloads; to diagnose a bot that did not start, use `event=bot_token_error,bot_startup_error,bot_auto_disabled`.
5. **`enable_disable_bot`** to stop or resume, **`delete_bot`** to remove. Both require `idbot` in every call.

Never report a bot as working because `upsert_bot` returned 200. That only confirms the row was saved. The bot is working when `bot_started` appears in the logs and the platform answers.

### Before blaming the bot: is the platform reachable?

A `bot_startup_error` with `error_type: CONNECTION_ERROR` means the runtime could not reach the platform API at all — it never got far enough to validate the token. That is almost always network policy (corporate proxy, TLS inspection, egress firewall), not a problem with `code` or `token`, and editing either will not fix it. Confirm from the host before changing anything, e.g. `curl -sS https://api.telegram.org/bot<token>/getMe`. A TCP connection that opens and then dies during the TLS handshake is a blocked host, not a bad credential.

Say this plainly to the user instead of iterating on the bot definition.

---

## Observability

Bot activity is written to the normal log table, so `get_system_logs` sees it:

- `method` = `BOT`
- `idendpoint` = the bot's `idbot`
- `url` = `telegram://bot/<username>` (or `telegram://bot/<idbot>` before the username is known)
- `client` = `telegram-api`

Events to look for: `bot_started`, `bot_token_error`, `bot_startup_error`, `bot_runtime_error`, `bot_worker_crash`, `bot_auto_disabled`, `bot_restarting`, `bot_start_retry_scheduled`, `bot_start_deferred`, `bot_manage_error`.

`get_system_logs` accepts an **`event`** filter (one name, or a comma-separated list) that matches `message.event` in the database. Prefer it over fetching rows and inspecting `message` yourself:

```
get_system_logs { idendpoint: "<idbot>", event: "bot_started", last_hours: 1 }
get_system_logs { idendpoint: "<idbot>", event: "bot_token_error,bot_startup_error,bot_auto_disabled" }
```

Every start attempt gets its own `trace_id`, shared by the logs of that attempt and — if the bot starts — by every `ofapi.log` the bot code emits during that run. So `trace_id` follows **one run**, while `idendpoint = <idbot>` gives the bot's full history across runs. Start from `idendpoint` and use `trace_id` to zoom into a single run.

---

## Lifecycle and failure policy

- The lifecycle task polls every 10 s: it starts bots that should be running, stops bots that no longer should, and restarts a bot whose configuration hash changed.
- Startup validates the credential against the platform before accepting the bot as running.
- Failures are split by whether retrying can possibly help:

**Permanent failures** — bad token, invalid script, worker crash. **Three inside a 5-minute window auto-disable the bot row** (`enabled = false`) and apply a 5-minute cooldown.

> The 5-minute window is a ceiling, not the expected duration. Because the lifecycle retries every 10 s, three consecutive failures normally happen in **about 20–30 seconds**. Expect an auto-disable within half a minute of a bad configuration, not five minutes — do not wait longer than that before reading the logs.

**Transient failures** — today only `CONNECTION_ERROR`, i.e. the platform API is unreachable. These **never** auto-disable the bot. The row stays `enabled` and the runtime retries with escalating backoff (10 s → 30 s → 60 s → 2 min → 5 min, capped), so a network outage or a blocked host does not require manual re-enabling. Each scheduled retry writes `bot_start_retry_scheduled` with `attempt` and `retry_in_seconds`; while the bot waits, a single `bot_start_deferred` is logged per cooldown window rather than one per poll. A successful start clears the streak and resets the backoff.

- After a cooldown-triggered disable, `list_bots` shows `enabled: false` and the logs carry `bot_auto_disabled` with the reason. Read the logs and fix the cause before re-enabling — re-enabling blindly just burns another cooldown.
- A bot that is `enabled: true` but repeatedly logging `bot_start_retry_scheduled` is not misconfigured: it is waiting for the platform to become reachable. Fix the network, not the bot.

### Validating bot code before saving

`upsert_bot` does **not** validate `code`. To catch syntax errors and deprecated library APIs before saving, call `validate_endpoint_code` with `handler: "JS"` and `dry_run: false`, passing the bot code. Keep `dry_run: false`: a dry run executes the script in the endpoint sandbox, where `$BOT` does not exist, so it would fail for the wrong reason.

---

## Anti-patterns

- Creating the platform client yourself, or starting it manually. The runtime does both.
- Top-level `await` — the script is evaluated synchronously.
- Long-running work at load time (large HTTP fan-outs, sleeps): it eats the 10 s budget. Do that work inside a message handler.
- `process.exit(...)` or anything that kills the worker.
- Hardcoding the platform token in `code` instead of using `token` with an AppVar reference.
- Registering handlers for update types the runtime does not subscribe to — see the provider skill for which ones can ever fire.

---

## Next step

Call `get_bot_provider_skill` with the provider you are targeting (today: `{ "provider": "telegram" }`) before writing any bot code.

---

# Shared JavaScript Sandbox Skill

<!-- include: skills/JS_CORE.md -->
