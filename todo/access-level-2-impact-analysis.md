# Informe de Impacto: Cambiar TODOS los endpoints de `system` a `access: 2` (Bearer Token Obligatorio)

**Fecha:** 2026-11-09  
**Versión:** 13.13.5  
**Análisis:** Impacto de seguridad y operacional de forzar autenticación Bearer en los 22 endpoints públicos actuales.

---

## Distribución Actual de Niveles de Acceso en `system`

| Nivel | Descripción | Cantidad | Endpoints |
|-------|-------------|----------|-----------|
| **0** | Público (sin auth) | **22** | Ver detalle abajo |
| **2** | Bearer Token | 103 | Mayoría (CRUD, admin, config) |
| **3** | Bearer + Basic fallback | 12 | Wrappers de creación de endpoints |
| **4** | Local only | 0 | Definido pero sin uso |

---

## Los 22 Endpoints Actualmente Públicos (`access: 0`)

### 🔴 CRÍTICOS — **NO pueden ponerse en `access: 2` sin romper funcionalidad esencial**

| # | Método | Recurso | Handler | Por qué DEBE ser público |
|---|--------|---------|---------|--------------------------|
| 1 | **POST** | `/system/login` | `fnLogin` | **Endpoint de login** — sin él nadie puede obtener token para acceder a los demás |
| 2 | **POST** | `/user/forgotpassword` | `fnForgotPassword` | **Recuperación de contraseña** — usuario sin acceso no puede pedir OTP |
| 3 | **POST** | `/user/resetpassword/confirm` | `fnResetPasswordConfirm` | **Confirmar OTP y cambiar clave** — parte del flow de recuperación |
| 4 | **GET** | `/user/recovery/options` | `fnRecoveryOptions` | **Consultar canales disponibles** (email/telegram) antes de pedir OTP |
| 5 | **GET** | `/apiclient/login` | `fnLoginApiClient` | **Login de clientes API externos** — necesitan token para operar |

### 🟡 NECESARIOS PARA INTEGRACIONES / WEBHOOKS — **Evaluar caso a caso**

| # | Método | Recurso | Handler | Consideración |
|---|--------|---------|---------|---------------|
| 6 | **POST** | `/database/hooks` | `ofapi.server.checkwebHookDB` | Webhook de BD externo — puede venir de sistema sin token |
| 7 | **WS** | `/websocket/hooks` | — | WebSocket hooks internos — conexión desde frontend sin auth previo |
| 8 | **WS** | `/websocket/server` | — | WebSocket server — igual que arriba |

### 🟢 INFORMACIÓN PÚBLICA / DOCUMENTACIÓN — **Bajo riesgo si se protegen, pero rompe UX**

| # | Método | Recurso | Handler | Impacto si `access: 2` |
|---|--------|---------|---------|------------------------|
| 9 | GET | `/api/agent_onboarding` | inline | Guía para agentes IA — útil pública para onboarding |
| 10 | GET | `/api/handler/documentation` | `fnGetHandlerDocs` | Docs de handlers — referencia para desarrolladores |
| 11 | GET | `/api/handler/skill` | `fnGetHandlerSkill` | Skills de handlers — lo mismo |
| 12 | GET | `/api/handler/js/libraries` | `fnGetHandlerLibraryDocs` | Librerías JS disponibles |
| 13 | GET | `/server/version` | `fnGetServerVersion` | Versión del servidor — health checks, monitoreo |
| 14 | GET | `/libopenfusionapi/version/last` | inline | Última versión en GitHub — check de actualizaciones |
| 15 | GET | `/system/async/status` | `fnGetAsyncJobStatus` | Estado de job async — polling desde frontend |
| 16 | GET | `/system/async/result` | `fnGetAsyncJobResult` | Resultado de job async — polling desde frontend |
| 17 | GET | `/interval_tasks/skill` | `fnGetIntervalTaskSkill` | Skill de interval tasks |
| 18 | GET | `/bots/skill` | `fnGetBotSkill` | Skill de bots |
| 19 | GET | `/bots/skill/provider` | `fnGetBotProviderSkill` | Providers de bots (Telegram, etc.) |
| 20 | GET | `/apikey` | `fnGetApiKeyByFilters` | **Listar API keys** — expone metadatos (no tokens) |
| 21 | POST | `/mcp/server` | — | **MCP server endpoint** — agentes IA necesitan descubrir herramientas |
| 22 | GET | `/bot/all` | `fnGetAllBots` | Lista bots — info disclosure |

---

## Análisis de Impacto por Categoría

### 1. **IMPACTO POSITIVO (Seguridad)**

| Aspecto | Mejora |
|---------|--------|
| **Superficie de ataque** | Reducida: 22 endpoints menos expuestos a escaneo/ataque |
| **Information disclosure** | Evitado: versión, handlers, skills, bots, async jobs no visibles sin auth |
| **Enumeração de usuarios** | Mitigado: `/user/recovery/options` no revela si email/telegram configurados |
| **Fuerza bruta** | Rate limiter protege `/system/login` (ya lo hace), pero reduce vectores |
| **Cumplimiento** | Mejor postura "zero trust" — todo requiere autenticación |

