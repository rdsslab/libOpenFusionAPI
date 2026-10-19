# HIVE-DRIVER (Impala / Hive) — AI Agent Skill

## Purpose

Use the `HIVE_DRIVER` handler (label `HIVE-DRIVER` in the registry) to connect OpenFusionAPI endpoints to Apache Hive / Cloudera Impala via the pure-JS `hive-driver` (Thrift TCP). This avoids native OS dependencies (unixODBC, C++ compilation), making it ideal for lightweight Docker images (`node:alpine`).

## When to use

- The source is HiveServer2 / Impala with TCP binary transport (port 21050 by default). Tested with real containers: `mirror.gcr.io/apache/hive:4.0.0` and `3.1.3` (`TCP 10000`, `Hive Session ID` confirmed; `authType: NONE` and `PLAIN` tested).
- You need LDAP/PLAIN domain authentication (`username`/`password`).
- You must receive parameters (`bind` / `replacements`) from HTTP requests, including arrays for `IN (...)` filters.
- You want event-loop isolation for large result sets (`maxRows` pagination + `Worker` thread).
- You need future Kerberos readiness (`authType: "KERBEROS"` reserved; requires `npm i kerberos` when needed; not installed today).

## When NOT to use

- If the database is SAP HANA → use `HANA`.
- If you need bulk insert efficiency → use `SQL_BULK_I` with a SQL-native driver.
- If the clúster only exposes HTTP transport or requires ODBC/JDBC specifically.
- If you need multi-statement queries per request (only one statement per request).

## Endpoint structure

```json
{
  "handler": "HIVE_DRIVER",
  "code": "SELECT * FROM enddb.demo WHERE category IN ($categories)",
  "custom_data": "{\"host\":\"impala.company.local\",\"port\":21050,\"authType\":\"PLAIN\",\"maxRows\":1000}"
}
```

Bind payload (POST / GET query / body):
```json
{ "bind": { "categories": ["X","Y"], "min_id": 100 } }
```

Response format: `{ "rows": [{...}], "count": N }`

## Connection config reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `host` | string | yes | HiveServer2 / Impala host |
| `port` | number | no | Default `21050` |
| `username` | string | yes (PLAIN) | Domain / LDAP account |
| `password` | string | yes (PLAIN) | Domain password |
| `useTLS` | boolean | no | Enables SSL on TCP socket |
| `tls` | object | no | `{ ca, rejectUnauthorized, cert, key }` — pass to `TcpConnection` |
| `authType` | string | no | `PLAIN`, `NONE`, `KERBEROS` (future) |
| `maxRows` | number | no | Paginated fetch size (default 1000) |
| `timeoutMs` | number | no | Query timeout (default 30000) |

## Precautions for Large Data / Unbounded Queries

**Critical — always enforce limits in SQL or config:**

- `maxRows` (default `1000`) controls only the **batch fetch size**, not the **total result set**. The worker loops with `while (more)` until `operation.hasMoreRows()` is false; if your query has no `LIMIT` or `WHERE` narrowing, it will pull **all matching rows** into the worker's memory and return them in full (`{rows:[...], count:N}`). Never run `SELECT * FROM large_table` without `LIMIT`.
- Always write `LIMIT <n>` (e.g. `LIMIT 1000`) or a narrowing `WHERE` clause in `method.code`. For reporting/aggregation endpoints prefer `GROUP BY` / `SUM` over raw row retrieval.
- If the result could exceed available memory (tens of thousands to millions of rows), split it into paginated endpoint calls, or use `SQL_BULK_I` / file-based extraction instead.
- Array binds (`IN ($list)`) expand into literal lists. An array with thousands of elements produces a very long SQL string that can hit parser limits or network packet size. Keep `IN (...)` arrays to a few hundred elements; for very large dimension lists use temporary tables or sub-queries.
- `timeoutMs` kills the worker after the timeout, but a `SELECT *` without `LIMIT` can fill memory *before* the timeout fires. Do not rely on the timeout alone as volume protection.
- For production endpoints, set the endpoint-level `timeout` plus a sane `maxRows`, and consider a `cache` or batch layer instead of allowing ad-hoc unfiltered queries.
- `SELECT` on Impala/Hive is read-only by default; `INSERT`/`UPDATE`/`DELETE` on huge tables are long-running and can hold locks — scope them with `WHERE` on a partition key.

## Security rules for agents

1. **Always use bind parameters** (`$param` or `:param`). Never concatenate SQL from user input.
2. **Use TLS when sending passwords** (`useTLS: true`). If using self-signed certs, pass `tls: { rejectUnauthorized: false }` temporarily and switch to CA trust afterward.
3. **Keep credentials in AppVars** (`$_VAR_IMPALA_USER`, etc.) or `connection` override, never in endpoint code or docs.
4. **Array parameters expand to `IN (...)`** automatically; no manual `JOIN` or string building needed.
5. **Precise number handling**: `BIGINT` > 9007199254740991 (MAX_SAFE_INTEGER) is returned as `String`; use `CAST(col AS STRING)` in SQL if the client expects text, or convert to `BigInt` in JS.
6. **Event loop protection**: the handler runs queries inside `hive-driver-worker.js` (`Worker` thread); do not try to run large `SELECT *` without pagination (`maxRows` or `LIMIT` in SQL).

## Common errors and fixes

- `Connection refused` / `ECONNREFUSED`: check `host`/`port`; verify `hive-site.xml` binds to `0.0.0.0`; check firewall between host and container.
- `Authentication error`: verify `authType`; for LDAP/Active Directory use `PLAIN`; for no-auth use `NONE`; for future Kerberos prepare `principal` and `keytabPath`.
- `TimeoutError`: increase `timeoutMs`; reduce `maxRows`; add `LIMIT` or `GROUP BY` in Impala.
- `BIGINT` truncation: cast to `STRING` in SQL or handle `String` result.
- `EPIPE` / `close`: protocol/version mismatch (test `V10` vs `V6` in `hive-worker.js`); verify `client_protocol` matches server.

## Example endpoint definition (complete)

```json
{
  "handler": "HIVE_DRIVER",
  "method": "POST",
  "resource": "/api/demo/hive/dev",
  "environment": "dev",
  "code": "SELECT id, name, category FROM enddb.demo WHERE category IN ($categories) AND id >= $min_id LIMIT 1000",
  "custom_data": "{\"host\":\"localhost\",\"port\":10000,\"username\":\"\",\"password\":\"\",\"authType\":\"NONE\",\"maxRows\":500,\"timeoutMs\":30000}"
}
```

Example request (array bind):
```bash
curl -X POST .../api/demo/hive/dev \
  -H "Content-Type: application/json" \
  -d '{"bind":{"categories":["X","Y"],"min_id":1}}'
```

Expected response:
```json
{"rows":[{"id":1,"name":"Alice","category":"X"}],"count":1}
```
