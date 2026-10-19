# HIVE-DRIVER Handler — Impala / Hive

El **HIVE-DRIVER** conecta OpenFusionAPI con servidores **Apache Hive** o **Cloudera Impala** mediante el driver puro `hive-driver` (Thrift sobre TCP). No requiere dependencias nativas del sistema (C++, unixODBC, compiladores), por lo que funciona en `node:alpine` sin problemas.

---

<details>
<summary>🧠 Cómo funciona</summary>

Cuando un endpoint usa el handler `HIVE_DRIVER` (registro `HIVE_DRIVER`):

1. El handler recibe la consulta SQL (`method.code`) y la configuración de conexión (`method.custom_data`).
2. Resuelve variables de entorno (`AppVar`) y aplica overrides de conexión seguros (`connection_override_allow`).
3. Extrae parámetros (`bind`, `replacements`, `params`) del request HTTP (GET/POST) igual que `SQL` y `HANA`.
4. Sustituye los placeholders `:param` / `$param` con valores literales escapados de forma segura (no hay `PreparedStatement` nativo en Impala; la sustitución es literal protegida).
5. Ejecuta la consulta dentro de un **Worker** (`node:worker_threads`) para que la deserialización de resultados Thrift nunca bloquee el event loop principal.
6. Usa paginación por lotes (`maxRows`) para evitar traer millones de filas de golpe.
7. Devuelve el resultado como JSON (`{ rows: [...], count: N }`); valores `BIGINT` > `MAX_SAFE_INTEGER` se convierten a `String` para preservar precisión.
8. Cierra el cliente (`client.close()`), la sesión (`session.close()`) y la operación (`operation.close()`) automáticamente.

**Soporta** `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, etc. (sujeto a permisos del usuario de base de datos).

**Nota de protocolo / compatibilidad**: usa `HIVE_CLI_SERVICE_PROTOCOL_V10` por defecto, compatible con **Apache Hive 3.x / 4.x** y **Cloudera Impala** (ambos usan `TCLIService` Thrift). Probado con contenedor real `mirror.gcr.io/apache/hive:4.0.0` y `3.1.3` (`localhost:10000`, TCP abierto, sesiones `Hive Session ID` confirmadas con `NoSasl` / `PLAIN`). Si tu clúster Impala requiere `V6`, modifica `hive-worker.js` (`client_protocol`).
</details>

---

<details>
<summary>⚙️ Configuración del Endpoint</summary>

Ejemplo de endpoint en OpenFusionAPI:

```json
{
  "handler": "HIVE_DRIVER",
  "method": "GET",
  "resource": "/api/demo/impala/dev",
  "environment": "dev",
  "code": "SELECT * FROM mi_base.tabla WHERE category IN ($categories) AND id = $id",
  "custom_data": "{\"host\":\"impala-empresa.com\",\"port\":21050,\"username\":\"$_VAR_IMPALA_USER\",\"password\":\"$_VAR_IMPALA_PASS\",\"useTLS\":true,\"authType\":\"PLAIN\",\"maxRows\":1000,\"timeoutMs\":30000}"
}
```

El `custom_data` es JSON. Puede ser un objeto literal o una referencia a `AppVar`: `"$_VAR_IMPALA_CONFIG"`.

---

<details>
<summary>📄 Definición de la Consulta y Parámetros (Bind)</summary>

### Sintaxis de placeholders

- `$nombre` — valor escalar (número, string, booleano, `NULL`).
- `:nombre` — igual que `$nombre`; el sistema limpia el prefijo (`:`, `$`, `@`) antes de sustituir.
- **Arrays** (`IN (:list)`): cada elemento se expande como `?, ?, ...` y se escapa individualmente.

### Ejemplo con array

```sql
SELECT * FROM pedidos WHERE status IN ($status_list) AND region = $region
```

Con body de request:

```json
{
  "bind": {
    "status_list": ["PENDIENTE", "APROBADO"],
    "region": "NORTE"
  }
}
```

Internamente se convierte en:

```sql
SELECT * FROM pedidos WHERE status IN ('PENDIENTE', 'APROBADO') AND region = 'NORTE'
```

**Importante**: nunca concatenar valores directamente en `method.code`. Siempre usar `bind` o `replacements`.

### Parámetros en GET

- `GET /api/demo/impala/dev?bind={"region":"NORTE"}`
- `GET /api/demo/impala/dev?region=NORTE` (si no hay clave `bind`, los campos sueltos se convierten en bind automáticamente, igual que `sqlFunction`).
- Repeated keys: `?id=1&id=2` → `bind: { id: ["1", "2"] }` (Fastify semantics).
</details>

---

<details>
<summary>🔧 Parámetros de Conexión (`custom_data` / AppVar)</summary>

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `host` | string | sí | Hostname / IP de HiveServer2 / Impala |
| `port` | number | no | Puerto Thrift binario. Default `21050` |
| `username` | string | sí (PLAIN) / no (NONE) | Usuario de dominio (LDAP) |
| `password` | string | sí (PLAIN) / no (NONE) | Clave de dominio |
| `database` | string | no | Base de datos por defecto (igual a `USE`) |
| `useTLS` | boolean | no | Activa TLS en el socket tcp (`ssl: true`). Default `false` |
| `tls` | object | no | Opciones TLS (`ca`, `rejectUnauthorized`, `cert`, `key`) pasadas al `TcpConnection` |
| `authType` | string | no | `PLAIN` (actual / LDAP), `NONE` / `NOSASL` (para servidores sin autenticación SASL), `KERBEROS` (reservado; requiere instalar `kerberos`) |
| `maxRows` | number | no | Filas por lote Thrift. Default `1000` |
| `timeoutMs` | number | no | Timeout de ejecución de la consulta. Default `30000` |
| `connection_override_allow` | array | no | Lista de rutas permitidas para `connection` override (ej. `["host","port"]`) |

**Ejemplo con TLS**:

```json
{
  "host": "impala-secure.empresa.com",
  "port": 21050,
  "username": "svc_impala",
  "password": "***",
  "useTLS": true,
  "tls": { "ca": "/certs/ca.pem", "rejectUnauthorized": true },
  "maxRows": 500
}
```

> ⚠️ **Seguridad**: si envías `password` sin `useTLS: true`, la contraseña viaja en texto plano por TCP. Siempre usa TLS en producción.
</details>

---

<details>
<summary>🌐 Ejemplos de Peticiones</summary>

### POST con array (`IN`) y variables de conexión

```bash
curl -X POST https://example.com/api/demo/impala/prd \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "bind": {
      "categories": ["X", "Y", "Z"],
      "min_id": 100
    },
    "connection": {
      "host": "impala-prd.empresa.com",
      "port": 21050,
      "username": "$_VAR_IMPALA_USER",
      "password": "$_VAR_IMPALA_PASS"
    }
  }'
