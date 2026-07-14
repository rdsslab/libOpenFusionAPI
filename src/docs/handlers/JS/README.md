# JS Handler – Server-Side JavaScript Execution

The **JS handler** enables the execution of raw JavaScript code on the server. This is the most flexible handler, allowing for complex logic, data transformation, multiple API calls, and custom algorithmic processing.

---

<details>
<summary>🧠 How It Works</summary>

When an endpoint is configured with the **JS** handler:
1.  **Sandboxing**: The code provided in the configuration is wrapped in an async function and executed within a Node.js VM context (using `createFunctionVM`).
2.  **Context Injection**: The function receives a context object providing access to the HTTP request, response helpers, and environment variables.
3.  **Execution**: The script runs inside the VM sandbox with helper variables injected into scope.
4.  **Response**: To send a response you must assign a value to `$_RETURN_DATA_`. Custom headers can be assigned to `$_CUSTOM_HEADERS_`.

</details>

---

<details>
<summary>⚙️ Endpoint Configuration</summary>

The configuration area accepts raw JavaScript code. The code must essentially form the body of an asynchronous function.

**Available Context Variables**:
You have access to a context object (implied) with helper functions injected via `functionsVars`:

---

## Log Level (log_level)

Muchos endpoints y herramientas MCP permiten configurar el nivel de log para cada petición. Los valores posibles y su significado son:

| Valor     | Nombre     | Descripción                                                                 |
|-----------|------------|-----------------------------------------------------------------------------|
| 0         | Disabled   | No se guarda ningún log para la petición.                                    |
| 1         | Basic      | Solo los campos mínimos (timestamp, método, status, ids, etc.).              |
| 2         | Normal     | Incluye parámetros, query, body, user agent, etc.                            |
| 3         | Full       | Incluye todo lo anterior más headers completos y respuesta serializada.       |

**Uso recomendado:**
- Usa `Basic` para monitoreo ligero.
- Usa `Normal` para depuración estándar.
- Usa `Full` solo para auditoría o troubleshooting profundo (puede incluir datos sensibles o grandes).
- Usa `Disabled` para endpoints donde no se requiere ningún registro.

En los schemas y herramientas MCP, el campo `log_level` acepta estos valores (0-3) y puede aparecer como `integer` o como selector textual en UIs.
-   `request.query` — Query string parameters for GET endpoints (object).
-   `request.body` — Parsed JSON body for POST endpoints; also used for multipart form-data fields.
-   `request.headers` — Incoming HTTP headers.
-   `$_APP_VARS_` — Object containing all resolved Application Variables for the current environment.
-   App Vars are also injected directly into the sandbox using their exact names, so `$_VAR_EMAIL_TRANSPORT` can be referenced directly when that App Var exists.
-   `custom_data` is not injected into the JS sandbox. It belongs to handler-specific configuration flows such as SQL, BOT, SOAP, TEXT, or FETCH, while the JS VM uses `code`, `app_vars`, request context, and the built-in helpers listed here.
-   `$_RETURN_DATA_` — Assign any JSON-serializable value here to send it as the response body.
-   `$_CUSTOM_HEADERS_` — Optional `Map<string, string>` with custom response headers (e.g., for file downloads).
-   `uFetchAutoEnv` — Built-in helper for calling other endpoints within the same OpenFusionAPI instance.
-   `request_xlsx_body_to_json(request)` — Built-in async helper that parses a multipart/form-data XLSX upload into a JSON array.
-   `askIAWithMCP(options)` — Built-in async helper for AI chats with optional MCP tool usage.
-   `listMcpTools(options)` — Built-in async helper that lists the tools exposed by one or more MCP servers.

**App Vars Access Recommendation**:
-   Prefer `$_APP_VARS_['$_VAR_NAME']` in documentation, agents, and reusable snippets because it is explicit and avoids ambiguity.
-   Direct access like `$_VAR_NAME` is supported and convenient, but it depends on the exact App Var name being present in the sandbox scope.
-   The dual exposure is intentional. It does not duplicate values in storage; it only creates two access paths to the same runtime data.

`uFetch` / `uFetchAutoEnv` note:
- `@rdsslab/uFetch` changes over time. Before creating or editing endpoint code that depends on it, verify the current official documentation or the installed package version.
- Do not assume legacy aliases such as `GET()` or `POST()` are still the preferred API.

`uFetch` source-of-truth policy (hybrid):
- For repository integration patterns in this handler, this local document is the operational source of truth.
- For package-level API contracts, the upstream docs are canonical.
- If they differ, update this local guide immediately with a compatibility note and migration guidance.
- Dedicated dependency guide for maintainers and agents: [../../dependencies/uFetch.md](../../dependencies/uFetch.md).
- Last local verification against upstream contract: `2026-07-14`.

