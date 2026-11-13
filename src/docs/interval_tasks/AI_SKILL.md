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
| `run_interval_task_now` | write | Set an **enabled, non-suspended** task due and wake the scheduler immediately. It answers 400 when the task does not exist or when it is already running with `allow_concurrent: false`, 409 `TASK_DISABLED` when the user turned the task off, 409 `TASK_SUSPENDED` when the scheduler suspended it after repeated failures, **409 `TASK_LOCKED`** when another instance holds the distributed lock (another worker or API node is already executing this task), and **409 `TASK_GROUP_LOCKED`** when another task of the same `exclusive_group` is running. |
| `reset_interval_task_attempts` | write | Clear the failure counter and lift the scheduler's suspension, so a task it suspended runs again. |
| `stop_interval_task_run` | write | Abort the execution of a task that is currently in flight: the scheduler cuts the in-flight HTTP call and records the run as `5` (aborted). Answers `stopped: false` with `reason: "NOT_RUNNING"` when there is no run left to abort. Does **not** touch `failed_attempts`, backoff or future runs — use `upsert_interval_task` with `enabled: false` to stop those instead. |
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

**`run_interval_task_now` does NOT re-enable a disabled task, nor lift a suspension.** The scheduler
only picks up tasks with `enabled: true` and `disabled_by` null, so forcing a disabled task returns
**409** with `reason: "TASK_DISABLED"` and forcing a suspended task returns **409** with
`reason: "TASK_SUSPENDED"` — nothing runs in either case. If you want a task off its schedule but
proven to work, do the inverse: keep it **enabled** with a long `interval`, force the run, then
shorten the interval. Never leave a task disabled and try to force it — that combination cannot
execute. To bring a suspended task back, fix the cause and use `reset_interval_task_attempts`.

---

## 3. Data model

Configuration you own:

| Field | Default | Meaning |
|---|---|---|
| `idtask` | UUID | Primary key, a UUID generated once and returned on INSERT. Omit to create; send it to update. Stable across backups and instances — it is the task's identity. |
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
| `exclusive_group` | — | Optional mutual-exclusion group. Tasks sharing this value never run at the same time, even though they have different `idtask`. |
| `exclusive_policy` | `skip` | When the group is busy: `skip` waits for the next natural occurrence, `wait` retries in 30 s. Only used with `exclusive_group` and `allow_concurrent: false`. |
| `max_failed_attempts` | `0` | Consecutive failures before the scheduler suspends the task (`disabled_by = 'system'`). `0` never suspends. Only values > 0 suspend after that many failures; invalid values fall back to 0. |
| `history_limit` | `50` | Executions kept per task. `0` disables history. |
| `note` | — | Free-text label. Not part of any key: two tasks may share it and a task may have none. To identify a task use its `idtask`, which is stable across backups and instances. |

Telemetry the scheduler owns — read it, never write it:

`status`, `failed_attempts`, `last_run`, `next_run`, `last_exec_time`, `last_response`, `disabled_by`,
`disabled_reason`.

`status`: `0` waiting · `1` running · `2` completed · `3` error · `4` timeout · `5` aborted. Values
`2`–`5` are terminal results of the previous run; they do not mean the task is still executing.
Operationally, only `1` is running, while any other enabled task with a future `next_run` is waiting.
`5` means an operator cut the execution in flight with `stop_interval_task_run`; unlike `3` and `4`
it does not count as a failure.

`disabled_by` is who took the task out of the schedule: `'system'` when the scheduler suspended it
after `max_failed_attempts` consecutive failures, `null` otherwise. A system suspension does **not**
change `enabled` — that flag is the user's intent and stays as the user left it. `disabled_reason`
carries the human-readable motive.

