# Interval Tasks — AI Agent Skill

An **interval task** makes the server call one of your endpoints on a schedule, unattended.
It is a row in `ofapi_intervaltask`, not an endpoint: the endpoint already exists and the task
only says *when* to call it, *with what payload* and *with whose credentials*.

Read this before scheduling, diagnosing or repairing a recurring task.

---

## 1. Required agent skills and context

1. Call `get_interval_task_skill` first. This document is its source of truth and may evolve with
  the scheduler.
2. Know the target application UUID. Use `apps_catalog` when it is not supplied.
3. Resolve the existing endpoint with `app_endpoints_catalog` or `search_endpoints`; never create
  an interval task with `endpoint_upsert`.
4. Read the endpoint's handler skill only when its payload or business logic must be understood or
  changed. Scheduling alone does not require editing endpoint code.
5. For private non-system endpoints, use `list_api_keys` and select an enabled key belonging to the
  same application.
6. Treat all task mutation tools as writes requiring explicit user authorization. Prefer listing,
  history and a disabled test task before enabling unattended execution.

The interval-task skill is independent from `JS_CORE`: tasks contain no executable code. The
endpoint being called may require `JS_CORE` or another handler skill, but that belongs to the
endpoint workflow rather than the scheduler.

---

## 2. Tools

| Tool | Mode | Use it to |
|---|---|---|
| `list_interval_tasks` | read | See every task of an application, with its configuration and its live telemetry. |
| `get_interval_task_runs` | read | Execution history of one task: duration, HTTP status, and — only with `include_response: true` — the `error` and `response` fields. Without that flag you get telemetry only, so a failed run looks empty of any error; set it when debugging. |
| `upsert_interval_task` | write | Create a task or change an existing one. |
| `run_interval_task_now` | write | Set an **enabled** task due and wake the scheduler immediately. It answers 400 when the task does not exist or when it is already running with `allow_concurrent: false`, and 409 `TASK_DISABLED` when the task is off. |
| `reset_interval_task_attempts` | write | Clear the failure counter and re-enable a task the backoff disabled. |
| `delete_interval_task` | write | Remove the schedule permanently. The endpoint is not touched. |

There is no "list all tasks of the server" tool: tasks are always listed per application.

### Recommended workflow to create one

1. Resolve the endpoint UUID with `app_endpoints_catalog` or `search_endpoints`.
2. `list_interval_tasks` on that application, to avoid duplicating a schedule that already exists.
3. `upsert_interval_task` with `enabled: true` and a long `interval`, so the task is live but will not
   fire on its own while you verify it.
4. `run_interval_task_now` to force one execution.
5. `get_interval_task_runs` to confirm the run succeeded.
6. `upsert_interval_task` again with the real `interval` (or `cron`) you want.

**`run_interval_task_now` does NOT re-enable a disabled task.** The scheduler only picks up tasks with
`enabled: true`, so forcing a disabled task returns **409** with `reason: "TASK_DISABLED"` and nothing
runs. If you want a task off its schedule but proven to work, do the inverse: keep it **enabled** with
a long `interval`, force the run, then shorten the interval. Never leave a task disabled and try to
force it — that combination cannot execute.

---

## 3. Data model

Configuration you own:

| Field | Default | Meaning |
|---|---|---|
| `idtask` | auto | Primary key. Omit to create; send it to update. |
| `idendpoint` | — | **Required.** The endpoint that gets called. |
| `enabled` | `false` | Whether the scheduler runs it. **A new task does not run until you set this to `true`.** |
| `schedule_mode` | `interval` | `interval` or `cron`. |
| `interval` | `300` | Seconds between executions in `interval` mode. |
| `cron` | — | Cron expression (5 or 6 fields) in `cron` mode. Validated at save time. |
| `timezone` | server tz | IANA name (`America/Guayaquil`) applied to the cron expression and the window. |
| `window_start` / `window_end` | — | `HH:MM` execution window. |
| `window_days` | — | Allowed weekdays, `1`=Monday … `7`=Sunday, comma separated. |
| `datestart` | now | Not eligible before this moment. |
| `dateend` | — | Stops running after this moment. |
| `params` | `{}` | Payload sent to the endpoint. See §5. |
| `idkey` | — | ApiKey used as Bearer. See §6. |
| `exec_time_limit` | `30` | Seconds one execution may take before it is aborted. |
| `allow_concurrent` | `false` | Whether a new execution may start while the previous one runs. |
| `max_failed_attempts` | `10` | Consecutive failures before the task is auto-disabled. |
| `history_limit` | `50` | Executions kept per task. `0` disables history. |
| `note` | — | Free text. Also the field used to match a task when restoring an app backup, so keep it stable and descriptive. |

