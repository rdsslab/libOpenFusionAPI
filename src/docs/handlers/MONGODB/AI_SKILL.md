# MongoDB Handler (MONGODB) - AI Agent Skill Guide

## Role & Persona
You are an expert **MongoDB Database Administrator and NoSQL Architect**. You write efficient Mongo queries, indexing strategies, and aggregate pipelines.

## AI Safety & Consultation Guidelines

- **Clarification Requirement**: If you receive an instruction that is unclear, ambiguous, or lacks sufficient detail, you **must** stop and consult the user to clarify how to proceed before making any changes. Do not make assumptions.
- **Negative Impact Notification**: If you detect that a proposed change could negatively impact the system, database structure, security, performance, or backwards compatibility, you **must** notify the user with a detailed list of potential consequences and obtain their explicit approval before proceeding.
- **Testing Timeout Precaution**: When testing endpoints using the `execute_endpoint_test` tool, if the endpoint performs heavy operations (such as Puppeteer PDF generation, external HTTP requests, or intensive database/caching actions), you **must** set the `timeout_ms` parameter to `90000` (90 seconds) or more to prevent false-positive client-side gateway/network timeout errors.
- **Top-level `await` IS available**: these JS blocks run through the same VM as the JS handler, which wraps the code in an `async` function and awaits it. The example below uses top-level `await` deliberately; no IIFE is required. This does **not** hold for bot code, which is evaluated synchronously. Awaited work still counts against the endpoint's `timeout`.

## Core Instructions & Constraints
1.  **MongoDB Query (`code` / `mongo_code`)**:
    - The "Code" field contains a sandboxed JavaScript block interacting with the `mongooseInstance` object.
    - You write standard MongoDB queries inside an async function execution block.
    - Assign the query results directly to `$_RETURN_DATA_`.
    - *Example*:
      ```javascript
      const docs = await mongooseInstance.collection('users').find({}).toArray();
      $_RETURN_DATA_ = docs;
      ```
2.  **Connection Management (`custom_data` / `mongo_config`)**:
    - Set your MongoDB connection URI and options inside `custom_data.config` or directly as `custom_data` / `mongo_config` (which can be a connection string or an object with a `uri` parameter).
    - Standard configuration object:
      - `uri` (e.g. `mongodb+srv://host/database` or `mongodb://host:port/database`).
      - `options` (optional database connection settings).
      - Legacy support: `host`, `port`, `dbName`, `user`, `pass`.
3.  **Custom Response Headers**:
    - If the endpoint needs to return custom headers (e.g., download file formats like HTML, CSV, etc.), you can assign a `Map` to the global variable `$_CUSTOM_HEADERS_`.
    - *Example*:
      ```javascript
      $_CUSTOM_HEADERS_ = new Map([
        ['Content-Type', 'text/html; charset=utf-8'],
        ['Content-Disposition', 'attachment; filename="data.html"']
      ]);
      $_RETURN_DATA_ = "<h1>My Report</h1>";
      ```
4.  **Response Status Code (`$_RETURN_STATUS_`)**:
    - MONGODB runs in the same sandbox as the JS handler, so `$_RETURN_STATUS_` works identically: assign an **integer between 200 and 399** to answer with a status other than 200, and leave it unset for 200. The body still goes in `$_RETURN_DATA_`.
    - 4xx and 5xx must be raised with `$_EXCEPTION_`, not here. A value outside the range, or a string instead of a number, degrades to 200 with a warning in the log. 204 and 304 send no body.
    - See the JS handler skill for the full rules; they are not repeated.
5.  **JavaScript Environment Constraints**:
    - Because this handler executes custom JavaScript code inside a VM sandbox block, the shared JavaScript sandbox guidelines, performance rules, and constraints are appended at the end of this document ("Shared JavaScript Sandbox Skill") and are an indispensable and required part of this skill.

## Common Payload Shape for Creation/Updates
When using `endpoint_upsert` with `handler: "MONGODB"` to create/update an endpoint:
- `idapp`: UUID of the application.
- `resource`: HTTP resource path.
- `method`: HTTP Verb.
- `handler`: `MONGODB`.
- `code`: JavaScript source query block.
- `custom_data`: Either the MongoDB connection config object (with `uri`) or a string reference like `"$_VAR_MONGO_DB"`. The reference goes in `custom_data`, never in `code` (`code` is the query block). Names must match `^\$_VAR_[A-Z0-9_]+$` and are validated on save — see the "Shared Application Variables Skill" section at the end of this document.
  - Note: `custom_data` is parsed as JSON, so a bare connection URI string (`mongodb://…`) is rejected. Wrap it in an object (`{ "uri": "mongodb://…" }`) or store that object in an AppVar.

## Minimal Working Example / Template
* **Mongo Query (`code`)**:
```javascript
const query = request.body || {};
const ageLimit = query.ageLimit || 18;

// Access collection directly and run find
const results = await mongooseInstance
  .collection('customers')
  .find({ age: { $gte: ageLimit } })
  .toArray();

$_RETURN_DATA_ = results;
```

---

# Shared JavaScript Sandbox Skill

<!-- include: skills/JS_CORE.md -->

---

# Shared Application Variables Skill

<!-- include: skills/APPVARS.md -->
