# Handler Documentation

This directory now follows a per-handler documentation contract.

## Contract

Each active handler must keep its material inside its own folder:

- `README.md`: canonical human guide.
- `manifest.json`: structured metadata used by tooling and runtime documentation endpoints.
- `examples.md` or `examples.json`: optional examples for real payloads and workflows.
- `api.generated.md`: optional generated reference for helpers or runtime-exposed APIs.

## Runtime Handlers

| Handler | Label | Status | Extra Files |
|---|---|---|---|
| [FETCH](./FETCH/README.md) | Fetch | active | - |
| [FUNCTION](./FUNCTION/README.md) | Function | active | - |
| [HANA](./HANA/README.md) | HANA | active | - |
| [JS](./JS/README.md) | JavaScript | active | libraries/README.md |
| [MCP](./MCP/README.md) | MCP | active | - |
| [MONGODB](./MONGODB/README.md) | MongoDB | active | - |
| [NA](./NA/README.md) | Not Assigned | internal | - |
| [SOAP](./SOAP/README.md) | SOAP | active | - |
| [SQL](./SQL/README.md) | SQL | active | - |
| [SQL_BULK_I](./SQL_BULK_I/README.md) | SQL Bulk Insert | active | - |
| [TELEGRAM_BOT](./TELEGRAM_BOT/README.md) | Telegram Bot | active | examples.md |
| [TEXT](./TEXT/README.md) | Text | active | - |

> Auto-generated from `src/lib/handler/handler.js` and per-handler `manifest.json` files.