Telemetry the scheduler owns — read it, never write it:

`status`, `failed_attempts`, `last_run`, `next_run`, `last_exec_time`, `last_response`.

`status`: `0` waiting · `1` running · `2` completed · `3` error · `4` timeout. Values `2`–`4`
are terminal results of the previous run; they do not mean the task is still executing. Operationally,
only `1` is running, while any other enabled task with a future `next_run` is waiting.

> In the response of `list_interval_tasks` the task's own `enabled` flag is returned as
> **`task_enabled`**, because `enabled` there belongs to the endpoint and to the application.

---

## 4. Updating a task is a partial update

`upsert_interval_task` with an `idtask` merges over the stored row: fields you do not send keep
their current value. Two exceptions to know:

- `params` is **replaced whole**, not merged key by key. Send the complete payload object.
- Sending an explicit `null` clears the field (`dateend: null` removes the end date); omitting the
  field keeps it.
- An `idtask` that does not exist is rejected with 404 — it never creates a task with that id.

Changing `interval`, `cron`, `timezone`, the window or `datestart` recomputes `next_run`
immediately, so the new schedule takes effect without waiting for the old cycle.

---

## 5. What the endpoint receives (`params`)

Preferred shape:

```json
{ "data": { "id": 42 }, "headers": { "x-source": "scheduler" } }
```

- `data` travels as **query string** on `GET` and `DELETE`, and as a **JSON body** on
  `POST`, `PUT` and `PATCH`.
