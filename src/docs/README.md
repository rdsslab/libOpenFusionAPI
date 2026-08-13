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
- Messaging bots: bots are not endpoints. See [bots/README.md](bots/README.md) for the `ofapi_bot` model, the provider registry, and the lifecycle. Bot startup must be confirmed in the logs (`method = BOT`, `idendpoint = idbot`), never in the tool response.
- Shared skill core: [skills/JS_CORE.md](skills/JS_CORE.md) holds the JavaScript sandbox guidance common to the JS handler, the MONGODB handler and bots. It is embedded into each `AI_SKILL.md` through the `<!-- include: skills/JS_CORE.md -->` marker, expanded at read time by `src/lib/server/docsInclude.js`.
- Recurring tasks: interval tasks are not endpoints either. See [interval_tasks/README.md](interval_tasks/README.md) for the `ofapi_intervaltask` model and the runtime, and [interval_tasks/AI_SKILL.md](interval_tasks/AI_SKILL.md) for the agent contract, served by the `get_interval_task_skill` tool. A task schedules an existing endpoint on a fixed interval or a cron expression with timezone and execution window, and is managed with `list_interval_tasks` / `get_interval_task_runs` (read) and `upsert_interval_task` / `run_interval_task_now` / `reset_interval_task_attempts` / `delete_interval_task` (write).