`uFetch.batch` quick reference:
- Signature: `batch({ url, method = 'GET', items, headers, options, timeout, config: { concurrency = 5, onProgress, responseParser, includeResponse = false } })`
- `url` is optional when the `uFetch` instance already has a base URL; use it only to override that base URL for the batch call.
- If an item includes any of `{ url, method, data, body, headers, options, timeout }`, those fields override the base values for that item.
- `timeout` can be defined globally per `batch(...)` call and overridden per item.
- Positional signature `batch(url, method, items, headers, options, config)` is no longer supported; use `batch_old(url, method, items, headers, options, config)` only for legacy compatibility.
- Result shape per item (default): `{ isError, httpCode, data?, error? }`
- If you explicitly set `config.includeResponse = true`, each result can also include `response`.
- `uFetchAutoEnv.create(...)` returns a `uFetch` instance, so `batch(...)` works there too.

When to use each approach:
- Use `get/post/put/patch/delete` for normal endpoint-to-endpoint calls or short request chains.
- Use `batch(...)` when you have a list/lote of input data and need to split it into concurrent workers (threads/blocks) with a controlled `concurrency` value.
- Prefer `batch(...)` over `Promise.all(...)` when you need fail-safe per-item results instead of failing the entire workload on the first rejected promise.
- Use `batch_old(...)` only when you must keep an existing positional integration while migrating to the object signature.

Quick decision (at a glance):
- One call to one endpoint: use `get/post/put/patch/delete`.
- Many calls derived from a lote/list: use `batch({ method, items, config: { concurrency, ... } })`.
- Need per-item error reporting without aborting all: use `batch(...)`.
- Existing positional code that cannot be refactored immediately: use `batch_old(...)` as a temporary compatibility bridge.

Batch example for internal endpoint fan-out (40 calls in 5 parallel workers):

```javascript
const soapFetch = uFetchAutoEnv.create('/api/demo/ofapi/soap/example01/auto');

const items = Array.from({ length: 40 }, (_, i) => ({ dNum: i + 1 }));

const batchResults = await soapFetch.batch({
  method: 'GET',
  items,
  config: {
    concurrency: 5,
  },
});

const responses = await Promise.all(
  batchResults.map(async (entry, index) => {
    if (entry.isError) {
      return {
        index,
        input: items[index],
        isError: true,
        httpCode: entry.httpCode,
        error: entry.error?.message || String(entry.error),
      };
    }

    return {
      index,
      input: items[index],
      isError: false,
      httpCode: entry.httpCode,
      data: entry.data,
    };
  })
);

$_RETURN_DATA_ = {
  total: items.length,
  concurrency: 5,
  responses,
};
```

**Response Contract**:
-   Assign the payload to `$_RETURN_DATA_`.
-   Optionally assign a `Map` to `$_CUSTOM_HEADERS_`.
-   Do **not** use `return` as the response contract.

**Simple Example (GET)**:
```javascript
// Read query params, call another endpoint, return merged result
const { user_name, account_id } = request.query;

const uF = uFetchAutoEnv.auto("/api/myapp/db/user/auto", true);
const resp = await uF.get({ data: { user_name, account_id } });
$_RETURN_DATA_ = await resp.json();
```

**Simple Example (POST)**:
```javascript
// Read POST body fields
const { name, status } = request.body;

const uF = uFetchAutoEnv.auto("/api/myapp/db/entity/auto", true);
const resp = await uF.post({ data: { bind: { name, status } } });
$_RETURN_DATA_ = await resp.json();
```

**AI Chat Example with MCP support**:
```javascript
const result = await askIAWithMCP({
  ai: {
    modelProvider: "ollama",
    model: "qwen2.5-coder:1.5b",
    baseUrl: "http://localhost:11434",
    temperature: 0.1,
    timeout: 1800000,
    responseTimeout: 120000,
  },
  mcpServers: [
    {
      name: "openfusion_system_remote_prd",
      url: "https://example.com/api/system/mcp/server/prd",
    },
  ],
  prompts: [
    {
      role: "user",
      content: "Lista las aplicaciones disponibles usando las herramientas MCP si hace falta.",
    },
  ],
  includeDiagnostics: true,
});

$_RETURN_DATA_ = result;
```

`askIAWithMCP(options)` contract:
- `options.ai` is required and must include at least `model`.
- `options.prompts` is required and accepts a string, an array of strings, or an array of `{ role, content }` messages.
- `options.mcpServers` is optional and accepts items with `name`, `url`, optional `headers`, optional `timeout`, and optional `transportPriority`.
- `options.maxToolRounds` is optional and defaults to `6`.
- `options.includeDiagnostics` is optional and returns execution details when set to `true`.
- `options.ai.timeout` controls the provider client's HTTP timeout, while `options.ai.responseTimeout|responseTimeoutMs|runTimeout` can be used as a hard deadline for waiting on the AI response.
- When `includeDiagnostics` is `false`, the helper returns only the final assistant text. When it is `true`, it returns an object with `text`, `provider`, `model`, `messages`, `tools`, `toolExecutions`, and `mcpServers`.

