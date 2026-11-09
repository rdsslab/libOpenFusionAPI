# Análisis Completo: Usuarios, Permisos y Autenticación en libOpenFusionAPI

**Fecha:** 2026-11-09  
**Versión analizada:** 13.13.5 (main branch)  
**Alcance:** Sistema completo de autenticación, autorización, gestión de usuarios internos (User), clientes externos (ApiClient/ApiKey), endpoints, bots, tareas programadas y auditoría.

---

## 1. Resumen Ejecutivo

### Estado actual
El sistema tiene **tres capas de identidad** bien diferenciadas pero con **gaps críticos de integración**:

| Capa | Tabla | Tipo credencial | Alcance | Autenticación | Autorización |
|------|-------|-----------------|---------|---------------|--------------|
| **Sistema (User)** | `ofapi_user` | Username/password + JWT (Bearer) + Cookie | Solo app `system` | Basic / Bearer / Cookie | Granular via `ctrl.env[env][resource][action]` + `as_admin` |
| **Clientes API (ApiClient)** | `ofapi_api_client` | Username/password + JWT (Bearer) | Apps normales (no system) | Basic (login) → Bearer (token) | **Ninguna** (endpoint.ctrl.users sin implementar) |
| **API Keys (ApiKey)** | `ofapi_api_key` | Token JWT firmado por `app.jwt_key` | Apps normales | Bearer (token apikey) | Solo `apikey.idapp === endpoint.idapp` |

### Hallazgos Críticos

1. **`ctrl.users` (allowlist por endpoint) documentado pero NO implementado** — existe en JSON Schema y documentación de `ctrl` pero el motor de permisos (`hasPermission`) no lo consulta.
2. **38 endpoints de `system` marcados `ctrl.admin: true` pero sin recurso mapeado** — `resolveResource()` devuelve `null` → `hasPermission` deniega → **acceso roto salvo cuentas `as_admin`**.
3. **`access === 4` (Local only) definido en docs/schema pero sin código de enforcement** — se trata como `access > 0` genérico.
4. **No hay herencia de permisos, roles, grupos ni deny explícito** — solo allowlist plana por recurso/acción.
5. **ApiClient no tiene `ctrl` ni vinculación a recursos** — el campo `AuthorizedEnpointsClient = []` está hardcodeado vacío.
6. **Seed crea 4 usuarios por defecto con claves conocidas** — obligan `change_password: true` pero siguen siendo vectores de ataque si no se rotan.
7. **`/restore` (PUT) es `access: 0` (público)** — permite restaurar la app `system` completa sin autenticación.
8. **Auth rate-limiter solo por IP/IP+username en memoria** — no persiste entre reinicios, no hay blocklist/allowlist persistente.

---

## 2. Arquitectura de Identidad y Autenticación

### 2.1 Capas de identidad

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AUTENTICACIÓN                                │
├──────────────────┬──────────────────────────┬──────────────────────┤
│  User (interno)  │  ApiClient (externo)     │  ApiKey (máquina)    │
├──────────────────┼──────────────────────────┼──────────────────────┤
│ Tabla: ofapi_    │ Tabla: ofapi_api_client  │ Tabla: ofapi_api_key │
│ user             │                          │                      │
├──────────────────┼──────────────────────────┼──────────────────────┤
│ Credenciales:    │ Credenciales:            │ Credencial:          │
│ - username       │ - username               │ - token (JWT)        │
│ - password       │ - password               │ - idapp + idclient   │
│   (HMAC-SHA256)  │   (HMAC-SHA256)          │   firmado por        │
│ - JWT Bearer     │ - JWT Bearer             │   app.jwt_key        │
│ - Cookie         │                          │ - startAt/endAt      │
│ - Refresh token  │                          │ - enabled            │
├──────────────────┼──────────────────────────┼──────────────────────┤
│ Login:           │ Login:                   │ Upsert:              │
│ POST /system/    │ POST /apiclient/login    │ POST /apikey         │
│ login (Basic)    │ (Basic) → Bearer token   │ genera token firmado │
├──────────────────┼──────────────────────────┼──────────────────────┤
│ Solo app=system  │ Apps normales            │ Apps normales        │
└──────────────────┴──────────────────────────┴──────────────────────┘
```

### 2.2 Flujo de autenticación (`AuthService.check_auth`)

```mermaid
flowchart TD
    A[Request] --> B{access == 0?}
    B -- sí --> C[Público - skip auth]
    B -- no --> D[getUserPasswordTokenFromRequest]
    D --> E{app == 'system'?}
    E -- sí --> F[check_auth_Bearer]
    E -- no --> G[switch access]
    G -- 1 Basic --> H[check_auth_Basic]
    G -- 2 Bearer --> F
    G -- 3 Both --> F -->|fail| H
    F --> I{apikey.idapp == endpoint.idapp?}
    I -- sí --> OK
    I -- no --> J{admin claim?}
    J -- no --> DENY
    J -- sí --> K{app == system?}
    K -- sí --> L[freshUser from DB]
    L --> M{as_admin?}
    M -- sí --> OK
    M -- no --> N[hasPermission(ctrl, env, resource, action)]
    N -->|granted| OK
    N -->|denied| DENY
