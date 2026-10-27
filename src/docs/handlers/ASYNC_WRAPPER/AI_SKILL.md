# ASYNC_WRAPPER

## Quick rules (agentes)

- El `code` del wrapper debe contener SOLO el UUID (`idendpoint`) del endpoint base.
- La configuración asíncrona va SOLO en `custom_data.async` del wrapper: `ttl_ms`, `max_consumes`, `notify_ws` (default `false`).
- El endpoint base debe estar habilitado y ser válido; `ASYNC_WRAPPER`, `MCP` y `TELEGRAM_BOT` no pueden ser base.
- La petición original (query/body/headers/method) se pasa intacta al endpoint base.
- Se lee `json_schema` y `data_test` del endpoint base (source of truth).
- Las respuestas binarias se almacenan como base64 con `result_is_binary=true`, preservando `content_type` y `response_headers`.
- WebSocket notifications solo si `notify_ws=true`.
- Cada job genera un `job_token` único. El token es obligatorio para consultar `/api/system/async/status/:id` y `/api/system/async/result/:id`.
- El listado de jobs (`/api/system/async/jobs`) está protegido (`access: 2`) y soporta filtros `idapp`, `status`, `environment`.
- El backend recalcula `resource`, `method`, `environment` y `code` para `ASYNC_WRAPPER` antes de guardar (ignora lo que envíe el usuario por servicio).
- El campo `resource` del wrapper no es editable en el GUI; se construye desde el endpoint base seleccionado.

## API Routes (system app)

- `GET /api/system/async/status/:id?token=<job_token>` — Estado del job (401 si token inválido).
- `GET /api/system/async/result/:id?token=<job_token>` — Resultado del job (401 si token inválido; 410 GONE al agotar consumos).
- `GET /api/system/async/jobs?idapp=<uuid>&status=<...>&environment=<...>` — Listado protegido de jobs.

## Respuesta 202

`{ requestId, status: 'PENDING', token, pollUrl, resultUrl, wsUrl, ttl_ms, max_consumes, notifyWs, created_at, expires_at, inherits }`

## Error handling

- Base endpoint inexistente/deshabilitado → 404.
- `code` no es UUID válido → 400.
- Base es `ASYNC_WRAPPER`/`MCP`/`TELEGRAM_BOT` → 400.
- Job expirado → 410 `EXPIRED`.
- Token inválido en status/result → 401.
