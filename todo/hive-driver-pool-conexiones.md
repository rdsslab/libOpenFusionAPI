# TODO: Pool de conexiones para HIVE_DRIVER

> Documento de trabajo para retomar la idea más adelante. No afecta el parche `13.13.5` (`FETCH_NEXT` / `flush`); es mejora de rendimiento posterior.
>
> **Seguridad:** no contiene IPs ni credenciales reales. Referencias al endpoint `172.16.243.104:3033` y `$_VAR_HIVE_CONFIG` son contextuales; cualquier contraseña debe rotarse si quedó expuesta en logs (hallazgo reportado el 20 oct 2026).

---

## 1. Objetivo

Evitar que cada petición a un endpoint `HIVE_DRIVER` abra / cierre una conexión TCP + `HiveSession` + autenticación LDAP (`authType: PLAIN`). Esto reduce latencia y carga en `nodo1.farmaenlace.com:21050`.

## 2. Estado actual

- `hive-worker.js` (parchado `13.13.5`) crea `new hive.HiveClient(...)`, conecta (`client.connect()`), abre `session.executeStatement()`, y destruye (`client.close()`) al terminar.
- No hay reutilización ni `ConnectionPool`. El handler usa `node:worker_threads` (`runHiveWorker`) con un `Worker` nuevo por petición.
- `buildConnectionCacheKey` ya existe en `hiveDriver.js` (solo para `recordConnectionOverride` / log, no para reusar).

## 3. Diseño propuesto (no implementado)

| Componente | Propuesta |
|---|---|
| **Clave de caché** | `buildConnectionCacheKey(config)` (host, port, authType, useTLS, …) como hace `sqlHana.js` / `ConnectionPool.js`. |
| **Unidad reutilizable** | `HiveClient` conectado + `HiveSession` abierto (no solo TCP; HS2 requiere `openSession`). |
| **TTL / evicción** | `CACHE_TTL` ≤ `hive.server2.thrift.session.idle.timeout` (default ~600 s; sugerir 5 min). `maxConnections` ~10 (como HANA). `clear()` / `invalidatePool()` al error o timeout del endpoint. |
| **Worker** | O bien (a) hacer el `Worker` persistente por clave y recibir `sql` por `postMessage` (cambia `runHiveWorker`), o (b) mantener `new Worker` pero pasarle una `session` ya creada (más complejo porque la sesión es un objeto Thrift). |
| **Estado entre queries** | Reset obligatorio (`USE default` o `RESET`) antes de ejecutar la query del endpoint, porque `HiveSession` conserva variables/`USE`. Si no, endpoint `A` podría ver datos de endpoint `B`. |

## 4. Riesgos específicos de Impala / Hive

- **Sesión inactiva**: Impala cierra sesiones tras `idle.timeout`. El pool debe hacer *heartbeat* (`waitUntilReady` / `status()`) o evictar antes del límite del servidor.
- **Contaminación de estado**: restricciones de seguridad (endpoint `qa` vs `prd`) requieren aislamiento; un pool mal reseteado mezcla resultados entre apps.
- **Credenciales en memoria**: con `authType: PLAIN` / `useTLS: false`, la contraseña LDAP viaja en texto hasta `nodo1:21050`. Un pool persistente mantiene la contraseña en memoria del proceso más tiempo; debe usarse solo con `useTLS: true` y rotar si quedó expuesta en logs (registro `$_VAR_HIVE_CONFIG` con `log_level: 3`).
- **Timeout / terminación**: hoy `runHiveWorker` hace `worker.terminate()` si excede `timeoutMs`. Con pool, debe invalidarse la entrada (`delete` + `clear()`) en vez de devolver una sesión rota al pool.

## 5. Referencias que importan

- `AGENTS.md` (línea de versión `13.13.5`): parche `FETCH_NEXT` / `flush` aplicado; la mejora de pool es independiente.
- `hive-worker.js`: bucle `while (more)` con `FETCH_NEXT` + `operation.flush()` (l. 106 / 116).
- `sqlHana.js`: patrón `getConnection` con `new Map()` / LRU / `clear()`.
- `ConnectionPool.js`: `DEFAULT_MAX_CONNECTIONS = 50`, `isConnectionExhaustionError`, `OFAPI_SQL_POOL_MAX_CONNECTIONS`.
- Subagente `ses_ea99c1232ffekuN0oyfx40lWGK`: diagnóstico de `TBufferedTransport` / `TFramedTransport`; no afecta diseño del pool, pero confirma que cualquier cambio de transporte debe mantenerse consistente (`transport`: `framed` por defecto para `hive-site.xml` 3.1.3).

## 6. Próximo paso recomendado

- **No urgente** tras `13.13.5`; validar estabilidad con `SELECT 1` y paginación grande (`maxRows: 100`, 250 filas) primero.
- Si se aprueba: implementar en `hiveDriver.js` (`getHivePool` similar a `sqlHana.js` `getConnection`) y adaptar `hive-worker.js` para aceptar `session` o usar worker persistente.
- Antes de implementar: confirmar `useTLS: true` en `impala.resultset.cache.size` y rotar contraseñas expuestas (hallazgo de seguridad del 20 oct 2026).
