# RECORDATORIO: Sincronizar skills e instrucciones MCP con cambios de comportamiento

Este archivo existe para garantizar que cualquier cambio en el comportamiento del proyecto sea reflejado inmediatamente en:

- `.opencode/AGENTS.md` (instrucciones para OpenCode)
- `.opencode/mcp_notes.md` (notas para servidores MCP locales como `graphify_local`)
- `.mcp.json` (configuración de servidores MCP del proyecto y externos)
- `src/docs/interval_tasks/` y `src/lib/db/default/` (documentación interna de herramientas MCP expuestas por libOpenFusionAPI)
- Skills registrados (`graphify`, cualquiera nuevo)

## Regla
Antes de hacer commit o push con cambios que afecten:
- comportamiento del scheduler (`schedule.js`, `interval_task.js`)
- herramientas MCP (`mcp.js`, `mcp/server.js`, manifestos, descripciones de herramientas)
- configuraciones (`.mcp.json`, `.env`, modelos por defecto)
- documentación de agentes (`AI_SKILL.md`, `README.md`, `MANIFEST`)

...se debe verificar que la documentación interna y externa esté actualizada.

## Última verificación
- `max_failed_attempts`: default `0` (nunca suspender) — actualizado en código, docs internos (`manifest.json`, `AI_SKILL.md`, `README.md`, `system.js`), `.opencode/AGENTS.md`, `.opencode/mcp_notes.md`.
- `graphify_local` en `.mcp.json` — actualizado.
- Skill `graphify` — registrado globalmente.

Si haces un cambio futuro, actualiza este archivo con la fecha y el cambio realizado.
