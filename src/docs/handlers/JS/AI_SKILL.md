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

## Common Payload Shape for Creation/Updates
When creating or modifying a JS endpoint using `upsert_js_endpoint_handler`, your input payload should contain:
- `idapp`: UUID of the application.
- `environment`: `'dev'`, `'qa'`, or `'prd'`.
- `resource`: HTTP path (e.g., `/scripts/my-logic`).
- `method`: HTTP Verb (e.g., `POST`).
- `access`: Access level code (0-4).
- `js_code`: The JS script contents.
- `timeout`: Max execution time in seconds.

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
