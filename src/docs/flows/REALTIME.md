# Real-time Flows

- [1. WebSocket client connection & messaging](#1-websocket-client-connection--messaging)
- [2. Server events pushed to subscribers](#2-server-events-pushed-to-subscribers)

Source references: `src/lib/server/websocket_manager.js`, `src/lib/server/websocket_client.js`,
`src/lib/index.js`.

---

## 1. WebSocket client connection & messaging

```mermaid
flowchart TD
    A["Client connects to /ws/* (WebSocket)"] --> PRE["Normal preValidation resolves the endpoint"]
    PRE --> OPEN["connection.openfusionapi = req.openfusionapi"]
    OPEN --> MSG["message received"]

    MSG --> PARSE{"Valid JSON?"}
    PARSE -- "no" --> CLOSE_ERR["send error + close"]
    PARSE -- "yes" --> CH{"Channel name format valid?"}
    CH -- "no" --> CLOSE_ERR
    CH -- "yes" --> SCHEMA{"Message schema valid?"}
    SCHEMA -- "no" --> CLOSE_ERR
    SCHEMA -- "yes" --> IDC{"idclient absent<br/>and channel != '/subscribe'?"}
    IDC -- "yes" --> CLOSE_ERR
    IDC -- "no" --> DISP["dispatchCommand(connection, msgObj)"]

    DISP --> CAT{"Command?"}
    CAT -- "/subscribe" --> SUB["validate channel → set channel,<br/>generate idclient, add to subscribers map<br/>reply { subscribed:true }"]
    CAT -- "/ping" --> PING["reply /pong"]
    CAT -- "none / other" --> BC{"idclient set?"}
    BC -- "yes" --> BCAST["handleBroadcast: forward payload<br/>to all subscribers of (idendpoint, channel)<br/>with readyState OPEN and different idclient"]
    BC -- "no" --> CLOSE_ERR

    SUB --> ASYNC["close → removeWsSubscriber"]
```

Format of an outgoing broadcast message:

```json
{ "channel": "<channel-name>", "sendFrom": "<idclient>", "payload": { } }
```

---

## 2. Server events pushed to subscribers

The server maintains an internal WebSocket client that subscribes to the `/server/events`
channel. Any `_emitEndpointEvent(event_name, data)` forwards to that channel; browser clients
subscribed to the same channel receive them.

```mermaid
flowchart TD
    SRC["Event producers"] --> EMIT["_emitEndpointEvent(event_name, data)"]
    EMIT --> SEND["Push to /server/events channel<br/>{ channel:'/server/events',<br/>payload:{ event_name, timestamp, data } }"]
    SEND --> SUB["Subscribed clients receive the event"]

    subgraph PROD["Producers"]
        A["request_start / request_completed<br/>(runtime)"]
        B["interval_task<br/>(TasksInterval worker events)"]
        C["database_hook<br/>(model hooks invalidation)"]
        D["cache_set / cache_released<br/>(cache events)"]
        E["system_information<br/>(SystemInfoTask, every 3 s)"]
        F["bot_changed / bot_status_changed<br/>(bot lifecycle)"]
    end
```

| Event(s) | Producer | Payload highlights |
|---|---|---|
| `request_start`, `request_completed` | EndpointRequestFlowService | endpoint metadata, statusCode, responseTime |
| `interval_task` | timer worker via TasksInterval | task id, status (RUNNING/DONE/ERROR/TIMEOUT), duration |
| `database_hook` | model hooks | model/table changed |
| `cache_set`, `cache_released` | cache | app/resource/key |
| `system_information` | SystemInfoTask | only when >1 WS client connected |
| `bot_changed`, `bot_status_changed` | bot manager / lifecycle | bot id, runtime_status, failure info |