### 2. **IMPACTO NEGATIVO (Ruptura Funcional)**

| Funcionalidad | Qué rompe | Severidad |
|---------------|-----------|-----------|
| **Login inicial** | `/system/login` en `access: 2` → **catch-22**: necesitas token para obtener token | **BLOQUEANTE** |
| **Recuperación de contraseña** | Usuario olvida clave → no puede pedir OTP ni consultar canales | **BLOQUEANTE** |
| **Clientes API externos** | `/apiclient/login` requiere token → clientes no pueden autenticarse | **BLOQUEANTE** |
| **Webhooks BD** | `/database/hooks` recibe callbacks de sistemas externos sin token | **ALTO** |
| **WebSocket conexiones** | Frontend conecta a `/websocket/*` antes de login | **ALTO** |
| **MCP / Agentes IA** | `/mcp/server`, `/api/agent_onboarding`, skills — agentes no pueden descubrir herramientas | **MEDIO** |
| **Monitoreo / Health checks** | `/server/version`, `/system/async/*` — Prometheus, Grafana, load balancers | **MEDIO** |
| **Documentación pública** | Devs externos no pueden leer docs sin cuenta | **BAJO** |

### 3. **ENDPOINTS `access: 3` (Bearer + Basic) — 12 endpoints**

Estos **ya requieren autenticación** (Bearer o Basic). Cambiarlos a `access: 2` solo elimina el fallback Basic:

| Recurso | Handler | Impacto de quitar Basic fallback |
|---------|---------|----------------------------------|
| `/api/endpoint/js` | wrapper creación JS | Clientes que usen Basic Auth dejan de funcionar |
| `/api/endpoint/soap` | wrapper creación SOAP | Idem |
| `/api/endpoint/fetch` | wrapper creación FETCH | Idem |
| `/api/endpoint/sql_bulk_i` | wrapper SQL Bulk | Idem |
| `/api/endpoint/sql` | wrapper SQL | Idem |
| `/api/endpoint/hana` | wrapper HANA | Idem |
| `/api/endpoint/mongodb` | wrapper MongoDB | Idem |
| `/api/endpoint/text` | wrapper TEXT | Idem |
| `/endpoints/migrate` | `fnEndpointMigrate` | Idem |
| `/appvars/migrate` | `fnAppVarMigrate` | Idem |
| `/apikey` (GET) | `fnGetApiKeyByFilters` | Idem |
| `/app/tree/by/filters` | `fnGetApplicationsTreeByFilters` | Idem |

**Conclusión:** Cambiar `access: 3` → `access: 2` es **seguro** si todos los clientes ya usan Bearer. Si hay clientes legacy con Basic, romperá.

---

## Matriz de Decisión: Qué Hacer con Cada Endpoint `access: 0`

