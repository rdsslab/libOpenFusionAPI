# MCP Handler – Model Context Protocol

The **MCP Handler** allows your OpenFusionAPI application to act as a **Model Context Protocol (MCP)** server. This enables AI models (like Claude, ChatGPT, etc.) to discover and interact with your defined API endpoints as "Tools".

---

<details>
<summary>🧠 How It Works</summary>

When an endpoint utilizes the **MCP** handler:
1.  **Tool Registration**: It scans the application for endpoints where `mcp.enabled` is true.
2.  **Server Generation**: It dynamically builds an MCP Server instance (`StreamableHTTPServerTransport`) that exposes these endpoints as tools.
3.  **Schema Conversion**: It converts your endpoint's JSON Schemas (input validation) into Zod schemas required by the MCP specification.
4.  **Transport**: It handles the MCP JSON-RPC communication over HTTP, allowing external AI clients to "call" your API functions naturally.

</details>

---

<details>
<summary>⚙️ Endpoint Configuration</summary>

The MCP handler is unique because it's usually configured on a single "Gateway" endpoint that serves as the entry point for the MCP protocol.

**Handler Type**: `MCP`

**Code Config**:
Typically requires no specific code in the editor if using the default factory, as the logic is handled by `server_mcp` factory which aggregates *other* endpoints.

**Enabling Tools**:
To make *other* endpoints visible to this MCP server, you must configure the **MCP** settings in their respective "Advanced" tabs:
-   **Enable MCP**: Checked
-   **Name**: Unique tool name (e.g., `get_weather`). Must be unique within the application.
-   **Description**: Natural language description helping the AI understand when and how to call this tool.

**Architecture**:

A typical app exposes one MCP gateway endpoint + N enabled endpoints (tools):

```
Your app
├── /mcp/server        ← Handler: MCP  (gateway — the MCP server entry point)
├── /db/user           ← Handler: SQL  (MCP enabled → tool: "get_user")
├── /db/account        ← Handler: SQL  (MCP enabled → tool: "get_account")
├── /team/members      ← Handler: JS   (MCP enabled → tool: "list_team_members")
└── /notifications/send ← Handler: JS  (MCP enabled → tool: "send_notification_email")
```

An AI agent connecting to `/mcp/server` will automatically discover all N tools.

## Standard Tool Contract

Every MCP-enabled endpoint should keep its tool contract structured and predictable. Use this order of truth:

1. `mcp.name` - unique tool identifier in `snake_case`.
2. `mcp.title` - short human-readable label.
3. `mcp.description` - action-oriented text that states what the tool does, when to use it, required inputs, and what it returns.
4. `mcp.meta` - structured governance metadata for agents and validators.
5. `json_schema.in` - input contract that the MCP server will expose as tool parameters.

Recommended `mcp.meta` fields:

- `operation_mode`: `read` or `write`.
- `requires_explicit_confirmation`: `true` for mutating tools.
- `side_effects`: short description of persistent impact.
- `safe_alternative`: the safest read-only tool to inspect before using a mutating tool.
- `risk_level`: optional severity label such as `low`, `medium`, `high`.

Naming rules:

- Use `snake_case` only.
- Prefer `verb_noun` or `verb_domain_noun` patterns.
- Keep the name short, explicit, and stable over time.
- Avoid ambiguous names such as `get_data`, `process`, or `tool1`.

Description rules:

- Start with either `READ ONLY:` or `WRITE OPERATION:`.
- State the minimum required parameters.
- State the expected result shape or effect.
- If the tool is mutating, explain the confirmation expectation clearly.
- Do not repeat in `mcp.description` the data already represented in `mcp.title`, `mcp.meta`, or `json_schema.in`; the server exposes those fields automatically when the tool is called.

</details>

---

<details>
<summary>🔌 Internal Architecture</summary>

The handler dynamically internalizes calls. When an AI invokes a tool:
1.  The MCP Server receives the request.
2.  It identifies the corresponding internal OpenFusionAPI endpoint.
3.  It executes an internal HTTP request (`uFetch`) to that endpoint using `localhost`.
4.  It formats the response (text/json) back into the MCP `content` format expected by the AI.

</details>

---

<details>
<summary>💡 Best Practices for Tool Configuration</summary>

### `mcp.name` — Tool naming

- Use `snake_case` (lowercase with underscores): `list_team_members`, `upsert_user_record`.
- Prefer a `verb_noun` or `domain_action` pattern: `create_user`, `get_account`, `send_email`.
- The name must be **unique within the application** — two tools with the same name will conflict.
- Keep it short and descriptive. The AI will use this name when deciding to call the tool.

### `mcp.description` — Writing effective descriptions

The description is the most important field. The AI model reads it to decide **when** to call the tool. A good description answers:
1. **What does it do?**
2. **When should it be called?**
3. **What key parameters does it require?** (especially non-obvious ones)
4. **What does it return?**

**Example quality comparison**:

| Quality | Example |
|---|---|
| ✅ Good | `Returns the role assignments for a user within a specific account. Requires user_name and account_id. Use it when the caller needs the user's effective permissions.` |
| ✅ Good | `Creates or updates an internal user profile. Omit id to create a new record; provide id to update an existing one. Returns the saved user record.` |
| ⚠️ Weak | `Get user` — too vague, the AI may not know when to use it |
| ⚠️ Weak | `Use UpdateBillingCycleDay` — useful hint, but missing the business purpose and required inputs |

**Template for a good description**:
```
[What it does] [when to use it / trigger condition].
Requires [key params].
Returns [what comes back].
```

### `json_schema.in` — Input schema → MCP tool parameters

Every property you define in `json_schema.in` becomes a **named parameter** the AI can fill when calling the tool. The `description` on each property directly informs the AI what to pass. Use it to:

- Constrain string values with `enum` (e.g., `"enum": ["A", "I"]`).
- Document units and formats in `description`.
- Mark required fields in the `required` array.
- Use `"additionalProperties": false` to prevent the AI from inventing extra fields.

**Example**:
```json
{
  "title": "AccountFilter",
  "type": "object",
  "required": ["account_id", "account_type"],
  "additionalProperties": false,
  "properties": {
    "account_id": {
      "type": "string",
      "minLength": 1,
      "description": "Unique account identifier."
    },
    "account_type": {
      "type": "string",
      "enum": ["COMPANY", "PERSON", "PARTNER"],
      "description": "Identifier category for the account."
    }
  }
}
```

The AI will see two parameters: `account_id` (required string) and `account_type` (required enum), with the descriptions as hints when asking the user.

</details>

<details>
<summary>📊 Capability Summary</summary>

| Feature | Supported |
|---|---:|
| MCP Tool Discovery | ✅ (Auto from App config) |
| JSON Schema to Zod | ✅ |
| JSON-RPC Transport | ✅ |
| HTTP Transport | ✅ |
| SSE Transport | ❌ (Current impl is HTTP Req/Res) |

</details>

---

<details>
<summary>💡 Typical Use Cases</summary>

-   **AI Integration**: Connect your business logic (SQL queries, Scripts) to an LLM.
-   **Chatbot Context**: Allow a chatbot to "lookup" user data or "perform" actions via your existing API.
</details>

---

## MCP Inspector
Use to test the MCP server

```bash
npx @modelcontextprotocol/inspector
```

© 2025 – OpenFusionAPI · Created and maintained by **edwinspire**
