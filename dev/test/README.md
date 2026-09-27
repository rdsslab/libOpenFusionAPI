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
| `exception_payload_test.js` | needs a live server on `:3000`; passes |
| `system_test.js` | needs a live server on `:3000`; passes since 13.11.17 |

Four more sat here until 13.11.18 and are registered now: `interval_task_schedule_test.js`,
`interval_task_response_outcome_test.js`, `tasks_interval_supervisor_test.js` and
`code_validator_callback_chain_test.js`. All four are pure, fast and green, and nobody had
registered them — which is not the same as having considered and excluded them.

`system_test.js` is unregistered on purpose, and the reason holds up: it creates and deletes
an endpoint in the shared `demo` app, so putting it in the packet would make every run create
and delete a shared endpoint, and its own failures would be one more thing that can spoil the
suites after it. One problem is left in it: it hardcodes `http://localhost:3000` with no
environment override, so it cannot be pointed at another instance.

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
  the other 2 are the unregistered ones below). All three values are overridable —
  `OFAPI_BASE_URL`, `OFAPI_TEST_USER`, `OFAPI_TEST_PASS` — which is how you point a
  suite at a different instance without editing it.
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
