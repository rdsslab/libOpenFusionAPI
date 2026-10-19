# HIVE-DRIVER Handler — Impala / Hive

The **HIVE-DRIVER** connects OpenFusionAPI to **Apache Hive** or **Cloudera Impala** servers via the pure-JS `hive-driver` (Thrift over TCP). No native OS dependencies (C++, unixODBC, compilers) are required, so it works on `node:alpine` with no issues.

---

<details>
<summary>🧠 How It Works</summary>

When an endpoint uses the handler `HIVE_DRIVER`:

1. The handler receives the SQL statement (`method.code`) and connection settings (`method.custom_data`).
2. It resolves environment variables (`AppVar`) and applies secure connection overrides (`connection_override_allow`).
3. It extracts bind parameters (`bind`, `replacements`, `params`) from the HTTP request (GET/POST) the same way `SQL` and `HANA` do.
4. It safely substitutes `$param` / `:param` placeholders with escaped SQL literal values (there is no native `PreparedStatement` in Impala; protected literal substitution is used instead).
5. It executes inside a **Worker** (`node:worker_threads`) so large Thrift result deserialization never blocks the main event loop.
6. It paginates by batches (`maxRows`) to avoid pulling millions of rows at once.
7. It returns `{ rows: [...], count: N }`; `BIGINT` values > `MAX_SAFE_INTEGER` are returned as `String` to preserve precision.
8. It automatically closes the client (`client.close()`), session (`session.close()`), and operation (`operation.close()`) when done.

**Supported**: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, etc. (subject to database user privileges).

**Protocol note / compatibility**: uses `HIVE_CLI_SERVICE_PROTOCOL_V10` by default, compatible with **Apache Hive 3.x / 4.x** and **Cloudera Impala** (same `TCLIService` Thrift protocol). Tested with real containers: `mirror.gcr.io/apache/hive:4.0.0` and `3.1.3` (`TCP 10000` open, `Hive Session ID` confirmed with `NoSasl` / `PLAIN`). For clusters that require `V6`, adjust `hive-worker.js` (`client_protocol`).
</details>

---

<details>
<summary>⚙️ Endpoint Configuration</summary>

Example endpoint in OpenFusionAPI:

```json
{
  "handler": "HIVE_DRIVER",
  "method": "GET",
  "resource": "/api/demo/impala/dev",
  "environment": "dev",
  "code": "SELECT * FROM mi_base.tabla WHERE category IN ($categories) AND id = $id",
  "custom_data": "{\"host\":\"impala-empresa.com\",\"port\":21050,\"username\":\"$_VAR_IMPALA_USER\",\"password\":\"$_VAR_IMPALA_PASS\",\"useTLS\":true,\"authType\":\"PLAIN\",\"maxRows\":1000,\"timeoutMs\":30000}"
}
```

The `custom_data` is JSON; it may be an object literal or an AppVar reference: `\"$_VAR_IMPALA_CONFIG\"`.

---

<details>
<summary>📄 Query Definition & Parameters (Bind)</summary>

### Placeholder syntax

- `$name` — scalar value (number, string, boolean, `NULL`).
- `:name` — same as `$name`; the system strips the prefix (`:`, `$`, `@`) before substituting.
- **Arrays** (`IN (:list)`): each element expands as `?, ?, ...` and is escaped individually.

### Example with an array

```sql
SELECT * FROM pedidos WHERE status IN ($status_list) AND region = $region
```

With request body:

```json
{
  "bind": {
    "status_list": ["PENDIENTE", "APROBADO"],
    "region": "NORTE"
  }
}
```

Internally it becomes:

```sql
SELECT * FROM pedidos WHERE status IN ('PENDIENTE', 'APROBADO') AND region = 'NORTE'
```

**Important**: never concatenate values directly into `method.code`. Always use `bind` or `replacements`.

### GET parameters

- `GET /api/demo/impala/dev?bind={"region":"NORTH"}`
- `GET /api/demo/impala/dev?region=NORTH` (without `bind`, loose fields become bind automatically — same as `sqlFunction`).
- Repeated keys: `?id=1&id=2` → `bind: { id: ["1", "2"] }` (Fastify semantics).
</details>

---

<details>
<summary>🔧 Connection Parameters (`custom_data` / AppVar)</summary>

| Field | Type | Required | Notes |
|---|---|---|---|
| `host` | string | yes | Hostname / IP of HiveServer2 / Impala |
| `port` | number | no | Default `21050` |
| `username` | string | yes (PLAIN) | Domain user (LDAP) |
| `password` | string | yes (PLAIN) | Domain password (protected via TLS in production) |
| `database` | string | no | Default database (same as `USE`) |
| `useTLS` | boolean | no | Enables SSL on the TCP socket (`ssl: true`). Default `false` |
| `tls` | object | no | TLS options (`ca`, `rejectUnauthorized`, `cert`, `key`) passed to `TcpConnection` |
| `authType` | string | no | `PLAIN` (today / LDAP), `NONE` / `NOSASL` (for SASL-less servers), `KERBEROS` (reserved; requires installing `kerberos`) |
| `maxRows` | number | no | Batch fetch size per Thrift fetch. Default `1000` (it is NOT the total result limit) |
| `timeoutMs` | number | no | Query timeout. Default `30000` |
| `connection_override_allow` | array | no | Allowlist of connection override keys (e.g. `["host","port"]`) |

