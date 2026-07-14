# uFetch Integration Guide

This page defines how libOpenFusionAPI documents and consumes @rdsslab/uFetch.

## Summary

- Dependency: @rdsslab/uFetch
- Used in: JS handler runtime helpers and FETCH handler integration behavior
- Primary local guides:
  - docs/handlers/JS/README.md
  - docs/handlers/JS/api.generated.md
  - docs/handlers/FETCH/README.md
- Upstream canonical docs: https://github.com/rdsslab/uFetch

## Source of Truth Rules

- Local docs are the operational source for repository-specific integration patterns.
- Upstream docs are the canonical source for public package API contracts.
- If local and upstream docs diverge, update local docs immediately and add a compatibility note.

## Current Contract Snapshot (High Impact)

- Preferred request methods: get, post, put, patch, delete with object options.
- Constructor supports timeout defaults via timeoutOptions as third argument.
- request(...) and method wrappers accept explicit body and timeout controls.
- Global timeout helpers are available: setTimeouts(...) and setAbortTimeout(...).
- Current batch signature: batch({ url, method, items, headers, options, config }).
- Batch positional signature is unsupported in batch() and should not be generated in new code.
- Legacy compatibility path: batch_old(url, method, items, headers, options, config).
- Batch supports top-level timeout and per-item timeout overrides.
- Batch supports config.responseParser and config.includeResponse (default false).
- Batch result item shape by default: { isError, httpCode, data?, error? }.
- If config.includeResponse=true, response is also included: { ..., response }.
- url in batch options is optional when instance base URL is already defined.

## Agent Guidance

- Start with repository docs to implement behavior in this codebase.
- Verify critical API details in upstream docs before changing production-sensitive code.
- Never generate positional batch(...) calls in new code.
- Use batch_old(...) only as a temporary migration bridge for legacy code.
- Prefer compatibility-preserving edits and include migration notes when signatures change.

## Compatibility Notes

| Topic | Current Recommendation | Legacy Compatibility | Risk if Ignored |
|---|---|---|---|
| Batch invocation | batch({ ...opts }) | batch_old(url, method, items, headers, options, config) | Runtime exceptions in JS endpoints |
| Timeout configuration | Prefer setTimeouts()/setAbortTimeout() globally plus timeout per request when needed | Hardcoded timeout only in external wrappers | Hanging requests or inconsistent timeout behavior |
| Batch result consumption | Prefer result.data; use includeResponse only when raw Response is needed | Legacy code reading result.response | Runtime errors when reading response.json() from undefined |
| Bulk fan-out patterns | Controlled concurrency via config.concurrency | Existing positional wrappers during migration | Unstable behavior and avoidable failures |
| Docs precedence | Local integration + upstream contract check | Manual cross-check only | Drift between generated code and runtime contract |

## Verification Metadata

- Last verified date: 2026-07-14
- Verified package version in this repository: @rdsslab/uFetch 4.0.2 (lock commit 6d54cf6)
- Verified against upstream source: README.md and src/fetch.js in rdsslab/uFetch
- Verified by: libOpenFusionAPI maintenance workflow

## Change Response Playbook

1. Update this dependency page with the new contract snapshot.
2. Update affected handler docs (JS and FETCH).
3. Add or refresh migration examples for agent-generated code.
4. Re-run docs validation and regenerate derived docs when needed.

## Minimal Migration Example

Before (do not generate in new code):

```javascript
await api.batch(url, "POST", items, headers, options, config);
```

After (recommended):

```javascript
await api.batch({
  url,
  method: "POST",
  items,
  headers,
  options,
  config,
});
```

Legacy bridge only:

```javascript
await api.batch_old(url, "POST", items, headers, options, config);
```
