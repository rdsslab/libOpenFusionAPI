# dev/test — the validation packet

```bash
npm test          # same as `npm run test:all`
```

That boots the real platform, waits for it to be ready, runs every registered suite in
its own process, prints a summary, and stops the server.

---

## Suites are registered by hand

**Dropping a file in this directory does nothing.** There is no auto-discovery: the list
is the `testRuns` array in [`index.js`](./index.js), and a file that is not in it is never
run by `npm test` and no regression in it is ever caught.

41 suites are registered as of 13.11.18.

## What the runner does

- Boots `src/server.js` from the **project root** (not from `dev/test`) with `PORT=3000`,
  `BUILD_DB=true` and `AUTH_MAX_FAILURES=1000`.
  The cwd matters: `src/lib/index.js` does `import "dotenv/config"`, which looks for
  `.env` from `process.cwd()`. With the cwd in `dev/test` the `.env` was not found,
  `JWT_KEY` was undefined, the server booted *degraded* (every `/api/*` returns `503`),
  and the readiness probe never saw a 200.
- Polls `POST /api/system/system/login/prd` for up to 180 s, accepting 200, 401 or 400.
  A `503` means degraded mode, and it keeps polling.
- Runs the suites **one at a time**, each as a child process.
- Per-suite timeout **300 s** (`TEST_SUITE_TIMEOUT_MS`), then `SIGTERM`, then `SIGKILL`
  after a 10 s grace period. The limit is per suite on purpose: a slow suite is fine, a
  hung one is not. Without it the packet used to wait forever on a child that had already
  printed PASS but was still holding the database pool open.
- `AUTH_MAX_FAILURES` is raised because `owasp_top10.js` deliberately fires dozens of
  failed logins from one IP and would otherwise rate-limit itself into `429`s. The rate
  limiter itself is covered by `rate_limit_policy_test.js`.

## Choosing the database engine

`DATABASE_URL` decides the engine. Without it Sequelize falls back to a SQLite file **in
the OS temp directory**, so `TMPDIR` decides where the test database lives:

```bash
# SQLite, in a directory you control and can throw away
TMPDIR=/home/me/ofapi-tests DATABASE_URL= npm test

# PostgreSQL, with DATABASE_URL coming from .env
TMPDIR=/home/me/ofapi-tests npm test
```

On Linux the default is `/tmp`, which is wiped on reboot and is shared by everything on
the machine. Pointing `TMPDIR` somewhere else is the difference between "the test
database" and "a file I did not know existed".

`BUILD_DB=true` — which the runner forces on the server it boots — **rebuilds the schema
and re-seeds**. On a database that already has data in it, that is a migration, not a
test run.

---

## The trap that costs the most time: `JWT_KEY` and the test database

**Password hashes are keyed on `JWT_KEY`.** The stored value is
`HMAC-SHA256(plaintext, JWT_KEY)`, with a fallback chain that also accepts the plaintext
as stored and HMACs made with `AUTH_LEGACY_KEYS`.

So a database seeded under one `JWT_KEY` **cannot authenticate under a different one**,
and the symptom is:

```
POST /api/system/system/login/prd   ->  401  {"code":2,"message":"Invalid credentials"}
```

for every user, with nothing in the response or the log pointing at the key. It looks
exactly like a wrong password, and it is not.

The common way into it: booting the platform with a throwaway `JWT_KEY` (to get a clean
run) against a database that a previous run seeded with the project's own key. The clean
run then *reseeds* and starts working, which makes it look like the old database was
broken rather than the key being different.

**Rule of thumb: the run that seeds the database and the run that authenticates against
it have to agree on `JWT_KEY`.** With no `JWT_KEY` set at all, a fresh database is fine
because there is no stored hash to disagree with — which is why the trap usually appears
only on the *second* run against an existing file.

## Two kinds of suite

**Pure** — imports modules and asserts. No connection, no server. Prefer these: they
fail fast and the failure message is the whole diagnosis.

