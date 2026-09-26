# Endpoint Logging — Per-status verbosity configuration

> **READ ME FIRST**: this document defines the complete contract of `endpoint.ctrl.log`
> (the parameterization of when and how much is logged per status class). It is the
> source of truth used by `EndpointLogger` (runtime), `endpoint_upsert` (writes)
> and the read tools (`read_endpoint_data`, `app_endpoints`) to decide how much
> to capture per HTTP response.

---

## 1. Where it is stored

Every endpoint persists a JSON object in the `ctrl` column of the `Endpoint` model.
Inside it you keep the logging sub-key:

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

Only **these five keys** are accepted. Any other key (or a `log` that is not an
object, or a value out of range) is rejected on save with the
`INVALID_LOG_LEVEL` error (HTTP 400) and `details` describing the offending field.

---

## 2. Level semantics

| Value | Name      | What is captured (EndpointLogger)                    |
|-------|-----------|------------------------------------------------------|
| 0 | Disabled | Nothing is logged for that status class.             |
| 1 | Basic    | Minimum data: timestamp, status, ids, response time. |
| 2 | Normal   | Adds the params/query/body that arrived in the request. |
| 3 | Full     | Adds full headers and sensitive response data.       |

Levels are **per status class** (each key maps to a range of codes):

| Key                 | HTTP range |
|---------------------|------------|
| `status_info`       | 1xx        |
| `status_success`    | 2xx        |
| `status_redirect`   | 3xx        |
| `status_client_error`| 4xx        |
| `status_server_error`| 5xx        |

---

## 3. Defaults

When a key (or the whole `log`) is omitted:

| Key                 | Default |
|---------------------|---------|
| `status_info`       | 1       |
| `status_success`    | 1       |
| `status_redirect`   | 1       |
| `status_client_error`| 2       |
| `status_server_error`| 3       |

On an INSERT the default is used. On an UPDATE only the submitted keys are changed;
the rest keep their stored value.

---

## 4. How the runtime reads it

`EndpointLogger` (src/lib/server/endpoint/EndpointLogger.js) on every response:
1. Reads `endpoint.ctrl.log` (via the persisted `ctrl` column).
2. Determines the status class with `getLogLevelForStatus(status)` (utils.js).
3. Applies the level and generates the log (with `$_RETURN_DATA_` truncated according to the level).

If `ctrl.log` is absent, the defaults apply (section 3).

---

## 5. How you change it from MCP

The `endpoint_upsert` tool accepts `ctrl.log`. Example — raising only
`status_server_error` to Full (3) without touching anything else:

```json
{
  "idapp": "<idapp>",
  "resource": "my-resources",
  "method": "GET",
  "handler": "TEXT",
  "ctrl": {
    "log": { "status_server_error": 3 }
  }
}
```

On an UPDATE, omit the keys you do not want to change. On an INSERT, the ones you
omit get the default from section 3.

---

## 6. Error contract

If you send an invalid `ctrl.log` (unknown key, non-integer value, or outside 0-3),
`upsertEndpoint` throws an error with `code = "INVALID_LOG_LEVEL"` and `details`
naming the offending key and value. `fnEndpointUpsert` returns it as HTTP 400 so
agents can detect and correct it without a generic 500.

---

## See also

- `src/lib/db/endpoint.js` — `validateLogLevelControl` validation.
- `src/docs/logging/AI_SKILL.md` — condensed version for agents.
- `src/docs/handlers/JS/README.md` — per-request `log_level` parameter.
