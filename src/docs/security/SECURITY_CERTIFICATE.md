# OpenFusionAPI Security Validation Certificate

| Field | Value |
| --- | --- |
| **Subject** | libOpenFusionAPI (OpenFusionAPI core server) |
| **Version** | 13.0.3 |
| **Validation date** | 2026-09-05 |
| **Validation scope** | OWASP Top 10 (2021) + security hardening packet |
| **Environment** | Local E2E, isolated SQLite database (`BUILD_DB=true`), port 3000 |

---

## 1. Result summary

**Status: PASSED.**

- **OWASP Top 10: 10 / 10 categories passed.**
- **Security hardening packet: all local suites passed.**
- The system is validated against the security baseline described below.

One utility check (`check_mcp_name_uniqueness`) could not run in this
environment because it requires connectivity to the remote production MCP
deployment referenced by the VS Code `mcp.json` server key
`openfusion_system_remote_prd`. It is a network/environment dependency of the
test harness, not a finding against the server code.

---

## 2. OWASP Top 10 results

| ID | Category | Result |
| --- | --- | --- |
| A01 | Broken Access Control | **PASS** — anonymous access to the system application is rejected (401); valid bearer token is accepted (200). |
| A02 | Cryptographic Failures | **PASS** — tampered JWTs are rejected (401) with no stack/trace leakage. |
| A03 | Injection | **PASS** — SQL injection payloads in Basic auth are rejected (400/401), never 500. |
| A04 | Insecure Design | **PASS** — the system API requires bearer auth; Basic credentials are not accepted on protected resources. |
| A05 | Security Misconfiguration | **PASS** — CORS reflects the caller origin (no wildcard), credentialed responses opt in explicitly, and `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` are present. |
| A06 | Vulnerable and Outdated Components | **PASS** — hardened transitive dependencies (`minimatch >=10.2.1`, `tar >=7.5.8`) and a hardened `jsonwebtoken` major version. |
| A07 | Identification and Authentication Failures | **PASS** — invalid credentials are rejected (401); valid credentials succeed (200). |
| A08 | Software and Data Integrity Failures | **PASS** — unsigned endpoint mutations are rejected (401) with no stack leakage. |
| A09 | Security Logging and Monitoring Failures | **PASS** — unauthorized requests are rejected (401) and the response includes the request URL (observability contract). |
| A10 | Server-Side Request Forgery | **PASS** — anonymous creation of SSRF-capable handlers (FETCH) is rejected (401). |

---

## 3. Security hardening validated

### 3.1 Per-endpoint CORS allowlist

- Each endpoint may declare an explicit `cors` allowlist (array of origins or a
  full policy object `{ origin, credentials, allowedHeaders, methods, maxAge }`).
- A browser request can only read an endpoint response when its `Origin` matches
  the allowlist; origins outside it receive no `Access-Control-Allow-Origin`.
- Deployment-wide `CORS_DEFAULT_DENY` can make the default policy deny
  cross-origin reads for every endpoint that does not declare its own `cors`.
- Validated by OWASP A05.

### 3.2 Brute-force authentication rate limiting

- Failed authentication attempts (401 responses) are counted per source IP and
  per IP+username pair in a sliding window.
- After the configured threshold the source enters a lockout with exponential
  backoff; blocked requests receive **429** with `Retry-After` **before** any
  credential comparison happens.
- Every threshold crossing and every blocked request is logged at level 3 as
  `{ type: 'posible_ataque' }` into `ofapi_log`, so brute-force attacks are
  distinguishable from misconfigured clients.
- Configurable via `AUTH_MAX_FAILURES`, `AUTH_WINDOW_MS`,
  `AUTH_LOCKOUT_BASE_MS`, `AUTH_LOCKOUT_MAX_MS`, `AUTH_PRUNING_AGE_MS`.
- Validated by `rate_limit_policy_test.js` (13/13) and
  `rate_limit_integration_test.js` (3/3).

### 3.3 External API client hardening

- `apiclient` CRUD endpoints tightened from anonymous (`access=0`) to
  authenticated broker access (`access=2`).
- `loginApiClient` no longer trusts a null/undefined client from the lookup and
  falls back safely to a `login:false` outcome instead of crashing.

### 3.4 Security headers (always applied)

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`

### 3.5 Password-recovery hardening (OTP)

- `/user/forgotpassword` **never** reveals whether an account exists or a code was
  sent: it always returns `200` with a generic message (anti account-enumeration,
  covers A07/A08).
- Recovery requests are rate-limited to **5 per 15 minutes per `ip::username`** in a
  dedicated in-memory limiter, separate from the brute-force limiter of §3.2; blocked
  requests are answered silently with the generic message and no code is generated.
- OTPs are 6 digits, **single-use**, expire after **30 minutes** and are burned after
  **5 failed attempts**; they are stored only as an HMAC-SHA256 hash (never plaintext).
- An OTP is delivered through **one channel only** (email or Telegram); the alternative
  channel is used only as a fallback for a failed delivery and only when viable.
- Delivery channels can be disabled per channel via the AppVars
  `$_VAR_RESET_EMAIL_ENABLED` / `$_VAR_RESET_TELEGRAM_ENABLED` (default: enabled).

---

## 4. Full local validation packet

| Suite | Result |
| --- | --- |
| `integration_test.js` | PASS |
| `bot_crud_test.js` | PASS |
| `bot_failure_policy_test.js` | PASS (22/22) |
| `bot_resilience_test.js` | PASS (4/4) |
| `bot_backup_test.js` | PASS (8/8) |
| `backup_restore_test.js` | PASS |
| `interval_task_upsert_test.js` | PASS |
| `fetch_timeout_test.js` | PASS |
| `rate_limit_policy_test.js` | PASS (13/13) |
| `rate_limit_integration_test.js` | PASS (3/3) |
| `cache_validation.js` | PASS |
| `endpoint_loader_vm_contract.js` | PASS |
| `ws_cache_events.js` | PASS |
| `owasp_top10.js` | PASS (10/10) |
| `check_mcp_name_uniqueness.js` | NOT RUN — requires remote production MCP endpoint (network dependency of the harness) |

> Note: for the OWASP audit the harness elevates `AUTH_MAX_FAILURES` so the
> audit's own intentionally-failed probes (dozens of 401s from one IP) do not
> trip the brute-force limiter; the rate limiting feature itself is validated by
> its dedicated suites above.

---

## 5. Commitment to revalidating

This certificate is valid for the recorded version and validation date. Any
change to authentication, CORS handling, handler isolation, dependency
overrides or the runtime pipeline must be followed by a re-run of the OWASP
audit and the security packet before release.

---

**Signed by** the automated validation pipeline
(`node dev/test/index.js`) — 2026-09-05.