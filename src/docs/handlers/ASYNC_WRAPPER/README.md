# ASYNC_WRAPPER

El handler ASYNC_WRAPPER permite ejecutar cualquier endpoint existente de forma asíncrona. Al invocarlo, crea un trabajo en segundo plano, responde inmediatamente con `202 Accepted` junto con un `requestId` y un `token`, y el endpoint base se ejecuta en background. El cliente puede consultar el estado y obtener el resultado usando los nuevos endpoints del sistema.

## Flujo de uso

1. **Crear el wrapper**: endpoint con `handler: "ASYNC_WRAPPER"` y `code` = UUID del endpoint base.
2. **Configurar**: `custom_data.async` del wrapper (`ttl_ms`, `max_consumes`, `notify_ws`).
3. **Invocar**: `POST /api/{app}/{resource}/{env}` con los parámetros del endpoint base. Responde `202` con `requestId` y `token`.
4. **Consultar estado**: `GET /api/system/async/status/{requestId}?token={token}`.
5. **Obtener resultado**: `GET /api/system/async/result/{requestId}?token={token}` (incrementa `consume_count`).
6. **Listar jobs** (solo administradores del sistema): `GET /api/system/async/jobs?idapp={idapp}&status={status}&environment={env}`.

## Configuración

Configura el comportamiento asíncrono en el `custom_data.async` del endpoint wrapper:

- `ttl_ms` (number, default `3600000`): Tiempo de vida del job en milisegundos.
- `max_consumes` (number, default `5`): Número máximo de veces que se puede recuperar el resultado.
- `notify_ws` (boolean, default `false`): Si `true`, emite notificaciones por WebSocket cuando el job se completa o falla.

El endpoint base se especifica en el campo `code` del wrapper como un UUID (el `idendpoint` del endpoint base). Solo endpoints válidos y habilitados (excluyendo `ASYNC_WRAPPER`, `MCP`, `TELEGRAM_BOT`) pueden usarse como base.

## Seguridad (token por job)

Cada job genera un `job_token` único que se devuelve en la respuesta `202`. Este token es obligatorio para consultar el estado y el resultado del job:

- `GET /api/system/async/status/:id?token=<job_token>` → 401 si el token no coincide.
- `GET /api/system/async/result/:id?token=<job_token>` → 401 si el token no coincide.

El UUID del job es público pero no basta por sí solo: se requiere el `job_token` para autorizar el acceso.

## Rutas del sistema

| Endpoint | Método | Descripción | Acceso |
|----------|--------|-------------|--------|
| `/api/system/async/status/:id` | GET | Estado del job | Público, requiere `job_token` |
| `/api/system/async/result/:id` | GET | Resultado del job | Público, requiere `job_token` |
| `/api/system/async/jobs` | GET | Listado de jobs con filtros | Protegido (sistema/admin) |

El endpoint de listado soporta filtros: `idapp`, `status`, `environment`.

## Comportamiento

- **Respuesta inmediata**: Devuelve `202 { requestId, status: 'PENDING', token, pollUrl, resultUrl, wsUrl, ... }`
- **Idempotencia**: Duplicados (mismo fingerprint: base endpoint + query/body + environment) mientras el job sea `PENDING` o `RUNNING` devuelven el `requestId` existente con su `token`.
- **Paso de petición íntegro**: La petición original (query, body, headers, method, etc.) se pasa intacta al endpoint base.
- **Herencia de metadatos**: Lee `json_schema` y `data_test` del endpoint base.
- **Respuestas binarias**: Se almacenan como base64 con `result_is_binary: true`, preservando `content_type` y `response_headers`.
- **Manejo de errores**: Si el endpoint base falla (error lanzado o HTTP >= 400), el job se marca `FAILED` con los detalles del error.
- **Expiración**: Jobs expirados (por `ttl_ms`) devuelven `410 EXPIRED` en status y resultado.
- **Consumos agotados**: Cuando `consume_count >= max_consumes`, el job se elimina y devuelve `410 GONE`.

## Configuración de la URL del wrapper

La URL del endpoint wrapper se construye automáticamente a partir del endpoint base: `baseResource + '/async'` (insertado antes del segmento de entorno, si aplica). Por ejemplo, si el base es `/api/test/api/test/async/base/json/dev`, el wrapper será `/api/test/api/test/async/base/json/async/dev`. En el backend se recalcula al guardar, ignorando lo que el usuario envíe por servicio.