- `headers` adds request headers.
- **The task method must be one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE` or `QUERY`.** The HTTP
  client the worker uses implements no other verb. `endpoint_upsert` does allow a `HEAD` or
  `OPTIONS` endpoint to exist, so a task can point at one; since 13.11.1 the worker rejects that
  before the request instead of failing with `uF[task.method.toLowerCase()] is not a function`. The
  run is still recorded as an error, and after the usual consecutive failures the task is disabled.
  Check the endpoint's `method` before pointing a task at it.

Legacy fallback: an object with **neither** a `data` nor a `headers` key is sent whole as `data`,
which is the shape kept for tasks already configured that way. `{"headers": {...}}` on its own is
fine: the headers are applied and no payload is sent.

---

## 6. Authentication (`idkey`)

- Endpoints of the `system` application use the internal token automatically.
- For any other application, an endpoint with `access > 0` needs `idkey` pointing at an **enabled**
  ApiKey **of the same application**, within its `startAt`/`endAt` validity. The key is sent as a
  Bearer token.
- Without it the run is recorded as an explicit error: *"Missing credentials: assign an enabled
  ApiKey (idkey) to this task"*. Nothing validates this at save time — it surfaces on the first run.
- Use `list_api_keys` to find the id.

---

## 7. Execution rules

- The scheduler sleeps until the nearest `next_run` (minimum 250 ms) and keeps a 60-second
  heartbeat to detect direct database changes and abandoned runs. API writes wake it immediately.
  A task fires when its `next_run` has passed and the application, endpoint and task are enabled.
- `next_run` is **anchored** to the planned schedule, not to the moment the previous run finished,
  so a slow execution does not make the series drift.
- Outside the execution window the task is rescheduled to the next window opening, not retried.
- A run that exceeds `exec_time_limit` is aborted and recorded with status `4` (timeout). A task
  left as `running` by a dead process is released once that limit plus a grace period passes.
- There are **two** clocks, and they live on different objects. `exec_time_limit` belongs to the
  task and is what the worker and the reaper enforce. The endpoint's `timeout` belongs to the
  endpoint and is enforced inside it. If the endpoint's timeout is the smaller one, the endpoint
  always answers first, the run is recorded as a 504 rather than as a timeout, and `exec_time_limit`
  never gets to be the thing that stopped it. `upsert_interval_task` returns a `warnings` entry when
  it saves such a combination; it is advisory, and the save still goes through.
- With `allow_concurrent: false` (the default) a cycle is skipped while the previous run is alive.
- HTTP `200` is recorded as completed unless the JSON payload explicitly declares
  `success: false`; that payload is recorded as an error using its `error` or `message`. The field is
  optional: endpoints without `success` continue to use the HTTP status as the outcome.
- Failures retry with exponential backoff, doubling from the interval up to `max_backoff_seconds`
  (default one hour). On reaching `max_failed_attempts` the task is **disabled automatically** with a
  `disabled_reason`.
- Three per-task knobs change that policy, and you should reach for them before resetting attempts
  by hand:
  - `max_failed_attempts: 0` means **never auto-disable**. The task keeps running and keeps recording
    failures however many accumulate. This is the right value for a monitoring task; a positive value
    is right for a task that must not keep hitting a downstream service.
  - `backoff_enabled: false` keeps the task on its normal interval even while it fails, so a health
    check does not drift from every 2 minutes to every 32 minutes exactly when the observed system is
    down. It does not prevent the auto-disable — combine it with `max_failed_attempts: 0` for that.
  - `max_backoff_seconds` caps the doubling per task (max 2592000 = 30 days). Omit for the global
    one-hour ceiling.
- In the run history (`get_interval_task_runs`), responses longer than 4096 characters are stored as
  `{truncated: true, size, preview}` and `error` is capped at 2000 characters. This does **not** apply
  to `last_response` on the task itself (`list_interval_tasks`): there the value is stored whole, so
  a task whose endpoint returns a large body can hand back an equally large `last_response`.

---

## 8. Diagnostics runbook

**"The task never runs."**
`list_interval_tasks` and check, in this order: `task_enabled`, `endpoint_enabled` and `app_enabled`
must all be `true`; `datestart` must be in the past and `dateend` in the future; `next_run` must not
be far ahead, and `failed_attempts` must be below `max_failed_attempts` — except when
`max_failed_attempts` is `0`, which exempts the task from the limit entirely. If a window is set, confirm
the current time and weekday fall inside `window_start`–`window_end` / `window_days` **in the task's
`timezone`**. Invalid IANA timezones and invalid cron expressions are rejected at save time. A
malformed `HH:MM` is currently ignored, so re-read the stored window values after writing.

**"It got disabled by itself."**
It hit `max_failed_attempts`. Read `get_interval_task_runs` to see the actual errors, fix the cause,
then `reset_interval_task_attempts` — that clears the counter, re-enables the task and reschedules it.

**"It runs but the endpoint receives nothing."**
Check `params`: a payload without a `data` key is sent whole as `data` (§5). Also check the endpoint
method — `data` goes in the query string for `GET`/`HEAD`/`DELETE` and in the body for the rest.

**"Every run fails with 401/403."**
`idkey` is missing, disabled, expired, or belongs to another application (§6).

**"Runs are recorded as status 4."**
The endpoint takes longer than `exec_time_limit`. Raise it, or make the endpoint asynchronous.
If instead you see a **504 from the endpoint** rather than status 4, the endpoint's own `timeout`
is the smaller of the two and it always wins: `exec_time_limit` cannot be what stopped the run.
`upsert_interval_task` answers with a `warnings` entry when it detects that, because the two are
separate knobs on separate objects and nothing else reports the mismatch. Keep `exec_time_limit`
larger than the endpoint `timeout` so the task's timeout stays reachable as a backstop.

**"`get_interval_task_runs` returns an empty list."**
`history_limit` is `0`, or the task has never run.

**"I want to stop it temporarily."**
`upsert_interval_task` with `{idtask, enabled: false}`. Do not delete it — `delete_interval_task`
loses the whole configuration.

---

## 9. Backup and restore

Interval tasks travel inside the application backup, at the root of the payload as `tasks`.
Telemetry is not restored (the task comes back as waiting, with zero failures), `idtask` and `idkey`
are remapped to the target instance, and the task is matched to an existing one by
`(idendpoint, note)`. Tasks that exist in the destination but are absent from the backup are not
deleted.
