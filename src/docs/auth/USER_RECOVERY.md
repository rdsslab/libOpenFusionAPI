# User Management & Password Recovery

This guide documents the **user lifecycle and password flows** of OpenFusionAPI: user CRUD,
self-service password change, admin password reset, and the one-time-code (OTP) password
recovery delivered by **email and/or Telegram**. It is oriented to operators, developers and
support staff.

- Context: the user/auth endpoints live in the `system` application (environment `prd`), handler
  `FUNCTION`.
- Flow diagrams (human reference): see [../flows/AUTH.md](../flows/AUTH.md).
- Security baseline: see [../security/SECURITY_CERTIFICATE.md](../security/SECURITY_CERTIFICATE.md).

---

## 1. Users and the `change_password` flag

Every internal platform user is a row of the `ofapi_user` table. Two flags matter for password
flows:

| Flag | Meaning |
|---|---|
| `enabled` | If `false`, the user cannot log in and receives no recovery code. |
| `change_password` | If `true`, the password must be changed at next login. It is set to `true` by default on creation and by an **admin reset**; it is cleared when the user changes the password or redeems a recovery OTP. The client reads it from the login response and is expected to force the change. |

---

## 2. Endpoint surface

All routes below belong to the `system` app in `prd`.

| Route | Method | Access | MCP tool | Purpose |
|---|---|---|---|---|
| `/system/login` | POST | 0 (public) | — | Authenticate and obtain a bearer token. |
| `/users/list` | GET | 2 (Bearer) | `list_users` | List system users (iduser, username, name, email, ctrl). |
| `/user/create` | POST | 2 (Bearer) | `user_create` | Create an internal user. |
| `/user/update` | POST | 2 (Bearer) | `user_update` | Update a user by `iduser` (never `iduser`/`username`). |
| `/user/delete` | POST | 2 (Bearer) | `user_delete` | Permanently delete a user. |
| `/user/changepassword` | POST | 2 (Bearer) | `user_change_password` | **Self-service** change with validation of the old password. Any authenticated user. |
| `/user/resetpassword` | POST | 2 (Bearer) | `user_reset_password` | **Admin** reset without the current password; sets `change_password=true`. |
| `/user/recovery/options` | GET | 0 (public) | — | Which recovery channels (email/telegram) are globally enabled. |
| `/user/forgotpassword` | POST | 0 (public) | — | Request a 6-digit OTP for password recovery. |
| `/user/resetpassword/confirm` | POST | 0 (public) | — | Redeem the OTP and set a new password. |
| `/user/linktelegram` | POST | 2 (Bearer) | — | Link the Telegram chat to the authenticated user. |
| `/user/recoverycleanup` | POST | 2 (Bearer) | — | Delete consumed/expired recovery requests (maintenance). |

> The recovery endpoints are intentionally **not** exposed as MCP tools: the flow is
> user-facing and anti-enumeration by design.

---

## 3. Password recovery by OTP (email / Telegram)

The recovery flow is **self-service**: a user who does not know their password can request a
6-digit one-time code that expires in 30 minutes, is single-use, and tolerates up to 5 attempts.

### 3.1 Requesting a code — `POST /user/forgotpassword`

Body (JSON):

```json
{
  "username": "jdoe",
  "channel": "email",
  "environment": "prd"
}
```

`channel` (`email` or `telegram`) is the **preferred** channel; `environment` selects the
AppVars that configure the channels (default `prd`). Behavior:

1. A generic message is always returned: **the response never reveals whether the account
   exists, which channel was used, or whether the send succeeded** (anti-account enumeration).
2. A channel is *viable* only when:
   - **email** → the `email` channel is enabled **and** the user has an `email`.
   - **telegram** → the `telegram` channel is enabled **and** the user has linked a Telegram
     chat (`custom_data.telegram_chat_id`).
3. Channel selection: starts from the requested channel; falls back to the other channel when
   the preferred one is not viable; falls back again if the first delivery attempt fails.
   An OTP is **never** sent through both channels at once.
4. Rate limit: **5 requests per 15 minutes per `ip::username`** (in-memory). Blocked requests
   are silently answered with the generic response and **no code is generated**.

Response (always 200):

```json
{ "success": true, "message": "If the account exists and the selected channel is available, you will receive a verification code.", "channel": "email" }
```

### 3.2 Redeeming the code — `POST /user/resetpassword/confirm`

Body (JSON):

```json
{ "username": "jdoe", "otp": "482913", "newPassword": "Str0ng#Passw0rd" }
```

- The OTP must be the current, unused, unexpired one for the user. Requesting a new code
  invalidates any previous pending code.
- A wrong OTP increments the attempt counter; after **5 failed attempts** the request is
  marked used and further attempts fail.
- The new password must satisfy the platform security policy (length, case, digit and special
  character).
- On success the password is updated, `change_password` is cleared and the request is marked
  used. Errors are returned as `400` with `error: "INVALID_OTP"` or `"WEAK_PASSWORD"` (plus a
  descriptive message).

---

## 4. Self-service password change

Any **authenticated** user can change their own password (`/user/changepassword`):

```json
{ "username": "jdoe", "oldPassword": "Old@Pass123", "newPassword": "New@Pass456" }
```

