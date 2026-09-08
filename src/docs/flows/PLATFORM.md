# Platform Flows

- [1. Server boot](#1-server-boot)
- [2. HTTP request lifecycle](#2-http-request-lifecycle)
- [3. Per-endpoint CORS & security headers](#3-per-endpoint-cors--security-headers)

Source references: boot in `src/lib/index.js`, request lifecycle in
`src/lib/server/runtime/*`, CORS/headers in `src/lib/server/runtime/registerCorePlugins.js`.

---

## 1. Server boot

```mermaid
flowchart TD
    A["src/server.js instantiates new server()"] --> B["ServerAPI constructor / _build()"]

    subgraph boot["module load"]
        C["dotenv: load .env"] --> D["JWT_KEY check<br/>warn if missing (non-fatal)"]
        D --> E["trustProxy parsed, dns ipv4first"]
    end

    B --> F["Fastify( bodyLimit, trustProxy )"]
    F --> G["registerCorePlugins"]
    G --> G1["formbody + multipart"]
    G --> G2["cookie (jwtKey secret)"]
    G --> G3["cors (global default policy)"]
    G --> G4["onSend hook (per-endpoint CORS + security headers)"]
    G --> G5["websocket plugin + static www/"]
    G1 --> H

    H["WebSocketManager"] --> I["buildDB()"]
    I --> I1{"BUILD_DB == TRUE<br/>dialect depends"}
    I1 -- "yes" --> I2["sync({alter:true})<br/>sqlite: PRAGMA foreign_keys handling"]
    I1 -- "no / afterwards" --> I3["Idempotent ensures"]
    I3 --> I4["ensureBotRuntimeColumns<br/>BotBackup.sync, BotLog.sync<br/>PasswordRecovery.sync<br/>ensureIntervalTaskColumns<br/>IntervalTaskRun.sync"]
    I4 --> I5["Seeds: defaultMethods, defaultUser, defaultApiClient, defaultApps"]
    I5 --> I6["getSystemToken<br/>(system token kept in-memory)"]

    I6 --> J["loadFunctionFiles (fn/system, fn/public)"]
    J --> K["_addFunctions (fnSystem/fnPublic built-ins)"]
    K --> L["EndpointRuntimeService wired<br/>(authService, runHandler, RateLimitService, events)"]
    L --> M["registerRequestLifecycle hooks<br/>onRequest / preValidation / onResponse / catch-all"]
    M --> N["webSocketManager.registerRoutes (/ws/*)"]
    N --> O["fastify.listen(port, host)"]

    O --> P["ServerReadyOrchestrator.start()"]
    P --> P1["Internal WS client connects<br/>subscribe /server/events"]
    P --> P2["TasksInterval.run()<br/>(interval-task scheduler worker)"]
    P --> P3["BackgroundTaskManager.startAll()<br/>SystemInfoTask · BotLifecycleTask · TimeSyncTask"]
```

---

## 2. HTTP request lifecycle

```mermaid
flowchart TD
    REQ["HTTP request arrives"] --> ONREQ["onRequest<br/>stamp request.startTime"]

    ONREQ --> PRE["preValidation (EndpointPreValidationService)"]
    PRE --> UA{"User-Agent empty<br/>AND not WebSocket?"}
    UA -- "yes" --> R403A["403 { error: Fail }"]
    UA -- "no" --> TRACE["ensureTraceId<br/>ofapi-trace-id generated or echoed"]
    TRACE --> URLP["getURLParams(url, method)"]
    URLP --> API{"Is an API route?<br/>(url_key present)"}
    API -- "no" --> NORMAL["Normal Fastify route / static / websocket"]
    API -- "yes" --> LOOKUP["endpoints.getEndpoint()"]
    LOOKUP --> FOUND{"Endpoint found<br/>and has handler?"}
    FOUND -- "no" --> R404["404 { error: Endpoint not found }"]
    FOUND -- "yes" --> RATE["applyRateLimit(ip, username)"]
    RATE --> BLOCKED{"isBlocked?<br/>429 retry-after"}
    BLOCKED -- "yes" --> R429["429 + Retry-After<br/>log possible_attack"]
    BLOCKED -- "no" --> EN{"Endpoint enabled?"}
    EN -- "no" --> R410["410 Endpoint unabled"]
    EN -- "yes" --> AP["authPolicy gate"]
    AP --> APDEN{"Policy allowed?"}
    APDEN -- "no" --> R403B["403 Auth policy denied"]
    APDEN -- "yes" --> AUTH["AuthService.check_auth<br/>attach request.openfusionapi.user"]
    AUTH --> HANDLE

    subgraph handle["handleApiRequest (EndpointRequestFlowService)"]
        HANDLE["reply already sent?"] -->|"no"| CTX["validateEndpointContext<br/>set ip_request"]
        CTX --> EVSTART["emit 'request_start'"]
        EVSTART --> CACHE{"cache_time > 0?"}
        CACHE -- "yes" --> HASH["hash_request + getPayload"]
        HASH --> HIT{"Cache HIT?"}
        HIT -- "yes" --> XHIT["X-Cache: HIT<br/>restore headers + respond 200"]
        HIT -- "no" --> XMISS["X-Cache: MISS"]
        XMISS --> RUN["runHandler"]
        CACHE -- "no" --> RUN2A["runHandler"]
        RUN --> HANDLER["handler.js dispatch<br/>(JS, SQL, FETCH, FUNCTION, ...)"]
        RUN2A --> HANDLER
    end

    HANDLER --> RESPHOOK["onResponse"]
    RESPHOOK -- "OPTIONS skipped" --> OPT
    RESPHOOK --> TIMING["compute response time (hrtime)"]
    TIMING --> TRACK["trackAuthFailure<br/>if statusCode==401 → rateLimitService.recordFailure"]
    TRACK --> LOG["saveLog (ofapi_log)"]
    LOG --> SETCACHE{"cache_time > 0?<br/>set cache"}
    SETCACHE -- "yes" --> WRITE["setCache(url_key)"]
    SETCACHE -- "no" --> EVEND
    WRITE --> EVEND["emit 'request_completed'"]

    EVEND --> ONSEND["onSend hook: per-endpoint CORS + security headers"]
    ONSEND --> RESP["HTTP response sent"]
    OPT["(skip)"] --> RESP
```

---

## 3. Per-endpoint CORS & security headers

Applies on every response in the `onSend` hook.

```mermaid
flowchart TD
    S["onSend hook"] --> ORIGIN["requestOrigin = req.headers.origin"]
    ORIGIN --> HASORIGIN{"Origin header present?"}
    HASORIGIN -- "no" --> SECHDR

    HASORIGIN -- "yes" --> EPC{"Endpoint declares its own<br/>cors allowlist/policy?"}
    EPC -- "yes" --> ALLOWED["normalizeEndpointCors + isOriginAllowed"]
    ALLOWED --> AOK{"Origin allowed?"}
    AOK -- "yes" --> SETEP["Access-Control-Allow-Origin = * or request origin<br/>credentials → ACAC true"]
    AOK -- "no" --> RMEP["Remove ACAO + ACAC headers"]

    EPC -- "no" --> DENY{"CORS_DEFAULT_DENY=true?"}
    DENY -- "yes" --> RMDEF["Remove ACAO + ACAC headers"]
    DENY -- "no" --> GLOB{"Global cors configured with<br/>origin: true or a function?"}
    GLOB -- "yes" --> SETG["ACAO = request origin<br/>credentials → ACAC true"]
    GLOB -- "no" --> SECHDR

    SETEP --> SECHDR
    RMEP --> SECHDR
    RMDEF --> SECHDR
    SETG --> SECHDR

    SECHDR["Security headers (always applied):<br/>X-Content-Type-Options: nosniff<br/>X-Frame-Options: DENY<br/>Referrer-Policy: no-referrer<br/>Permissions-Policy: geolocation=(), microphone=(), camera=()"] --> DONE["Response sent"]
```