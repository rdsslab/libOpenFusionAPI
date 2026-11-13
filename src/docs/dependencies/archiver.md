# Archive Generation Integration Guide

This page defines how libOpenFusionAPI documents and consumes the `archiver` package, exposed inside the JS handler sandbox as the `archiver` variable.

## Summary

- Dependency: archiver
- Used in: JS handler runtime helpers (ZIP / TAR / TAR+GZIP / JSON archive generation in memory)
- Primary local guides:
  - docs/handlers/JS/README.md
  - docs/handlers/JS/libraries/archiver.md
- Upstream canonical docs: https://www.archiverjs.com/docs/

## Source of Truth Rules

- Local docs are the operational source for repository-specific integration patterns.
- Upstream docs are the canonical source for public package API contracts.
- If local and upstream docs diverge, update local docs immediately and add a compatibility note.

## Current Contract Snapshot (High Impact)

- `archiver@8` is **ESM-only** and exposes classes: `ZipArchive`, `TarArchive`, `JsonArchive`, plus the base class `Archiver`. The historical `archiver('zip', options)` factory from earlier majors **no longer exists**.
- Canonical flow: `new archiver.ZipArchive(options)` → register `data`/`error`/`end` listeners → `append()` / `file()` / `directory()` / `glob()` → `await finalize()`.
- `append(source, data)` accepts a `Buffer`, a `string` or a readable `stream`. `data.name` (the internal path inside the archive) is required.
- ZIP options: `comment`, `store` (STORE method, no compression), `forceZip64`, `namePrependSlash`, `forceUTC`, and `zlib` (`zlib.level` 0-9 controls compression).
- TAR options: `gzip` (boolean) plus `gzipOptions`; `gzip: true` produces a `.tar.gz`.
- Entry data for appends: `name`, `date`, `mode`, `prefix`, `type`.
- `finalize()` returns a `Promise` that resolves when the format module has drained every appended source.
- archiver only **creates** archives. Extraction is out of scope for this dependency.

## Agent Guidance

- Start with repository docs to implement behavior in this codebase.
- Verify critical API details in upstream docs before changing production-sensitive code.
- Register the `data` and `error` listeners **before** appending anything: an archive is a stream, and chunks emitted with no listener are lost silently.
- Await `finalize()` and the completion signal (the `end` event of the destination) before touching the collected chunks.
- Return the archive as a Buffer in `$_RETURN_DATA_`, and set `Content-Type` plus `Content-Disposition` in `$_CUSTOM_HEADERS_` so the response is a download.
- Never pass request-supplied paths to `file()`, `directory()` or `glob()`: resolve them against an allowlisted base directory to avoid path traversal.
- Do not let caller input decide entry names inside the archive.
- Keep generated archives small: in-memory generation holds the whole artifact in RAM and compression burns the endpoint `timeout`.

## Compatibility Notes

| Topic | Current Recommendation | Legacy Compatibility | Risk if Ignored |
|---|---|---|---|
| Instantiation | `new archiver.ZipArchive()` / `new archiver.TarArchive()` | The `archiver('zip')` factory from older majors | Runtime `TypeError`: v8 has no callable default export |
| Module format | ESM named exports only | CommonJS `require('archiver')` from older majors | Mixed-format breakage on upgrade |
| Stream capture | Listen for `data`/`error` before appending, await `finalize()` | `pipe()` to a filesystem stream (outside the sandbox) | Empty or truncated archive returned to the caller |
| Large payloads | Cap entry count and size, lower `zlib.level` or use `store: true` | `zlib.level: 9` by default | CPU exhaustion and endpoint timeouts |
| Entry names | Build from validated data | Raw `request.body` values | Caller-controlled paths inside the archive |

## Verification Metadata

- Last verified date: 2026-11-12
- Verified package version in this repository: archiver 8.0.0
- Verified against upstream docs: https://www.archiverjs.com/docs/
- Verified by: libOpenFusionAPI maintenance workflow

## Change Response Playbook

1. Update this dependency page with the new contract snapshot.
2. Update affected handler docs (JS README and the generated library files via `functionVars.js`).
3. Add or refresh migration examples for agent-generated code.
4. Re-run docs validation and regenerate derived docs when needed.

## Minimal Example

```javascript
const archive = new archiver.ZipArchive({ zlib: { level: 6 } });

const chunks = [];
archive.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

const finished = new Promise((resolve, reject) => {
  archive.on('end', resolve);
  archive.on('error', reject);
});

archive.append(Buffer.from('hello world'), { name: 'hello.txt' });
archive.append(JSON.stringify({ created: true, rows: 2 }), { name: 'data.json' });

await archive.finalize();
await finished;

$_CUSTOM_HEADERS_.set('Content-Type', 'application/zip');
$_CUSTOM_HEADERS_.set(
  'Content-Disposition',
  'attachment; filename="files.zip"',
);

$_RETURN_DATA_ = Buffer.concat(chunks);
```