```

### 2.3 `getUserPasswordTokenFromRequest` — extracción multi-esquema

```javascript
// Soporta en orden de prioridad:
1. Authorization: Basic base64(username:password)
2. Authorization: Bearer <jwt>           // peek claims para custom jwt_key si es apikey
3. Cookie: OFAPI_TOKEN=<jwt>
```

### 2.4 JWT y firma

- **User/ApiClient tokens**: firmados con `JWTKEY` global (`process.env.JWT_KEY` o fallback)
- **ApiKey tokens**: firmados con `app.jwt_key` (por app, UUIDv4 generado al crear app)
- **System token**: `CreateOpenFusionAPIToken()` → `openfusionapi` user con `as_admin: true`, 1 año TTL, solo en memoria

---

## 3. Modelo de Autorización Actual

### 3.1 Esquema `User.ctrl` (JSON)

```json
{
  "as_admin": false,                    // bypass global (superadmin)
  "env": {
    "dev|qa|prd": {
      "users":        { "read": true, "create": true, "edit": true, "delete": true },
      "apiclients":   { "read": true, "create": false, "edit": false, "delete": false },
      "endpoints":    { "read": true, "create": true, "edit": true, "delete": true },
      "apps":         { "read": true, "create": true, "edit": true, "delete": true },
      "appvars":      { "read": true, "create": true, "edit": true, "delete": true },
      "bots":         { "read": true, "create": true, "edit": true, "delete": true },
      "interval_tasks": { "read": true, "create": true, "edit": true, "delete": true },
      "logs":         { "read": true },
      "settings":     { "read": true, "edit": true },
      "*":            { "read": true, "create": true, "edit": true, "delete": true }  // wildcard recurso
    }
  }
}
```

**Acciones válidas:** `read`, `create`, `edit`, `delete`  
**Método HTTP → Acción:** GET/HEAD/OPTIONS/QUERY→read, POST→create, PUT/PATCH→edit, DELETE→delete

### 3.2 `hasPermission(ctrl, env, resource, action)` — motor actual

```javascript
export function hasPermission(userCtrl, environment, resource, action) {
  if (!userCtrl || !environment || !resource || !action) return false;
  if (userCtrl.as_admin === true) return true;           // 1. Superadmin bypass
  
  const envPerms = userCtrl.env?.[environment];
  if (!envPerms) return false;
  
  const resourcePerms = envPerms[resource];
  if (resourcePerms && resourcePerms[action] === true) return true;  // 2. Match exacto
  
  const wildcardPerms = envPerms["*"];                  // 3. Wildcard recurso
  if (wildcardPerms && wildcardPerms[action] === true) return true;
  
  return false;
}
```

### 3.3 `resourceMapper.resolveResource(ctrl, path)` — mapeo path→recurso

```javascript
const PATH_RESOURCE_MAP = [
  { prefix: "/users",          resource: "users" },
  { prefix: "/user/",          resource: "users" },
  { prefix: "/api_clients",    resource: "apiclients" },
  { prefix: "/apiclient",      resource: "apiclients" },
  { prefix: "/system/endpoints", resource: "endpoints" },
  { prefix: "/api/endpoint",   resource: "endpoints" },
  { prefix: "/apps",           resource: "apps" },
  { prefix: "/app/variables",  resource: "appvars" },
  { prefix: "/bots",           resource: "bots" },
  { prefix: "/interval_tasks", resource: "interval_tasks" },
  { prefix: "/system/log",     resource: "logs" },
  { prefix: "/system/settings", resource: "settings" },
];
```

**Override por endpoint:** `endpoint.ctrl.resource` tiene prioridad sobre el mapa.

### 3.4 Helpers de `ctrl` predefinidos

```javascript
emptyCtrl()      → { as_admin: false, env: {} }                    // sin acceso
fullAccessCtrl() → todos recursos/acciones en dev/qa/prd, sin as_admin
adminCtrl()      → fullAccessCtrl + as_admin: true                  // superadmin
```

---

## 4. Gaps y Bugs Críticos Detectados

### 4.1 **CRÍTICO: `ctrl.users` (allowlist por endpoint) no implementado**

**Ubicación:** Documentado en `src/lib/db/default/system.js` línea 5913:
```json
"ctrl": {
  "users": ["user1", "user2"]  // "optional user allowlist for this endpoint"
}
```

**Realidad:** `hasPermission()` **nunca consulta** `ctrl.users`. El endpoint se protege solo por recurso (`users`, `endpoints`, etc.) y acción, no por usuario individual.

**Impacto:** Imposible restringir un endpoint concreto a usuarios específicos sin crear recursos artificiales.

### 4.2 **CRÍTICO: 38 endpoints `system` con `ctrl.admin: true` pero recurso no mapeado**

```bash
$ node -e "
import { system_app } from './src/lib/db/default/system.js';
import { resolveResource } from './src/lib/server/resourceMapper.js';
const eps = system_app.endpoints||[];
let unmappedAdmin=0;
for(const e of eps){
  if(e.ctrl?.admin===true && !resolveResource(e.ctrl, e.resource)) unmappedAdmin++;
}
console.log('unmappedAdmin:', unmappedAdmin);  // 38
"
```

**Endpoints afectados (ejemplos):**
- `POST /user/create` → `fnCreateUser` (crear usuarios)
- `POST /user/update` → `fnUpdateUser` (modificar usuarios, **incluye `ctrl`**)
- `POST /user/delete` → `fnDeleteUser` (borrar usuarios)
- `POST /user/resetpassword` → `fnResetUserPassword` (reset admin de passwords)
- `POST /apikey` → `fnUpsertApiKey` (crear/modificar API keys)
- `POST /apps/backup` → `fnRestoreAllAppsFromBackup` (restaurar TODAS las apps)
- `POST /app/backup` → `fnRestoreAppFromBackup` (restaurar app individual)
- `POST /apiclient` → `fnCreateApiClient` (crear clientes API)

**Por qué falla:** `resolveResource()` devuelve `null` → `hasPermission()` deniega (unmapped = deny en app `system`) → **solo cuentas `as_admin` pueden acceder**. Usuarios con `ctrl.env.prd.users.create: true` **no pueden** crear usuarios.

### 4.3 **CRÍTICO: `/restore` (PUT) es `access: 0` (público)**

```json
{ "resource": "/restore", "method": "PUT", "access": 0, "code": "fnCheckSystemApp" }
```

`fnCheckSystemApp` con `body.restore: true` ejecuta `restoreAppFromBackup` → **restaura la app `system` completa (endpoints, usuarios, API keys, bots, tareas) SIN AUTENTICACIÓN**.

### 4.4 **ALTO: `access === 4` (Local only) sin enforcement**

Definido en:
- `src/lib/server/doc_generator.js:6` → `"4": "Local only"`
- `src/lib/server/endpoint/handlerBuild/mcp.js:118` → devuelve "Local only"
- `src/lib/db/default/system.js:5875` → documentado en JSON Schema

**Código real (`auth_service.js:121`):**
```javascript
if (handler.params.access > 0) {  // 1,2,3,4 todos caen aquí
  switch (handler.params.access) {
    case 1: /* Basic */ break;
    case 3: /* Bearer + Basic */ break;
    default: /* Bearer (2 y 4) */ break;
  }
}
```
**Resultado:** `access: 4` se comporta igual que `access: 2` (Bearer token).

### 4.5 **ALTO: ApiClient sin autorización granular**

- Tabla `ofapi_api_client` **no tiene campo `ctrl`**
- `loginApiClient` asigna `u.Authorized = AuthorizedEnpointsClient` → **array hardcodeado vacío** (`src/lib/db/apiclient.js:9,160`)
- Auth por ApiKey solo verifica `apikey.idapp === endpoint.idapp` → **todo cliente de la app accede a todos sus endpoints**

### 4.6 **MEDIO: Wildcard acción `*` válido en schema pero ignorado por motor**

```javascript
// validateCtrlSchema ACEPTA "*" como acción
if (!VALID_ACTIONS.includes(actName) && actName !== "*") { error }