> In the response of `list_interval_tasks` the task's own `enabled` flag is returned as
> **`task_enabled`**, because `enabled` there belongs to the endpoint and to the application.
> **`task_enabled: true` with `disabled_by: 'system'` means the scheduler suspended the task**: the
> user still wants it to run, but it will not until `reset_interval_task_attempts` (or an
> `upsert_interval_task` with `enabled: true`) lifts the suspension.

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
  run is still recorded as an error, and after the usual consecutive failures the task is suspended.
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
- An operator can also cut the run **in flight** on demand with `stop_interval_task_run`. That asks
  the scheduler to abort the real HTTP call it is currently making and records the run as `5`
  (aborted). It only reaches the run the scheduler has in flight for that task right now: a stop
  that arrives after the call already finished answers `stopped: false`. Unlike a failure or a
  timeout, an aborted run does **not** increment `failed_attempts`, does not apply backoff and cannot
  suspend the task; the schedule is unchanged, so the next planned run still happens. Disabling
  the task (`enabled: false`) prevents future runs but never cuts one already executing.
- There are **two** clocks, and they live on different objects. `exec_time_limit` belongs to the
  task and is what the worker and the reaper enforce. The endpoint's `timeout` belongs to the
  endpoint and is enforced inside it. If the endpoint's timeout is the smaller one, the endpoint
  always answers first, the run is recorded as a 504 rather than as a timeout, and `exec_time_limit`
  never gets to be the thing that stopped it. `upsert_interval_task` returns a `warnings` entry when
  it saves such a combination; it is advisory, and the save still goes through.
- With `allow_concurrent: false` (the default) a cycle is skipped while the previous run is alive.
- Tasks that share an `exclusive_group` never run at the same time, even though their `idtask`
  differs. The worker, `run_interval_task_now` and the RUNNING transition all enforce it. When the
  group is busy, `exclusive_policy` decides: `skip` (default) leaves the task for its next natural
  occurrence, `wait` reschedules it to now + 30 seconds. A forced run on a busy group answers
  **409 `TASK_GROUP_LOCKED`**. `allow_concurrent: true` opts the task out of the group check; that is
  rarely what you want, since the group exists precisely to prevent overlap.
- An endpoint with `exclusive: true` accepts one execution at a time from any origin (scheduled
  task, forced run, GUI Tester, `execute_endpoint_test`, direct HTTP). A second concurrent call gets
  **409 `ENDPOINT_LOCKED`** while the first holds its lease (`timeout` + 30 s). This is independent
  from the task lock: a task can hold its own lease and still be rejected by an exclusive endpoint.
  See §9 for the full contract.
- HTTP `200` is recorded as completed unless the JSON payload explicitly declares
  `success: false`; that payload is recorded as an error using its `error` or `message`. The field is
  optional: endpoints without `success` continue to use the HTTP status as the outcome.
- Failures retry with exponential backoff, doubling from the interval up to `max_backoff_seconds`
  (default one hour). On reaching `max_failed_attempts` the scheduler **suspends** the task:
  `disabled_by = 'system'` with a `disabled_reason`, and the task stops being scheduled. It does
  **not** flip `enabled` — that stays as the user's intent — so a suspended task still reads
  `task_enabled: true`. To bring it back, fix the cause and call `reset_interval_task_attempts`.
- Three per-task knobs change that policy, and you should reach for them before resetting attempts
  by hand:
  - `max_failed_attempts: 0` means **never suspend**. The task keeps running and keeps recording
    failures however many accumulate. This is the right value for a monitoring task; a positive value
    is right for a task that must not keep hitting a downstream service.
  - `backoff_enabled: false` keeps the task on its normal interval even while it fails, so a health
    check does not drift from every 2 minutes to every 32 minutes exactly when the observed system is
    down. It does not prevent the suspension — combine it with `max_failed_attempts: 0` for that.
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
must all be `true`; `disabled_by` must be null (a `'system'` value means the scheduler suspended it
after repeated failures); `datestart` must be in the past and `dateend` in the future; `next_run` must
not be far ahead. If a window is set, confirm the current time and weekday fall inside
`window_start`–`window_end` / `window_days` **in the task's `timezone`**. Invalid IANA timezones and
invalid cron expressions are rejected at save time. A malformed `HH:MM` is currently ignored, so
re-read the stored window values after writing.

