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
| `get_interval_task_runs` | read | Read the execution history of one task: duration, HTTP status, error, response. |
| `upsert_interval_task` | write | Create a task or change an existing one. |
| `run_interval_task_now` | write | Set the task due and wake the scheduler immediately. |
| `reset_interval_task_attempts` | write | Clear the failure counter and re-enable a task the backoff disabled. |
| `delete_interval_task` | write | Remove the schedule permanently. The endpoint is not touched. |

There is no "list all tasks of the server" tool: tasks are always listed per application.

### Recommended workflow to create one

1. Resolve the endpoint UUID with `app_endpoints_catalog` or `search_endpoints`.
2. `list_interval_tasks` on that application, to avoid duplicating a schedule that already exists.
3. `upsert_interval_task` **without** `enabled: true` — the task is stored but does not run yet.
4. `run_interval_task_now` to force one execution.
5. `get_interval_task_runs` to confirm the run succeeded.
6. `upsert_interval_task` again with `{idtask, enabled: true}` to let it run on its schedule.

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

- `data` travels as **query string** on `GET`, `HEAD` and `DELETE`, and as a **JSON body** on
  `POST`, `PUT` and `PATCH`.
- `headers` adds request headers.

Legacy fallback: an object **without** a `data` key is sent whole as `data`. That makes
`{"headers": {...}}` alone a trap — the headers object would be sent as the payload and no header
would be added. Always include `data` when you also send `headers`.

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
- With `allow_concurrent: false` (the default) a cycle is skipped while the previous run is alive.
- HTTP `200` is recorded as completed unless the JSON payload explicitly declares
  `success: false`; that payload is recorded as an error using its `error` or `message`. The field is
  optional: endpoints without `success` continue to use the HTTP status as the outcome.
- Failures retry with exponential backoff, doubling from the interval up to one hour. On reaching
  `max_failed_attempts` the task is **disabled automatically** with a `disabled_reason`.
- Responses longer than 4096 characters are stored as `{truncated: true, size, preview}`.

---

## 8. Diagnostics runbook

**"The task never runs."**
`list_interval_tasks` and check, in this order: `task_enabled`, `endpoint_enabled` and `app_enabled`
must all be `true`; `datestart` must be in the past and `dateend` in the future; `failed_attempts`
must be below `max_failed_attempts`; `next_run` must not be far ahead. If a window is set, confirm
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
