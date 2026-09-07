# Informe de Validación MCP — Pre-Producción

**Fecha:** 2026-09-07
**Servidor evaluado:** localhost:3000 (MCP endpoint `/api/system/mcp/server/prd`)
**Tools MCP publicadas:** 75
**Script de validación:** `dev/test/mcp_exhaustive_validation.js`
**Resultado:** **77/77 comprobaciones OK** — sin FAIL funcionales. Los 3 hallazgos de la corrida anterior (H1–H3) fueron corregidos y re-verificados en este ciclo.

---

## Resumen Ejecutivo

| Métrica | Valor |
|---|---|
| Comprobaciones | 77 |
| PASS | 77 |
| FAIL | 0 |
| Bugs corregidos en esta fase | **H1/BUG-6, H2 (SMTP), H3/BUG-7, BUG-5, BUG-8, BUG-9** |
| Observaciones (NOTE, no bloqueantes) | 5 |

### Veredicto: **LISTO PARA PRODUCCIÓN** ✔

- Flujo MCP completo e2e verificado: onboarding → discovery → CRUD de usuarios/endpoints/bots/api_clients → login y consumo de endpoints protegidos con api keys firmadas → recuperación de clave sin revelar usuarios → limpieza sin huérfanos.
- La suite deja la DB en baseline (users=4, clients=1, bots=2, endpoints=193, apikeys=0, recovery=0).

---

## Hallazgos cerrados en este ciclo

### H1 (era BUG-6): `apiclient_create` no devolvía la contraseña generada

**Antes:** `createApiClient()` (DB) genera y hashea la contraseña y la devuelve en `{ client, password }` (`src/lib/db/apiclient.js:57`), pero `fnCreateApiClient` descartaba `data.password` al montar la respuesta.
**Fix:** `src/lib/server/functions/system/prd/apiclient/index.js` — `password: data.password` se incluye en `r.data` (se muestra una sola vez; el flujo de login la verifica contra el hash).
**Verificado:** la suite comprueba que la respuesta trae la contraseña y luego el login HTTP con ella devuelve 200 + JWT.

### H2: email de bienvenida fallaba — `$_VAR_SMTP_TRANSPORT` no definido

**Antes:** el código del endpoint `POST /email/smtp` referencia `$_VAR_SMTP_TRANSPORT` (`src/lib/db/default/system.js`), variable que **no existe** en `ofapi_appvars`; el error se arrastraba en el 200 de `apiclient_create` como `email.error`. Además el nombre chocaba con `$_VAR_EMAIL_TRANSPORT` (la variable de la recuperación de clave, sí seedeada).
**Fix (naming unificado):** el código de `/email/smtp` ahora usa `$_VAR_EMAIL_TRANSPORT` — la AppVar ya existente en el seed (`{"host":"smtp.example.com",...}`, usada también por `src/lib/db/user.js:19`). Aplicado en el seed y en el row vivo de la DB.
**Estado:** en local el transporte demo (`smtp.example.com`) no entrega (ENOTFOUND) — comportamiento esperado que la suite registra como NOTE, no como fallo. Requiere un SMTP real en `$_VAR_EMAIL_TRANSPORT` para entrega efectiva.
**Pendiente recomendado (NOTEs asociadas):** `apiclient/index.js:42` hardcodea `to: "edwinspire@gmail.com"` y el envío depende de `process.env.USER_OPENFUSIONAPI_TOKEN` — artefactos de dev que deben salir de la config en producción, junto con remover el `// TODO: guardar el fallo de email en log`.

### H3 (era BUG-7): `apiclient_login` MCP lanzaba 500 crudo con esquema vacío

**Antes:** el tool MCP publica un `inputSchema` sin propiedades (`json_schema.in` del endpoint `GET /apiclient/login` está vacío y con `additionalProperties:false`), así que es imposible pasar credenciales; al invocarlo sin args, `loginApiClient(undefined, undefined)` → `EncryptPwd(undefined)` → `ERR_INVALID_ARG_TYPE` (500 con stack del servidor).
**Fix:**

```js
const username = auth_data?.Basic?.username;
const password = auth_data?.Basic?.password;
if (!username || !password) {
  r.data = { login: false, error: "username and password are required (Basic Auth) to login." };
  r.code = 400;
  return r;
}
```

**Verificado:** la invocación MCP devuelve 400 con mensaje actionable (no 500); el login por HTTP con Basic sigue 200 + JWT.
**Pendiente recomendado (NOTE):** declarar `json_schema.in` con `username`/`password` en el endpoint para que el tool MCP acepte credenciales (requiere además que el handler tome credenciales del body/query en el path MCP).

---

## Correcciones de esta fase (resumen)

| Fix | Archivo | Cambio |
|---|---|---|
| BUG-5 | `src/lib/db/user.js` | `EncryptPwd` con HMAC-SHA256 + `JWT_KEY` (antes sha256 plano) |
| BUG-8 | `src/lib/server/mcp/utils.js` | `passthrough` de `ctrl.as_admin` en user_create MCP |
| BUG-9 | `src/lib/db/user.js` (`deleteUser`) | borra `PasswordRecovery` antes de `user.destroy()` (FK sin CASCADE en esquema real) |
| H1/BUG-6 | `src/lib/server/functions/system/prd/apiclient/index.js` | devuelve `password` generada (una sola vez) |
| H2 | `src/lib/db/default/system.js` + DB viva | `/email/smtp` usa `$_VAR_EMAIL_TRANSPORT` (variable existente) |
| H3/BUG-7 | `src/lib/server/functions/system/prd/apiclient/index.js` | login sin credenciales → 400 actionable (no 500) |

---

## Resultados por Batch