```

### SQL configurado

```sql
SELECT id, name, category FROM enddb.demo WHERE category IN ($categories) AND id >= $min_id LIMIT 1000;
```

### Respuesta exitosa

```json
{
  "rows": [
    { "id": 1, "name": "Alice", "category": "X" },
    { "id": 2, "name": "Bob", "category": "X" },
    { "id": 3, "name": "Charlie", "category": "Y" }
  ],
  "count": 3
}
```

---

<details>
<summary>🔐 Autenticación y Acceso</summary>

Soporta los modos estándar de OpenFusionAPI:

- **Público**
- **Basic Authentication**
- **Token (JWT)**

**Recomendación**: usar tokens con permisos de solo lectura (`SELECT`) para endpoints públicos; restringir `INSERT/UPDATE/DELETE` a roles específicos.
</details>

---

<details>
<summary>🪵 Registro (Logs)</summary>

Cada petición registra (global OpenFusionAPI):

- Timestamp
- SQL ejecutado (con bind resuelto o con placeholders según nivel de log)
- Tiempo de ejecución (ms)
- Host / puerto de conexión
- Resultado (`statusCode` / error)
- Si hay timeout (`504`)
</details>

---

<details>
<summary>📊 Resumen de Capacidades</summary>

| Característica | Soportado |
|---|---|
| Impala / HiveServer2 (TCP binario) | ✅ |
| LDAP / PLAIN (autenticación por dominio) | ✅ |
| Kerberos (reservado, sin instalar hoy) | ⏳ (listo para `authType: "KERBEROS"`) |
| TLS / SSL | ✅ (`useTLS` + `tls`) |
| Parámetros (`$`, `:`, arrays `IN`) | ✅ |
| Paginación por lotes (`maxRows`) | ✅ |
| Aislamiento de event loop (`Worker`) | ✅ |
| Precisión BIGINT (`Int64` → `String`) | ✅ |
| Precisión DECIMAL | ⚠️ Depende de `hive-driver`; usar `CAST(col AS STRING)` si se requiere |
| Múltiples consultas por request | ❌ (una por request) |
| Bulk insert eficiente | ❌ (usar `SQL_BULK_I` con otro motor) |
| Caching | ✅ (global OpenFusionAPI) |

</details>

---

<details>
<summary>💡 Casos de Uso Típicos</summary>

- Exponer tablas / vistas de Impala como REST (dashboards, reporting).
- Consultas analíticas con agregaciones (`GROUP BY`, `SUM`) y filtros por arrays (`IN`).
- Validación de datos entre sistemas (ej: comparar IDs de dominio con lista de códigos).
- Integración con blogs / APIs que consumen datos de Big Data sin instalar ODBC en la imagen Docker.
</details>

---

## Notas & Limitaciones

- **No hay `PreparedStatement` nativo**: todos los parámetros se sustituyen como literales protegidos. Nunca uses concatenación manual.
- **Tipos grandes**: `BIGINT` > `MAX_SAFE_INTEGER` se devuelve como `String`; para preservar como número en el cliente, usa `CAST(col AS STRING)` o convierte a `BigInt` en JS.
- **Event Loop**: el `Worker` aísla la deserialización Thrift, pero un `SELECT` con millones de filas puede crecer en memoria del worker; usa `maxRows` y `LIMIT`.
- **Kerberos**: requiere instalar `npm i kerberos` y configurar `principal` / `keytabPath`; hoy no se instala para evitar dependencias nativas y se deja como `authType` futuro.
- **Versión del protocolo**: por defecto `V10` (compatible Hive 3.x/4.x). Si tu clúster requiere `V6`, modifica `hive-worker.js` (`TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V6`).

© 2026 — OpenFusionAPI · `hive-driver` integration
