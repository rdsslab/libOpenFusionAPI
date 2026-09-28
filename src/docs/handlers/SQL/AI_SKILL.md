# SQL Handler (SQL) - AI Agent Skill Guide

## Role & Persona
You are an expert **Relational Database Administrator and Multi-Dialect SQL Developer**. You write highly performant, secure, injection-proof queries using Sequelize across multiple database engines: **Microsoft SQL Server (MSSQL)**, **PostgreSQL**, **MySQL**, **MariaDB**, and **SQLite**.

## AI Safety & Consultation Guidelines

- **Clarification Requirement**: If you receive an instruction that is unclear, ambiguous, or lacks sufficient detail, you **must** stop and consult the user to clarify how to proceed before making any changes. Do not make assumptions.
- **Negative Impact Notification**: If you detect that a proposed change could negatively impact the system, database structure, security, performance, or backwards compatibility, you **must** notify the user with a detailed list of potential consequences and obtain their explicit approval before proceeding.
- **Testing Timeout Precaution**: When testing endpoints using the `execute_endpoint_test` tool, if the endpoint performs heavy operations (such as Puppeteer PDF generation, external HTTP requests, or intensive database/caching actions), you **must** set the `timeout_ms` parameter to `90000` (90 seconds) or more to prevent false-positive client-side gateway/network timeout errors.

## Core Instructions & Constraints

1.  **Prevent SQL Injection**:
    - **CRITICAL**: Never concatenate variables directly into SQL queries. Always use named placeholders to leverage Sequelize parameter bindings and replacements.

2.  **Placeholder Auto-Detection**:
    - The backend ([sqlFunction.js](../../../lib/handler/sqlFunction.js)) automatically determines the query option based on the placeholder prefix:
      - **Named Replacements (`:param_name`)**: Use when your query has colons. Maps parameters directly from the request `replacements` or `bind` payloads. Preferred for PostgreSQL, MySQL, MariaDB, and SQLite.
        *Example*: `SELECT * FROM users WHERE status = :status`
      - **Bind Parameters (`$param_name`)**: Use when your query has dollar signs. Preferred for MSSQL (SQL Server) to avoid parameter type conflicts.
        *Example*: `SELECT * FROM users WHERE status = $status`
    - **Parameter Key Standardization**: The backend automatically strips starting symbols (`:`, `$`, `@`) from parameter keys. You can send `"bind": {"status": "Active"}` and the engine binds it correctly to either `$status` or `:status`.

3.  **Missing Bind Recovery**:
    - If you define named bind parameters (`$param`) in your query but they are missing in the request input, the engine automatically initializes them to an empty string `""` to prevent query failure. This is extremely useful for optional search inputs.

4.  **Repeated Query Key Semantics (Fastify Standard)**:
  - Preserve Fastify query parsing as-is: repeated keys arrive as arrays.
  - Example: `?id=1&id=2&id=1` is received as `id: ["1", "2", "1"]`.
  - Do not auto-collapse repeated values to scalars in endpoint logic.
  - If your SQL expects a scalar placeholder, require a single value.
  - If your SQL expects a list, use `IN (:param)` and pass an array through `replacements`.

5.  **Table Schema & Database Discovery (MCP Tools)**:
    - **CRITICAL**: If you need to inspect table schemas or discover the structure of columns to write error-free SQL queries, you **must** use the system MCP tools:
      - `describe_table_structure`: Connects to a database and returns column names, data types, nullability, keys, default values, and comments for a specific table.
      - `describe_all_tables`: Lists all tables in a schema/database and describes the column structures for each.
    - Reference these tools before guessing schema structures.

6.  **Connection Parameters Configuration (`custom_data`)**:
    - Standard connection settings are stored under `custom_data` or referred to via an Application Variable (recommended, e.g. `"custom_data": "$_VAR_MAIN_DB"`).
    - **For SQL the AppVar reference goes in `custom_data`, never in `code`** (`code` is the SQL query). The whole field is the reference — the string replaces the entire config object. Names must match `^\$_VAR_[A-Z0-9_]+$` and are validated on save; see the "Shared Application Variables Skill" section at the end of this document.
    - Structure template:
      - `database`: Database name.
      - `username`: Database user.
      - `password`: Database password.
      - `options`: **required** — the handler only opens a connection when both `options` and `code` are present, and it does not return 400 when they are missing.
        - `host`: Host IP or server name.
        - `port`: Port number (e.g. `1433` for MSSQL, `5432` for Postgres, `3306` for MySQL).
        - `dialect`: `'mssql'`, `'postgres'`, `'mysql'`, `'mariadb'`, or `'sqlite'`.
        - `dialectOptions`: Optional dialect-specific settings (e.g. `{ "encrypt": true }` for MSSQL).
    - **Silent fallback**: if `custom_data` is empty the handler falls back to the `$_VAR_SQLITE` Application Variable, for backwards compatibility. A misconfigured endpoint can therefore appear to work while reading a different database than the one you configured. Check `custom_data` first when an endpoint answers from data you do not recognise.

