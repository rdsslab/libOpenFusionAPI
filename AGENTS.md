# AGENTS.md — libOpenFusionAPI

## Quick commands (verified in this repo)

- Version: `13.13.4` (bumped from 13.13.3)
- Build / syntax check: `node --check src/lib/handler/hive-worker.js && node --check src/lib/handler/hiveDriver.js`
- Full handler docs: `npm run docs:handlers` (rebuilds `docs/index` and validates handler docs)
- Version bump script: `npm run set_version`
- Main package: `@rdsslab/libopenfusionapi`

## What changed recently (agent-critical)

- `HIVE_DRIVER` (label `HIVE-DRIVER`) is an independent handler, not `SQL_DRIVER`.
- `hive-worker.js`: supports `protocol` (`V6` / `V10`) and `transport` (`framed` / `buffered`) per endpoint via `custom_data`. Default: V10 + framed.
- `hiveDriver.js`: `protocol`, `client_protocol`, `transport` added to override allowlist (`hiveCeiling`) and reserved request keys.
- Auth `NONE` / `NOSASL`: uses `NoSaslTransportPassthroughAuthentication` to avoid forcing `TBufferedTransport` (fixes `openSession` hang with HiveServer2 3.1.3 / `TFramedTransport`).
- `README.md` and `AI_SKILL.md`: translated to English; `authType` values explicitly listed (`PLAIN`, `NONE`/`NOSASL`/`NO_SASL`, `KERBEROS`); `tls` can reference AppVars (`$_VAR_IMPALA_TLS`).
- Large data precautions (`AI_SKILL.md`, line 53+): `maxRows` is batch size, not total result limit; `LIMIT` mandatory; array binds limited; `timeoutMs` does not protect memory.
- Seed demo (`src/lib/db/default/demo.js`): `$_VAR_HIVE_CONFIG` + 2 endpoints (`GET /api/demo/hive/constant`, `POST /api/demo/hive/dev`).
- Subagent (`ses_ea99c1232ffekuN0oyfx40lWGK`) completed protocol diagnosis: TCP connects (`localhost:10000`), server creates `Hive Session ID`, but `openSession` hangs due to `TBufferedTransport` vs `TFramedTransport` mismatch.

## Architecture notes for agents

- Endpoints configured via JSON `method.custom_data` (`host`, `port`, `username`, `password`, `database`, `useTLS`, `tls`, `authType`, `protocol`, `client_protocol`, `transport`, `maxRows`, `timeoutMs`).
- Queries use `$param` (scalar) or `:param` (array `IN (...)`). Never concatenate SQL; always use `bind` or `replacements`.
- Handler runs queries in `node:worker_threads` (`hive-worker.js`) to avoid blocking the event loop.
- `SAFE_LITERAL` substitution is used (Impala has no native `PreparedStatement`).
- `BIGINT` > `MAX_SAFE_INTEGER` returned as `String` to preserve precision.
- Build passes; GUI (`libOpenFusionAPIGUI`) rebuilt (`v9.5.14`) with `hiveDriver.svelte` widget registered in `editor.svelte` (`HANDLER_TABS`).

## Non-obvious conventions

- `hive-worker.js` must remain intact; manual edits to protocol/auth are now handled through `custom_data` (no manual server edits needed, survives updates).
- If using `authType: NONE`, ensure server `hive-site.xml` allows `NONE` and `auth=NONE` is set.
- `hive-site.xml` config (`framed.transport`) must match the `transport` config: if server uses `framed=true` (default 3.1.3), leave `transport` as default (`framed`); only set `buffered` explicitly if server requires it (`framed=false`).
- `AI_SKILL.md` covers errors (`TimeoutError`, `Connection refused`, protocol mismatch, `EPIPE`).
- `CHANGELOG.md` updated (`13.13.3` -> `13.13.4`).

## References that matter

- Skill docs: `src/docs/handlers/HIVE_DRIVER/README.md` (English), `AI_SKILL.md` (English).
- Subagent session `ses_ea99c1232ffekuN0oyfx40lWGK`: full protocol/transport diagnosis.
- `README.md`: translated to English for consistency (`HANA`, `SQL`, `MONGODB` docs also in English).

## Graphify (project mapped — 2608 nodes / 5840 edges / 153 communities)

- Only `graphify-out/GRAPH_REPORT.md` is tracked in git; `graph.html` (2.5 MB), `graph.json` (2.4 MB) and all caches are regenerated locally.
- Build report + mapeo: `graphify . --update --code-only` (~40 s, sin LLM).
- Query: `graphify query "<question>"`.
- Refresh clusters/report: `graphify cluster-only .`.
- Si otro agente de IA necesita el grafo sin clonar+regenerar, publica `graphify-out/graph.html` en GitHub Pages o crea un workflow que lo genere y lo descarte.
- Nota: el historial antiguo de `graphify-out/` (~5 MB) no se elimina automáticamente; si lo quieres reducir globalmente usa `git filter-repo` o BFG.
