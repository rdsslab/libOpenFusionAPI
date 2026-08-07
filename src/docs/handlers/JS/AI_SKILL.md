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

4. **Testing Timeout Precaution**:
   - When testing endpoints using the `execute_endpoint_test` tool, if the endpoint performs heavy operations (such as Puppeteer PDF generation, external HTTP requests, or intensive database/caching actions), you **must** set the `timeout_ms` parameter to `90000` (90 seconds) or more to prevent false-positive client-side gateway/network timeout errors.

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
