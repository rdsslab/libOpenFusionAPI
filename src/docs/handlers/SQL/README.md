# SQL Handler – Universal Database Connector

The **SQL handler** allows OpenFusionAPI to execute SQL queries against various relational databases (MySQL, PostgreSQL, MSSQL, SQLite, etc.) using the Sequelize ORM.

---

<details>
<summary>🧠 How It Works</summary>

When an endpoint is configured with the **SQL** handler:
1.  **Configuration**: It reads the SQL query from the endpoint `code` and the database connection settings from `custom_data`.
2.  **Connection Pooling**: It uses an internal Least Recently Used (LRU) mechanism to manage and reuse database connection pools, ensuring high performance and resource efficiency (limit: 50 active pools).
3.  **Binding**: It safely binds parameters from the HTTP request (GET query params or POST body) to the SQL query to prevent SQL Injection.
4.  **Execution**: The query is executed via Sequelize.
5.  **Response**: The result set is returned as a JSON object/array.

</details>

---

<details>
<summary>⚙️ Endpoint Configuration</summary>

For this handler:
-   `code` stores the SQL query string.
-   `custom_data` stores the database connection settings and optional SQL execution metadata.

**`code` example**:
```sql
SELECT * FROM users WHERE id = :id
```

**`custom_data` - Inline config**:
```json
{
  "config": {
    "database": "my_db",
    "username": "db_user",
    "password": "db_password",
    "options": {
      "host": "localhost",
      "port": 5432,
      "dialect": "postgres"
    }
  },
  "query_type": "SELECT"
}
```

**`custom_data` — Application Variable reference** _(recommended for production)_:
Instead of storing credentials in the endpoint, reference an Application Variable by name. The runtime resolves this string to the actual connection config stored in AppVars:
```json
"$_VAR_MAIN_DB"
```
This keeps secrets out of endpoint configuration. Manage AppVars from the application settings panel.

> **The `$_VAR_` prefix is part of the variable name.** Names must match `^\$_VAR_[A-Z0-9_]+$` and the stored name must be identical, character for character, to the string written in `custom_data`. This is validated when saving the variable. A variable created as `MAIN_DB` is never resolved: the literal string reaches the handler and the request fails with `400 Invalid JSON in method custom_data/AppVar`. If the prefix is right but no variable exists for the endpoint's environment, the error is `AppVar $_VAR_MAIN_DB not found for environment <env>` instead.

**Note**: Connection details can also be dynamically overridden per request (see "Dynamic Connection" below).

</details>

---

<details>
<summary>🌐 Parameter Binding</summary>

The handler supports two methods for passing parameters from the HTTP request to the SQL query:

1.  **Bind Parameters (`$param`)** _(recommended for MSSQL / T-SQL, also supported generically through Sequelize bind)_:
  OpenFusion binds request values by name and passes them to `sequelize.query(...)` as named bind parameters. In practice, the safest pattern for MSSQL / T-SQL is to use `$param_name` directly in `WHERE`, `VALUES`, `SET`, `TRY_CONVERT`, `NULLIF`, etc. Avoid re-declaring T-SQL variables with the same names as bound fields when the request uses `bind`, because the handler may already inject those values internally and duplicate `DECLARE @param = $param` patterns can fail with errors like `Invalid pseudocolumn` or `variable already declared`.

    **Recommended rule**:
    - Use `$param` directly in SQL expressions.
    - If you need local variables, use different names and only after validating that your exact handler/runtime supports that pattern.
    - For POST requests to SQL endpoints, prefer sending parameters under `bind`.

    **SQL**:
    ```sql
  SET NOCOUNT ON;

  IF NULLIF(LTRIM(RTRIM($account_name)), '') IS NULL
    THROW 53001, 'The account_name parameter is required.', 1;

  SELECT *
  FROM dbo.accounts
  WHERE account_name = NULLIF(LTRIM(RTRIM($account_name)), '')
    AND account_id = TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM($account_id)), ''));
    ```
  **Request (GET)**: `?account_name=acme&account_id=1001`
  **Request (POST body)**: `{"account_name": "acme", "account_id": 1001}`

2.  **Named Replacements (`:param`)**:
    Alternative syntax that works well for simpler inline queries across multiple dialects (MySQL, PostgreSQL, SQLite).

    **SQL**: `SELECT * FROM products WHERE category = :category`
    **Request**: `?category=electronics`

**Payload Structure (POST)**:
Choose the payload style that matches your SQL placeholder style:
- If your SQL uses `$param`, send values in `bind`.
- If your SQL uses `:param`, send values in `replacements`.

```json
{
  "bind": {
    "account_name": "acme",
    "account_id": 1001
  }
}
```
In the SQL, access with `$account_name` and `$account_id`.

