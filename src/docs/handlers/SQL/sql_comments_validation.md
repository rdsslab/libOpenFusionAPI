# SQL comments in the `SQL` handler — live validation and fixes

> Report of the live test of the comment trimming introduced in commit `f2f1b81`
> (`stripNonExecutableComments`), the findings it produced and the fixes applied.

---

## 1. What was tested and why

Commit `f2f1b81` added to `src/lib/handler/utils.js` the function
`stripNonExecutableComments()`, which removes the **non-executable** comments (`--`,
MySQL `#`, `/* … */`) from the SQL before handing it to Sequelize, keeping `/*! … */`
and the `/*+ … */` hints. It is called from `ConnectionPool.js` inside the
`QueryConComentariosNeutros.formatBindParameters` patch, **only when the request carries
`values`** (`$name` binds).

The goal of the test was to check, against real engines, that the trimming does what it
promises and **does not break anything that used to work**. The conclusion is that it did
what it promised but introduced one regression, worsened another and left two pre-existing
defects unresolved. All four are fixed here.

### Engines and builds compared

Each case was run twice, changing only the URL, to isolate the effect of the commit:

| Build | Commit | Port | Role |
|---|---|---:|---|
| **BEFORE** | `42bafea` (parent of `f2f1b81`) | 3200 | baseline without trimming |
| **AFTER** | `f2f1b81` (HEAD) | 3100 | with trimming |

Real engines in Docker, all with the `sqltest` database and the `items`/`counters` tables
seeded:

| Engine | Where | Version |
|---|---|---|
| PostgreSQL | `127.0.0.1:5432` | local image |
| SQL Server | `127.0.0.1:1433` | local image |
| MySQL | `127.0.0.1:3306` | `mysql:8.4` |
| MariaDB | `127.0.0.1:3307` | `mariadb:11.4` |
| SQLite | `/tmp/opencode/sqltest.sqlite` | file |
| SAP HANA | — | **out of scope** |

> **HANA is out**: `sqlHana.js` does not go through Sequelize or
> `ConnectionPool.formatBindParameters` (it uses its own substitute), so the commit does
> not touch it. Its own substitute already ignored the `$` in comments and literals.

### Harness

- `comments_matrix.mjs` — 95-case matrix × 5 engines (line comments, block, multiline,
  nested, inside literals/identifiers, executable, around binds, AppVars `$_VAR_…`, odd
  apostrophes).
- `edge_cases.mjs` — 15 edge cases (token fusion, scope, `--` on MySQL/MariaDB).
- `extra_cases.mjs` — 6 extras (`#` with a double bind, `/*! */` with a bind, `$$` on
  Postgres).
- `sql_comments_test.js` (in the repo) — 20 cases against a real SQL Server.
- `sql_param_detection_test.js` (in the repo) — **pure** suite of the scanner.

---

## 2. A/B results

| Test | BEFORE (3200) | AFTER uncorrected (3100) | Fixed |
|---|---:|---:|---:|
| `comments_matrix` (95 × 5 engines) | 91/95 | 88/95 | **95/95** |
| `edge_cases` | 13/15 | — | **15/15** |
| `extra_cases` | 2/6 | — | 5/6\* |
| `sql_comments_test` (MSSQL) | — | — | **20/20** |
| `sql_param_detection_test` (pure) | — | — | **107 cases** |

\* The only one still failing is MariaDB with a `$bind` inside `/*! … */`; it is a driver
limitation, not the handler's (see §4, H4).

Commit `f2f1b81` **fixed 2 cases** (the two SQLite ones that used to return `200 null`)
and **broke 5** (token fusion, on the five engines). The 2 PostgreSQL dollar-quoting ones
failed before and after: they are pre-existing defects of the `bind` path, unrelated to
the trimming.

---

## 3. Findings

### H1 · Regression (high) — the dropped block fuses the tokens it separated

Removing a `/* … */` without leaving a separator glues the words the comment separated:

