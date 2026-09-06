# Runtime & Handler Flows

- [1. Handler dispatch](#1-handler-dispatch)
- [2. Cache (HIT / MISS)](#2-cache-hit--miss)
- [3. JS handler sandbox](#3-js-handler-sandbox)
- [4. MCP handler invocation](#4-mcp-handler-invocation)

Source references: `src/lib/handler/handler.js`, `src/lib/handler/*`,
`src/lib/server/createFunctionVM.js`, `src/lib/server/endpoint/handlerBuild/mcp.js`,
`src/lib/handler/mcpFunction.js`.

---

## 1. Handler dispatch

```mermaid
flowchart TD
    A["runHandler(request, reply, endpoint, server_data)"] --> N["Normalize handler name"]
    N --> L["handler = Handlers lookup<br/>by endpoint.handler"]
    L --> NA{"Handler missing<br/>and name == 'NA'?"}
    NA -- "yes" --> REMAP["Remap to TEXT<br/>endpoint.handler = 'TEXT'"]
    REMAP --> VALID
    NA -- "no" --> VALID{"handler && handler.fn present?"}
    VALID -- "no" --> BAD["404 { error: Handler '<name>' no es valido }"]
    VALID -- "yes" --> DISP["await handler.fn({ request, reply, endpoint, server_data })"]
    DISP --> OUT["Response through sendHandlerResponse"]
    DISP -- "throws" --> ERR["replyException → 500"]
```

Handler table (keys of the `Handlers` map):

| Key | Handler | Implementation |
|---|---|---|
| `JS` | JavaScript | `jsFunction` — sandboxed VM (see §3) |
| `FETCH` | Fetch | `fetchFunction` — HTTP proxy (uFetch) |
| `SOAP` | SOAP | `soapFunction` — SOAP→REST |
| `SQL` | SQL | `sqlFunction` — Sequelize |
| `SQL_BULK_I` | SQL Bulk Insert | `sqlFunctionInsertBulk` |
| `HANA` | HANA | `sqlHana` — SAP HANA client |
| `TEXT` | Text | `textFunction` — static content |
| `FUNCTION` | Function | `customFunction` — registered server fn |
| `MONGODB` | MongoDB | `mongodbFunction` |
| `MCP` | MCP | `mcpFunction` — MCP server (see §4) |
| `NA` | Not Assigned | remapped to TEXT at runtime |

---

## 2. Cache (HIT / MISS)

```mermaid
flowchart TD
    A["handleApiRequest"] --> C{"cache_time > 0?"}
    C -- "no" --> RUN["runHandler directly"]
    C -- "yes" --> H["hash_request = hash(app, resource, env, method)<br/>getPayload"]
    H --> HIT{"data_cache present?"}
    HIT -- "yes" --> HDR["X-Cache: HIT<br/>restore cached headers"]
    HDR --> R200["respond 200 with cached data"]
    HIT -- "no" --> MISS["X-Cache: MISS"]
    MISS --> RUN
    RUN --> RESP{"onResponse"}
    RESP --> WRITE{"cache_time > 0<br/>and idendpoint?"}
    WRITE -- "yes" --> SET["setCache(url_key, request, reply)"]
    WRITE -- "no" --> END["finish"]
```

---

## 3. JS handler sandbox

```mermaid
flowchart TD
    A["EndpointLoader._initVmHandler → createFunctionVM(code, app_vars, timeout)"] --> BUILD["Build wrapped code as async IIFE"]
    BUILD --> TIMERS["Wrap setInterval/clearInterval/setTimeout<br/>setTimeout/clearTimeout → track resources"]
    TIMERS --> TPO["timeoutPromise:<br/>after timeoutVM ms → controller.abort()<br/>+ reject 'JS handler execution timeout'"]
    TPO --> CODE["Inject user code as __executeUserCode"]
    CODE --> RACE["await Promise.race([user code, timeoutPromise])"]
    RACE --> CLN["finally: clearTimeout, abort, cleanup tracked timers"]
    CLN --> RET["return { data: $_RETURN_DATA_,<br/>headers: $_CUSTOM_HEADERS_ }"]

    BUILD --> COMP["compile once via new vm.Script"]

    subgraph PERREQ["Per-request (reusable compiled fn)"]
        CL["structuredClone app vars"] --> SAN["sandbox =<br/>{ customVarsAndFunctions, ...appVars,<br/>$_APP_VARS_, timers, AbortController }"]
        SAN --> CTX["vm.createContext with<br/>codeGeneration: { strings:false, wasm:false }"]
        CTX --> RUN["runInContext(timeout = timeoutVM + 5000)<br/>breakOnSigint true"]
    end

    RET --> SEND["jsFunction sends { statusCode:200, data, headers }"]
    COMP --> CL
    RUN -- "AbortSignal wired to user I/O" --> SEND
    RUN -- "throws" --> SERR["replyException → 500"]
```

> The sandbox disables `eval`/`new Function`/WASM (`codeGeneration` off). A dual timeout guards
> execution: the in-VM `Promise.race` (AbortSignal) and a VM-level hard timeout with 5 s slack.

---

## 4. MCP handler invocation

```mermaid
flowchart TD
    A["Client calls an MCP endpoint (Streamable HTTP)"] --> B["runHandler → mcpFunction"]
    B --> F{"server_mcp factory present?"}
    F -- "no" --> THROW["init error → JSON-RPC error -32603 / HTTP 500"]
    F -- "yes" --> S["server = serverFactory(request.headers)<br/>fresh isolated McpServer with all tools"]
    S --> T["StreamableHTTPServerTransport<br/>+ server.connect(transport)"]
    T --> H["transport.handleRequest(req, res, body)"]

    H --> TP{"Method"}
    TP -- "tools/list" --> TL["Return registered tool list<br/>(schemas from json_schema → Zod)"]
    TP -- "tools/call" --> TC["tool.handler(data, ctx, currentHeaders)"]

    TC --> UNW{"shouldUnwrapSingleValueInput<br/>and data.value?"}
    UNW -- "yes" --> U["unwrap data = data.value"]
    UNW -- "no" --> M["(data as is)"]
    U --> MAP["Map tool → internal endpoint URL<br/>URLAutoEnvironment + uF.auto(url, true)"]
    M --> MAP
    MAP --> SAN["Sanitize incoming headers<br/>(strip host/content-type/length)"]
    SAN --> CALL["uF.method() with data + auth headers"]
    CALL --> RES{"HTTP ok?"}
    RES -- "yes" --> BLOCK["Return MCP content block<br/>{ type:'text', mimeType, text, statusCode }"]
    RES -- "no" --> ERR["Return { type:'text', text:'Error: …', statusCode:500 }"]
    BLOCK --> OK["JSON-RPC response via transport → client"]
    ERR --> OK
```

> MCP tools are built only from endpoints with `mcp.enabled === true` (non-WS, non-MCP
> handler). The catalog tools `list_api_endpoints_*` and the handler/library skill tools
> (`get_handler_skill`, `validate_json_schema_for_mcp`) are registered alongside them.