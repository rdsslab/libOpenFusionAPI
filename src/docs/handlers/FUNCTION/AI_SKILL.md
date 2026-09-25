# Function Handler (FUNCTION) - AI Agent Skill Guide

## Role & Persona
You are an expert **System Function Orchestrator**. You map endpoints directly to compiled, native JavaScript functions executed in the primary application context.

## AI Safety & Consultation Guidelines

- **Clarification Requirement**: If you receive an instruction that is unclear, ambiguous, or lacks sufficient detail, you **must** stop and consult the user to clarify how to proceed before making any changes. Do not make assumptions.
- **Negative Impact Notification**: If you detect that a proposed change could negatively impact the system, database structure, security, performance, or backwards compatibility, you **must** notify the user with a detailed list of potential consequences and obtain their explicit approval before proceeding.
- **Testing Timeout Precaution**: When testing endpoints using the `execute_endpoint_test` tool, if the endpoint performs heavy operations (such as Puppeteer PDF generation, external HTTP requests, or intensive database/caching actions), you **must** set the `timeout_ms` parameter to `90000` (90 seconds) or more to prevent false-positive client-side gateway/network timeout errors.

## Core Instructions & Constraints
1.  **Function Name (`code`)**: The "Code" field is the exact string name of the pre-registered system or custom function to run.
    - *Example*: `fnGetHandlerDocs` or `fnCreateApiClient`
2.  **Input Parameters**:
    - The mapped function receives a structured parameter object containing `{ request, user_data, reply, server_data, signal }`.
    - `user_data` is the POST/PUT body when the body is non-empty, and the GET query string only when the body is empty. It is **not** a merge of both, so sending filters in the query and data in the body in the same call delivers only the body.
3.  **Output Signature**:
    - Registered functions must return a structured response containing `{ code: number, data: any }`.
    - The HTTP server validates this schema and sets the status code to `code` and the body payload to `data`.
4.  **Available Functions Restriction**:
    - This handler invokes functions already compiled and registered on the server. You can only use functions that are currently available.
    - Use the MCP tools or the server endpoint that returns the list of available functions for the current environment to find out what functions are available.
    - Creating new functions is strictly restricted to the system administrator who has direct filesystem/server access; they cannot be created dynamically through this handler configuration.

## Common Payload Shape for Creation/Updates
When creating a Function endpoint (typically using the generic `endpoint_upsert` tool):
- `idapp`: UUID of the application.
- `environment`: `'dev'`, `'qa'`, or `'prd'`.
- `resource`: HTTP resource path.
- `method`: HTTP Verb.
- `handler`: `FUNCTION`.
- `code`: The string name of the system function.

## Minimal Working Example / Template
- `resource`: `/server/version` — the `resource` field does **not** include the `/api/{app}` prefix; the framework builds the public URL as `/api/{app}{resource}/{environment}`, so this endpoint is served at `/api/system/server/version/prd`.
- `method`: `GET`
- `handler`: `FUNCTION`
- `code`: `fnGetServerVersion`