```sql
SELECT id, qty/* nota */FROM items WHERE name <> $name ORDER BY id LIMIT 5
```

ran as `… qtyFROM items …` → `Unknown column 'qtyFROM'`. Confirmed with
**HTTP 500 on the five engines**.

A detail that made it hard to see: it only happens when the request carries binds
(`values`), because the trimming lives inside `formatBindParameters`. With `:param`
(replacements) or with no parameters, the comment arrives intact and the query works: the
same SQL that fails with `?name=…` passes with `/resource` and no parameters. It is the
kind of regression a smoke test without binds does not catch.

### H2 · Worsening (medium) — `--` with no space is not a comment on MySQL/MariaDB

On MySQL and MariaDB, `--` **only** opens a comment if a space or a control character
follows. `1--2` is `1 - (-2)` = 3:

```
MySQL   [SELECT 7--1+1] -> 9
MariaDB [SELECT 7--1+1] -> 9
```

The trimming treated `--` as a comment on every engine, so

```sql
SELECT 1--2 AS x, $name AS eco
```

was trimmed to `SELECT 1`: the endpoint answered **200 with a wrong result** (the `AS x`
and `eco` disappeared) instead of the 500 error it gave before the commit. A silent 200
with changed data is worse than a 500.

### H3 · Pre-existing defect (medium) — PostgreSQL dollar-quoting

Two symptoms, same root: Sequelize's bind-substitution regex
(`lib/dialects/abstract/query.js:78`, `sql.replace(/\B\$(\$|\w+)/g, …)`) does not tell a
`$` that opens a dollar-quoted body from one that opens a bind.

- **`$$ … $$`** → the regex turns `$$` into `$` and PostgreSQL answers
  `syntax error at or near "$"` (500).
- **`$tag$ … $tag$`** → `$tag` was read as a bind and the guard rejected it with
  `SQL_BIND_INSIDE_LITERAL` (400), even when the body had no `$name`.

```sql
SELECT $$ cuerpo $$ AS txt, $name AS eco   -- 500 before
SELECT $tag$ cuerpo $tag$ AS t, $name AS eco -- 400 before
```

### H4 · Pre-existing defect (low) — `$bind` inside executable comments `/*! … */`

`/*! … */` runs on MySQL/MariaDB, so a `$name` inside is a real bind. The code neutralized
it (inserting a space: `$ name`) and the query died with a syntax error.

```sql
SELECT 1 AS x /*! , $name AS eco */   -- 500 before, 200 with eco=zzz on MySQL
```

### H5 · Positive effect — SQLite and the leading comment

Sequelize has a shortcut for SQLite: if the SQL **starts** with `-- ` it does
`return resolve()` and runs it as is. An endpoint that started with `-- comment` returned
`200 null`; by removing the comment first, it now returns rows. The trimming, here, fixes
it.

---

## 4. Fix applied

### `src/lib/handler/utils.js`

1. **`isLineCommentAt(query, i, dialect)`** (new). Decides whether a `--` comment starts
   at `query[i]`. On MySQL/MariaDB it requires a space or a control character after it
   (or end of string); elsewhere, and with no dialect, it always comments. Used by
   `scanSqlTokens()` and `stripNonExecutableComments()`. → **H2**.

2. **`stripNonExecutableComments()`**: when dropping a non-executable `/* … */` it leaves
   a **space**, because the comment separated tokens. → **H1**. Also, `#` is trimmed on
   MariaDB too (it used to be MySQL only), and `--` goes through `isLineCommentAt()`.
   → **H2**.

3. **`scanSqlTokens()`**:
   - `--` goes through `isLineCommentAt()`. → **H2**.
   - The content of `/*! … */` and `/*+ … */` is recorded as **code** on MySQL/MariaDB,
     so a `$name` inside is a real bind and is not neutralized. → **H4**.
   - The dollar-quoted body range ends where the closing tag **starts** (it used to
     include it and mark its own `$tag` as a bind). → **H3**.
   - Every dollar-quoted body also leaves a **region marker** with its offsets, which
     `protectDollarQuoted()` consumes.

