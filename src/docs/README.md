# Open Fusion API

## Documentation Notes

- Handler docs index: see [handlers/README.md](handlers/README.md).
- External dependency doc template (hybrid local + upstream model): see [templates/EXTERNAL_DEPENDENCY_DOC_TEMPLATE.md](templates/EXTERNAL_DEPENDENCY_DOC_TEMPLATE.md).
- uFetch dependency guide (instantiated template): see [dependencies/uFetch.md](dependencies/uFetch.md).
- Each handler now owns a dedicated folder with a `README.md` plus a `manifest.json` contract for tooling.
- SQL scope: [handlers/SQL/README.md](handlers/SQL/README.md) documents the generic relational handler that runs through Sequelize.
- HANA scope: [handlers/HANA/README.md](handlers/HANA/README.md) documents the dedicated SAP HANA handler that uses `@sap/hana-client`.
- Cross-engine caution: behavior validated for MSSQL / T-SQL should not be assumed on PostgreSQL, MySQL, MariaDB, SQLite, or HANA without testing on that engine.
- Seeded app caution: some bundled apps are restored from `src/lib/db/default/` on startup, so persistent changes to seeded endpoints should be synchronized in those default definitions.
- TELEGRAM_BOT caution: HTTP `200` confirms route handling, not successful bot startup. Check worker logs for real startup validation.
- Recurring tasks: OpenFusionAPI supports recurrent execution of endpoints through interval tasks. Use system tools `/interval_tasks/byidapp` (read), `/interval_tasks/upsert` (write), and `/interval_tasks/delete` (write) to manage schedules.