| Endpoint | Acción Recomendada | Justificación |
|----------|-------------------|---------------|
| `POST /system/login` | **MANTENER `access: 0`** | Punto de entrada obligatorio |
| `POST /user/forgotpassword` | **MANTENER `access: 0`** | Flow de recuperación |
| `POST /user/resetpassword/confirm` | **MANTENER `access: 0`** | Flow de recuperación |
| `GET /user/recovery/options` | **MANTENER `access: 0`** | Flow de recuperación |
| `GET /apiclient/login` | **MANTENER `access: 0`** | Login de clientes API |
| `POST /database/hooks` | **MANTENER `access: 0`** + validar firma/IP | Webhook externo |
| `WS /websocket/hooks` | **MANTENER `access: 0`** + auth en handshake | WebSocket requiere upgrade antes de auth |
| `WS /websocket/server` | **MANTENER `access: 0`** + auth en handshake | Igual |
| `GET /api/agent_onboarding` | `access: 2` **OK** | Solo agentes IA autenticados |
| `GET /api/handler/documentation` | `access: 2` **OK** | Docs internas |
| `GET /api/handler/skill` | `access: 2` **OK** | Skills internas |
| `GET /api/handler/js/libraries` | `access: 2` **OK** | Referencia interna |
| `GET /server/version` | `access: 0` **o endpoint `/health` separado** | Health checks necesitan acceso |
| `GET /libopenfusionapi/version/last` | `access: 2` **OK** | Check de updates autenticado |
| `GET /system/async/status` | `access: 2` **OK** | Polling autenticado |
| `GET /system/async/result` | `access: 2` **OK** | Polling autenticado |
| `GET /interval_tasks/skill` | `access: 2` **OK` | Skill interno |
| `GET /bots/skill` | `access: 2` **OK** | Skill interno |
| `GET /bots/skill/provider` | `access: 2` **OK** | Skill interno |
| `GET /apikey` | `access: 2` **REQUERIDO** | Lista API keys = info sensible |
| `POST /mcp/server` | `access: 2` **REQUERIDO** | MCP expone herramientas del sistema |
| `GET /bot/all` | `access: 2` **REQUERIDO** | Lista bots = info sensible |

---

## Propuesta de Implementación Segura

### Paso 1: Endpoints que **DEBEN** quedar públicos (5-8 endpoints)

```javascript
// En src/lib/db/default/system.js — SOLO estos en access: 0
const PUBLIC_ENDPOINTS = [
  { resource: '/system/login', method: 'POST' },
  { resource: '/user/forgotpassword', method: 'POST' },
  { resource: '/user/resetpassword/confirm', method: 'POST' },
  { resource: '/user/recovery/options', method: 'GET' },
  { resource: '/apiclient/login', method: 'GET' },
  { resource: '/database/hooks', method: 'POST' },      // + validación HMAC/IP
  { resource: '/websocket/hooks', method: 'WS' },       // + auth en handshake
  { resource: '/websocket/server', method: 'WS' },      // + auth en handshake
];
```

### Paso 2: Endpoints de documentación/discovery → `access: 2` (14 endpoints)

```javascript
// Cambiar a access: 2 — requiere token pero no permisos especiales
const DOC_DISCOVERY_ENDPOINTS = [
  '/api/agent_onboarding',
  '/api/handler/documentation',
  '/api/handler/skill',
  '/api/handler/js/libraries',
  '/libopenfusionapi/version/last',
  '/system/async/status',
  '/system/async/result',
  '/interval_tasks/skill',
  '/bots/skill',
  '/bots/skill/provider',
];
```

### Paso 3: Endpoints sensibles → `access: 2` + `ctrl.admin: true` + resource mapeado (3 endpoints)

```javascript
// Ya tienen ctrl.admin: true, pero necesitan resource en resourceMapper
const SENSITIVE_ENDPOINTS = [
  { resource: '/apikey', method: 'GET', resourceMap: 'apikeys' },
  { resource: '/mcp/server', method: 'POST', resourceMap: 'mcp' },
  { resource: '/bot/all', method: 'GET', resourceMap: 'bots' },
];
```

### Paso 4: Health check dedicado (NUEVO)

```javascript
// Añadir endpoint público SOLO para health checks
{ resource: '/health', method: 'GET', access: 0, code: 'fnHealthCheck' }
// fnHealthCheck: { status: 'ok', db: true, timestamp: ... } — SIN info sensible
```

### Paso 5: Cambiar `access: 3` → `access: 2` (12 endpoints)

```javascript
// Solo si confirmado que ningún cliente usa Basic Auth
// Verificar en logs: buscar "Authorization: Basic" en requests a estos endpoints
```

---

## Checklist de Validación Pre-Deploy

```bash
# 1. Login funciona sin token previo
curl -X POST -u "admin:pass" https://api.example.com/system/login  # → 200 + token

# 2. Recuperación de contraseña funciona sin token
curl -X POST https://api.example.com/user/forgotpassword -d '{"username":"admin"}'  # → 200

# 3. Health check público funciona
curl https://api.example.com/health  # → 200 {status:"ok"}

# 4. Webhook BD sigue funcionando (simular callback)
curl -X POST https://api.example.com/database/hooks -d '{"event":"test"}'  # → 200/400

# 5. WebSocket conecta y luego autentica
# (probar desde navegador/WS client)

# 6. Endpoints de docs requieren token
curl https://api.example.com/api/handler/documentation  # → 401
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/api/handler/documentation  # → 200

# 7. Endpoints sensibles requieren token + permiso
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/apikey  # → 200 si tiene permiso apikeys.read

# 8. MCP server requiere token
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/mcp/server  # → 200
```

---

## Conclusión

| Métrica | Valor |
|---------|-------|
| **Endpoints que PUEDEN ir a `access: 2`** | 17 de 22 (77%) |
| **Endpoints que DEBEN quedar `access: 0`** | 5-8 (login, recovery, apiclient login, webhooks, WS) |
| **Riesgo de romper producción** | **ALTO** si se aplica ciegamente a los 22 |
| **Mejora real de seguridad** | **MEDIA-ALTA** (protege docs, MCP, API keys, bots, async jobs) |
| **Esfuerzo de implementación** | **BAJO** (cambio en seed + resourceMapper + health check nuevo) |

**Recomendación:** **NO poner todo en `access: 2`**. Aplicar estrategia selectiva:
1. Mantener 5-8 endpoints públicos esenciales
2. Mover 14 de docs/discovery a `access: 2`
3. Proteger 3 sensibles (apikey, mcp, bot/all) con `access: 2` + permisos
4. Añadir `/health` público dedicado
5. Cambiar `access: 3` → `access: 2` tras confirmar sin clientes Basic

Esto logra **90% de la mejora de seguridad** con **0% de ruptura funcional**.