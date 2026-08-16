# Interval Tasks - Human Guide

An interval task calls an existing OpenFusionAPI endpoint automatically. The task contains the
schedule, payload and credentials; the endpoint continues to own all business logic.

## Safe creation workflow

1. Open the application and go to **Interval Tasks**.
2. Create a task and select the endpoint it must call.
3. Leave **Enabled** off while configuring and testing it.
4. Choose one schedule mode:
   - **Interval**: every N seconds. Use it for fixed elapsed-time cadences such as every 300 seconds.
   - **Cron**: calendar times such as weekdays at 07:00. Use an IANA timezone when local time matters.
5. Add an API Key if the endpoint is private and is not part of the `system` application.
6. Save the task, select it and click **Run now**.
7. Review **History**. Enable the task only after the test run succeeds.

## Field reference

| Field | Recommended value | Purpose |
|---|---|---|
| Endpoint | Required | Existing endpoint called by the task. |
| Enabled | Off for new tasks | Starts or pauses unattended execution. |
| Allow concurrent | Off | Prevents overlapping executions of the same task. |
| API Key | Empty for public/system endpoints | Bearer credential for a private endpoint in the same application. |
| Schedule mode | Interval | Selects fixed seconds or a cron expression. |
| Interval | 300 seconds | Frequency in interval mode. Minimum 1 second. |
| Cron | Empty | Five or six fields. Example: `0 7 * * 1-5` for weekdays at 07:00. |
| Execution timeout | 30 seconds | Aborts one run when the endpoint exceeds this duration. |
| Timezone | Empty or explicit IANA zone | Applies to cron and execution windows. Example: `America/Guayaquil`. |
| Window start/end | Empty | Optional daily `HH:MM` range in the selected timezone. |
| Days | Empty | Optional weekdays, `1` Monday through `7` Sunday. Example: `1,2,3,4,5`. |
| Date Start/End | Empty | Optional lifetime boundaries. They do not define frequency. |
| Note | Descriptive text | Identifies the purpose and helps match tasks during backup restore. |
| Max failed attempts | 10 | Disables the task after this many consecutive failures. |
| History limit | 50 | Number of runs retained. `0` disables history. |

These defaults are conservative: a new task is disabled, overlapping runs are blocked, executions
have a finite timeout, repeated failures stop automatically, and history remains bounded.

## Parameters

The recommended Parameters value is:

```json
{
  "data": {
    "id": 42
  },
  "headers": {
    "x-source": "scheduler"
  }
}
```

For `GET`, `HEAD` and `DELETE`, `data` becomes query parameters. For `POST`, `PUT` and `PATCH`, it
becomes the request body. Always include `data` when sending `headers`.

## Reading status and history

- **Current status — Waiting**: scheduled for a future run.
- **Current status — Running**: the endpoint is currently executing.
- **Last result — OK**: the last run completed successfully.
- **Last result — Error**: the endpoint or authentication failed.
- **Last result — Timeout**: execution exceeded the configured limit.

The task list uses **Waiting/Running** for what is happening now. Open the task or its History to
see the result of the previous execution; a task can correctly be **Waiting** with **Last result: OK**.

Failures use exponential backoff. When the maximum is reached, correct the underlying endpoint or
credential problem before using **Reset attempts**.

## Cron examples

| Requirement | Expression |
|---|---|
| Every 5 minutes | `*/5 * * * *` |
| Every day at 02:30 | `30 2 * * *` |
| Weekdays at 07:00 | `0 7 * * 1-5` |
| First day of each month at midnight | `0 0 1 * *` |

Use Interval rather than cron when the requirement is an elapsed cadence such as every 90 seconds.

## Troubleshooting

- If it never runs, check task, endpoint and application enabled states, dates, window and `next_run`.
- For 401/403 responses, verify the API Key is enabled, valid and belongs to the endpoint application.
- If history is empty, the task has not run or History limit is `0`.
- If the task disabled itself, inspect History, fix the cause and then reset attempts.
- To pause without losing configuration, turn off Enabled. Delete only when the schedule is no longer needed.

For API and MCP details, see [AI_SKILL.md](AI_SKILL.md). For runtime architecture and source locations,
see [README.md](README.md).