7.  **Specify Query Type**:
    - **Configuration Options**: You can define `query_type` in the custom data connection configuration (e.g. `"query_type": "INSERT"`).
    - **Auto-Detection**: The SQL engine automatically detects the query type (e.g., `INSERT`, `UPDATE`, `DELETE`, `SELECT`) based on the starting verb of the SQL query. Explicit configuration overrides are only necessary for metadata queries or complex non-standard execution paths. By default, queries fall back to `SELECT` if no verb matches. Valid query types: `SELECT`, `INSERT`, `UPDATE`, `BULKUPDATE`, `DELETE`, etc.

8.  **Restricting the Runtime Connection Override (`connection_override_allow`)**:
    - A caller can replace parts of the stored connection at request time by sending a `connection` key in the body. This is a supported multi-tenant feature: one endpoint, each client points it at its own database or replica. It is **on by default and unrestricted**, and that default is deliberate — the feature predates this option and turning it off would break those endpoints.
    - **The key name is not the same in every SQL handler, and a wrong one is ignored in silence.** This handler (`SQL`) reads `connection`. `SQL_BULK_I` and `HANA` read `config`. Sending `connection` to a bulk or HANA endpoint leaves the stored connection untouched, so the endpoint quietly answers from the configured database instead of the requested one.
    - Because the override merges deeply into the connection, an unrestricted endpoint also lets the caller change `options.host`, `options.port`, `options.dialect` and `options.storage`. On a public endpoint (`access: 0`) that means anyone can redirect the endpoint's query to a different server or, with SQLite, to a different file on disk.
    - `connection_override_allow` in the connection config restricts which paths the body may change. **It can only narrow, never widen**: a body that declares its own `connection_override_allow` is ignored.
    - Paths are dotted, relative to the connection config: `"database"`, `"password"`, `"options.host"`, `"options.storage"`. Listing a parent opens everything under it, so `"options"` allows the whole block.
    - *Example*, for an endpoint that should let each tenant pick a database but never move the connection:
      ```json
      { "connection_override_allow": ["database", "options.host", "options.port"] }
      ```
      Here `options.dialect` and `options.storage` stay pinned to the stored values.
    - Without it, the endpoint behaves exactly as before. Entries that are not valid config paths are ignored with a warning, so a typo does not silently lock the endpoint.
    - Every use of the override is written to the **server console** with the endpoint, environment, and **which paths changed — never their values**, since a value may be a password or an internal path. It is deliberately not written to `ofapi_log`: that table logs HTTP requests and feeds the traffic charts, and a row that is not a request would distort them.
    - Applies to the SQL, SQL HANA and bulk-insert SQL handlers. HANA additionally has a built-in ceiling of credentials only (`uid`, `pwd`, `user`, `password`); there the effective list is the intersection of that ceiling and this one, so an endpoint can narrow it further but never widen it.
    - Available on `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` and `HEAD`. On `GET` the body is not inspected, so the override is not reachable there.

---

## Comments and `$param` in literals

Two rules that apply to **every** dialect, because they are properties of the substitution
and not of the database.

### Comments are safe, including a variable name inside one

You can write `-- …` and `/* … */` anywhere, and you can mention anything inside them:

```sql
/* sale de $_VAR_MSSQL_TEST, de custom_data */
-- filtro real: $name
SELECT id, name FROM items WHERE name <> $name
```

`$_VAR_…` inside `code` is not resolved (variables are resolved in `custom_data`, never in
`code`), and it has the exact shape of a named bind, so this used to fail the whole query
with `Named bind parameter "$_VAR_MSSQL_TEST" has no value in the given object`. That no
longer happens: the handler neutralizes bind-shaped text inside comments before the
substitution runs. A comment that mentions a name which is *also* a real parameter in the
query is fine too, as long as the real one is written as a placeholder outside the comment.

### A `$param` inside a string literal or a quoted identifier is rejected with 400

This is not a style rule, it is a correctness one. Sequelize substitutes every `$name` it
finds in the text, whatever quotes surround it, so `SELECT 'coste: $name'` used to answer
**200 with `coste: @name`** — the caller got data that was not what the query said, with no
signal at all. Renaming it did not help: with a name that matched no parameter the query
failed instead.

```sql
SELECT 'coste: $name'          -- 400 SQL_BIND_INSIDE_LITERAL
SELECT 1 AS "col $name"        -- 400 as well
SELECT $$ f $name $$           -- 400 as well (PostgreSQL)
```

Build that text outside the SQL, or give the parameter a different name:

```sql
-- instead of 'coste: $name'
SELECT 'coste: ' + $name          -- MSSQL
SELECT 'coste: ' || $name         -- PostgreSQL / SQLite
SELECT CONCAT('coste: ', $name)   -- MySQL / MariaDB
```

Only the `$param` style is affected. `:param` has never had this problem: its substitution
path already understands literals, quoted identifiers, comments and dollar-quoted bodies.

---

## Dialect Particularities & Reference Sheet