**"The task is skipped or delayed while another task runs."**
Both tasks are in the same `exclusive_group` and `allow_concurrent` is false. `list_interval_tasks`
shows the group and the policy. With `exclusive_policy: "skip"` the blocked task waits for its next
natural occurrence; with `"wait"` the scheduler retries in 30 seconds. Check that the collision is
real: if both schedules are safe to overlap, clear `exclusive_group` (or set `allow_concurrent: true`)
on the task that does not need the group. Do not remove the group merely to make a run start — the
group is what protects the shared downstream system.

**"The endpoint answers 409 `ENDPOINT_LOCKED`."**
The endpoint has `exclusive: true` and another execution of the same endpoint is still running:
another task, a forced run, the GUI Tester, `execute_endpoint_test` or a direct client. Wait for it to
finish. The task's own lock is not the cause — `TASK_LOCKED` and `TASK_GROUP_LOCKED` are different
reasons. Remove `exclusive` only if concurrent executions of that endpoint are truly safe.

**"It got suspended by itself."**
It hit `max_failed_attempts`, so the scheduler set `disabled_by = 'system'` while leaving
`task_enabled` true. Read `get_interval_task_runs` to see the actual errors, fix the cause, then
`reset_interval_task_attempts` — that clears the counter, lifts the suspension and reschedules it.
Sending `upsert_interval_task` with `enabled: true` does the same. It only reactivates a task the
**scheduler** suspended: a task the user turned off (`enabled: false`) is left off by the reset.

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

**"I want to stop the run that is executing right now."**
Use `stop_interval_task_run` with `{idtask}`. It cuts the in-flight HTTP call and the run is
recorded as `5` (aborted). Check the answer: `stopped: true` means a run was actually in flight;
with `reason: "NOT_RUNNING"` the run had already finished and there was nothing to abort — read
`get_interval_task_runs` to see what it did. An aborted run is not counted as a failure, so nothing
to reset afterwards. It cannot undo what the endpoint already did before the cutoff; if the endpoint
carried side effects, handle them outside the scheduler.

**"I want to stop it temporarily."**
`upsert_interval_task` with `{idtask, enabled: false}`. Do not delete it — `delete_interval_task`
loses the whole configuration. Note this only prevents **future** runs: the scheduler wakes up fast,
but an execution that is already in flight when you disable the task keeps going until it finishes
or reaches `exec_time_limit`. If you need to also cut that one, call `stop_interval_task_run`
first, then disable.

---

## 9. Mutual exclusion: task groups and exclusive endpoints

Two independent layers keep work from overlapping, and both can reject a run.

### Task groups (`exclusive_group`)

`exclusive_group` groups tasks that must not overlap even though they have different `idtask` — for
example a long synchronization and an immediate cleanup that touch the same downstream system. The
worker and `run_interval_task_now` both check it. `exclusive_policy` chooses what happens when the
group is busy:

| Value | Behavior |
|---|---|
| `skip` (default) | Do not start this cycle; the task waits for its next natural occurrence. |
| `wait` | Reschedule `next_run` to now + 30 seconds and try again. |

The check only considers tasks of the group that are `running` with a lease (`locked_until`) still in
the future; an expired lease from a crashed process does not block the group. `allow_concurrent: true`
opts the task out of the group check, which defeats the purpose of the group. A forced run on a busy
group answers **409 `TASK_GROUP_LOCKED`**.

### Exclusive endpoints (`exclusive`)

`exclusive` is a field of the endpoint, not of the task. When it is `true`, the endpoint accepts one
execution at a time from **any** origin: a scheduled task, `run_interval_task_now`, the GUI Tester,
`execute_endpoint_test` or a direct HTTP client. A second concurrent call answers
**409 `ENDPOINT_LOCKED`** while the first holds the lease, which lasts the endpoint `timeout` plus
30 seconds. A crashed process therefore frees the endpoint shortly after its own deadline.

- It is independent from the task lock and from `exclusive_group`: a task can hold its own lease and
  still be rejected by an exclusive endpoint.