**With a connection** — writes rows and reads them back. It **must close the pool** when
it finishes, via [`close_db.js`](./close_db.js), or the process prints its success and then
hangs. With SQLite nothing appears to happen (the pool is in memory, no socket); against
PostgreSQL or SQL Server the open TCP socket keeps the event loop alive and the packet
stalls on a suite that has already reported.

`close_db.js` waits for the background `authenticate()` before closing, because closing
while that promise is in flight gets `pool is draining and cannot accept work`. It also
never turns a green suite red: a failure to close is logged and ignored, since what the
suite validates is its result, not whether the pool shut down cleanly.

## `backup_restore_test.js` cleans up only when it passes

This suite creates rows in the seeded app — an `ApiClient`, an `ApiKey`, an extra
`Endpoint`, an extra `IntervalTask`, an extra `AppVars` and a `Bot` — and at the end of
the run it restores the app to its original backup and destroys all of them.

**That cleanup is at the end of the happy path, with no `finally` around it.** If the
suite fails, every one of those rows stays, and the app stays in whatever state the
restore left it in. The next run then starts from a database that is not the one it
expects, and the failure you are looking at is the second-order one.

So: when `backup_restore_test.js` goes red, give the next run a fresh `TMPDIR` rather
than trying to work out why it now fails somewhere else.

## The seeded credentials survive a packet run

Worth stating because the opposite is a reasonable guess from the `JWT_KEY` section
above — and it was the wrong guess, cost some time, and is the reason that section
exists. Verified against the database a full packet run leaves behind: both `admin` and
`demo` authenticate with their seed passwords, as long as `JWT_KEY` is the one that
database was seeded with.

## Files here that are not in the packet

Two files in this directory look like tests and are **not registered**. `npm test` does not
run them and nothing catches a regression in them.

| file | state |
|---|---|
| `exception_payload_test.js` | needs a live server on `:3000`; passes. Reads `OFAPI_BASE_URL` since 13.11.21, and used to read an `OFAPI_TEST_URL` of its own |
| `system_test.js` | needs a live server on `:3000`; passes since 13.11.17 |

Four more sat here until 13.11.18 and are registered now: `interval_task_schedule_test.js`,
`interval_task_response_outcome_test.js`, `tasks_interval_supervisor_test.js` and
`code_validator_callback_chain_test.js`. All four are pure, fast and green, and nobody had
registered them — which is not the same as having considered and excluded them.

`system_test.js` is unregistered on purpose, and the reason holds up: it creates and deletes
an endpoint in the shared `demo` app, so putting it in the packet would make every run create
and delete a shared endpoint, and its own failures would be one more thing that can spoil the
suites after it.

It also hardcoded `http://localhost:3000` in its own `baseUrl`, so `OFAPI_BASE_URL` was
ignored *silently*: point it at a dead port and the suite went to `localhost:3000` anyway and
exited 0. Fixed in 13.11.21 — it takes `TEST_BASE_URL` from `test_credentials.js` now, like
the other 11. A test that runs against the wrong instance is not a failing test, it is a false
guarantee, and that is the expensive kind of green.

It was broken for a long time, for two reasons in a row. Up to `1f075a9` it hardcoded
`admin:admin@admin`, which the seed has never created, so it never got past login. An
earlier, unrelated commit (`a67e99a`, the MCP-harness work) swapped that for
`basicAuthHeader()`, which fixed the login as a side effect — and that is what exposed the
second reason. The MCP endpoint answers in **SSE** — `content-type: text/event-stream`, body
`event: message\ndata: {...}` — and the test read `res.data.result.tools` as if it were
JSON, so it threw on `null` at the discovery step, with a `TypeError` that named neither the
transport nor the MCP. 13.11.17 fixed that by parsing the `data:` lines. 13.11.19 moved the
endpoint deletion into a `finally`, which the `process.exit()` calls inside the suite would
otherwise have skipped, leaving `/test_ping_js` in `demo` on every failed run.

## The rest of the files here