```json
{
  "replacements": {
    "account_name": "acme",
    "account_id": 1001
  }
}
```
In the SQL, access with `:account_name` and `:account_id`.

**Important compatibility note for agents and endpoint authors**:
- The documented runtime failure for `DECLARE @field = $field` was reproduced with MSSQL / T-SQL endpoints executed through the generic SQL handler.
- The SQL handler itself is generic: it chooses between Sequelize `bind` and `replacements` and then delegates to the configured dialect. Because of that, do not automatically assume identical behavior on PostgreSQL, MySQL, MariaDB, or SQLite without testing on that dialect.
- If your POST body is `{ "bind": { ... } }`, do not assume you must also write `DECLARE @field = $field` in the SQL.
- On MSSQL / T-SQL this can conflict with parameter preparation and produce runtime errors such as `Invalid pseudocolumn "$field"` or `The variable name '@field' has already been declared`.
- Prefer direct usage like `WHERE col = $field`, `VALUES ($field, ...)`, or `TRY_CONVERT(INT, NULLIF($field, ''))`.

**Practical portability rule**:
- If you need the most portable examples across PostgreSQL, MySQL, MariaDB, and SQLite, prefer `:param` replacements.
- If you are intentionally writing MSSQL / T-SQL and already validated the endpoint on that engine, `$param` with `bind` is the preferred pattern.
- For any dialect-specific query, validate on the real engine before copying the example to another database.

**Array and `IN (...)` rule (`bind` vs `replacements`)**:
- In this SQL handler, list expansion for `IN (...)` is most predictable with `:param` and `replacements`.
- Example (portable): `WHERE account_id IN (:account_ids)` with `{"replacements":{"account_ids":[1,2,3]}}`.
- Avoid relying on `$param` list expansion semantics to be identical across all dialects.
- For single scalar values, both styles can work; choose one style per endpoint and keep it consistent.

**Repeated query keys (Fastify semantics)**:
- OpenFusion preserves the value shape provided by Fastify for `request.query`.
- A key sent once remains a scalar (for example `?status=ACTIVE` => `"ACTIVE"`).
- A repeated key remains an array (for example `?id=1&id=2&id=1` => `["1","2","1"]`).
- The SQL handler does not collapse repeated query values automatically; if your SQL expects a scalar, avoid repeating that key or validate it explicitly.
- For list filters, prefer `IN (:param)` with `replacements`.

</details>

---

<details>
<summary>🔌 Dynamic Connection</summary>

You can override or provide connection details at runtime by sending a `connection` object in the request body (POST only). This is useful for multi-tenant applications connecting to different databases based on the user context.

**Request Body**:
```json
{
  "connection": {
    "database": "tenant_123",
    "username": "custom_user",
    "password": "custom_password"
  },
  "bind": {
    "id": 50
  }
}
```

</details>

---

<details>
<summary>📤 Example Requests</summary>

**Simple Selection (PostgreSQL / MySQL)**

Endpoint `code`: `SELECT * FROM customers WHERE country = :country`

Endpoint `custom_data`:

```json
{
  "config": {
    "database": "crm",
    "username": "readonly",
    "password": "secret",
    "options": {
      "host": "db.internal",
      "port": 5432,
      "dialect": "postgres"
    }
  },
  "query_type": "SELECT"
}
```

```bash
curl -X GET "https://your-server.com/api/sql/customers?country=USA"
```

**Response**:
```json
[
  { "id": 1, "name": "Acme Corp", "country": "USA" },
  { "id": 2, "name": "Globex", "country": "USA" }
]
```

---

**Portable POST Example (PostgreSQL / MySQL / MariaDB / SQLite)**

If you want a cross-dialect pattern, prefer `:param` replacements and send values in `replacements`.

Endpoint `code`:
```sql
SELECT
  order_id,
  customer_name,
  status
FROM sales_orders
WHERE status = :status
  AND country = :country;
```

**POST body**:
```json
{
  "replacements": {
    "status": "OPEN",
    "country": "US"
  }
}
```

This avoids assuming MSSQL-specific behavior and is usually the safest starting point when the same documentation may be read by users of different Sequelize dialects.

---

**Portable `IN (...)` Example with Array (PostgreSQL / MySQL / MariaDB / SQLite)**

Endpoint `code`:
```sql
SELECT
  account_id,
  account_name
FROM accounts
WHERE account_id IN (:account_ids)
  AND status = :status;
```

```bash
curl -X POST "https://your-server.com/api/sql/accounts/filter" \
  -H "Content-Type: application/json" \
  -d '{
    "replacements": {
      "account_ids": [101, 102, 103],
      "status": "A"
    }
  }'
```

This is the recommended cross-dialect approach when your query needs list expansion in `IN (...)`.

