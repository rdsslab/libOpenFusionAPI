# JS Handler - AI Agent Skill Guide

This handler executes JavaScript in a `node:vm` sandbox to serve an **HTTP endpoint**. The shared JavaScript sandbox rules are included below; the sections after it cover what is specific to the HTTP endpoint context.

<!-- include: skills/JS_CORE.md -->

---

## HTTP Endpoint Contract

These rules apply **only** when the JavaScript runs as an HTTP endpoint. They do not apply to bot code (see the `get_bot_skill` MCP tool).

1. **Response Contract (`$_RETURN_DATA_`)**:
   - Do **NOT** use top-level `return` statements to output data.
   - Instead, assign your final response payload (any JSON-serializable value) directly to the pre-injected variable `$_RETURN_DATA_`.
   - *Example*: `$_RETURN_DATA_ = { success: true, count: 10 };`

2. **Request Context**:
   - `request.query`: Object containing GET query parameters.
   - `request.body`: Object containing the parsed POST/PUT JSON body.
   - `request.headers`: Object containing incoming HTTP headers.

3. **Response Headers Customization**:
   - To send custom response headers, use the map `$_CUSTOM_HEADERS_` (e.g. `$_CUSTOM_HEADERS_.set('Content-Type', 'text/csv')`).

4. **Response Status Code (`$_RETURN_STATUS_`)**:
   - The success path answered `200` only, with no way to say otherwise. Assign an **integer between 200 and 399** to `$_RETURN_STATUS_` to answer with something else. Leaving it unset keeps `200`.
   - The body is unaffected: it still goes in `$_RETURN_DATA_`.
   - *Example*: an events receiver that must distinguish "events were created" from "everything was a duplicate" —
     ```js
     const created = [];
     for (const ev of request.body.events ?? []) {
       if (await insertIfNew(ev)) created.push(ev.id);
     }
     $_RETURN_DATA_ = { created: created.length };
     $_RETURN_STATUS_ = created.length > 0 ? 201 : 200;
     ```
   - Assign a **number**. `$_RETURN_STATUS_ = "201"` is rejected and falls back to 200 with a warning: a string a `Number()` would convert would hide the mistake rather than surface it.
   - **4xx and 5xx are not accepted here.** Raise errors with `$_EXCEPTION_` instead, which is the path that builds the standard error payload with its `trace_id`. Two ways to produce an error means the client cannot tell which shape it is looking at.
   - An out-of-range or non-integer value degrades to `200`, not to `500`, and logs a warning. The endpoint produced valid data; only the number was mistyped, and the caller should not pay for it.
   - **204 and 304 send no body** — the protocol forbids one, so `$_RETURN_DATA_` is discarded. Do not put the only copy of a result in there when answering 204.
   - The status survives response caching. An endpoint that answered 203 answers 203 from cache too, rather than degrading to 200 on the second identical request.
   - A 3xx with no `Location` header logs a warning. It is still sent — the destination may be carried in the body — but a client cannot follow a redirect that does not say where to.

5. **Testing Timeout Precaution**:
   - When testing endpoints using the `execute_endpoint_test` tool, if the endpoint performs heavy operations (such as Puppeteer PDF generation, external HTTP requests, or intensive database/caching actions), you **must** set the `timeout_ms` parameter to `90000` (90 seconds) or more to prevent false-positive client-side gateway/network timeout errors.

6. **Top-level `await` IS available**:
   - The endpoint code is wrapped in an `async` function and awaited by the runtime, so top-level `await` works. You can write `const rows = await uFetchAutoEnv.get('/api/x/auto')` directly at the top level of the script, with no IIFE and no `.then()`.
   - This is the **only** JavaScript context where that holds. Bot code is evaluated synchronously and rejects top-level `await`; see the bot skill. Do not carry the habit across contexts.
   - Every await still counts against the endpoint's `timeout` (seconds). If the script exceeds it, the VM is aborted with "JS handler execution timeout".

---

## Agent Kit

The sandbox injects a provider-agnostic **agent kit** so an endpoint can answer with an LLM,
search the web, read documents or handle audio/video without wiring providers by hand. It is
independent of any bot, HTTP layer or database, and it is available in bot sandboxes too.

**Named helpers** (prefer them for readability):

| Helper | What it does |
| --- | --- |
| `askAgent(options)` | Runs **one stateless** LLM turn with tools, deterministic pre-search, in-memory media/documents and a single result envelope. |
| `AgentSession(options)` | Runs **multi-turn** conversations: owns history and memory, recalls past facts, compacts the context and emits events. |
| `webSearch(options)` | Web search with a provider chain (DuckDuckGo → Bing → http-json). |
| `readDocument(input, options)` | Extracts text from an in-memory PDF, DOCX or text file. |
| `transcribeAudio(input, options)` | Speech to text through the configured STT providers. |
| `synthesizeSpeech(text, options)` | Text to speech through the configured TTS providers. |
| `extractVideoFrames(input, options)` | Extracts stills from a video container as base64 JPEGs. |
| `describeMediaSupport(options)` | Reports which media capabilities are available right now. |

**`agentKit`** is the full namespace: use it for the policy helpers (`looksLikeWebQuery`,
`cleanWebQuery`, `formatWebRecap`, `mergeQuoted`), `MemoryStore`, `createOllamaTokenCounter`,
`checkGrounding`, the buffer helpers and the media-provider registries.