Prompt normalization guidance:
- For new endpoints, prefer a single canonical input field named `prompts`.
- For compatibility-oriented endpoints, a practical precedence is `body.prompts ?? body.prompt ?? body.messages` for POST and `query.prompts ?? query.prompt ?? query.messages` for GET.
- Prefer structured chat messages like `{ role, content }` when system instructions or multi-turn context matter.
- For GET endpoints, `query.prompts` often arrives as a JSON string, so parse it before calling `askIAWithMCP` when the caller sends an array or message objects.

Recommended MCP workflow for agents:
- If the available tools are unknown, call `listMcpTools` first to discover the server capabilities.
- Then call `askIAWithMCP` with the selected MCP servers.
- When the result looks inconsistent, enable `includeDiagnostics` and inspect `result.messages`, `result.tools`, and `result.toolExecutions` before assuming hidden state or prompt reuse.

Recommended `request.body` convention for AI endpoints:

```json
{
  "ai": {
    "modelProvider": "ollama",
    "model": "qwen2.5-coder:1.5b",
    "baseUrl": "http://localhost:11434",
    "temperature": 0.1,
    "timeout": 1800000,
    "responseTimeout": 120000
  },
  "mcpServers": [
    {
      "name": "openfusion_system_remote_prd",
      "url": "https://example.com/api/system/mcp/server/prd"
    }
  ],
  "prompts": [
    {
      "role": "user",
      "content": "Explica que aplicaciones hay disponibles."
    }
  ],
  "includeDiagnostics": false,
  "maxToolRounds": 6
}
```

Reusable JS endpoint snippet:

```javascript
const body = request.body || {};

const ai = {
  modelProvider: body.ai?.modelProvider ?? "ollama",
  model: body.ai?.model ?? "qwen2.5-coder:1.5b",
  baseUrl: body.ai?.baseUrl ?? "http://localhost:11434",
  temperature: body.ai?.temperature ?? 0.1,
  timeout: body.ai?.timeout ?? 1800000,
  responseTimeout: body.ai?.responseTimeout ?? body.ai?.responseTimeoutMs ?? body.ai?.runTimeout ?? 120000,
  apiKey: body.ai?.apiKey,
};

const result = await askIAWithMCP({
  ai,
  mcpServers: Array.isArray(body.mcpServers) ? body.mcpServers : [],
  prompts: body.prompts ?? body.prompt ?? body.messages,
  includeDiagnostics: body.includeDiagnostics ?? false,
  maxToolRounds: body.maxToolRounds ?? 6,
});

$_RETURN_DATA_ = result;
```

Reusable JS endpoint snippet using App Vars for AI and MCP configuration:

```javascript
const body = request.body || {};
const prompts = body.prompts ?? body.prompt ?? body.messages;

if (!prompts) {
  $_EXCEPTION_("The request body must include prompts, prompt, or messages.", { body }, 400);
}

const ai = $_APP_VARS_["$_VAR_AI_DEFAULTS"];
const mcpServers = $_APP_VARS_["$_VAR_MCP_SERVERS_DEFAULT"] ?? [];

if (!ai || typeof ai !== "object") {
  $_EXCEPTION_("Application variable $_VAR_AI_DEFAULTS is required and must be an object.", { appVars: $_APP_VARS_ }, 500);
}

const result = await askIAWithMCP({
  ai,
  mcpServers,
  prompts,
  includeDiagnostics: body.includeDiagnostics ?? true,
  maxToolRounds: body.maxToolRounds ?? 6,
});

$_RETURN_DATA_ = result;
```

Seed/runtime note:
- Updating `src/lib/db/default/*.js` only changes the default seed artifacts in the repository.
- Existing endpoint records already stored in a database will not automatically inherit those documentation or payload changes.
- If runtime behavior does not match the updated seed file, verify the persisted endpoint/App Var data before debugging the helper itself.

Discovery-only snippet for MCP servers:

```javascript
const tools = await listMcpTools({
  mcpServers: request.body?.mcpServers ?? [],
});

$_RETURN_DATA_ = tools;
```

</details>

---

<details>
<summary>📦 Importing Modules</summary>