13 of the 53 files in this directory are not suites. Knowing which is which saves
reading each one:

- **helpers**, imported by suites rather than run as one — `close_db.js` (close the
  pool), `execute_endpoint_test_payload.js`, and `test_credentials.js`, which holds the
  `admin` / `Adm1n@0penFusion!` pair that 11 files here log in with (9 of them suites;
  the other 2 are the unregistered ones below) and exports `TEST_BASE_URL`. All three values
  are overridable — `OFAPI_BASE_URL`, `OFAPI_TEST_USER`, `OFAPI_TEST_PASS` — which is how you
  point a suite at a different instance without editing it.
- **base URL: one convention, and one exception** — of the fourteen files here that name a
  server, **thirteen read `OFAPI_BASE_URL`**, through `TEST_BASE_URL` from
  `test_credentials.js`. It took three commits to get there, because it was three conventions
  and none of them complete: six files hardcoded `http://localhost:3000` with no override, and
  three had invented a private variable — `CACHE_TEST_BASE_URL`, `OWASP_BASE_URL` and
  `WS_CACHE_TEST_BASE_URL`. All six and all three are fixed as of 13.11.23, and the private
  names survive as silent fallbacks rather than being removed. The fourteenth file is
  `index.js`, which ignores the variable on purpose: it starts the server on `:3000` and polls
  `:3000`, so **the packet as a whole cannot be pointed at another instance** — every suite can,
  the runner that hosts them cannot.
- **three suites start their own platform** — `cache_validation.js`, `owasp_top10.js` and
  `ws_cache_events.js` probe `BASE_URL` for two attempts and, finding nothing, `spawn`
  `src/server.js` with `PORT` taken from that same URL. That is why they each had a variable of
  their own, and it is worth knowing when you test an override: **pointing them at a free port
  does not break them**, they just come up on it. To see whether an override is honoured, put
  something that answers on that port and count who talks to it. It is also why
  `ws_cache_events.js` derives its `ws://` URL from `BASE_URL`: the path is fixed and known, and
  host and port are what change with the instance.
- **the runner** — `index.js`, the thing `npm test` invokes
- **runnable on their own, with their own npm script** — `mcp_contract_audit.js`
  (`npm run test:mcp-contract`), `mcp_schema_smoke.mjs` (`test:mcp-schemas`),
  `mcp_tool_descriptions.js` (`test:mcp-docs`), `handler_db_matrix.mjs` (below).
  `check_mcp_name_uniqueness.js` is the odd one: it has a `test:mcp-names` script **and**
  is a suite, registered twice, against `prd` and against the `demo` app
- **orphans** — `mcp_live_validation.js`, `mcp_exhaustive_validation.js` and
  `mcp_schema_conversion.js` are neither registered nor wired to any npm script; they only
  run if you type the filename, and all three need a live server. Each says so in its own
  header now (13.11.20). `mcp_exhaustive_validation.js` is the one that must never become a
  suite: it creates users, `api_clients` and password-recovery rows, so it would dirty the
  state the other suites check. The other two only read, so they could be registered — which
  is why their headers say exactly what they do instead of just complaining.
- **the one file that reads the database directly** — `mcp_exhaustive_validation.js` opens
  SQLite with `node:sqlite`, to mint api keys signed with an app's `jwt_key` the way that
  app's processor does, and to verify rows the API does not return. It read that file from
  a hardcoded `temporales/ofapi12.sqlite`, which is nobody's database. The failure was worse
  than a missing file: `DatabaseSync` **creates** the file if it is not there, so on a
  machine where it had been created once it sat there at 0 bytes and the suite died with
  `no such table: ofapi_password_recovery` — a complaint about tables when the cause was
  the path. It now reads `OFAPI_TEST_DB_PATH`, with the old path as the default (13.11.24);
  point it at the same file the server is using, `$TMPDIR/ofapi.sqlite` under the packet.
  `DATABASE_URL` does not cover it: on a networked engine this file still cannot run.
  Since 13.11.25 it also **writes** to that file: the cleanup batch creates one user as
  `as_admin` (the BUG-8 check needs it) and the API then refuses to delete it — the caller
  is the `system` app's api key, which is not `as_admin`, and that refusal is the protection
  working. So the batch removes that user's rows itself, recovery rows before the user row
  because it is a foreign key, exactly as `deleteUser` does. That is one more reason this
  file must not become a packet suite.

