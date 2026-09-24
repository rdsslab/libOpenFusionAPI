# Admin alerts (system app - server parametrization)

The **system** application can push proactive operational alerts to a Telegram group:
intrusion attempts, server errors, 4xx saturation, bot incidents and a periodic health
digest. This is server-side parametrization of the `system` app, **not** a reusable
Telegram bot pattern — it is documented here (see `system/README.md`), separate from the
messaging bot skills.

## Architecture

```
ofapi_bot (Admin Notifications Bot)  ── on-demand replies + menu
        │   $BOT.api (grammY sandbox), calls /api/system endpoints with ofapi.genToken
        ▼

Interval tasks (timer/worker) ──► POST /api/system/admin/alerts/auto
  idtask 3 "Admin Alerts - events scan"  (interval 60 s)
  idtask 4 "Admin Alerts - system digest" (interval 86400 s)
        │   app system token (getSystemToken), params.data = { mode }
        ▼
fnAdminAutoAlerts  (src/lib/server/functions/system/prd/alerts/index.js)
        │   reads ofapi_log + ofapi_bot_log + AppVars in-process
        ▼
sendTelegramMessage  (src/lib/server/functions/system/prd/user/sendTelegramMessage.js)
        ▼
Telegram group  ($_VAR_ADMIN_GROUP_CHAT_ID)
```

Proactive sends never live in the bot worker: an interval task runs the endpoint,
which does the work in the main process. The bot is only the on-demand surface for
querying (`/health`, `/errors`, `/intrusions`, `/logs`) and for managing the
subscription (`/subscribe`, `/unsubscribe`).

## Configuration (AppVars, app `system`, env `prd`)

| Variable | Seed | Meaning |
|---|---|---|
| `$_VAR_TELEGRAM_TOKEN` | `PLACEHOLDER_REEMPLAZAR_CON_TOKEN_REAL` | Bot token (shared with the recovery bot) |
| `$_VAR_ADMIN_GROUP_CHAT_ID` | `""` | Chat id of the admin group; empty = notifications are skipped |
| `$_VAR_ADMIN_ALERT_CURSOR` | `""` | JSON `{"scanned_up_to":"<ISO>"}` written by the events scan (dedup) |
| `$_VAR_ALERT_4XX_THRESHOLD` | `20` | Number of 4xx responses in a window that triggers the "elevated client errors" alert |
| `$_VAR_TELEGRAM_ERROR_NOTIFY_CODES` | `""` | CSV of status codes matched by the events scan (e.g. `5xx,4xx`, or explicit `500,502,429`). Empty = `5xx`. |
| `$_VAR_TELEGRAM_ERROR_NOTIFY_SYSTEM_ADMINS` | `true` | Boolean. `true` or empty (default) **fans out** the report to every system admin with `ctrl.as_admin` and `custom_data.telegram_chat_id`, in addition to the group. Only `false`/`0`/`off` disables it (group only). |
| `$_VAR_SERVER_STARTUP_NOTIFY` | `"on"` | `"on"` (default) or `"off"`. Controls the auto-notification sent to the administrators when the server starts (see `POST /system/admin/startup` below). |

`/subscribe` (run inside the target group by an administrator) writes the negative
group chat id into `$_VAR_ADMIN_GROUP_CHAT_ID` automatically.

## Fan-out to system admins

When `$_VAR_TELEGRAM_ERROR_NOTIFY_SYSTEM_ADMINS` resolves to `true` (or is empty/unset),
every report is sent to each recipient in the fan-out list:

- the admin group (`$_VAR_ADMIN_GROUP_CHAT_ID`), when set, plus
- every system user with `ctrl.as_admin === true` that has `custom_data.telegram_chat_id`
  set, resolved through `fnGetUsersList` and deduplicated.

The group is always part of the list when `$_VAR_ADMIN_GROUP_CHAT_ID` is not empty.
Only the explicit values `false`, `0` or `off` disable the individual-admins fan-out
(group only); any other value (empty string, `true`, `1`, `on`) keeps it enabled.
`.telegram_chat_id` detection uses `user.ctrl.as_admin`; users without that flag are
never notified individually even if they have a chat id.