**Example with TLS**:

```json
{
  "host": "impala-secure.empresa.com",
  "port": 21050,
  "username": "svc_impala",
  "password": "***",
  "useTLS": true,
  "tls": { "ca": "/certs/ca.pem", "rejectUnauthorized": true },
  "maxRows": 500
}
```

> ⚠️ **Security**: if you send `password` without `useTLS: true`, the credential travels in clear text over TCP. Always enable TLS in production.
</details>

---

<details>
<summary>🌐 Example Requests</summary>

### POST with array (`IN`) and connection override

```bash
curl -X POST https://example.com/api/demo/impala/prd \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "bind": {
      "categories": ["X", "Y", "Z"],
      "min_id": 100
    },
    "connection": {
      "host": "impala-prd.empresa.com",
      "port": 21050,
      "username": "$_VAR_IMPALA_USER",
      "password": "$_VAR_IMPALA_PASS"
    }
  }'
```

### SQL configured

```sql
SELECT id, name, category FROM enddb.demo WHERE category IN ($categories) AND id >= $min_id LIMIT 1000;
```

### Successful response

```json
{
  "rows": [
    { "id": 1, "name": "Alice", "category": "X" },
    { "id": 2, "name": "Bob", "category": "X" },
    { "id": 3, "name": "Charlie", "category": "Y" }
  ],
  "count": 3
}
```

---

<details>
<summary>🔐 Authentication & Access</summary>

Supports the standard OpenFusionAPI access modes:

- **Public**
- **Basic Authentication**
- **Token (JWT)**

**Recommendation**: use read-only tokens for public endpoints (`SELECT`); restrict `INSERT/UPDATE/DELETE` to specific roles.
</details>

---

<details>
<summary>🪵 Logs</summary>

Each request logs globally on OpenFusionAPI:

- Timestamp
- SQL executed (resolved bind or raw placeholder depending on log level)
- Execution time (ms)
- Connection host / port
- Result (`statusCode` / error)
- Timeout (`504`) if applicable
</details>

---

<details>
<summary>📊 Capability Summary</summary>

| Feature | Supported |
|---|---|
| Impala / HiveServer2 (TCP binary) | ✅ |
| LDAP / PLAIN domain auth | ✅ |
| Kerberos (reserved; not installed today) | ⏳ ready for `authType: "KERBEROS"` |
| TLS / SSL (`useTLS` + `tls`) | ✅ |
| Parameters (`$`, `:`, arrays `IN`) | ✅ |
| Batch pagination (`maxRows`) | ✅ |
| Event loop isolation (`Worker`) | ✅ |
| BIGINT precision (`Int64` → `String`) | ✅ |
| DECIMAL precision | ⚠️ depends on `hive-driver`; use `CAST(col AS STRING)` |
| Multiple queries per request | ❌ (one per request) |
| Efficient bulk insert | ❌ (use `SQL_BULK_I` with another engine) |
| Caching | ✅ (global OpenFusionAPI) |
</details>

---

<details>
<summary>💡 Typical Use Cases</summary>

- Expose Hive/Impala tables and views as REST endpoints (dashboards, reporting).
- Analytical queries with aggregations (`GROUP BY`, `SUM`) and filters by arrays (`IN`).
- Cross-system data validation (e.g., compare IDs against a code list).
- Integrate Big Data consumers (blogs, APIs) without installing ODBC in the Docker image.
</details>

---

## Notes & Limitations

- **No native `PreparedStatement`**: all parameters are substituted as protected literals. Never concatenate manually.
- **Large types**: `BIGINT` > `MAX_SAFE_INTEGER` is returned as `String`; if you need a number in the client, cast to `STRING` in SQL or convert to `BigInt` in JS.
- **Event Loop**: the Worker isolates Thrift deserialization, but a `SELECT` with millions of rows can grow the worker memory; always use `maxRows` or a `LIMIT` in your SQL.
- **Kerberos**: requires `npm i kerberos` and a configured `principal` / `keytabPath`; not installed today to avoid native dependencies and is left as a reserved `authType`.
- **Protocol version**: defaults to `V10` (Hive 3.x / 4.x compatible). If your cluster requires `V6`, edit `hive-worker.js` (`TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V6`).

© 2026 — OpenFusionAPI · `hive-driver` integration