## The three-engine matrix

[`handler_db_matrix.mjs`](./handler_db_matrix.mjs) is deliberately **outside** the packet:
it needs PostgreSQL, SQL Server and HANA at once, while the packet runs against whatever
the project's `.env` says, which is one engine. Adding it would make the whole packet
fail on any machine that does not have all three containers up, for a reason unrelated to
whatever change is being tested.

It documents its own requirements and its per-engine destination variables at the top of
the file. The last full run, with all three engines up, was **52 handlers passing and 0
failing**; it needs port 30015 (HANA) reachable, so it is not something to re-run
casually.

## Comments in the SQL of the `SQL` handler

[`sql_comments_test.js`](./sql_comments_test.js) is outside the packet for the same reason
as the matrix: it needs a SQL Server container with the `sqltest` database, and the packet
runs against whatever the project's `.env` says. It also needs the platform already
running, which the packet does not do for out-of-packet suites.

It checks that a comment written in the query — `-- …` or `/* … */` — changes nothing:
not the rows, not the autodetected query type, not the detection of `$name` / `:name`. The
three endpoints it exercises that live in the app `demo`
(`/ofapi/examples/sql/mssql_sin_comentarios`, `…_comentarios`, `…_comentario_appvar`) are
the same query with and without comments on top, so the comment is the only variable in
the experiment.

**As of 13.11.32 it reports 19 of 19 passing.** Before the fix it was 11 of 18, with 7
known defects and one root cause.

### What the defect was

`src/lib/handler/utils.js` knew which `$name` were real placeholders and which were only
text inside a comment, but that knowledge never reached the substitution. Sequelize does
the substitution with a regex that sees no comments —
`sql.replace(/\B\$(\$|\w+)/g, …)` in `dialects/abstract/query.js` — so:

- a `$_VAR_…` in a comment, with no bind of that name in the request, was a **500**
  `Named bind parameter "$_VAR_MSSQL_TEST" has no value in the given object`. The name
  happens to look exactly like a named bind, which is why this is the case people hit.
- a `$name` inside a **string literal** whose name collided with a real bind was
  **silent corruption**: HTTP 200 and the literal came back rewritten (`'coste: $name'`
  returned `coste: @name`).

The trigger was the request, not the endpoint: with no bind parameters in the request the
handler passed no `bind` to Sequelize, `formatBindParameters` was skipped, and the same
endpoint answered 200. So the same query worked or failed depending on the payload.

The other Sequelize substitution path, `injectReplacements` (`:name`, `?`), was never
affected — it is a hand-written scanner that tracks literals, quoted identifiers,
comments and `$$…$$` bodies. That asymmetry between the two paths *was* the whole defect.

### What the fix is

Two pieces, in two files, neither of them in the SQL handler itself:

- `prepararSqlParaBinds()` in `src/lib/handler/utils.js` walks the query and, for every
  `$name` that lives in a comment, inserts a space **between the `$` and the name**:
  `$_VAR_X` becomes `$ _VAR_X`. That is what the regex needs to stop matching, and it is
  inert for the database — the comment is still a comment with the same text. The space
  has to go *after* the `$`; put before, `$` stays glued to the identifier and the regex
  matches anyway.
- `parchearBindsDeComentarios()` in `src/lib/handler/ConnectionPool.js` installs that on
  the instance. It shadows `dialect.Query` with a subclass **of that instance** rather
  than assigning to `dialect.Query.formatBindParameters`, because `Query` lives on the
  dialect's *prototype* (`MssqlDialect.prototype.Query = Query`): two instances of the
  same engine share the very same object, and a plain assignment patches every one of
  them, including `lib/db/sequelize.js` — the platform's own connection, which has
  nothing to do with this.

