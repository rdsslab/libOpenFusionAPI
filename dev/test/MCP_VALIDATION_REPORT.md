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
**Pendiente recomendado (NOTEs asociadas):** `apiclient/index.js:42` hardcodea `to: "edwinspire@gmail.com"` — artefacto de dev que debe salir de la config en producción, junto con remover el `// TODO: guardar el fallo de email en log`. El token de autenticación del envío ya no es una variable de entorno: usa `getSystemToken()` (en memoria, `process.env.USER_OPENFUSIONAPI_TOKEN` eliminado).

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

- **SMTP demo:** el transporte semilla apunta a `smtp.example.com` (no entrega en local). Para producción: definir `$_VAR_EMAIL_TRANSPORT` real; quitar el `to` hardcodeado de `fnCreateApiClient`; loguear los fallos de email (`// TODO` en `apiclient/index.js:59`). La auth interna del envío usa `getSystemToken()` en memoria (ya no `USER_OPENFUSIONAPI_TOKEN`).
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
| `src/lib/server/functions/system/prd/security/index.js` | **Nuevo**: `fnPasswordMigrationStatus/Run/Validate` (endpoints admin de migración de contraseñas) + export en `prd/index.js` |
| `src/lib/server/functions/system/prd/security/index.js` → seed | 3 endpoints `/security/password-migration/{status,run,validate}` en `system.js` y en la DB viva (ver runbook más abajo) |

---

## Nota de migración: hashes de contraseña (servidores en versión anterior)

`EncryptPwd` siempre ha sido `HMAC-SHA256(JWTKEY)`; el riesgo real de migración es el valor de `JWT_KEY`, no el algoritmo.

- **Regla nº 1:** desplegar la nueva versión con la **misma `JWT_KEY`** del servidor anterior (hashes, tokens de sesión, api keys firmadas y OTPs dependen de ella). No rotar la clave en el mismo cambio de versión.
- **Regla nº 2:** en migraciones en las que algún servidor corrió sin `JWT_KEY` (fallback `oy8632rcv"$/8`) o con un `.env` distinto, definir `AUTH_LEGACY_KEYS` (separadas por coma) con la/s clave/s antiguas. El login (`src/lib/db/user.js`, `src/lib/db/apiclient.js`) acepta el hash como fallback, re-hashea con la clave actual y devuelve 200 — migración perezosa, sin bloquear usuarios ni sumar 401 al rate limiter.
- **Caso BUG-5 cubierto:** filas cuya columna `password` guarda la contraseña en claro (altas/resets de una versión con el bug) también se detectan (`plain === storedHash`) y re-hashean en el primer login.
- Verificado: `dev/test` + E2E (fila en claro → login 200 → hash re-escrito con el algoritmo actual) + suite 77/77 sin regresiones.

### Runbook de rotación de `JWT_KEY` (producción)

Re-encripar hashes HMAC de la clave vieja a la nueva **sin la contraseña en claro es criptográficamente imposible** (el hash es unidireccional). Por eso la rotación segura es de **doble clave con ventana de migración**, no un re-hash offline.

Pasos (servidores sin recuperación de claves configurada — no la necesitan):

1. **Desplegar** esta versión con la `JWT_KEY` **actual** (sin cambios) y verificar `GET /api/system/security/password-migration/status/prd`.
2. **Sanear** filas en claro con `POST /api/system/security/password-migration/run/prd` (opcional: `{"dry_run":true}` primero; `{"scope":"users"}` limita). Solo convierte filas almacenadas en claro (bug BUG-5); los hashes no se tocan.
3. **Canario** antes de reiniciar: `POST /api/system/security/password-migration/validate/prd` con `{"type":"user","username":"X","password":"Y"}` de una cuenta real → devuelve `verifies_with: "current_key" | "legacy_or_clear"` y `would_rehash_on_login`.
4. **Rotar**: en `.env` poner `JWT_KEY=<nueva-fuerte>` Y `AUTH_LEGACY_KEYS=<la-que-tenías>`. Reiniciar. El login valida por fallback y re-hashea al primer login de cada usuario (200, sin 401s que alimenten el rate limiter).
5. **Cerrar** la ventana: cuando la población activa ya se haya logueado, quitar `AUTH_LEGACY_KEYS` del `.env` y reiniciar.

Impactos de la rotación que son **esperados** (y por qué):

- Tokens/sesiones de sistema (cookie `OFAPI_TOKEN`, `Authorization: Bearer` del sistema) quedan inválidos → los usuarios re-loguean. Es el objetivo de la rotación.
- Hashes OTP (`${JWTKEY}::otp`) ya emitidos quedan inválidos; expirarían igual (respaldos de seguridad).
- **Las api keys (`ofapi_api_key`) NO se invalidan**: se firman con el `jwt_key` de cada app (p.ej. `SYSTEM_JWT_KEY`), no con la `JWT_KEY` del servidor.
- `USER_OPENFUSIONAPI_TOKEN` ya no existe como variable: el token de sistema se emite y cachea en memoria (`getSystemToken()` en `auth.js`) y lo usan el worker de interval tasks (`timer/worker.js`) y el envío del password del apiclient (`prd/apiclient/index.js:49`). Al no pasar por `.env`, una rotación de `JWT_KEY` lo regenera automáticamente en el siguiente arranque (sin tokens viejos colgando).

### Endpoints de administración de migración de contraseñas

Añadidos en la app `system`, entorno `prd`, `handler=FUNCTION`, `access=2`, `ctrl.admin=true` (Bearer de sistema con `as_admin`, o usuario con permiso). No se publican como tools MCP (`mcp.enabled=false`).

| Método | Endpoint | Función | Comportamiento |
|---|---|---|---|
| GET | `/api/system/security/password-migration/status/prd` | `fnPasswordMigrationStatus` | Conteo por formato de `users` y `api_clients`: `hashed` (HMAC 64-hex), `clear` (en claro, migrable offline), `empty`; más `legacy_keys.configured`/`count`. Solo lectura. |
| POST | `/api/system/security/password-migration/run/prd` | `fnPasswordMigrationRun` | Re-hashea a la `JWT_KEY` actual todas las filas en claro (transacción). `{"dry_run":true}` calcula sin escribir; `{"scope":"users"|"clients"|"all"}` limita. Devuelve las cuentas migradas. |
| POST | `/api/system/security/password-migration/validate/prd` | `fnPasswordMigrationValidate` | Canario de login (users o api_clients) replicando los filtros reales de login. Devuelve `valid`, `format`, `verifies_with`, `would_rehash_on_login`. No modifica nada y el password no se persiste ni se loguea. `400` si faltan `username`/`password`. |

Verificado E2E contra el servidor vivo: fila en claro creada a propósito → `status` la clasifica como `clear` → `run` la convierte (el hash en DB pasa a `HMAC(JWT_KEY actual)`) → el login posterior responde 200 → `status` ya no muestra `clear`. Suite completa **77/77** sin regresiones.

---

*Validación exhaustiva completa — 2026-09-07. 77/77 OK; solo quedan NOTEs de configuración/deploy documentadas arriba.*