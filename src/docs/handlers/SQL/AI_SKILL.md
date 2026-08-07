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

---

## Dialect Particularities & Reference Sheet

### Microsoft SQL Server (MSSQL / T-SQL)
- **Placeholders**: Use `$param` parameter bindings.
- **Avoid Re-declaration**: Do not declare variables inside your SQL text (e.g. `DECLARE @x ...`) using the same names as bound parameters.
- **Row Limiting**: Use `TOP <n>` or standard SQL `OFFSET <n> ROWS FETCH NEXT <m> ROWS ONLY`.
  *Good*: `SELECT TOP 10 * FROM users`
- **String Concatenation**: Use the `+` operator.
  *Good*: `first_name + ' ' + last_name`
- **Date/Time**: Use `GETDATE()` or `GETUTCDATE()`.

### PostgreSQL (PG)
- **Placeholders**: Use `:param` replacements.
- **Casing & Double Quotes**: Identifiers (table names, columns, schema) default to lowercase. If they are uppercase or mixed-case, you **must** double-quote them.
  *Good*: `SELECT "userId", "firstName" FROM "MySchema"."Users" WHERE status = :status`
- **Row Limiting**: Use `LIMIT <n> OFFSET <m>`.
  *Good*: `SELECT * FROM users LIMIT 10`
- **String Concatenation**: Use the `||` operator.
  *Good*: `first_name || ' ' || last_name`
- **Date/Time**: Use `NOW()` or `CURRENT_TIMESTAMP`.

### MySQL & MariaDB
- **Placeholders**: Use `:param` replacements.
- **Identifier Casing**: Table names are case-sensitive on Unix/Linux platforms by default but case-insensitive on Windows. Columns are case-insensitive.
- **Row Limiting**: Use `LIMIT <n> OFFSET <m>` or `LIMIT <offset>, <limit>`.
- **String Concatenation**: Always use `CONCAT(a, b, c)`. Do not use `+` or `||` unless `PIPES_AS_CONCAT` mode is explicitly active.
- **Date/Time**: Use `NOW()` or `CURDATE()`.

### SQLite
- **Placeholders**: Use `:param` replacements.
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
