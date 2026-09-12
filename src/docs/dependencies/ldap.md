# LDAP Client Integration Guide

This page defines how libOpenFusionAPI documents and consumes the `ldapts` package, exposed inside the JS handler sandbox under the `ldap` (and `ldapts`) variables.

## Summary

- Dependency: ldapts
- Used in: JS handler runtime helpers (LDAP v3 and Active Directory connectivity, credential validation)
- Primary local guides:
  - docs/handlers/JS/README.md
  - docs/handlers/JS/libraries/ldap.md
  - docs/handlers/JS/libraries/ldapts.md
- Upstream canonical docs: https://ldapts.js.org/

## Source of Truth Rules

- Local docs are the operational source for repository-specific integration patterns.
- Upstream docs are the canonical source for public package API contracts.
- If local and upstream docs diverge, update local docs immediately and add a compatibility note.

## Current Contract Snapshot (High Impact)

- Preferred workflow: `new Client({ url })` → `client.bind(userDN, password)` → `client.search(baseDN, options)` → `client.unbind()` in a `finally` block.
- `url` must use the `ldap://` or `ldaps://` scheme. Prefer `ldaps://` in production.
- `bind()` rejects with an LDAP-specific error class (e.g. `InvalidCredentialsError`) on failure.
- `search(baseDN, options)` returns `{ searchEntries, searchReferences }`.
- Search options include `scope` (`base` | `one` | `sub`), `filter`, `attributes`, `sizeLimit`, `timeLimit` and `paged`.
- Write operations: `client.add(dn, attributes)`, `client.modify(dn, changes)` (array of `Change` objects), `client.del(dn)`.
- `ldap.escapeFilter(value)` escapes LDAP filter metacharacters from untrusted input.
- All operations return Promises and work inside the async wrapper of the JS handler.

## Agent Guidance

- Start with repository docs to implement behavior in this codebase.
- Verify critical API details in upstream docs before changing production-sensitive code.
- Pull host, bind credentials and base DN from Application Variables (`$_APP_VARS_['$_VAR_...']`); never inline secrets in endpoint code.
- Structure flows as `new Client` → `bind()` → operations → `unbind()` in a `finally` block.
- Escape every user-supplied value used inside an LDAP filter with `ldap.escapeFilter(...)`.
- Cap searches with `sizeLimit` and restrict `attributes` to avoid memory-heavy responses.
- Prefer read-only service accounts unless the handler must create/modify directory entries.
- For credential validation, find the user DN first, then `bind()` with that DN and the typed password; do not echo secrets to the caller.

## Compatibility Notes

| Topic | Current Recommendation | Legacy Compatibility | Risk if Ignored |
|---|---|---|---|
| Library naming | Use the `ldap` variable in new code | `ldapts` alias available for code written against the package name | Unclear naming in generated endpoint code |
| Transport security | Prefer `ldaps://` (LDAP over TLS) | Plain `ldap://` still supported | Credentials sent in clear text |
| Lifecycle | Always `client.unbind()` in `finally` | Leaving the socket open | Resource leaks and hanging connections |
| Filter inputs | Escape with `ldap.escapeFilter(...)` | Raw string interpolation in filters | LDAP injection from user-controlled input |
| Search volume | Always set `sizeLimit` | Unbounded `sub` searches | Excessive memory and CPU usage in the sandbox |
| Credentials | Resolve from Application Variables | Hardcoded in endpoint code | Secrets exposed in stored endpoint code |

## Verification Metadata

- Last verified date: 2026-09-12
- Verified package version in this repository: ldapts 9.0.0
- Verified against upstream docs: https://ldapts.js.org/
- Verified by: libOpenFusionAPI maintenance workflow

## Change Response Playbook

1. Update this dependency page with the new contract snapshot.
2. Update affected handler docs (JS README and the generated library files via `functionVars.js`).
3. Add or refresh migration examples for agent-generated code.
4. Re-run docs validation and regenerate derived docs when needed.

## Minimal Example

```javascript
const client = new ldap.Client({
  url: $_APP_VARS_['$_VAR_LDAP_URL'],
});

try {
  await client.bind(
    $_APP_VARS_['$_VAR_LDAP_BIND_DN'],
    $_APP_VARS_['$_VAR_LDAP_BIND_PASSWORD'],
  );

  const user = ldap.escapeFilter(String(request.query?.user || '')) || '(objectClass=person)';

  const { searchEntries } = await client.search(
    $_APP_VARS_['$_VAR_LDAP_BASE_DN'],
    { scope: 'sub', filter: user, attributes: ['cn', 'mail'], sizeLimit: 50 },
  );

  $_RETURN_DATA_ = searchEntries;
} finally {
  await client.unbind();
}
```