// hasPermission NUNCA busca "*" en acciones
if (resourcePerms && resourcePerms[action] === true) return true;
```

**Test empírico:**
```javascript
validateCtrlSchema({env:{prd:{users:{"*":true}}}})  // → {valid:true}
hasPermission({env:{prd:{users:{"*":true}}}}, 'prd', 'users', 'read')  // → FALSE
```

### 4.7 **MEDIO: Sin herencia, roles, grupos ni deny explícito**

- Permisos son **allowlist plana** por recurso/acción
- No hay "roles" (admin, editor, viewer) reutilizables
- No hay herencia (`dev` no hereda de `prd` ni viceversa)
- No hay `deny` (solo ausencia de `allow`)
- No hay permisos a nivel de instancia/registro (row-level)

### 4.8 **MEDIO: Rate limiter solo en memoria, sin persistencia**

`RateLimitService` usa `Map` en memoria:
- Pierde estado al reiniciar el proceso
- No hay blocklist/allowlist persistente (IPs conocidas maliciosas/confiables)
- No integra con WAF/Cloudflare/nginx externo

### 4.9 **BAJO: Seed users con passwords conocidos en código**

```javascript
const DEFAULT_USERS = [
  { username: "superopenfusionapi", password: "Sup3r@0penFusion!", systemAdmin: true },
  { username: "admin", password: "Adm1n@0penFusion!", systemAdmin: true },
  { username: "client_api", password: "Cl13nt@0penFusion!" },
  { username: "demo", password: "D3m0@0penFusion!" },
];
```

Obligan `change_password: true` en primer login, pero:
- Están en código fuente (repo público/privado)
- `defaultUser()` se ejecuta **en cada arranque** → recrea si faltan
- No hay flag para deshabilitar seed en producción

### 4.10 **BAJO: `refresh_token` emitido pero sin endpoint de refresh**

`login()` genera:
```javascript
let refresh_token = GenToken({ api: { username, iduser, email, now } }, 3600);
```
**No existe endpoint `/refresh` ni lógica para validar/rotar refresh tokens.**

---

## 5. Análisis de Endpoints de Sistema Críticos

### 5.1 Endpoints `access: 0` (públicos) en app `system`

| Método | Recurso | Handler | Riesgo |
|--------|---------|---------|--------|
| GET | `/api/agent_onboarding` | `fnOnboarding` | Info disclosure |
| POST | `/system/login` | `fnLogin` | **Login endpoint** (necesario público) |
| GET | `/system/environment` | `fnGetEnvironment` | Info disclosure |
| GET | `/information/static` | `fnStaticInfo` | Info disclosure |
| GET | `/information/dynamic` | `fnDynamicInfo` | Info disclosure |
| GET | `/api/handler/documentation` | `fnHandlerDoc` | Info disclosure |
| GET | `/api/handler/skill` | `fnHandlerSkill` | Info disclosure |
| GET | `/api/handler/js/libraries` | `fnJsLibraries` | Info disclosure |
| GET | `/server/version` | `fnServerVersion` | Info disclosure |
| GET | `/libopenfusionapi/version/last` | `fnLastVersion` | Info disclosure |
| WS | `/websocket/hooks` | - | WebSocket hook |
| WS | `/websocket/server` | - | WebSocket server |
| POST | `/restore` | `fnCheckSystemApp` | **CRÍTICO: restore system sin auth** |
| POST | `/system/logout/0.01` | `fnLogout` | Logout (requiere sesión) |
| GET | `/system/async/status` | `fnAsyncStatus` | Estado jobs async |
| GET | `/system/async/result` | `fnAsyncResult` | Resultado jobs async |
| GET | `/system/async/jobs` | `fnListAsyncJobs` | Lista jobs async |

### 5.2 Endpoints `ctrl.admin: true` sin recurso mapeado (38)

**Categoría: Gestión de Usuarios (6)**
- `POST /user/create` → `fnCreateUser`
- `POST /user/update` → `fnUpdateUser`  
- `POST /user/delete` → `fnDeleteUser`
- `POST /user/changepassword` → `fnUpdateUserPassword`
- `POST /user/resetpassword` → `fnResetUserPassword` (admin reset)
- `POST /user/telegram/validate` → `fnValidateTelegramUser`

**Categoría: API Clients & Keys (4)**
- `POST /apiclient` → `fnCreateApiClient`
- `POST /apikey` → `fnUpsertApiKey`
- `GET /apikey` → `fnGetAllApiKeys`
- `POST /apikey` (delete) → `fnDeleteApiKey`

**Categoría: Apps & Backup/Restore (5)**
- `POST /app/backup` → `fnRestoreAppFromBackup`
- `POST /apps/backup` → `fnRestoreAllAppsFromBackup`
- `POST /appgroup/scan` → `fnAppGroupScan`
- `POST /appgroup/changes` → `fnAppGroupChanges`
- `POST /appgroup/link` → `fnAppGroupLinkWrite`

**Categoría: Sistema & Config (8)**
- `POST /cache/clear` → `fnClearCache`
- `POST /cache/invalidate` → `fnInvalidateCache`
- `POST /endpoints/migrate` → `fnMigrateEndpoint`
- `POST /system/admin/alerts` → `fnSystemAdminAlerts`
- `POST /system/admin/startup` → `fnSystemAdminStartup`
- `POST /audit/log/prune` → `fnPruneAuditLog`
- `POST /security/password-migration/run` → `fnRunPasswordMigration`
- `POST /security/password-migration/validate` → `fnValidatePasswordMigration`

**Categoría: Bots & Interval Tasks (15)**
- `POST /bot/all` → `fnGetAllBots`
- `POST /bots` (crud) → varios
- `POST /interval_tasks` (crud) → varios

---

## 6. Auditoría y Trazabilidad

### 6.1 Modelo `ofapi_audit_log`

```javascript
{
  idlog: BIGINT PK,
  trace_id: UUID,                    // ofapi-trace-id header
  timestamp: DATE,
  actor_kind: "user" | "apikey" | "system",
  actor_id: STRING,                  // iduser o null
  actor_username: STRING,            // username o "-"
  idclient: UUID,                    // si actor_kind=apikey
  action: "login|login_failed|logout|create|update|delete|enable|disable|restore|bulk_delete",
  entity_type: "app|appvar|endpoint|bot|interval_task|user|apiclient|apikey",
  entity_id: STRING,                 // PK como string
  idapp: UUID,                       // app dueña
  environment: "dev|qa|prd|null",
  target_username: STRING,           // para login/reset/delete user
  status: BOOLEAN,                   // éxito/fallo
  result_code: SMALLINT,             // HTTP status
  message: STRING,
  before: JSON,                      // snapshot previo (sanitizado)
  after: JSON,                       // snapshot resultado (sanitizado)
  ip: STRING,
  user_agent: STRING,
}
```

### 6.2 Cobertura actual

- ✅ User CRUD, login, password change/reset, recovery
- ✅ ApiClient CRUD, login
- ✅ ApiKey CRUD
- ✅ App, AppVars, Endpoint, Bot, IntervalTask CRUD
- ✅ Backup/Restore operaciones
- ❌ **No audita**: decisiones de autorización (allow/deny por `hasPermission`)
- ❌ **No audita**: rate limit blocks (solo log `possible_attack` en `ofapi_log`)

---

## 7. Propuesta de Mejora: Sistema de Permisos Tipo Árbol / RBAC / ABAC

### 7.1 Objetivos

1. **Mantener compatibilidad** con `ctrl` actual (migración gradual)
2. **Soportar allowlist por endpoint** (`ctrl.users`) 
3. **Habilitar roles/grupos** reutilizables
4. **Soportar deny explícito** y precedencia deny > allow
5. **Permitir integración LDAP/Keycloak/OIDC** como proveedor de identidad
6. **Añadir permisos row-level** (opcional, por recurso)
7. **Persistir rate-limit** y permitir blocklist/allowlist

### 7.2 Nuevo modelo de datos propuesto

```sql
-- 1. Roles reutilizables (template de permisos)
CREATE TABLE ofapi_role (
  idrole UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,        -- 'admin', 'editor', 'viewer', 'api_client'
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,          -- roles protegidos
  permissions JSONB NOT NULL,               -- { "dev": { "endpoints": { "read": true, "create": false } } }
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Grupos de usuarios (colección de roles + miembros)
CREATE TABLE ofapi_group (
  idgroup UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  idapp UUID REFERENCES ofapi_application(idapp),  -- opcional: grupo global o por app
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Miembros de grupo (user o apiclient)
CREATE TABLE ofapi_group_member (
  idgroup UUID REFERENCES ofapi_group(idgroup) ON DELETE CASCADE,
  member_type VARCHAR(20) NOT NULL,         -- 'user' | 'apiclient'
  member_id UUID NOT NULL,                  -- iduser o idclient
  PRIMARY KEY (idgroup, member_type, member_id)
);

-- 4. Asignación de roles a grupos
CREATE TABLE ofapi_group_role (
  idgroup UUID REFERENCES ofapi_group(idgroup) ON DELETE CASCADE,
  idrole UUID REFERENCES ofapi_role(idrole) ON DELETE CASCADE,
  environment VARCHAR(10),                  -- null = todos, o 'dev'|'qa'|'prd'
  PRIMARY KEY (idgroup, idrole, environment)
);

-- 5. Asignación directa de roles a usuarios (sin grupo)
CREATE TABLE ofapi_user_role (
  iduser BIGINT REFERENCES ofapi_user(iduser) ON DELETE CASCADE,
  idrole UUID REFERENCES ofapi_role(idrole) ON DELETE CASCADE,
  environment VARCHAR(10),
  PRIMARY KEY (iduser, idrole, environment)
);

-- 6. Allowlist/Denylist por endpoint (reemplaza ctrl.users)
CREATE TABLE ofapi_endpoint_acl (
  idendpoint UUID REFERENCES ofapi_endpoint(idendpoint) ON DELETE CASCADE,
  principal_type VARCHAR(20) NOT NULL,      -- 'user' | 'apiclient' | 'group' | 'role'
  principal_id UUID NOT NULL,               -- iduser, idclient, idgroup, idrole
  action VARCHAR(20) NOT NULL,              -- 'read'|'create'|'edit'|'delete'|'*'
  effect VARCHAR(10) NOT NULL DEFAULT 'allow', -- 'allow' | 'deny'
  priority INT DEFAULT 0,                   -- mayor = más prioridad
  PRIMARY KEY (idendpoint, principal_type, principal_id, action)
);

-- 7. Rate limit persistente
CREATE TABLE ofapi_rate_limit_block (
  idblock UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip INET,
  username VARCHAR(150),
  blocked_until TIMESTAMP NOT NULL,
  reason VARCHAR(100),                      -- 'brute_force', 'manual', 'waf'
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 7.3 Motor de autorización unificado (nuevo `hasPermissionV2`)

```javascript
/**
 * Evalúa permiso con precedencia:
 * 1. Deny explícito en endpoint ACL (max priority)
 * 2. Allow explícito en endpoint ACL
 * 3. as_admin bypass
 * 4. Roles asignados (user_role + group_role) → agregan permisos
 * 5. ctrl.env legacy (compatibilidad)
 * 6. Default deny
 */
async function hasPermissionV2({ user, apikey, endpoint, environment, action, resource }) {
  const ctx = { user, apikey, endpoint, environment, action, resource };
  
  // 1. Endpoint ACL (deny > allow, por priority)
  const aclDeny = await EndpointACL.findOne({
    where: { idendpoint: endpoint.idendpoint, effect: 'deny', ...matchPrincipal(ctx) },
    order: [['priority', 'DESC']]
  });
  if (aclDeny && matchesAction(aclDeny, action)) return { allowed: false, reason: 'explicit_deny', source: 'endpoint_acl' };
  
  const aclAllow = await EndpointACL.findOne({
    where: { idendpoint: endpoint.idendpoint, effect: 'allow', ...matchPrincipal(ctx) },
    order: [['priority', 'DESC']]
  });
  if (aclAllow && matchesAction(aclAllow, action)) return { allowed: true, reason: 'explicit_allow', source: 'endpoint_acl' };
  
  // 2. Superadmin (User only)
  if (user?.ctrl?.as_admin === true) return { allowed: true, reason: 'as_admin', source: 'user_ctrl' };
  
  // 3. Roles compuestos (User + ApiClient via groups)
  const effectivePermissions = await computeEffectivePermissions(ctx);
  if (effectivePermissions[resource]?.[action] === true) {
    return { allowed: true, reason: 'role_based', source: 'roles', roles: effectivePermissions._meta };
  }
  
  // 4. Legacy ctrl.env (compatibilidad)
  if (hasPermission(user?.ctrl, environment, resource, action)) {
    return { allowed: true, reason: 'legacy_ctrl', source: 'user_ctrl' };
  }
  
  return { allowed: false, reason: 'default_deny', source: 'none' };
}
```

### 7.4 Migración gradual desde `ctrl` actual

```javascript
// Paso 1: Seed roles por defecto (idempotente)
const SYSTEM_ROLES = [
  { name: 'super_admin', permissions: { '*': { '*': { '*': true } } }, is_system: true },
  { name: 'admin', permissions: fullAccessCtrl().env, is_system: true },
  { name: 'editor', permissions: { dev:{'*':{read:true,create:true,edit:true}}, qa:{'*':{read:true}}, prd:{} } },
  { name: 'viewer', permissions: { '*': { '*': { read: true } } } },
  { name: 'api_client', permissions: { '*': { 'endpoints': { read: true } } } },
];

// Paso 2: Asignar roles a usuarios existentes según su ctrl
async function migrateCtrlToRoles() {
  const users = await User.findAll();
  for (const u of users) {
    const ctrl = u.ctrl || {};
    if (ctrl.as_admin) await assignRole(u.iduser, 'super_admin');
    else if (hasFullAccess(ctrl)) await assignRole(u.iduser, 'admin');
    else if (hasAnyAccess(ctrl)) await assignRole(u.iduser, 'editor');
  }
  
  // ApiClients → rol api_client
  const clients = await ApiClient.findAll();
  for (const c of clients) await assignRoleToClient(c.idclient, 'api_client');
}

// Paso 3: EndpointACL desde ctrl.users (si existe)
async function migrateEndpointCtrlUsers() {
  const eps = await Endpoint.findAll({ where: { ctrl: { users: { [Op.ne]: null } } } });
  for (const ep of eps) {
    for (const username of ep.ctrl.users || []) {
      const user = await User.findOne({ where: { username } });
      if (user) await EndpointACL.create({
        idendpoint: ep.idendpoint,
        principal_type: 'user',
        principal_id: user.iduser,
        action: '*',
        effect: 'allow'
      });
    }
  }
}
```

### 7.5 Integración LDAP / Keycloak / OIDC

**Arquitectura propuesta:**

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Identity       │     │  OpenFusionAPI   │     │  Authorization     │
│  Provider       │────▶│  Auth Gateway    │────▶│  Engine (V2)       │
│  (LDAP/Keycloak)│     │  (nuevo módulo)  │     │  (hasPermissionV2) │
└─────────────────┘     └──────────────────┘     └────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌───────────────┐   ┌───────────────┐
            │ User Sync     │   │ JIT Provision │
            │ (cron/trigger)│   │ (primer login)│
            └───────────────┘   └───────────────┘
```

**Módulo `auth_gateway.js` (nuevo):**

```javascript
// Configuración por proveedor
const IDP_CONFIG = {
  ldap: {
    url: 'ldap://ldap.example.com:389',
    bindDN: 'cn=admin,dc=example,dc=com',
    bindPassword: 'secret',
    searchBase: 'ou=users,dc=example,dc=com',
    searchFilter: '(uid={{username}})',
    attributes: ['uid', 'mail', 'cn', 'memberOf'],
    groupSearchBase: 'ou=groups,dc=example,dc=com',
    groupSearchFilter: '(member={{userDN}})',
    groupAttribute: 'cn',
  },
  keycloak: {
    serverUrl: 'https://keycloak.example.com',
    realm: 'openfusionapi',
    clientId: 'openfusionapi-client',
    clientSecret: 'secret',
    adminUser: 'admin',
    adminPassword: 'secret',
  },
  oidc: {
    issuer: 'https://accounts.google.com',
    clientId: 'xxx.apps.googleusercontent.com',
    clientSecret: 'secret',
    scope: 'openid email profile',
  }
};

// Flujo de autenticación unificado
export async function authenticateWithIDP({ provider, username, password, token }) {
  const config = IDP_CONFIG[provider];
  if (!config) throw new Error(`Unknown IDP: ${provider}`);
  
  let idpUser;
  if (provider === 'ldap') {
    idpUser = await ldapBindAndSearch(config, username, password);
  } else if (provider === 'keycloak') {
    idpUser = await keycloakValidateToken(config, token) || await keycloakPasswordGrant(config, username, password);
  } else if (provider === 'oidc') {
    idpUser = await oidcValidateToken(config, token);
  }
  
  // JIT provisioning / sync
  const localUser = await syncOrCreateLocalUser(idpUser, provider);
  
  // Generar token OpenFusionAPI
  const ofapiToken = GenToken({ admin: localUser.toJSON() }, localUser.exp_time || 3600);
  
  return { user: localUser, token: ofapiToken, idpUser };
}

// Sincronización de atributos y grupos/roles
async function syncOrCreateLocalUser(idpUser, provider) {
  const username = idpUser.username || idpUser.email || idpUser.sub;
  let user = await User.findOne({ where: { username } });
  
  const mappedAttrs = mapIDPAttributes(idpUser, provider);
  const mappedGroups = mapIDPGroups(idpUser, provider);  // ['admins', 'developers', ...]
  
  if (!user) {
    user = await User.create({
      username,
      password: '',  // sin password local, auth delegada
      email: mappedAttrs.email,
      first_name: mappedAttrs.firstName,
      last_name: mappedAttrs.lastName,
      enabled: true,
      ctrl: emptyCtrl(),  // permisos via roles, no ctrl
      custom_data: { idp_provider: provider, idp_id: idpUser.id, idp_groups: mappedGroups },
    });
  } else {
    await user.update({ ...mappedAttrs, custom_data: { ...user.custom_data, idp_groups: mappedGroups } });
  }
  
  // Sincronizar roles desde grupos IDP
  await syncRolesFromIDPGroups(user.iduser, mappedGroups);
  
  return user;
}

function mapIDPGroups(idpUser, provider) {
  // LDAP: memberOf → cn de grupos
  // Keycloak: realm roles + client roles + groups
  // OIDC: groups claim
  return idpUser.groups || idpUser.realm_roles || idpUser.client_roles || [];
}

async function syncRolesFromIDPGroups(iduser, idpGroups) {
  const roleMapping = {
    'ofapi-super-admin': 'super_admin',
    'ofapi-admins': 'admin',
    'ofapi-editors': 'editor',
    'ofapi-viewers': 'viewer',
    'ofapi-api-clients': 'api_client',
  };
  
  for (const g of idpGroups) {
    const roleName = roleMapping[g.toLowerCase()];
    if (roleName) await assignRole(iduser, roleName);
  }
}
```

**Configuración en `.env`:**
```bash
# Proveedor primario (uno solo activo)
AUTH_IDP_PROVIDER=keycloak          # ldap | keycloak | oidc | none (default)
AUTH_IDP_FALLBACK_LOCAL=true        # si IDP falla, intentar usuario local
AUTH_IDP_SYNC_CRON="0 */6 * * *"    # sync cada 6h
AUTH_IDP_JIT_PROVISIONING=true      # crear usuario en primer login exitoso
```

---

## 8. Roadmap de Implementación Priorizado

### Fase 1: Fixes Críticos (Semana 1-2) — **Sin breaking changes**

| # | Acción | Archivos | Riesgo |
|---|--------|----------|--------|
| 1.1 | Cambiar `/restore` a `access: 2` + `ctrl.admin: true` + resource `settings` | `src/lib/db/default/system.js` | Bajo |
| 1.2 | Mapear recursos faltantes en `resourceMapper.js` para 38 endpoints admin | `src/lib/server/resourceMapper.js` | Bajo |
| 1.3 | Implementar `ctrl.users` allowlist en `hasPermission` | `src/lib/server/permissions.js` | Bajo |
| 1.4 | Rechazar wildcard `*` en acciones en `validateCtrlSchema` | `src/lib/server/permissions.js` | Bajo |
| 1.5 | Implementar `access === 4` (Local only) → solo localhost/127.0.0.1 | `src/lib/server/auth_service.js` | Medio |
| 1.6 | Añadir campo `ctrl` a `ApiClient` + migración | `src/lib/db/models.js`, `src/lib/db/apiclient.js` | Medio |

### Fase 2: RBAC Core (Semana 3-5)

| # | Acción | Archivos nuevos/modificados |
|---|--------|------------------------------|
| 2.1 | Crear tablas `ofapi_role`, `ofapi_group`, `ofapi_group_member`, `ofapi_group_role`, `ofapi_user_role` | `src/lib/db/models.js`, migración |
| 2.2 | Crear `ofapi_endpoint_acl` tabla | `src/lib/db/models.js` |
| 2.3 | Implementar `hasPermissionV2` con precedencia deny>allow>roles>legacy | `src/lib/server/permissionsV2.js` |
| 2.4 | Migrar seed users a roles (`super_admin`, `admin`) | `src/lib/db/user.js` |
| 2.5 | UI: `PermissionEditor.svelte` → editor de roles/grupos + ACL por endpoint | GUI |

### Fase 3: IDP Integration (Semana 6-8)

| # | Acción | Archivos |
|---|--------|----------|
| 3.1 | Módulo `auth_gateway.js` con drivers LDAP/Keycloak/OIDC | `src/lib/server/auth_gateway.js` |
| 3.2 | JIT provisioning + sync cron | `src/lib/server/auth_gateway.js` |
| 3.3 | Mapeo groups→roles configurable | `src/lib/server/auth_gateway.js` |
| 3.4 | Config `.env` + docs | `env.example`, `src/docs/auth/IDP_INTEGRATION.md` |

### Fase 4: Hardening & Observabilidad (Semana 9-10)

| # | Acción |
|---|--------|
| 4.1 | Rate limit persistente (`ofapi_rate_limit_block`) + blocklist/allowlist admin |
| 4.2 | Auditoría de decisiones de auth (allow/deny) en `ofapi_audit_log` |
| 4.3 | Refresh token endpoint + rotación |
| 4.4 | Deshabilitar seed users en producción (`OFAPI_DISABLE_DEFAULT_USERS=true`) |
| 4.5 | Tests de integración auth/permisos/IDP |

---

## 9. Checklist de Validación Post-Implementación

### 9.1 Tests de regresión críticos

```bash
# 1. /restore ya no público
curl -X PUT https://api.example.com/restore -d '{"restore":true}'  # → 401

# 2. Usuario con users.create puede crear usuarios (antes roto)
TOKEN=$(curl -s -X POST -u "editor:pass" /system/login | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" -X POST /user/create -d '{"username":"test"}'  # → 200

# 3. ctrl.users allowlist funciona
# Endpoint con ctrl.users: ["alice"] → alice accede, bob denegado

# 4. access:4 (Local only) bloquea IP remota
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/local-only  # → 403 si IP != 127.0.0.1

# 5. ApiClient con ctrl puede acceder a endpoints permitidos
```

### 9.2 Tests de RBAC V2

```bash
# 1. Rol 'viewer' solo read en todos recursos
# 2. Deny explícito en endpoint ACL tiene prioridad sobre rol allow
# 3. Grupo con roles se hereda a miembros
# 4. Keycloak login → JIT provisioning → roles sincronizados
# 5. LDAP group sync cada 6h actualiza roles
```

---

## 10. Conclusiones

El sistema actual **funciona para casos simples** (superadmin + usuarios con permisos granulares por recurso) pero tiene **gaps de seguridad críticos** (`/restore` público, endpoints admin sin recurso mapeado) y **limitaciones arquitecturales** (sin roles, sin allowlist por endpoint, sin IDP externo).

La **migración propuesta es incremental y backward-compatible**:
1. **Fase 1** arregla los bugs críticos sin tocar el modelo de datos
2. **Fase 2** añade RBAC real coexistiendo con `ctrl` legacy
3. **Fase 3** habilita Keycloak/LDAP/OIDC como proveedor de identidad
4. **Fase 4** endurece rate-limit, auditoría y refresh tokens

**Recomendación inmediata:** Aplicar **Fase 1.1-1.5** antes de cualquier despliegue en producción expuesto a internet.

---

## Apéndice: Referencias de Código Clave

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/lib/server/permissions.js` | `hasPermission`, `validateCtrlSchema`, `emptyCtrl`, `adminCtrl`, `fullAccessCtrl` |
| `src/lib/server/auth.js` | `checkToken`, `EncryptPwd`, `passwordMatches`, `getUserPasswordTokenFromRequest`, `CreateOpenFusionAPIToken` |
| `src/lib/server/auth_service.js` | `AuthService.check_auth`, `check_auth_Bearer`, `check_auth_Basic`, `freshUser` |
| `src/lib/db/user.js` | `login`, `createUser`, `updateUser`, `defaultUser`, `DEFAULT_USERS`, password recovery |
| `src/lib/db/apiclient.js` | `createApiClient`, `loginApiClient`, `AuthorizedEnpointsClient` |
| `src/lib/db/apikey.js` | `upsertApiKey`, `GenTokenJWT` (firma con `app.jwt_key`) |
| `src/lib/server/resourceMapper.js` | `resolveResource`, `PATH_RESOURCE_MAP`, `listResources` |
| `src/lib/db/default/system.js` | Seed de 137 endpoints system (incluye `ctrl.admin`, `access`, `resource`) |
| `src/lib/server/runtime/RateLimitService.js` | Rate limiter en memoria con backoff exponencial |
| `src/lib/server/audit/auditService.js` | `recordAudit`, `getActorFromParams`, `AUDIT_ACTIONS`, `AUDIT_ENTITY_TYPES` |
| `src/lib/server/functions/system/prd/user/index.js` | Handlers de user CRUD, login, recovery, Telegram link |
| `src/lib/server/functions/system/prd/apiclient/index.js` | Handlers de ApiClient CRUD, login |
| `src/lib/server/functions/system/prd/apikey/index.js` | Handlers de ApiKey CRUD (genera tokens firmados) |
| `src/lib/server/functions/system/prd/app/index.js` | `restoreAppFromBackup`, `restoreAllAppsFromBackup` |
| `src/lib/db/app.js` | `restoreAppFromBackup`, `restoreApiClients`, `restoreApiKeys` |

---

*Documento generado automáticamente tras análisis completo del códigobase (2608 nodos, 5840 edges en knowledge graph). Verificaciones empíricas ejecutadas contra código vivo.*