# Admin notifications (Telegram)

OpenFusionAPI can push proactive operational alerts to a Telegram group: intrusion
attempts, server errors, 4xx saturation, bot incidents and a periodic health digest.

## Architecture

```
ofapi_bot (Admin Notifications Bot)  ── on-demand replies + menu
        │   $BOT.api (grammY sandbox), calls /api/system endpoints with ofapi.genToken
        ▼

Interval tasks (timer/worker) ──► POST /api/system/admin/alerts/auto
  idtask 3 "Admin Alerts - events scan"  (interval 300 s)
  idtask 4 "Admin Alerts - system digest" (interval 3600 s)
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

`/subscribe` (run inside the target group by an administrator) writes the negative
group chat id into `$_VAR_ADMIN_GROUP_CHAT_ID` automatically.

## Modes of `POST /system/admin/alerts`

Body `{ "mode": "events" | "digest", "respond_inline": false, "window_hours": 24 }`.

- **events** (interval every 5 min) — scans the window since the cursor for:
  - intrusion attempts: `ofapi_log` rows with `log_level 3`, `status 401/429` and
    `message.type` in `possible_attack` | `posible_ataque`;
  - 5xx server errors, grouped by `method url`;
  - client errors: total 4xx, alerted when ≥ `$_VAR_ALERT_4XX_THRESHOLD`;
  - bot incidents from `ofapi_bot_log`: `bot_auto_disabled`, `bot_quarantined`,
    `bot_platform_outage_suspected`.
  Stays silent when nothing happened; advances the cursor in every run, so a window
  is never reported twice.
- **digest** (interval every hour) — reuses `fnGetSystemHealthStats`, formats apps,
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