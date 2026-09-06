# Authentication & User Flows

- [1. Login (`/system/login`)](#1-login--systemlogin)
- [2. Access decision by `access` level](#2-access-decision-by-access-level)
- [3. Authentication rate limiting (brute-force)](#3-authentication-rate-limiting-brute-force)
- [4. Password recovery — request OTP (`/user/forgotpassword`)](#4-password-recovery--request-otp)
- [5. Password recovery — redeem OTP (`/user/resetpassword/confirm`)](#5-password-recovery--redeem-otp)
- [6. Change & reset password](#6-change--reset-password)
- [7. Telegram recovery bot — conversation state machine](#7-telegram-recovery-bot--conversation-state-machine)

Source references: `src/lib/server/auth.js`, `src/lib/server/auth_service.js`,
`src/lib/server/runtime/RateLimitService.js`, `src/lib/db/user.js`,
`src/lib/server/functions/system/prd/user/*`. Human guide: [../auth/USER_RECOVERY.md](../auth/USER_RECOVERY.md).

---

## 1. Login (`/system/login`)

```mermaid
flowchart TD
    A["POST /system/login (FUNCTION → fnLogin)"] --> B["getUserPasswordTokenFromRequest"]
    B --> CRED{"Authorization header scheme"}
    CRED -- "Basic" --> B1["Base64 decode → username:password"]
    CRED -- "Bearer" --> B2["JWT decode (peek claims)<br/>optional custom jwt_key for api clients"]
    CRED -- "none" --> B3["Cookie OFAPI_TOKEN → checkToken"]
    B1 --> LOGIN["await login(username, password)"]
    B2 --> LOGIN
    B3 --> LOGIN

    LOGIN --> Q["User.findOne<br/>username + EncryptPwd(password)<br/>enabled, start/end date window"]
    Q --> U{"User found?"}
    U -- "no" --> BAD["customError(2) →<br/>401 { login: false }"]
    U -- "yes" --> TOK["tokenSeconds = exp_time (default 3600)<br/>GenToken(admin) access token<br/>GenToken(refresh_token, 3600)"]
    TOK --> LAST["update last_login"]
    LAST --> CLEAR["setCookie OFAPI_TOKEN=''<br/>maxAge 5 (clears stale cookie)"]
    CLEAR --> OK{"user.login truthy?"}
    OK -- "yes" --> COOK["Header Authorization: Bearer token<br/>setCookie OFAPI_TOKEN=token<br/>(httpOnly, Secure if https, sameSite Lax)"]
    COOK --> R200["200 { login, user, token,<br/>refresh_token, exp_seconds }"]
    OK -- "no" --> BAD
```

> `change_password` is returned in the user payload (it is **not** enforced server-side on
> login); the client is expected to force the change flow when `true`.

---

## 2. Access decision by `access` level

```mermaid
flowchart TD
    A["AuthService.check_auth(handler, request, reply)"] --> PUB{"access == 0?"}
    PUB -- "yes" --> PUBOK["Public — skip auth entirely"]
    PUB -- "no" --> EXTR["getUserPasswordTokenFromRequest"]

    EXTR --> SYS{"handler.params.app == 'system'?"}
    SYS -- "yes" --> SYSB["check_auth_Bearer (see below)"]
    SYSB -- "pass" --> ATTS["attach request.openfusionapi.user"]
    SYSB -- "fail" --> R401S["401 System API requires a valid Token"]

    SYS -- "no" --> SW{"switch (access)"}
    SW -- "1 (Basic)" --> B1{"Basic creds present?"}
    B1 -- "yes" --> B1A["check_auth_Basic<br/>(login + check_auth_Bearer)"]
    B1A -- "pass" --> ATTB["attach user"]
    B1A -- "fail" --> R401B["401 Invalid Username or Password"]
    B1 -- "no" --> R401B

    SW -- "3 (Bearer + Basic fallback)" --> M1["check_auth_Bearer"]
    M1 -- "pass" --> ATTM1["attach user"]
    M1 -- "fail" --> M2["check_auth_Basic"]
    M2 -- "pass" --> ATTM2["attach user"]
    M2 -- "fail" --> R401M["401 requires a Token or Username and Password"]

    SW -- "default / 2 (Bearer)" --> D1["check_auth_Bearer"]
    D1 -- "pass" --> ATTD["attach user"]
    D1 -- "fail" --> R401D["401 requires a valid Token"]

    subgraph BEARER["check_auth_Bearer(handler, data) — shared by all Bearer paths above"]
        direction TB
        B0["check_auth_Bearer"]
        BK1{"Bearer.data.apikey.idapp<br/>== handler.params.idapp?"}
        BK1 -- "yes" --> BT["true"]
        BK1 -- "no" --> BK2{"data.admin present?"}
        BK2 -- "no" --> BF["false"]
        BK2 -- "yes" --> BK3{"app == 'system'?"}
        BK3 -- "yes" --> BK4["freshUser(tokenUser)<br/>re-read from DB"]
        BK4 -- "null/disabled" --> BF
        BK4 -- "ok" --> BK5{"resource == '/user/changepassword'?"}
        BK5 -- "yes" --> BT
        BK5 -- "no" --> BK6{"resource == '/user/linktelegram'<br/>and has admin claim?"}
        BK6 -- "yes" --> BT
        BK6 -- "no" --> BK7{"userCtrl.as_admin == true?"}
        BK7 -- "yes" --> BT
        BK7 -- "no" --> BK8["hasPermission(ctrl, env, resource, action)"]
        BK8 -- "granted" --> BT
        BK8 -- "denied / unmapped" --> BF
        BK3 -- "no (normal app)" --> BK5
    end
```

---

## 3. Authentication rate limiting (brute-force)

In-memory sliding window, per IP and per IP+username. Read in `preValidation`, written from
`onResponse` when a request ends with 401.

```mermaid
flowchart TD
    subgraph READ["isBlocked (preValidation)"]
        R1["keys = ip & optional ipu"] --> R2{"lockedUntil > now?"}
        R2 -- "yes" --> RB["blocked: true, retryAfterMs"]
        R2 -- "no" --> RN["blocked: false"]
    end

    subgraph WRITE["recordFailure (onResponse, after 401)"]
        W1["for each key: push now to failures[]<br/>prune window (AUTH_WINDOW_MS default 10 min)"]
        W1 --> W2{"already locked out?"}
        W2 -- "yes" --> WB["no new failure, blocked"]
        W2 -- "no" --> W3{"failures >= AUTH_MAX_FAILURES (5)?"}
        W3 -- "no" --> WN["blocked: false"]
        W3 -- "yes" --> W4["lockoutDurationMs = base·2^(n−1)<br/>capped at AUTH_LOCKOUT_MAX_MS (24 h)"]
        W4 --> W5["lockedUntil = now + duration<br/>log posible_ataque on first crossing"]
    end

    RB --> OUT["Request blocked → 429 + Retry-After"]
    RN --> CONT["Continue to auth check"]
    WN --> CONT2["(no action)"]
```

Configuration env vars (with defaults): `AUTH_MAX_FAILURES=5`, `AUTH_WINDOW_MS=600000`,
`AUTH_LOCKOUT_BASE_MS=5000`, `AUTH_LOCKOUT_MAX_MS=86400000`, `AUTH_PRUNING_AGE_MS=86400000`.

---

## 4. Password recovery — request OTP (`/user/forgotpassword`)

```mermaid
flowchart TD
    A["POST /user/forgotpassword"] --> U{"username present?"}
    U -- "no" --> R400A["400"]
    U -- "yes" --> RL{"isRateLimited(ip, username)?<br/>5 per 15 min"}
    RL -- "yes" --> GEN1["200 generic (no OTP issued)"]
    RL -- "no" --> MARK["markRecoveryAttempt(ip, username)"]
    MARK --> CFG["getRecoveryChannelConfig(env)<br/>reads system AppVars"]
    CFG --> EMAIL["email: flag AND smtp transport host is set"]
    CFG --> TG["telegram: flag AND bot token set"]

    EMAIL --> CR["createPasswordRecovery<br/>{ found, otp, idrecovery, user }"]
    TG --> CR
    CR --> FOUND{"User active and found?"}
    FOUND -- "no" --> GEN1
    FOUND -- "yes" --> INVAL["Invalidate previous pending OTPs"]
    INVAL --> OTP["OTP = randomInt(100000, 999999)<br/>store hash, expires = now + 30 min"]

    OTP --> SEL["Channel selection with viability<br/>preferred channel → fallback rules"]
    SEL --> VIABLE{"Selected channel viable?"}
    VIABLE -- "no" --> NULLC["selected = null"]
    VIABLE -- "yes" --> DEL["deliverOtpByEmail | deliverOtpByTelegram"]
    DEL --> DROK{"Delivery ok?"}
    DROK -- "no" --> FALL["Fallback to the alternative channel<br/>(only if that channel is viable)"]
    FALL --> FOK{"Fallback ok?"}
    FOK -- "yes" --> CHSEL["updatePasswordRecoveryChannel(idrecovery)<br/>selected = fallback"]
    FOK -- "no" --> NULLC
    DROK -- "yes" --> CHSEL2["updatePasswordRecoveryChannel(idrecovery)<br/>selected = primary"]
    CHSEL --> GEN2["200 generic { success:true, channel: selected }"]
    CHSEL2 --> GEN2
    NULLC --> GEN2
    GEN1 --> R["Response never reveals account existence / delivery result"]
```

---

## 5. Password recovery — redeem OTP (`/user/resetpassword/confirm`)

```mermaid
flowchart TD
    A["POST /user/resetpassword/confirm"] --> REQ{"username, otp, newPassword present?"}
    REQ -- "no" --> R400["400"]
    REQ -- "yes" --> TX["consumePasswordRecovery — DB transaction"]

    TX --> USR["findActiveUserByUsername"]
    USR --> UOK{"Valid active user?"}
    UOK -- "no" --> T1["rollback → INVALID_OTP"]
    UOK -- "yes" --> ROW["Find latest unused, unexpired recovery row"]
    ROW --> ROK{"Found?"}
    ROK -- "no" --> T2["rollback → INVALID_OTP"]
    ROK -- "yes" --> HMAC{"otp_hash == hash(otp)?"}
    HMAC -- "no" --> AT["attempts += 1"]
    AT --> ATRY{"attempts >= 5?"}
    ATRY -- "yes" --> BURN["mark row used = true"]
    BURN --> T3["commit → INVALID_OTP (0 attempts left)"]
    ATRY -- "no" --> T4["commit → INVALID_OTP + attemptsLeft"]

    HMAC -- "yes" --> POL["validatePasswordSecurity(newPassword)<br/>(length, case, digit, special)"]
    POL --> POK{"Valid?"}
    POK -- "no" --> T5["rollback → WEAK_PASSWORD"]
    POK -- "yes" --> UP["update user: password=hash, change_password=false"]
    UP --> USED["mark row used = true"]
    USED --> CMIT["commit"]
    CMIT --> R200["200 { success: true }"]
```

---

## 6. Change & reset password

Two distinct flows:

- **Self-service** (`/user/changepassword`, any authenticated user): validates the current
  password, requires the new one to differ, clears `change_password`.
- **Admin reset** (`/user/resetpassword`, bearer + ctrl permission): no current password
  required; assigns a temporary password and sets `change_password = true`.

```mermaid
flowchart TD
    subgraph SELF["Self-service changepassword"]
        S1["Validate username, oldPassword, newPassword"] --> S2{"password policy ok<br/>and differs from old?"}
        S2 -- "no" --> SE["error"]
        S2 -- "yes" --> S3{"User active and<br/>oldPassword matches?"}
        S3 -- "no" --> SE
        S3 -- "yes" --> S4["Update password + change_password=false"]
    end

    subgraph ADMIN["Admin reset (no current password)"]
        A1["Requires iduser + newPassword"] --> A2{"User exists and<br/>policy ok?"}
        A2 -- "no" --> AE["error"]
        A2 -- "yes" --> A3["Update password + change_password=true<br/>(must change at next login)"]
    end
```

---

## 7. Telegram recovery bot — conversation state machine

The **Recovery Password Bot** is stateless (in-memory `Map` of chat → step). It authenticates
against the server and calls the internal endpoints with `uFetchAutoEnv`.

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> link: /link
    idle --> forgot: /forgot
    idle --> change: /changepassword
    idle --> idle: /health, /help, /start
    idle --> idle: /cancel

    state link {
        [*] --> linkUser: ask username
        linkUser --> linkPass: ask password
        linkPass --> done: login + POST /user/linktelegram
        linkPass --> idle: login failed
    }

    state forgot {
        [*] --> forgotUser: ask username
        forgotUser --> done: POST /user/forgotpassword
    }

    state change {
        [*] --> chUser: ask username
        chUser --> chPass: ask current password
        chPass --> chNew: ask new password
        chNew --> chConfirm: ask confirmation
        chConfirm --> chDone: match → login + POST /user/changepassword
        chConfirm --> idle: mismatch
    }

    done --> idle
```

> If `$_VAR_RESET_TELEGRAM_ENABLED = false` the bot still responds, but the server decides the
> delivery — so no Telegram OTP is produced.