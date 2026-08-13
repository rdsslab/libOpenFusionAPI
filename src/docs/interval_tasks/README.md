# Interval Tasks

Recurring, unattended execution of an existing endpoint.

An interval task is a row of `ofapi_intervaltask` that points at an endpoint and says *when* to call
it, *with what payload* (`params`) and *with whose credentials* (`idkey`). It contains no code: the
logic lives in the endpoint, which stays callable by hand exactly as before.

- **Agent skill (the full contract, including the diagnostics runbook):** [AI_SKILL.md](AI_SKILL.md),
  served by the `get_interval_task_skill` tool.
- **Machine-readable summary:** [manifest.json](manifest.json).

## HTTP routes (system app, `prd`)

| Route | Method | MCP tool |
|---|---|---|
| `/interval_tasks/byidapp` | GET | `list_interval_tasks` |
| `/interval_tasks/runs` | GET | `get_interval_task_runs` |
| `/interval_tasks/skill` | GET | `get_interval_task_skill` |
| `/interval_tasks/upsert` | POST | `upsert_interval_task` |
| `/interval_tasks/run_now` | POST | `run_interval_task_now` |
| `/interval_tasks/reset_attempts` | POST | `reset_interval_task_attempts` |
| `/interval_tasks/delete` | DELETE | `delete_interval_task` |

## Where the code lives

| Concern | File |
|---|---|
| Data access, upsert merge, status transitions, reaper | `src/lib/db/interval_task.js` |
| Execution history (`ofapi_intervaltask_run`), truncation, pruning | `src/lib/db/interval_task_run.js` |
| Idempotent column migration run at boot | `src/lib/db/ensureIntervalTaskColumns.js` |
| Scheduler worker thread (10 s poll, auth, fetch, timeout) | `src/lib/timer/worker.js` |
| Pure scheduling math: cron, windows, anchored next_run, backoff | `src/lib/timer/schedule.js` |
| Worker supervision and event forwarding | `src/lib/timer/tasks.js` |
| HTTP/MCP handlers | `src/lib/server/functions/system/prd/interval_tasks/index.js` |
| Tool and schema declarations | `src/lib/db/default/system.js` |

## Design notes

- **`enabled` defaults to `false`.** Creating a task never starts it by accident; enabling is a
  separate, explicit decision.
- **`next_run` is anchored** to the planned schedule rather than to the end of the previous run, so
  a slow execution does not make the series drift.
- **Updating is a partial merge.** `IntervalTask.upsert` builds the row from the payload, so
  omitted fields would fall back to model defaults; `upsertIntervalTask` merges over the stored row
  first. `params` is the one field replaced whole, so a key can be removed.
- **Telemetry is not configuration.** `INTERVAL_TASK_RUNTIME_ATTRIBUTES` is ignored on upsert and
  dropped on backup restore, mirroring `BOT_RUNTIME_ATTRIBUTES` for bots.
- **Failures are self-limiting.** Exponential backoff up to one hour, then auto-disable at
  `max_failed_attempts`, so a broken task cannot hammer a downstream service indefinitely.
