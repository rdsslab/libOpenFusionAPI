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
      - `options`:
        - `host`: Host IP or server name.
        - `port`: Port number (e.g. `1433` for MSSQL, `5432` for Postgres, `3306` for MySQL).
        - `dialect`: `'mssql'`, `'postgres'`, `'mysql'`, `'mariadb'`, or `'sqlite'`.
        - `dialectOptions`: Optional dialect-specific settings (e.g. `{ "encrypt": true }` for MSSQL).

7.  **Specify Query Type**:
    - **Configuration Options**: You can define `query_type` in the custom data connection configuration (e.g. `"query_type": "INSERT"`).
    - **Auto-Detection**: The SQL engine automatically detects the query type (e.g., `INSERT`, `UPDATE`, `DELETE`, `SELECT`) based on the starting verb of the SQL query. Explicit configuration overrides are only necessary for metadata queries or complex non-standard execution paths. By default, queries fall back to `SELECT` if no verb matches. Valid query types: `SELECT`, `INSERT`, `UPDATE`, `BULKUPDATE`, `DELETE`, etc.

8.  **Restricting the Runtime Connection Override (`connection_override_allow`)**:
    - A caller can replace parts of the stored connection at request time by sending a `connection` key in the body. This is a supported multi-tenant feature: one endpoint, each client points it at its own database or replica. It is **on by default and unrestricted**, and that default is deliberate — the feature predates this option and turning it off would break those endpoints.
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
  Set `"parse_bigint": true` in the connection config to get numbers for the values that fit in `Number.MAX_SAFE_INTEGER`:
  ```json
  { "database": "app", "username": "u", "password": "p",
    "parse_bigint": true,
    "options": { "dialect": "postgres", "host": "db", "port": 5432 } }
  ```
  It is opt-in, and it is only a type change: a value outside the safe range (`9007199254740993`, or anything past `9223372036854775807`) still arrives as a string rather than as a rounded number, and `numeric` / decimal types are never touched — rounding an amount is worse than handing it over as text. A client that cannot cope with a mixed row should not enable it.

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
* **Query (`code` / `sql_query`)**:
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
* **Query (`code` / `sql_query`)**:
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