`oldPassword` is validated, the new password must differ from the old one and satisfy the
security policy, and `change_password` is set to `false` on success. This endpoint is reachable
even when the platform would otherwise force a password change on login.

---

## 5. Admin password reset

An administrator can set a new password **without knowing the current one**
(`/user/resetpassword`):

```json
{ "iduser": 7, "newPassword": "Temp@Pass123" }
```

This is appropriate for help-desk flows: the admin assigns a temporary password and the user is
forced to change it on next login (`change_password=true`). To change their own password the
user should use `/user/changepassword` (section 4).

---

## 6. Linking Telegram for recovery delivery

To receive recovery codes through Telegram, the user links their chat to their account once
(`/user/linktelegram`). The bot itself drives this via `/link` (see section 8).

```json
{ "chat_id": 123456789 }
```

The `chat_id` is stored in the authenticated user's `custom_data.telegram_chat_id`. Only the
account owner can link their own chat (the request must be authenticated).

---

## 7. Configuration (AppVars of the `system` app)

Recovery is configured through application variables of the `system` app, per environment:

| AppVar | Type | Purpose |
|---|---|---|
| `$_VAR_EMAIL_TRANSPORT` | json | `nodemailer` SMTP transport, e.g. `{ "host": "smtp.example.com", "port": 587, "secure": false, "auth": { "user": "...", "pass": "..." } }`. A channel is enabled only if this has a non-empty `host`. |
| `$_VAR_EMAIL_FROM` | string | Sender address for recovery emails. Falls back to `transport.from` or the SMTP `auth.user`. |
| `$_VAR_TELEGRAM_TOKEN` | string | Telegram Bot API token (share it with the Recovery bot `token`). The channel is enabled only if this is non-empty. |
| `$_VAR_RESET_EMAIL_ENABLED` | boolean | Master switch; **default enabled** when absent. |
| `$_VAR_RESET_TELEGRAM_ENABLED` | boolean | Master switch; **default enabled** when absent. |

Factory seeds: `$_VAR_EMAIL_TRANSPORT` and `$_VAR_EMAIL_FROM` are seeded with demo values and
`$_VAR_TELEGRAM_TOKEN` with `PLACEHOLDER_REEMPLAZAR_CON_TOKEN_REAL` — all three must be replaced
with real values before using the flow. See [AppVar guide](../skills/APPVARS.md).

---

## 8. Recovery Password Bot (Telegram)

The system app seeds a Telegram bot named **Recovery Password Bot**
(`idbot 684e37c0-8135-4e68-ab6d-60d3f59b2d76`, provider `telegram`, environment `prd`) whose
`token` references `$_VAR_TELEGRAM_TOKEN`. It is a first-class bot: it must be started and
diagnosed exactly like any other bot, see [../bots/README.md](../bots/README.md) and
[../bots/providers/telegram/README.md](../bots/providers/telegram/README.md).

Commands:

| Command | Purpose |
|---|---|
| `/start` | Greeting + command list. |
| `/help` | Command list. |
| `/cancel` | Abort the current conversation. |
| `/link` | Link this chat to a user account (asks username + password, logs in and stores the chat). Required before `/forgot` can deliver over Telegram. |
| `/forgot` | Request a password recovery code (asks username; the server delivers by email or Telegram). |
| `/changepassword` | Change the user password (asks username, current password, new password, confirm). |
| `/health` | Reports the system status endpoint. |

The bot is a **stateless conversation**: it keeps an in-memory `Map` of chat → step. `link`,
`forgot` and `changepassword` run multi-step dialogues; if `$_VAR_RESET_TELEGRAM_ENABLED` is
turned off the bot still answers, but delivery is decided by the server (so no Telegram OTP will
be produced). Remember the sandbox rules: the worker pre-creates `$BOT`, never instantiate or
`start()` it yourself.

---

## 9. Maintenance: cleanup of recovery requests

Consumed or expired recovery requests accumulate in `ofapi_password_recovery`. They are removed
by `POST /user/recoverycleanup`, which is scheduled automatically by a seeded **interval task**
that runs a cron `0 3 * * *` (America/Guayaquil). Its runtime is governed by the interval task
engine, see [../interval_tasks/README.md](../interval_tasks/README.md).

---

## 10. Security considerations

- **OTP storage:** the code is stored only as an HMAC-SHA256 hash; plaintext never persists.
  Missing `OTP_HASH_SECRET` falls back to a secret derived from `JWT_KEY`.
- **Anti-enumeration:** `/user/forgotpassword` always answers 200 with a generic message,
  whether or not the account exists or the delivery failed. User existence is never exposed.
- **Rate limiting:** each `ip::username` pair is limited to 5 recovery requests per 15 minutes
  (in-memory medium, separate from the global authentication brute-force limiter described in
  the security certificate).
- **Brute-force:** OTPs are single-use, expire in 30 minutes, and are burned after 5 failed
  attempts.
- **Channel isolation:** an OTP is delivered through one channel only; the alternative channel
  is used only as a fallback for a failed delivery, and only when that channel is viable.

---

📌 *This guide covers the internal user and password flows. For endpoint creation or the handler
reference, see [../endpoint/README.md](../endpoint/README.md) and
[../handlers/README.md](../handlers/README.md).*