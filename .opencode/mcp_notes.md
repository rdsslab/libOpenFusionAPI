# Nota para agentes MCP (MCP server: graphify_local / openfusion)

## Cambio aplicado: suspensión por errores de IntervalTask
Archivo: `src/lib/timer/schedule.js`

- `MAX_FAILED_ATTEMPTS_DEFAULT` cambiado a `0`.
- `shouldDisableForFailures()` actualizado:
  - `undefined/null/""` → `false` (nunca suspender)
  - `max < 0` o no finito → `false` (nunca suspender)
  - `max === 0` → `false` (nunca suspender)
  - Solo `max > 0` activa suspensión tras `max` fallos consecutivos.

## Implicación para consultas de tareas
- Si se pregunta por tareas deshabilitadas por errores: buscar `disabled_by = 'system'`; ahora solo ocurre si `max_failed_attempts > 0` y se alcanzó.
- Si se pregunta por comportamiento por defecto: no se deshabilita (default 0).
- Si se busca configurar suspensión: usar valor `> 0` en `max_failed_attempts`.