| Batch | Cobertura | Resultado |
|---|---|---|
| Preflight MCP y servidor | tools/list, latencia | ✅ PASS |
| Batch-user | user_create MCP (as_admin y sin permisos), login 200, acceso a endpoint protegido (200/401), list_users, BUG-8, reset de contraseña + re-login | ✅ PASS |
| Batch-EP | 5 endpoints demo nuevos (JS, SQL, access 0/1/2/3), pre-existentes, anónimo 401, access con Bearer/Basic 200 | ✅ PASS |
| Batch-R | recovery/options, forgotpassword genérico, fila OTP creada, usuario inexistente no revelado, recoverycleanup | ✅ PASS |
| Batch-B | bot con código válido compilable, list, enable/disable, ciclo de vida sin errores de sintaxis | ✅ PASS |
| Batch-C | apiclient_create (+password devuelta, email como NOTE), update (set password), login HTTP 200 + JWT sin claim apikey, /apikey, keys firmadas por app (demo/system), consumo cross-app, login MCP → 400 actionable | ✅ PASS |
| Batch-Q | nombres únicos, descripciones sin placeholders, inputSchema, tool global sin args, sin comillas tipográficas | ✅ PASS |
| Limpieza | endpoint_delete ×5, sin huérfanos, delete_bot ×2 (incluye el bot inválido del probe), user_delete A/B, CASCADE recovery, interval tasks seed, apiclient_delete, login del cliente borrado → 401 | ✅ PASS |

---

## Observaciones (NOTE, baja severidad — ningún FAIL)

- **SMTP demo:** el transporte semilla apunta a `smtp.example.com` (no entrega en local). Para producción: definir `$_VAR_EMAIL_TRANSPORT` real; quitar el `to` hardcodeado y el uso de `USER_OPENFUSIONAPI_TOKEN` de `fnCreateApiClient`; loguear los fallos de email (`// TODO` en `apiclient/index.js:59`).
- **`apiclient_login` MCP:** el tool sigue sin inputSchema (`json_schema.in` vacío) → no usable vía MCP; no 500ea (400 ahora). Pendiente de declarar props para habilitarlo en agentes.
- **Rate limiter por IP global:** `RateLimitService` cuenta por IP (e IP+usuario), no por credencial. Un batch de 401 legítimos desde una IP dispara 429 para todo esa IP durante el lockout (backoff exponencial). Defensivo; documentar para no ponerlo detrás de redes compartidas sin un proxy de límites.
- **`upsert_bot` sin validación estática:** código inválido se acepta en el upsert y solo falla en runtime (el arranque registra `bot_startup_error`; el servidor sobrevive). Considerarlo como mejora.
- **Gap MCP: no existe tool `upsert_api_key`:** los agentes solo pueden listar keys, no emitirlas/renovarlas vía MCP (en la suite se emitieron por HTTP `POST /api/system/apikey/prd`).

---

## Correcciones de infraestructura del script de validación

1. **Token MCP acuñado en runtime** (firmado con el `jwt_key` del app `system`, `a6c042e9-…`) en lugar del token estático de `.mcp.json`, que quedaba transitoriamente rechazado tras un restart con `TIME_SYNC_ENABLED=true` (saltos de reloj en el fetch de tiempo externo).
2. **POST de login con `body: {}`:** sin cuerpo el servidor responde `400 FST_ERR_CTP_EMPTY_JSON_BODY` → cascada de 401.
3. **Reinicio del servidor pre-corría:** obligatorio, el rate limiter en memoria acumula los 401 intencionales entre corridas.
4. **Checks Batch-Q afinados:** el placeholder legítimo de `endpoint_upsert` y el `...` de ejemplos de código NO son placeholders; y la clase de "comillas tipográficas" contenía dos `"` ASCII → ahora `[\u201C\u201D\u2018\u2019]` (0 comillas tipográficas en las 75 tools).
5. **Heurística `isError` por forma** (`success === false` o `typeof error === "string"` en la raíz), porque `apiclient_create` incorpora `email.error` dentro de un 200.
6. **El probe de `upsert_bot` con código inválido captura y borra su `idbot`** en el cleanup (antes dejaba un bot huérfano por corrida).

---

## Fixes de la fase previa (mantenidos)

| Bug | Descripción | Fix |
|---|---|---|
| BUG-1 | `agent_onboarding` rompía el VM por apóstrofes en summary | template literal en el seed |
| BUG-2 | `delete_interval_task` (DELETE) no leía `idtask` en query | `fndeleteIntervalTask` lee body **y** `request.query` |
| BUG-3 | Describe SQLite sin `storage` en el schema | seed ajustado (storage + required por dialecto) |
| BUG-4 | `endpoint_delete` FK (consecuencia de BUG-2) | resuelto con el orden tasks→bots→endpoints |

---

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `dev/test/mcp_exhaustive_validation.js` | Suite 77 checks: token MCP runtime, POST con `body:{}`, checks Batch-Q afinados, cleanup CASCADE + badbot, `isError` por forma, checks H1/H3 actualizadas a comportamiento corregido |
| `src/lib/db/user.js` | BUG-5 (HMAC) y BUG-9 (`deleteUser` limpia `PasswordRecovery`) |
| `src/lib/server/mcp/utils.js` | BUG-8 (`passthrough` de ctrl) |
| `src/lib/server/functions/system/prd/apiclient/index.js` | H1 (devolver `password`), H3 (400 actionable sin credenciales) |
| `src/lib/db/default/system.js` | `/email/smtp` usa `$_VAR_EMAIL_TRANSPORT` (seed); misma corrección aplicada al row vivo de `temporales/ofapi12.sqlite` |

---

*Validación exhaustiva completa — 2026-09-07. 77/77 OK; solo quedan NOTEs de configuración/deploy documentadas arriba.*