- `exclusive: false` (default) costs nothing: the lock module is never reached. On an exclusive
  endpoint the steady state is two indexed `UPDATE`s per call (acquire and release), measured at
  roughly 0.5 ms p50 / 2 ms p95 on local SQLite and expected to add 1–5 ms on a networked database.
- Enable it only where concurrent execution would corrupt state (writes, counters, file generation).
  Read-only endpoints rarely need it.
- Set it with `endpoint_upsert` (`exclusive: true`) and read it back with `read_endpoint_data`.

---

## 10. Distributed lock & operator abort (v13.13.5+)

Since v13.13.5 the scheduler uses a **database-level lock** (`locked_until` column) instead of an in-memory flag. This fixes three long-standing gaps:

1. **Cross-instance protection** — two API nodes cannot execute the same task concurrently.
2. **Race-free acquisition** — the lock is taken atomically with `UPDATE ... WHERE locked_until IS NULL OR locked_until < NOW()`. No window where two workers read "free" and both proceed.
3. **`run_interval_task_now` respects the lock** — it returns `409 TASK_LOCKED` instead of silently overlapping.

The lock TTL is `exec_time_limit + 30 s` grace period. A crashed worker leaves the lock; the reaper (`reapStaleRunningTasks`) clears it once the TTL expires.

### Operator-initiated abort

`stop_interval_task_run` now propagates an **abort token** through every handler layer:

- Worker generates `X-OFAPI-Abort-Token` header per run.
- Shared cache `globalThis.__ofapi_abort_token_cache` (auto-TTL cleanup).
- Internal endpoint `GET /system/interval-tasks/abort-check/:token` → `204` (running) / `410` (aborted).
- Endpoint handlers receive the token and can react:
  - **JS/VM handlers**: `$_ABORT_TOKEN_` (string) and `$_ABORT_CHECK()` (throws if aborted).
  - **SQL handlers** (PostgreSQL, SQLite, Oracle, MSSQL, HANA): native `statement_timeout` / `queryTimeout` / `requestTimeout` cancels the query in the database.
  - **MySQL/MariaDB**: hint `/*+ MAX_EXECUTION_TIME(ms) */` prepended to the query.
  - **MongoDB**: `fnVars.abortToken` available in sandbox.
  - **Hive/Impala**: worker thread checks abort every 100 row fetches.
  - **fetchFunction**: propagates the header to downstream calls.

**Usage in your endpoint code (JS handler):**

```javascript
// Check once at the start
if ($_ABORT_TOKEN_) {
  console.log('Abort token present:', $_ABORT_TOKEN_);
}

// Or call periodically in long loops
for (const item of largeArray) {
  $_ABORT_CHECK(); // throws if operator called stop_interval_task_run
  await process(item);
}
```

`$_ABORT_CHECK()` throws a `TimeoutError` with message `Execution aborted by operator`; the run is recorded as status `5` (aborted) and does **not** increment `failed_attempts`.

### Error codes summary

| Code | Reason | Meaning |
|------|--------|---------|
| 409 | `TASK_DISABLED` | Task has `enabled: false`. |
| 409 | `TASK_SUSPENDED` | Scheduler suspended after `max_failed_attempts`. |
| 409 | `TASK_LOCKED` | Another instance holds the distributed lock (`locked_until` not expired). |
| 409 | `TASK_GROUP_LOCKED` | Another task of the same `exclusive_group` is running. |
| 409 | `ENDPOINT_LOCKED` | The target endpoint has `exclusive: true` and another execution holds its lease. |
| 504 | `TimeoutError` | Endpoint or query timeout. |
| 504 | `Execution aborted by operator` | `stop_interval_task_run` was called; `$_ABORT_CHECK()` threw. |

---

## 11. Backup and restore
Telemetry is not restored (the task comes back as waiting, with zero failures and no `disabled_by`)
and `idkey` is remapped to the target instance. `idtask` is the identity: the UUID from the backup is matched
against the destination as-is, and if the row does not exist it is inserted honoring that UUID —
there is no numeric id to collide with, so the restore is idempotent by construction. `note` plays
no part in the match. Tasks that exist in the destination but are absent from the backup are not
deleted.
