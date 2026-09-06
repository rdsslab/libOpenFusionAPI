# Background Flows

- [1. Interval-task scheduler worker](#1-interval-task-scheduler-worker)
- [2. Bot lifecycle (Telegram, worker + failure policy)](#2-bot-lifecycle-telegram-worker--failure-policy)

Source references: `src/lib/timer/worker.js`, `src/lib/timer/schedule.js`,
`src/lib/timer/tasks.js`, `src/lib/server/bot-manager/manager.js`,
`src/lib/server/bot-manager/worker.js`, `src/lib/server/bot-manager/failurePolicy.js`.

---

## 1. Interval-task scheduler worker

Runs in a worker thread. It self-schedules the next tick from the next due task in DB instead
of a fixed interval, so idle systems do not poll in a tight loop.

```mermaid
flowchart TD
    A["scheduleTick(0) at worker start<br/>or new message wake"] --> T["tick()"]

    T --> G{"tickInProgress?<br/>(no overlapping cycles)"}
    G -- "yes" --> W["wakePending = true<br/>(re-run right after this cycle)"]
    G -- "no" --> REAP["reapStaleRunningTasks()<br/>release RUNNING tasks older than exec_time_limit"]
    REAP --> LOAD["getIntervalTaskProcess()<br/>load due tasks"]

    LOAD --> FOR["for each task"]
    FOR --> CAN["canRun(task, now)"]

    CAN --> C1{"in running set?<br/>unless allow_concurrent"}
    C1 -- "yes" --> NEXT
    C1 -- "no" --> C2{"status == RUNNING?<br/>unless allow_concurrent"}
    C2 -- "yes" --> NEXT
    C2 -- "no" --> C3{"isWithinWindow(now)?"}
    C3 -- "no" --> RESC["rescheduleIntervalTask(task)<br/>move next_run to next valid slot<br/>(status/consecutive failures untouched)"]
    RESC --> NEXT
    C3 -- "yes" --> RUN["running.add(idtask)<br/>set status RUNNING"]

    RUN --> FETCH["runFetchTask"]
    FETCH --> URL{"method and url set?"}
    URL -- "no" --> EF["finish ERROR 'Not url or method'"]
    URL -- "yes" --> TOKEN["resolveAuthToken"]
    TOKEN --> T1{"token resolved<br/>or access <= 0?"}
    T1 -- "no" --> ET["finish ERROR 'Missing credentials (idkey)'"]
    T1 -- "yes" --> OPT["buildRequestOptions → {data, headers}<br/>timeout = exec_time_limit * 1000 (default 30 s)"]
    OPT --> CALL["uF.method({ data, headers, timeout })<br/>Bearer token if app/system"]

    CALL --> OK{"HTTP 200?"}
    OK -- "yes" --> BODY{"Content-Type json?"}
    BODY -- "yes" --> J["resp.json()"]
    BODY -- "no" --> TXT["resp.text()"]
    J --> OUT["getResponseOutcome(data) → success?"]
    TXT --> OUT
    OUT -- "yes" --> FD["finish DONE + http_status 200"]
    OUT -- "no" --> FE["finish ERROR (app-level error payload)"]

    OK -- "no" --> CC{"401 or 403<br/>and idkey?"}
    CC -- "yes" --> DROP["invalidate apiKeyCache entry"]
    CC -- "no" --> DROP
    DROP --> EC["finish ERROR + http_status N"]

    CALL -- "throws" --> TO{"TimeoutError / AbortError?"}
    TO -- "yes" --> FT["finish TIMEOUT<br/>'Executed exceeded exec_time_limit'"]
    TO -- "no" --> FX["finish ERROR (message)"]

    FD --> FIN
    FE --> FIN
    EC --> FIN
    FT --> FIN
    FX --> FIN
    EF --> FIN
    ET --> FIN
    FIN["finishTask: updateIntervalTaskStatus<br/>history row + prune (history_limit)<br/>emit interval_task event → WS clients"]
    FIN --> NEXT["running.delete(idtask)"]
    NEXT --> FOR
    FOR --> NXT["getNextIntervalTaskRun → computeSchedulerDelay"]
    NXT --> SC{"wakePending?"}
    SC -- "yes" --> ST["scheduleTick(0)"]
    SC -- "no" --> SD["scheduleTick(nextDelay)"]
    ST --> T
    SD --> SLEEP["worker sleeps until next tick"]
```

Logging is done through a `LogBuffer` that flushes every 10 s (batch 100, buffer cap 200).

---

## 2. Bot lifecycle (Telegram, worker + failure policy)

Each bot runs in its own worker thread. The manager starts/stops workers; the worker loads user
code in a VM sandbox, validates the token with `getMe()`, and reports failure signals. The
manager classifies failures and decides **retry vs. quarantine vs. disable**.

```mermaid
flowchart TD
    A["worker: START message<br/>(token, code, botId, env, app_env_vars, traceId)"] --> SANDBOX["vm sandbox<br/>grammy + $BOT_TOKEN + functionsVars + app vars"]
    SANDBOX --> WRAP["wrap: $BOT = new grammy.Bot(token)<br/>+ user code"]
    WRAP --> VM["vm.Script + runInContext<br/>timeout 10 s (initial load only)"]

    VM -- "throws at load" --> CLSF["classifyStartupError"]
    CLSF --> CT{"errorType"}
    CT -- "SyntaxError/ReferenceError/<br/>no valid $BOT" --> CE["CODE_ERROR (permanent)"]
    CT -- "401" --> CI["INVALID_TOKEN (permanent)"]
    CT -- "403/404" --> CB["FORBIDDEN (permanent)"]
    CT -- "429" --> CR["RATE_LIMITED (transient)"]
    CT -- ">=500" --> CP["PROVIDER_ERROR (transient)"]
    CT -- "HttpError/network code" --> CN["CONNECTION_ERROR (transient)"]
    CT -- "else" --> CS["STARTUP_ERROR (unknown)"]
    CE --> ERR["postMessage ERROR → manager reacts<br/>process.exitCode=1, worker ends"]
    CI --> ERR
    CB --> ERR
    CR --> ERR
    CP --> ERR
    CN --> ERR
    CS --> ERR

    VM -- "load ok" --> GETME["bot.api.getMe() → authenticate"]
    GETME -- "ok" --> START["bot.start( drop_pending_updates,<br/>handleSignals:false,<br/>allowed_updates: message, callback_query )"]
    START --> POST["postMessage STARTED → runtime_status RUNNING<br/>(resets failure streak after BOT_HEALTHY_AFTER_MS=60 s)"]
    START -- "error" --> CLSF
    GETME -- "error" --> CLSF

    POST --> ERRB
    subgraph RUNT["manager failure policy (classifyBotFailure)"]
        ERRB["worker sends ERROR / BOT_ERROR / worker-created<br/>errorType + name + code + status + message"]
        ERRB --> CLASS{"classify as…"}
        CLASS -- "PERMANENT<br/>(invalid token, code error, forbidden)" --> P1{"consecutive >= 3<br/>(PERMANENT_DISABLE_ATTEMPTS)?"}
        P1 -- "yes" --> DIS["enabled=false<br/>runtime_status DISABLED_ERROR<br/>needs human action"]
        P1 -- "no" --> P2["backoff retry"]
        CLASS -- "TRANSIENT<br/>(connection, rate-limited, provider,<br/>network codes, 429, >=5xx)" --> T1{"consecutive >= 8<br/>(QUARANTINE_AFTER_ATTEMPTS)?"}
        T1 -- "yes" --> Q["QUARANTINED<br/>poll every nextBackoffMs(QUARANTINE tier)<br/>base 15 min → cap 60 min<br/>indefinitely"]
        T1 -- "no" --> F1["BACKOFF retry<br/>nextBackoffMs(FAST tier)<br/>base 10 s → cap 5 min, equal jitter"]
        CLASS -- "UNKNOWN" --> U1{"consecutive >= 4<br/>(QUARANTINE_AFTER_ATTEMPTS_UNKNOWN)?"}
        U1 -- "yes" --> Q
        U1 -- "no" --> F1
    end

    F1 --> A
    P2 --> A
    Q -- "poll again after backoff" --> A
    Q -- "back online" --> POST
    DIS --> H["human: fix token/code, re-enable"]
```

Runtime states (`ofapi_bot.runtime_status`): `STOPPED → STARTING → RUNNING`, plus
`BACKOFF`, `QUARANTINED`, `DISABLED_ERROR`. `enabled` is the user's intent: recoverable
failures never flip it; only persistent permanent failures do. During an outage the manager
holds every retry at the FAST cap (~5 min) until the connection returns.