---

**MSSQL — Parameterized Query with Validation**

Endpoint `custom_data`: `"$_VAR_MAIN_DB"`

Endpoint `code`:
```sql
SET NOCOUNT ON;

-- Mandatory parameter validation
IF NULLIF(LTRIM(RTRIM($user_name)), '') IS NULL
  THROW 53001, 'The user_name parameter is required.', 1;

IF TRY_CONVERT(INT, NULLIF($account_id, '')) IS NULL
  THROW 53002, 'The account_id parameter is required.', 1;

SELECT
  u.user_id,
  u.user_name,
  u.email
FROM [AppDb].[dbo].[users] u WITH (NOLOCK)
INNER JOIN [AppDb].[dbo].[account_users] a WITH (NOLOCK)
  ON u.user_id = a.user_id
WHERE u.user_name = NULLIF(LTRIM(RTRIM($user_name)), '')
  AND a.account_id = TRY_CONVERT(INT, NULLIF($account_id, ''));
```

```bash
curl -X GET "https://your-server.com/api/myapp/endpoint/qa?user_name=alex&account_id=1001"
```

**Response**:
```json
[
  { "user_id": 19, "user_name": "alex", "email": "alex@example.com" }
]
```

---

**MSSQL — UPSERT with Transaction**

Endpoint `custom_data`: `"$_VAR_MAIN_DB"`

Endpoint `code`:
```sql
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRAN;

    IF TRY_CONVERT(INT, NULLIF($id, '')) IS NULL
      INSERT INTO [AppDb].[dbo].[entities] (name, status, created_by)
      VALUES ($name, $status, $updated_by);
    ELSE
      UPDATE [AppDb].[dbo].[entities]
      SET name = $name, status = $status, updated_by = $updated_by
        WHERE id = TRY_CONVERT(INT, NULLIF($id, ''));

    COMMIT TRAN;
END TRY
BEGIN CATCH
    ROLLBACK TRAN;
    THROW;
END CATCH
```

**POST body**:
```json
{
  "bind": {
    "id": null,
    "name": "Sample Entity",
    "status": "A",
    "updated_by": "system_admin"
  }
}
```

</details>

---

<details>
<summary>MSSQL / T-SQL Best Practices</summary>

When writing T-SQL for production endpoints, these patterns improve correctness and safety:

**Parameter normalization** — when possible, normalize inline with `$param` expressions instead of re-declaring request-backed variables:
```sql
SELECT *
FROM dbo.items
WHERE code = NULLIF(LTRIM(RTRIM($text_param)), '')
  AND id = TRY_CONVERT(INT, NULLIF(LTRIM(RTRIM($int_param)), ''));
```

**Mandatory validation with `THROW`** — returns HTTP 500 with the message as `error`:
```sql
IF NULLIF(LTRIM(RTRIM($text_param)), '') IS NULL
  THROW 53001, 'The text_param parameter is required.', 1;
```

**Avoid duplicate declarations for bound fields in MSSQL / T-SQL**:
```sql
-- Avoid patterns like this in T-SQL when using OpenFusion SQL bind payloads
DECLARE @text_param NVARCHAR(100) = $text_param;
```
This failure was observed on MSSQL / T-SQL. Other Sequelize dialects may behave differently, so validate per engine before applying the same restriction universally.

**Suppress row counts** to keep JSON output clean:
```sql
SET NOCOUNT ON;
```

**Transactions with automatic rollback on error**:
```sql
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRAN;
    -- ... DML statements ...
    COMMIT TRAN;
END TRY
BEGIN CATCH
    ROLLBACK TRAN;
    THROW;
END CATCH
```

**`cache_time`** — set on the endpoint (in seconds) to cache the JSON response and avoid repeated identical queries:
- `0` — no cache (default, use for writes and real-time reads)
- `30` – `120` — short-lived cache for frequently-read, rarely-changing data
- `300` – `600` — longer cache for expensive queries on stable master data

</details>

---

<details>
<summary>📊 Capability Summary</summary>

| Feature | Supported |
|---|---:|
| Multiple Dialects (PG, MySQL, MSSQL) | ✅ (Sequelize) |
| Connection Pooling | ✅ (LRU Cache) |
| Parameter Binding | ✅ (Replacements/Bind) |
| MSSQL note on `DECLARE @x = $x` with `bind` | ⚠️ Reproduced issue |
| Dynamic Connections | ✅ (Per-request override) |
| Application Variable Reference | ✅ (`"$_VAR_*"` in custom_data) |
| CRUD Operations | ✅ |
| Caching | ✅ (OpenFusion Standard) |

</details>

---

© 2025 – OpenFusionAPI · Created and maintained by **edwinspire**