`askAgent()` does not remember anything between calls: re-send `messages`/`history` or use
`AgentSession`. A session keeps the history inside the instance, searches it with hybrid
memory (lexical always, cosine when embeddings are available), compacts at a configurable
share of the context window and reports every step through one `onEvent({ type, at, turn, ... })`
callback. Pass `eventLevel: 'compact'` when the endpoint only needs milestones (`done`,
`recall`, `compaction_*`, `error`); the default `full` forwards every streaming delta.

```javascript
// Read a PDF that arrived as base64 and answer with the model.
const doc = await readDocument(
  { data: Buffer.from($_BODY_.file_base64, 'base64'), mimeType: 'application/pdf' },
  { maxChars: 40000 }
);

const answer = await askAgent({
  provider: { provider: 'ollama', model: 'llama3.2:3b', baseUrl: OLLAMA_URL + '/v1', apiKey: 'ollama' },
  system: 'Answer briefly and never invent data.',
  messages: [{ role: 'user', content: doc.text }]
});

$_RETURN_DATA_ = { chars: doc.chars, answer: answer.text };
```

Multi-turn example (create the session inside the endpoint; it is not shared between requests):

```javascript
const events = [];
const session = new AgentSession({
  provider: {
    provider: 'ollama',
    model: 'llama3.2:3b',
    baseUrl: OLLAMA_URL,
    contextLength: 8192,
  },
  system: 'Answer briefly. Use the conversation history when it is relevant.',
  memory: { mode: 'hybrid', topK: 5, budget: 1800 },
  context: { thresholdPercent: 90 },
  eventLevel: 'compact',
  onEvent: (event) => events.push(event.type),
});

await session.ask('Hi, I am Ana');
const reply = await session.ask('What is my name?');

$_RETURN_DATA_ = { text: reply.text, events, stats: session.stats() };
```

**Rules**

- Nothing is written to disk: documents, audio and video are processed entirely in memory.
- The kit is **not** a Telegram client and knows nothing about bots. Keep the bot's own logic
  (commands, handlers, keyboards) in the bot code; keep only the reusable harness here.
- Providers are explicit. Pass the provider config (`type`, `baseUrl`, `apiKey`, `voice`...) in
  the options; the kit never reads credentials from the database by itself.
- `readDocument` returns `{ ok, kind, text, truncated, pages, chars, mimeType, fileName }`.
  Check `truncated` and tell the caller when only part of the document was read.
- Errors thrown by the kit carry a `userMessage` suitable for showing to an end user, next to
  the technical `message` and a `code` such as `PDF_NO_TEXT` or `FFMPEG_FAILED`.
- `askAgent()` returns `text`, `usedWeb`, `webResults`, `documents`, `media`, `mode`,
  `injectedContextChars` and `injectedContext` in one envelope. `usage` and detailed
  `toolExecutions` are `null`/empty unless `includeDiagnostics: true` is set; keep diagnostics in
  logs, not in the HTTP response.
- Never pass `history`, `prompt`, `messages` or event callbacks to `session.ask()`: the session
  owns them and ignores those keys. Use `session.ask(text, { recall: false })` to skip one lookup.
- A session is process-local with in-memory `MemoryStore`: create it inside the endpoint and do
  not promise recall across HTTP requests unless your own code persists and restores `history`.

Full reference for each helper: `GET /api/handler/js/libraries?handler=JS&library=<name>`
(or `agentKit` for the namespace).

---

## Common Payload Shape for Creation/Updates
When creating or modifying a JS endpoint using `endpoint_upsert` with `handler: "JS"`, your input payload should contain:
- `idapp`: UUID of the application.
- `resource`: HTTP path (e.g., `/scripts/my-logic`).
- `method`: HTTP Verb (e.g., `POST`).
- `handler`: `JS`.
- `access`: Access level code (0-4).
- `code`: The JS script contents.
- `timeout`: Max execution time in seconds.
- `environment`: `'dev'`, `'qa'`, or `'prd'` (defaults to `dev` if omitted).
  - `exclusive`: Optional boolean (default `false`). When `true`, the endpoint accepts one execution at a time from any origin (scheduled task, forced run, GUI Tester, `execute_endpoint_test`, direct HTTP). A second concurrent call receives `409 ENDPOINT_LOCKED`. The lease lasts `timeout` + 30 s. Enable it only where concurrent execution would corrupt state.

---

## Operator Abort Signal

An operator can cut a running execution with `stop_interval_task_run`. The request receives an
`X-OFAPI-Abort-Token` header and the endpoint code has two helpers:

- `$_ABORT_SIGNAL_` — native `AbortSignal` (useful with `fetch`, database drivers, etc.).
- `$_ABORT_CHECK()` — throws `AbortError` if the operator called stop.

```javascript
if ($_ABORT_TOKEN_) {
  console.log('Abort token present:', $_ABORT_TOKEN_);
}

for (const item of largeArray) {
  $_ABORT_CHECK(); // throws if operator called stop_interval_task_run
  await process(item);
}
```

`$_ABORT_CHECK()` throws a `TimeoutError` with message `Execution aborted by operator`; the run is
recorded as status `5` (aborted) and does **not** increment `failed_attempts`.

---

## Minimal Working Example / Template
```javascript
const query = request.query || {};
const name = query.name || "World";

// Assign response to pre-injected variable
$_RETURN_DATA_ = {
  message: `Hello, ${name}!`,
  timestamp: new Date().toISOString()
};
```

---

# Shared Application Variables Skill

<!-- include: skills/APPVARS.md -->