The patch is in `buildSequelize()`, the only place in the project where a per-endpoint
Sequelize instance is created, so every existing endpoint and every future one gets it
without its definition being touched, and both `SQL` and `SQL_BULK_I` are covered.

Literals are **not** neutralized. That would mean rewriting the literal with
concatenation — `+` in T-SQL, `||` elsewhere — which depends on the dialect, changes the
text the client receives, and cannot be applied at all to a quoted identifier or a
`$$…$$` body, where there is nowhere to split. So instead a `$name` inside a literal or a
quoted identifier is now **rejected with a 400** explaining the conflict. That is a change
for the better even for queries that were already failing: the previous behaviour for a
colliding literal was a 200 carrying data that was not what the endpoint said.

`sql_param_detection_test.js` covers the pure half of this and is in the packet: 48 cases
for the scanner and for `prepararSqlParaBinds()`, plus adversarial inputs.

## The other two marker styles, and HANA

Two follow-up questions that are worth answering in writing because the answer is not the
one most people expect.

**`:name` and `@name` inside a comment, in the `SQL` handler, were never broken.** No fix
was needed and none was made; the point is that it is worth knowing why.

- `:name` goes through `injectReplacements`, the hand-written scanner quoted above, which
  already tracks comments. Inside a comment it is left alone.
- `@name` is **not a placeholder at all** in this handler. The `@` is stripped from the
  **keys of the request body** (`{"@name": "x"}` binds `$name`); in the query text it is
  never substituted and travels to the engine as-is. On MSSQL that makes it a T-SQL
  variable reference, so inside a comment it is inert twice over.

Verified live against MSSQL rather than assumed — 13 query shapes covering each style in
block and line comments, all three in the same comment, `$` repeated, `$` glued to the
comment delimiters, and `$` at the end of a code line.

**HANA had the same defect, still unfixed, because it is not Sequelize.**
[`sql_hana_comments_test.js`](./sql_hana_comments_test.js) is in the packet and is pure —
30 cases, no database, and it fails 14 of them against the previous parser. HANA rewrites
`:name` / `$name` into positional `?` with its own loop in
`src/lib/handler/sqlHana.js`, which tracked quotes and nothing else, so:

1. `/* sale de $_VAR_HANA_DB */` was a **500** `Missing parameter value for $_VAR_HANA_DB`.
   Same symptom, same reason: `$_VAR_…` is shaped exactly like a named placeholder.
2. An apostrophe **inside a comment** (`/* it's a note */`, `-- don't filter`) flipped the
   quote state and left it stuck. Every *real* placeholder after it was then invisible, so
   `$a` reached the database verbatim. The failure surfaced as a HANA syntax error instead
   of the clear "missing parameter" of case 1 — a neutral comment turned a working filter
   into a broken statement.

The fix is the comment state in that loop: inside a comment, no quote and no marker is
read. Unlike the `SQL` handler, nothing has to be neutralized here — HANA already receives
the `?` in place, so the comment text reaches the driver **byte for byte** as written.

Getting at that loop at all required extracting it out of `executeQuery` into an exported
`construirComandoHana()`. It is pure string work with no pool access, so it can be tested
without a HANA server — which is the only reason this is covered by a test suite at all
today, and the reason the second defect above was found.

## Adding a suite

1. Write the file.
2. Register it in the `testRuns` array in [`index.js`](./index.js) **with a comment saying
   whether it is pure or opens a connection**. The reason is what tells the next person
   whether a red result is the product or the harness, and it is the part that is always
   missing when it matters.
3. If it opens a connection, close the pool with `close_db.js`.
4. Check that it fails **without** your change. A test that passes both before and after
   is not a test, and there is no way to tell afterwards which of the two you wrote.
5. Run the whole packet, not just the new suite. The suites share a database, and a
   change that is fine alone is not necessarily fine in sequence.
