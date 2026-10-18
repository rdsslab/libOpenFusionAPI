# OpenCode + Graphify — Configuración del proyecto

## Antes de responder cualquier pregunta sobre el código de este proyecto:

1. Verifica si existe `graphify-out/graph.json`. Si existe:
   - Usa `/graphify query "<pregunta>"` para consultar la arquitectura, relaciones o comunidades.
   - Usa `/graphify path "NodoA" "NodoB"` para rastrear conexiones.
   - Usa `/graphify explain "concepto"` para entender un símbolo central (ej. `RateLimitService`, `EndpointRuntimeService`, `MCPToolRuntime`).
2. Solo si la consulta requiere leer código fuente específico (ej. detalles internos de un archivo que no aparece en los nodos del grafo), lee el archivo directamente con las herramientas estándar.

## Datos clave del grafo actual (`graphify-out/graph.json`)
- 2,584 nodos · 5,798 aristas · 143 comunidades
- God nodes principales: `recordAudit()`, `sequelize`, `Endpoint`, `RateLimitService`
- Comportamiento de suspensión por errores: `max_failed_attempts` default = 0 (nunca suspender). Cualquier valor no válido (`null`, `undefined`, `""`, negativo o no numérico) cae en 0. Solo si se configura explícitamente `> 0` se suspende tras ese número de fallos consecutivos.
- Comunidades relevantes: `mcp.js` (MCP server), `RateLimitService.js` (limitación), `EndpointRuntimeService.js`, `mcp_contract_audit.js`, `handler.js`, `sqlFunction.js`
- Ciclos de importación detectados: `log.js -> models.js -> utils.js -> functionVars.js` (4 archivos)

## Consultas sugeridas para este proyecto:
- "¿Qué conecta `mcp.js` con `RateLimitService`?"
- "¿Cuál es el camino más corto entre `Endpoint` y `BotLifecycleTask`?"
- "¿Qué archivos contribuyen al ciclo `log.js -> models.js -> utils.js`?"

Nota: El grafo se generó con `--code-only` (sin docs ni imágenes semánticas). Para actualizarlo después de cambios grandes: `graphify update .`