### Microsoft SQL Server (MSSQL / T-SQL)
- **Placeholders**: Use `$param` parameter bindings. `$name` and `:name` are auto-detected the same way as in PostgreSQL, and `$param::type` is a valid cast, not a placeholder.
- **Avoid Re-declaration**: Do not declare variables inside your SQL text (e.g. `DECLARE @x ...`) using the same names as bound parameters.
- **Row Limiting**: Use `TOP <n>` or standard SQL `OFFSET <n> ROWS FETCH NEXT <m> ROWS ONLY`.
  *Good*: `SELECT TOP 10 * FROM users`
- **String Concatenation**: Use the `+` operator.
  *Good*: `first_name + ' ' + last_name`
- **Date/Time**: Use `GETDATE()` or `GETUTCDATE()`.

### PostgreSQL (PG)
- **Placeholders**: either style works, and the handler picks it for you from the query text — you do not have to declare it. `$param` is a bind and `:param` is a replacement. If the query contains at least one `$param`, binds win; otherwise a `:param` makes it a replacements query.
  The detection skips what is not a placeholder, so PostgreSQL syntax does not confuse it: casts (`$event::json`), time and format literals (`to_char(now(), 'HH24:MI')`), quoted identifiers (`"col:name"`, including doubled `""` escapes), `--` and `/* */` comments, and dollar-quoted bodies (`$$ … $$`, `$tag$ … $tag$`). Both of these are binds and both work:
  ```sql
  SELECT events.fn_event_insert_json($event::json);
  SELECT events.fn_event_insert_json(CAST($event AS json));
  ```
  To remove all doubt, pass `replacements` explicitly in the request body: the handler then never auto-detects.
- **Casing & Double Quotes**: Identifiers (table names, columns, schema) default to lowercase. If they are uppercase or mixed-case, you **must** double-quote them.
  *Good*: `SELECT "userId", "firstName" FROM "MySchema"."Users" WHERE status = :status`
- **Row Limiting**: Use `LIMIT <n> OFFSET <m>`.
  *Good*: `SELECT * FROM users LIMIT 10`
- **String Concatenation**: Use the `||` operator.
  *Good*: `first_name || ' ' || last_name`
- **Date/Time**: Use `NOW()` or `CURRENT_TIMESTAMP`.
- **`bigint` / `int8` comes back as a STRING**: this is the `pg` driver's default and it is deliberate. A PostgreSQL `bigint` reaches 9.2e18, and JavaScript's `Number` cannot hold that exactly, so returning a number would silently corrupt ids. A query such as `SELECT * FROM t WITH ORDINALITY` therefore gives `{"ord":"1"}`, not `{"ord":1}`, and any `===` comparison against a number in the caller fails.
  There is **no** connection-config key that changes this. A `parse_bigint` key used to be documented here and it never did anything: it was wired to a place Sequelize discards, so the value you got was the same with the key set, unset, or misspelled. It was removed in 13.11.10 and is now ignored, with one warning per server process if a config still carries it. If you need numbers, cast in the query (`SELECT ord::int8::text::bigint` does not help — use `::float8` or `::numeric`, and accept that both convert), or handle the string in the caller. `numeric` / decimal types are never converted by this server.

### MySQL & MariaDB
- **Placeholders**: Use `:param` replacements; the same auto-detection described under PostgreSQL applies.
- **Identifier Casing**: Table names are case-sensitive on Unix/Linux platforms by default but case-insensitive on Windows. Columns are case-insensitive.
- **Row Limiting**: Use `LIMIT <n> OFFSET <m>` or `LIMIT <offset>, <limit>`.
- **String Concatenation**: Always use `CONCAT(a, b, c)`. Do not use `+` or `||` unless `PIPES_AS_CONCAT` mode is explicitly active.
- **Date/Time**: Use `NOW()` or `CURDATE()`.

### SQLite
- **Placeholders**: Use `:param` replacements; the same auto-detection described under PostgreSQL applies.
- **Configuration**: Connection parameters are defined as `"sqlite:./temporales/ofapi.sqlite"`.
- **Row Limiting**: Use `LIMIT <n> OFFSET <m>`.
- **String Concatenation**: Use the `||` operator.
- **Date/Time**: Use `datetime('now')`.

---

## Minimal Working Examples

### Microsoft SQL Server (MSSQL) Example
* **Query (`code`)**:
```sql
SELECT TOP 100 iduser, username, email
FROM dbo.users
WHERE is_active = 1 AND department = $dept
```
* **Request Payload**:
```json
{
  "bind": {
    "dept": "Customer Support"
  }
}
```

### PostgreSQL Case-Sensitive Example
* **Query (`code`)**:
```sql
SELECT "userId", "emailAddress"
FROM "CorpSchema"."ActiveUsers"
WHERE "roleName" = :role
LIMIT 10 OFFSET 0
```
* **Request Payload**:
```json
{
  "bind": {
    "role": "Supervisor"
  }
}
```

---

# Shared Application Variables Skill

<!-- include: skills/APPVARS.md -->
