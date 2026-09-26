# SQL BULK INSERT Handler – High Performance Data Loading

The **SQL BULK INSERT handler** (`SQL_BULK_I`) is a specialized handler optimized for inserting large volumes of data into a relational database within a single transaction.

---

<details>
<summary>🧠 How It Works</summary>

When an endpoint is configured with the **SQL_BULK_I** handler:
1.  **Configuration**: Reads target table info and DB connection settings.
2.  **Pool Management**: Reuses database connections via an LRU pool (shared mechanism with the standard SQL handler).
3.  **Transaction**: Initiates a database transaction.
4.  **Bulk Operation**: Executes a high-performance `bulkInsert` command (via Sequelize) for the provided array of data rows.
5.  **Commit/Rollback**: Commits the transaction if successful, or rolls back entirely if any error occurs to ensure data integrity.

</details>

---

<details>
<summary>⚙️ Endpoint Configuration</summary>

The configuration must be a valid **JSON object**.

**Required Fields** (all at the root of `custom_data` — there is no `config` wrapper, the handler
reads `custom_data` as the connection config itself):
-   `database`: Database name. Missing it returns `400 Database is required`.
-   `options`: Connection options. Missing it returns `400 Params configuration is not complete`.
-   `ignoreDuplicates`: (Optional) Boolean to ignore duplicate key errors.
-   `query_type`: (Optional) Defaults to `INSERT`.

The target table comes from `code` (`table_name` above is the table name, optionally schema-qualified).

**Example** — `code` is `inventory.logs` and `custom_data` is:
```json
{
  "database": "warehouse_db",
  "username": "writer_svc",
  "password": "secure_password",
  "ignoreDuplicates": true,
  "options": {
    "host": "192.168.1.50",
    "dialect": "postgres"
  }
}
```

</details>

---

<details>
<summary>📥 Data Payload</summary>

The data to insert must be sent in the request (usually `POST` body) as an array under the `data` key.

**Request Body**:
```json
{
  "data": [
    { "id": 1, "item": "Widget A", "qty": 100 },
    { "id": 2, "item": "Widget B", "qty": 50 },
    { "id": 3, "item": "Widget C", "qty": 200 }
  ]
}
```

</details>

---

<details>
<summary>📊 Capability Summary</summary>

| Feature | Supported |
|---|---:|
| Transactional Integrity | ✅ (All or Nothing) |
| Schema Support | ✅ |
| Ignore Duplicates | ✅ |
| Connection Pooling | ✅ |
| High Performance | ✅ (Batch Insert) |

</details>

---

© 2025 – OpenFusionAPI · Created and maintained by **edwinspire**