The JS Handler environment often enables access to standard internal libraries. You can use `import` statements if the environment supports ESM, or rely on globally injected dependencies if configured in the VM setup. _(Note: Check your administrator's configuration for enabled modules)._

For a complete list of pre-injected modules, libraries, and functions available in this environment, refer to [api.generated.md](api.generated.md).

Common pre-injected modules available in many deployments include:
- `nodemailer` — for sending emails
- `xlsx_style` — for generating Excel files (XLSX)
- `uFetchAutoEnv` — for calling internal API endpoints
- `request_xlsx_body_to_json` — for parsing uploaded XLSX files

</details>

---

<details>
<summary>📤 Example Logic</summary>

**Complex Transformation**

```javascript
// Calculate total value from a list of items in the request
const items = request.body.items || [];
let total = 0;

for (const item of items) {
  total += (item.price * item.quantity);
}

// Add a custom header
let headers = new Map();
headers.set('X-Calculated-Total', total.toString());

$_CUSTOM_HEADERS_ = headers;
$_RETURN_DATA_ = {
  count: items.length,
  totalValue: total,
  currency: "USD"
};
```

**XLSX File Upload — parse a multipart/form-data spreadsheet upload**

```javascript
// request.body contains multipart form fields (strings/values)
// request_xlsx_body_to_json parses the attached XLSX file
const sheets = await request_xlsx_body_to_json(request);

if (Array.isArray(sheets) && sheets.length > 0) {
  const rows = sheets[0]?.sheets[0]?.data;

  // Multipart fields are accessed via request.body
  const groupIdType = request.body?.groupIdType?.value;
  const groupId = request.body?.groupId?.value;

  // Process rows and call downstream endpoint
  const uF = uFetchAutoEnv.auto("/api/myapp/data/import/auto", true);
  const resp = await uF.post({
    data: { groupIdType, groupId, rows }
  });
  $_RETURN_DATA_ = await resp.json();
} else {
  $_RETURN_DATA_ = { error: "No rows were found in the uploaded workbook." };
}
```

**XLSX File Download — return a binary spreadsheet**

```javascript
// Generate an XLSX buffer and send it as a download
const rows = [{ column_1: "value_1", column_2: 100 }];
const worksheet = xlsx_style.utils.json_to_sheet(rows);
const workbook  = xlsx_style.utils.book_new();
xlsx_style.utils.book_append_sheet(workbook, worksheet, "Data");

const buffer = xlsx_style.write(workbook, { type: "buffer", bookType: "xlsx" });

$_CUSTOM_HEADERS_ = new Map([
  ["Content-Type",        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["Content-Disposition", 'attachment; filename="report.xlsx"'],
]);
$_RETURN_DATA_ = buffer;
```

**Sending an Email via Application Variable**

The App Var `$_VAR_EMAIL_TRANSPORT` holds the `nodemailer` transporter config. Access it directly in JS code:

```javascript
const transporter = nodemailer.createTransport($_VAR_EMAIL_TRANSPORT);
const info = await transporter.sendMail({
  from:    request.body.from,
  to:      request.body.to,
  subject: request.body.subject,
  html:    request.body.html,
});
$_RETURN_DATA_ = { messageId: info.messageId, accepted: info.accepted };
```

**Orchestration — call multiple internal endpoints and merge results**

```javascript
const urlAccountSummary = "/api/myapp/db/account_summary/auto";
const urlTeamMembers = "/api/myapp/db/team_members/auto";

const uF1 = uFetchAutoEnv.auto(urlAccountSummary, true);
const uF2 = uFetchAutoEnv.auto(urlTeamMembers, true);

const [resp1, resp2] = await Promise.all([
  uF1.get({ data: request.query }),
  uF2.get({ data: request.query }),
]);

const accountSummary = await resp1.json();
const teamMembers = await resp2.json();

$_RETURN_DATA_ = { accountSummary, teamMembers };
```

**Incorrect Example**

```javascript
return { ok: true };
```

The code above may execute, but it is not the supported response contract for this handler. Use `$_RETURN_DATA_` instead.

</details>

---

<details>
<summary>📊 Capability Summary</summary>

| Feature | Supported |
|---|---:|
| Custom Logic | ✅ |
| Access Request Data | ✅ (Body, Query, Headers) |
| Custom Response Headers | ✅ |
| Async/Await | ✅ |
| Environment Variables | ✅ |
| Error Handling | ✅ (Catch & throw) |

</details>

---

<details>
<summary>⚠️ Security & Performance</summary>

-   **Sandboxing**: Code runs in a VM, but infinite loops or heavy computations can impact server performance.
-   **Timeouts**: Execution is typically bounded by a timeout (default or configured per endpoint) to prevent hanging processes.
-   **Library drift**: If your script depends on `uFetch` or `uFetchAutoEnv`, verify the current upstream API before copying older snippets from seeds or previous docs.
</details>

---

© 2025 – OpenFusionAPI · Created and maintained by **edwinspire**
