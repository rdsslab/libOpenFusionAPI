# Auditoría de arranque y configuración — libOpenFusionAPI v13.5.6

Fecha: 2026-09-23 · Entorno: Node v24.21.0, npm 11.19.0, Linux

Objetivo: arrancar y configurar el proyecto **siguiendo únicamente la documentación
presente** (README.md, env.example, src/docs/*), registrar los obstáculos, y proponer
mejoras de documentación.

---

## 1. Pruebas realizadas

| # | Escenario (fiel a la doc) | Resultado |
|---|---|---|
| A | `git clone` → `npm install` → `npm start` **sin `.env`** | Servidor arranca en *modo degradado* exactamente como documenta el README (`JWT_KEY` faltante, raíz muestra el listado de variables faltantes, `/api/*` → 503). ✅ Comportamiento documentado correcto. |
| B | `cp env.example .env` → `npm start` **(flujo literal documentado)** | Servidor arranca "normal" pero **ROTO**: las tablas de BD nunca se crean (`BUILD_DB` está comentado), todos los endpoint responden 500 (`SQLITE_ERROR: no such table: ofapi_*`) y el cliente WebSocket entra en bucle de reconexión. El portal `/` carga, pero la API es inutilizable. ❌ **BLOQUEADOR** |
| C | Igual que B + `BUILD_DB=true` (primer arranque) | Arranca correctamente: `/` → 200 (landing), `/api/system/server/version/prd` → `{"version":"13.5.6","ddbb":"sqlite"}`, login OK, MCP server OK. ✅ |

Flujo verificado en C:

```bash
# Login (Basic Auth — no body JSON)
curl -X POST http://localhost:3000/api/system/system/login/prd \
  -u "superopenfusionapi:Sup3r@0penFusion!"
# → {"login":true,"user":{...}, ...}

# Endpoints públicos
curl http://localhost:3000/api/system/server/version/prd
# → {"version":"13.5.6","ddbb":"sqlite"}

# MCP server (requiere Accept: application/json, text/event-stream)
curl -X POST http://localhost:3000/api/system/mcp/server/prd \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <token de .mcp.json>" ...
```

---

## 2. Obstáculos y ambigüedades encontrados (con evidencia)

### O1 — BLOQUEADOR: primer arranque sin `BUILD_DB` deja una BD vacía y la API 500
- README (tabla de variables): `BUILD_DB` = "Rebuild/seed the database on boot", **Required: No**.
- `env.example`: `#BUILD_DB=true` comentado por defecto.
- Realidad: con BD sqlite nueva y sin `BUILD_DB`, el `buildDB()` solo sincroniza tablas
  auxiliares; las tablas principales (`ofapi_application`, `ofapi_method`, `ofapi_user`,
  …) **no se crean** y el seed falla. El servidor escucha pero todo `/api/*` → 500.
- Logs: `SequelizeDatabaseError: SQLITE_ERROR: no such table: ofapi_method`; bucle
  `Reintentando conexión…` del WebSocket.
- Peor trampa: como `JWT_KEY` del `env.example` rellena el placeholder, el *config health*
  da **OK** y el servidor parece sano; el modo degradado no aparece.

### O2 — No existe una sección de instalación/arranque
- El README "Quick Start" son 4 pasos asumiendo una UI inexistente (ver O3). No dice
  `npm install` ni `npm start`, ni la versión mínima de Node (`package.json` no tiene
  campo `engines`), ni los requisitos de toolchain para dependencias nativas
  (`canvas`, `sqlite3`, `oracledb`, `@sap/hana-client`), ni que `package.json` usa
  `allowScripts` (mecanismo de npm v11+).

### O3 — La "Simple UI" descrita en README/App/endpoint NO existe en este repo
- README: "**Simple UI** to configure endpoints…", "Log into the platform", "Deploy with
  a single click".
- `src/docs/App/README.md` y `src/docs/endpoint/README.md`: describen botones
  ("NEW APP", dropdown, "Endpoints tab") con capturas de pantalla incrustadas.
- Realidad: el único HTML del repo es `www/index.html` (919 líneas), una **landing page
  estática** de marketing **sin login ni formularios de configuración**. `grep "NEW APP"`
  no encuentra nada. Toda la configuración real es vía HTTP API / MCP tools.

### O4 — Credenciales por defecto no documentadas
- El README dice "Log into the platform" sin decir con qué cuentas.
- Los usuarios seed solo viven en `src/lib/db/user.js`:
  | usuario | password | rol |
  |---|---|---|
  | `superopenfusionapi` | `Sup3r@0penFusion!` | system admin |
  | `admin` | `Adm1n@0penFusion!` | system admin |
  | `demo` | `D3m0@0penFusion!` | solo lectura dev |
  | `client_api` | `Cl13nt@0penFusion!` | api client |
- Además se crean con `change_password: true` (obligan a cambiarla en el primer login),
  detalle tampoco mencionado al primer usuario.

### O5 — Rutas documentadas ≠ rutas reales; login usa Basic Auth
- `src/docs/auth/USER_RECOVERY.md` documenta `POST /system/login`.
- URL real: `POST /api/system/system/login/prd` (esquema `/api/{app}/{resource}/{environment}`;
  el `resource` del seed es `/system/login` dentro de la app `system`, por eso "system"
  se duplica). El resto de rutas de la tabla padecen lo mismo (sin prefijo `/api/` ni
  sufijo de entorno).
- El login autentica por **Basic Auth** (`Authorization: Basic …`), no por body JSON;
  con `Content-Type: application/json` y body vacío responde 400. No documentado.

### O6 — `JWT_KEY` placeholder público e inseguro
- `env.example` trae `JWT_KEY=change-me-to-a-strong-random-secret`. El README dice
  "**none — required**" (contradice que el ejemplo traiga un valor). Copiar el ejemplo
  verbatim deja una clave conocida públicamente (JWTs falsificables). El *config health*
  solo verifica presencia, no fuerza de la clave.

### O7 — MCP: header `Accept` y token incrustado
- El endpoint MCP responde `-32000 Not Acceptable` si el cliente no envía
  `Accept: application/json, text/event-stream` (no documentado).
- `.mcp.json` trae un Bearer token hardcodeado (expira ~2027) firmado con el JWT_KEY de
  la instancia; es config de ejemplo útil, pero conviene documentar cómo regenerarlo.

### O8 — Menores
- Fallback a `sqlite` en `/tmp/ofapi.sqlite` sí está documentado en `env.example`, pero
  no hay nota de persistencia (se pierde al reiniciar el host) ni recomendación de
  `DATABASE_URL` para entornos persistentes/producción.
- `www/index.html` apunta a `http://localhost:3000/...` hardcodeado (puerto/host
  cambiantes según `PORT`/`HOST`).

---

## 3. Mejoras de documentación propuestas

### 3.1 `README.md` — nueva sección "🚀 Instalación y primer arranque"
1. Requisitos: Node ≥ 20 (fijar versión soportada), npm ≥ 11 (por `allowScripts`), y en
   Linux build-essential/python3 para `canvas`/`oracledb`/`sqlite3` (native rebuilds).
2. `npm install`
3. `cp env.example .env` y **editar obligatoriamente**:
   - `JWT_KEY=$(openssl rand -hex 32)` (nunca dejar el placeholder)
   - `BUILD_DB=true` **la primera vez** (o siempre que se quiera resetear la BD)
4. `npm start` → abrir `http://localhost:<PORT>`
5. Primer login con credenciales por defecto (tabla de O4) + aviso de cambio obligatorio.
6. Aviso explícito: *"sin `BUILD_DB` en una BD vacía el servidor arranca pero todos los
   endpoints responden 500 por tablas ausentes"*.

### 3.2 `README.md` — reescribir "Quick Start" y corregir la tabla de variables
- Sustituir el flujo "Log into the platform / Deploy with a single click" por el flujo
  real vía API/MCP (login con curl, token, ejemplo de creación de app + endpoint) o
  declarar que la UI no está incluida en este repo.
- En la tabla de variables: `BUILD_DB` → "**Sí, en el primer arranque**"; anotar el
  placeholder inseguro de `JWT_KEY`.

### 3.3 `src/docs/auth/USER_RECOVERY.md` — rutas completas y método de auth
- Tabla con URLs reales (`/api/system/system/login/prd`) y nota: *"todas las rutas usan
  el prefijo `/api/{app}` y el sufijo `/{environment}`"*.
- Documentar que `/system/login` (y `/apiclient/login`) autentican por **Basic Auth**.

### 3.4 `src/docs/App/README.md` y `src/docs/endpoint/README.md`
- Marcar en el encabezado que las capturas corresponden a una UI **externa/no incluida
  en este repositorio**, y migrar el contenido al flujo real (HTTP API + MCP tools) con
  ejemplos `curl`, o alinear el README principal con una guía API-first.

### 3.5 `env.example`
- Añadir comentario de "primer arranque": descomentar `BUILD_DB=true` la primera vez.
- Nota de seguridad: generar `JWT_KEY` aleatorio; el valor del ejemplo es PUBLICO.
- Nota de persistencia: el sqlite de `/tmp` se pierde; usar `DATABASE_URL` para entornos
  reales.

### 3.6 Opcional
- `package.json`: añadir campo `engines` (Node >= 20, npm >= 11) para fallar temprano.
- `.vscode/` o docs: cómo regenerar el token de `.mcp.json` (login + `GET /apiclient/login`
  o la tool MCP correspondiente).

---

## 4. Resumen

El proyecto **arranca y funciona** (flujo C verificado: landing, endpoints públicos,
login Basic Auth, MCP server). El problema es que la documentación actual:
1. **No documenta el paso que destraba el primer arranque** (`BUILD_DB=true`), y
   enmascara el fallo porque el health-check solo valida `JWT_KEY`.
2. **Describe una UI que no existe** en este repositorio (Quick Start + guías App/endpoint).
3. **Oculta información mínima** para configurar: credenciales por defecto, rutas reales
   (`/api/{app}/{resource}/{env}`), Basic Auth en login, y generación segura de `JWT_KEY`.

---

## 5. Estado de aplicación de las mejoras (2026-09-23)

| Archivo | Cambio aplicado |
|---|---|
| `README.md` | Nueva sección "Quick Start (first run)": requisitos (Node/npm/toolchain), `npm install` + `cp env.example .env`, `JWT_KEY` aleatorio, `BUILD_DB=true` en primer arranque (con advertencia del 500), credenciales por defecto + cambio obligatorio, login con Basic Auth y sanity check. Aviso de que `www/` es solo landing (sin consola). Corregida la tabla de variables (`JWT_KEY`, `HOST`, `BUILD_DB`, persistencias de sqlite). Ajustados los párrafos que prometían una "Simple UI". |
| `env.example` | Aviso de seguridad del placeholder de `JWT_KEY` (+ `openssl rand -hex 32`), nota de primer arranque de `BUILD_DB`, y nota de pérdida del sqlite en `/tmp`. |
| `src/docs/auth/USER_RECOVERY.md` | Documentado el esquema real `/api/{app}{resource}/{environment}` con ejemplos completos en la tabla (URL real por fila) y nota de **Basic Auth** para `/system/login` y `/apiclient/login`. |
| `src/docs/App/README.md` | Callout ⚠️: las capturas corresponden a una consola externa no incluida en el repo; configuración realmente vía HTTP API/MCP. |
| `src/docs/endpoint/README.md` | Idem callout ⚠️. |

Pendiente / recomendado (no aplicado por estar fuera del alcance de documentación):
- `package.json`: añadir campo `engines` (`node >= 20`, `npm >= 11`) para fallar temprano.
- Docs de MCP: documentar el header `Accept: application/json, text/event-stream` y cómo
  regenerar el token de `.mcp.json`.