The fan-out is best-effort: a failure to load the user list (e.g. the `system` app
tree being temporarily unavailable) logs `[admin alerts] fan-out admins list failed`
and still delivers to the group. Delivery to each recipient is logged as
`sendReportFanOut` per chat id.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No report but errors exist | `$_VAR_ADMIN_GROUP_CHAT_ID` empty and `$_VAR_TELEGRAM_ERROR_NOTIFY_SYSTEM_ADMINS` set to `false`/`0`/`off` with no individual admins configured → no recipients (`NO_RECIPIENTS`). Set the group or enable the fan-out. |
| `NO_TOKEN` | `$_VAR_TELEGRAM_TOKEN` empty or still `PLACEHOLDER...`; replace with a real bot token. |
| `NO_CHAT_ID` | A recipient exists but its chat id is empty; check `$_VAR_ADMIN_GROUP_CHAT_ID` / `custom_data.telegram_chat_id`. |
| Only the group receives it | Individual admins skipped; confirm their users have `ctrl.as_admin === true` and `custom_data.telegram_chat_id`. |
| Too many/few status codes reported | Adjust `$_VAR_TELEGRAM_ERROR_NOTIFY_CODES` (CSV) e.g. `5xx,4xx`, `500,502,429`; empty defaults to `5xx`. |

## Modes of `POST /system/admin/alerts`

Body `{ "mode": "events" | "digest", "respond_inline": false, "window_hours": 24 }`.

- **events** (interval every 60 s) — scans the window since the cursor for:
  - intrusion attempts: `ofapi_log` rows with `log_level 3`, `status 401/429` and
    `message.type` in `possible_attack` | `posible_ataque`;
  - 5xx server errors, grouped by `method url`;
  - client errors: total 4xx, alerted when ≥ `$_VAR_ALERT_4XX_THRESHOLD`;
  - bot incidents from `ofapi_bot_log`: `bot_auto_disabled`, `bot_quarantined`,
    `bot_platform_outage_suspected`.
  Stays silent when nothing happened; advances the cursor in every run, so a window
  is never reported twice.
- **digest** (interval every 24 h) — reuses `fnGetSystemHealthStats`, formats apps,
  endpoints and log metrics over the last `window_hours`.

`respond_inline: true` returns the composed message in `report_text` instead of
sending it to the group (used by `/intrusions` and `/health` on demand).

## Security notes

- The endpoint is `access 2` (system app). Interval tasks authenticate with the
  in-memory system token; interactive calls need an admin token
  (`ofapi.genToken({ admin: { username: "openfusionapi", ctrl: { as_admin: true } } })`).
- `/subscribe` only accepts the request in a group when the sender is
  `administrator`/`creator` of that group.
- A placeholder `$_VAR_TELEGRAM_TOKEN` or an empty group chat id make the endpoint
  skip sending (reported as `status: "skipped"`, `reason: NO_TOKEN`/`NO_CHAT_ID`).

## Server startup notification (`POST /system/admin/startup`)

Every time the server starts, if a Telegram bot is configured (`$_VAR_TELEGRAM_TOKEN`
resolves to a real token, not `PLACEHOLDER...`), the server automatically notifies the
administrators with the general server data. This is triggered fire-and-forget from the
boot sequence (a few seconds after `fastify.listen()`), so it does not delay startup.

The message is composed by `fnAdminStartupNotify` (same module as the alerts) and
includes: timestamp, PID, version, uptime, exposed environments, enabled bots, total
apps, endpoints (total/enabled/MCP), recent log volume, and CPU/RAM (best-effort).

Recipients use the same fan-out as the alerts: the admin group
(`$_VAR_ADMIN_GROUP_CHAT_ID`) plus every system admin with `ctrl.as_admin === true`
and `custom_data.telegram_chat_id` (see "Fan-out to system admins" above).

- `$_VAR_SERVER_STARTUP_NOTIFY = "off"` disables the automatic boot notification
  (endpoint responds `status: "disabled"`, `reason: "NOTIFY_OFF"`).
- A placeholder/empty token responds `status: "skipped"`, `reason: "NO_TOKEN"` and
  nothing is sent.
- When there are no recipients (no group and no individual admins) it responds
  `status: "skipped"`, `reason: "NO_RECIPIENTS"`.
- `respond_inline: true` returns the composed message in `report_text` instead of
  sending it (used for on-demand previews).
