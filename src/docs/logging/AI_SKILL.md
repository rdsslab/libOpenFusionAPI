# Logging — Agent Contract (AI_SKILL)

Concise operative contract for AI agents that read, configure, or debug
OpenFusionAPI endpoint logging. Read `README.md` in this folder for the full
contract and the runtime details.

## Where logging is configured

Persisted per-endpoint, on the endpoint's `ctrl.log` object:

```json
"ctrl": {
  "log": {
    "status_info": 1,
    "status_success": 1,
    "status_redirect": 1,
    "status_client_error": 2,
    "status_server_error": 3
  }
}
```

Only these five keys are supported. Do not use other keys under `ctrl.log`.

## Level values

| Value | Meaning  | What is captured                                |
| ----- | -------- | ----------------------------------------------- |
| 0     | Disabled | No logging for that status class.               |
| 1     | Basic    | Minimal request summary (status, latency, ids). |
| 2     | Normal   | Adds params, query, body, user agent.           |
| 3     | Full     | Adds headers and full response data.            |

## Defaults

When `ctrl.log` (or a key) is omitted, these apply:

- `status_info`, `status_success`, `status_redirect` = 1
- `status_client_error` = 2
- `status_server_error` = 3

When updating an existing endpoint you only need to send the keys you want to
change; omitted keys keep their stored value.

## Status classes → response mapping

- `status_info` → 1xx informational
- `status_success` → 2xx success
- `status_redirect` → 3xx redirection
- `status_client_error` → 4xx client error
- `status_server_error` → 5xx server error

## How to configure from MCP

Use `endpoint_upsert` with a `ctrl` object carrying only the `log` keys you want
to change. Example: raise server-error verbosity to Full:

```json
{
  "idapp": "<idapp>",
  "idendpoint": "<optional; omit for INSERT>",
  "resource": "example",
  "method": "GET",
  "handler": "TEXT",
  "ctrl": { "log": { "status_server_error": 3 } }
}
```

Invalid payloads (unknown keys, non-integer values, values outside 0-3) return
HTTP 400 with `code: "INVALID_LOG_LEVEL"` and a `details` object describing the
failing field — read it and retry instead of retrying blindly.

## How to inspect

- `read_endpoint_data` returns the persisted endpoint, including `ctrl.log`.
- `read_endpoint_data` / `endpoint_get_code` overview tools list this contract.

## See also

- `src/docs/logging/README.md`
- Per-handler skills under `src/docs/handlers/*/AI_SKILL.md`
