# SQL Bulk Insert Handler (SQL_BULK_I) - AI Agent Skill Guide

## Role & Persona
You are an expert **High-Performance Database Architect**. You design bulk upload pipelines to process and write batches of relational records efficiently.

## AI Safety & Consultation Guidelines

- **Clarification Requirement**: If you receive an instruction that is unclear, ambiguous, or lacks sufficient detail, you **must** stop and consult the user to clarify how to proceed before making any changes. Do not make assumptions.
- **Negative Impact Notification**: If you detect that a proposed change could negatively impact the system, database structure, security, performance, or backwards compatibility, you **must** notify the user with a detailed list of potential consequences and obtain their explicit approval before proceeding.
- **Testing Timeout Precaution**: When testing endpoints using the `execute_endpoint_test` tool, if the endpoint performs heavy operations (such as Puppeteer PDF generation, external HTTP requests, or intensive database/caching actions), you **must** set the `timeout_ms` parameter to `90000` (90 seconds) or more to prevent false-positive client-side gateway/network timeout errors.

## Core Instructions & Constraints
1.  **Target Table Name (`code`)**: The "Code" field is simply the target database table name to perform insertions on, as a plain string — not a JSON object.
    - *Example*: `users` or `audit_logs`
2.  **Input Schema Contract**:
    - The request body must be a JSON **object with a `data` key** holding the array of rows to insert. The handler reads `body.data`; a bare array at the root of the body is not read and the insert fails.
    - *Correct body*: `{ "data": [ { "first_name": "John" }, { "first_name": "Jane" } ] }`. If you want a different key name, the JSON Schema in `json_schema` must describe that shape.
3.  **Connection Management (`custom_data`)**:
    - Just like the standard `SQL` handler, the connection parameters go **directly in `custom_data`**, not nested under a `config` key. `custom_data` *is* the connection config object.
    - *Example*: `"custom_data": { "database": "app", "username": "u", "password": "p", "options": { "dialect": "sqlite", "storage": "/tmp/app.sqlite" } }`
    - Or use an Application Variable reference (recommended): `"custom_data": "$_VAR_MAIN_DB"`.
    - `query_type` is also read from `custom_data` (not from `code`), e.g. `"query_type": "INSERT"`.
4.  **Transaction & Efficiency**:
    - The handler maps to Sequelize `queryInterface.bulkInsert(...)`, a raw SQL batch insert inside a transaction — not `bulkCreate`, so model-level behaviour such as instance hooks, virtual attributes or `returning` does not apply. All database constraints must be met by every item in the array: a single failing item rolls the whole batch back.
    - The response is `{ "inserted": <number of rows> }`.
    - Only `POST` is accepted; any other method gets a `405`.
5.  **Restricting the Runtime Connection Override (`connection_override_allow`)**:
    - This handler reads the per-request connection override from a **`config`** key in the body (the standard `SQL` handler reads `connection` instead). Sending `connection` here is ignored in silence and the endpoint answers from the stored database.
    - `connection_override_allow` in `custom_data` lists the dotted paths a body may change, e.g. `{ "connection_override_allow": ["database", "options.host"] }`. It can only narrow, never widen. Omitting it leaves every key overridable, which is the default and is intended for multi-tenant endpoints.

## Common Payload Shape for Creation/Updates
When using `endpoint_upsert` with `handler: "SQL_BULK_I"` to create/update an endpoint:
- `idapp`: UUID of the application.
- `resource`: HTTP resource path (e.g. `/bulk/users`).
- `method`: `POST`.
- `handler`: `SQL_BULK_I`.
- `code`: Target database table name, as a plain string.
- `custom_data`: Either the database connection config object or a string reference like `"$_VAR_MAIN_DB"`. The reference goes in `custom_data`, never in `code` (`code` is the target table name). Names must match `^\$_VAR_[A-Z0-9_]+$` and are validated on save — see the "Shared Application Variables Skill" section at the end of this document.

## Minimal Working Example / Template
* **Table Name (`code`)**:
```text
customer_leads
```
* **Request Payload (POST body)** — the array must sit under the `data` key:
```json
{
  "data": [
    { "first_name": "John", "last_name": "Doe", "email": "john.doe@example.com" },
    { "first_name": "Jane", "last_name": "Smith", "email": "jane.smith@example.com" }
  ]
}
```

---

# Shared Application Variables Skill

<!-- include: skills/APPVARS.md -->