4. **`protectDollarQuoted(query, context)`** (new). Sets the dollar-quoted bodies
   (delimiters included) aside with a `$`-free sentinel before delegating to Sequelize
   and restores them afterwards, so the engine receives the exact text of the endpoint.
   The regions come from the scanner, not from a raw `$$` search: that way a `$$`
   **inside a literal** (`SELECT '$$' AS a, $name AS b, '$$' AS c`) is not taken for a
   body and does not swallow the real `$name` in between. → **H3**.

### `src/lib/handler/ConnectionPool.js`

In `formatBindParameters`, after `prepararSqlParaBinds`, if the dialect is **PostgreSQL**
it calls `protectDollarQuoted()` and restores the result:

```js
if (contextoEscaneo.dialect === "postgres") {
  const { sql: forSequelize, restore } = protectDollarQuoted(limpio, contextoEscaneo);
  const [finalSql, parameters] = Original.formatBindParameters.call(this, forSequelize, values, dialect, ...resto);
  return [restore(finalSql), parameters];
}
```

The other dialects are untouched. → **H3**.

### Regression tests (in the repo, inside the packet)

`dev/test/sql_param_detection_test.js` adds three new pure blocks:

- `stripCases` — H1, H2 (per dialect) and H4 on the text that runs.
- `dialectCases` — H2/H3/H4 on `scanSqlPlaceholders` + `prepararSqlParaBinds`.
- `dollarCases` / `dollarIntactCases` — H3 (`protectDollarQuoted`), including the
  ambiguous `$$`-inside-literals case.

---

## 5. Residual limitations (documented, not regressions)

- **MariaDB + `$bind` inside `/*! … */`** still answers 500. The server accepts `?`
  inside an executable comment (tested with `PREPARE`/`EXECUTE`), and the MariaDB driver
  with `execute()` does too; but Sequelize uses `connection.query()`, whose `?`
  substitution is client-side and **does not see executable comments**, leaving the `?`
  literal. It is not fixable from the handler without changing driver. On MySQL it works
  (200). The baseline failed too (500), so there is no regression.
- **`SELECT '$$'`** (a single `$$` inside a literal) still returns `$`: Sequelize's regex
  reads it as `$$`→`$` and there is no pair to delimit a body. It is pre-existing
  behavior, outside the findings.
- **PostgreSQL and `$name` inside a `$$ … $$` body** stays rejected with 400
  (`SQL_BIND_INSIDE_LITERAL`): a `$name` in a function body must not be substituted
  silently. `protectDollarQuoted()` does not change that rule.

---

## 6. How to reproduce

```bash
# 1. Server with the fixed code (platform DB in a temporary SQLite)
rm -f /tmp/opencode/ofapi.sqlite
PORT=3100 TMPDIR=/tmp/opencode BUILD_DB=true node ./src/server.js

# 2. Baseline, worktree of the parent commit 42bafea, on 3200
#    (node_modules symlink and .env copy, see §7)

# 3. Comparisons (development harness, outside the packet)
OFAPI_BASE_URL=http://localhost:3100 node comments_matrix.mjs
OFAPI_BASE_URL=http://localhost:3200 node comments_matrix.mjs

# 4. Pure and engine suites, inside the repo
node dev/test/sql_param_detection_test.js
OFAPI_BASE_URL=http://localhost:3100 OFAPI_TEST_MSSQL_PASSWORD='…' node dev/test/sql_comments_test.js
```

## 7. Test environment

- Local server launched from the working tree, not the `openfusionapi` container (the
  port 3000 container does not expose `/api/system/...`, so it is useless as a baseline).
- Baseline in a worktree of `42bafea` (`/tmp/opencode/ofapi-before`) with `node_modules`
  linked and `.env` copied, port 3200.
- Each server's platform DB lives in its own `TMPDIR` with `BUILD_DB=true`; the test
  engines are Docker containers with the `sqltest` database seeded.
