# Interval Tasks: Análisis del problema T2 (Solapamiento de ejecuciones)

**Fecha:** 12/11/2026  
**Proyecto:** libOpenFusionAPI v13.x  
**Contexto:** Usuario reporta que la protección `allow_concurrent: false` no evita solapamientos reales

---

## 1. Resumen ejecutivo

El scheduler de Interval Tasks **sí implementa** una protección básica contra solapamientos (`allow_concurrent: false`), pero tiene **tres huecos críticos** que permiten que una misma tarea se ejecute concurrentemente en la práctica:

| Hueco | Descripción | Impacto |
|-------|-------------|---------|
| **1. Solo en memoria (por worker)** | `running` Set es local al hilo worker; no protege entre múltiples instancias API | Muy alto en despliegues HA/cluster |
| **2. Race condition DB → RUNNING** | `canRun()` lee `status === RUNNING` pero el `UPDATE` a RUNNING no es atómico con la decisión | Alto con carga concurrente |
| **3. Timeout no detiene el handler** | `exec_time_limit` aborta el `fetch` HTTP, pero el código del endpoint (JS/SQL/MONGO/HIVE) sigue ejecutándose | Crítico: ya ocurrió 22/09 y 30/09 |
| **4. `runNow` bypassa `running` Set** | `runNowIntervalTask` solo mira `status` en BD, no el `running` Set del worker | Medio |

---

## 2. Lo que SÍ funciona (protección actual)

### 2.1 `canRun()` en `src/lib/timer/worker.js` (líneas 494-512)

```javascript
function canRun(task, now) {
  const allowConcurrent = !!task.allow_concurrent;

  // 1. ¿Ya la está ejecutando ESTE worker?
  if (running.has(String(task.idtask)) && !allowConcurrent) {
    return { run: false, reason: "already running in this worker" };
  }

  // 2. ¿Está marcada RUNNING en BD? (puede venir de otro proceso o corrida abandonada)
  if (task.status === TASK_STATUS.RUNNING && !allowConcurrent) {
    return { run: false, reason: "task marked as running" };
  }
  // ...
}
```

### 2.2 `reapStaleRunningTasks()` (líneas 853-902)

Libera tareas que quedaron en `RUNNING` más allá de `exec_time_limit + graceSeconds` (30s por defecto):

```javascript
const limitMs = (Number(task.exec_time_limit || 30) + Number(graceSeconds || 0)) * 1000;
if (now.getTime() - startedAt.getTime() <= limitMs) continue;
// Marca como TIMEOUT, incrementa failed_attempts, reprograma con backoff
```

### 2.3 `stop_interval_task_run` → `abortRun()` (tasks.js:69-84, worker.js:129-155)

Permite abortar una corrida **en vuelo** vía `AbortController`:
- El worker registra `runAbort.set(idtask, controller)` antes del `fetch`
- `abortRun()` llama `controller.abort()` → el `fetch` rechaza con `AbortError`
- El `catch` distingue `operatorAbort` (estado `ABORTED`, sin backoff) de timeout (estado `TIMEOUT`, con backoff)

---

## 3. Lo que NO funciona (huecos reales)

### 3.1 Hueco 1: Protección solo local al worker (no distribuida)

**Archivo:** `src/lib/timer/worker.js`, línea 33
```javascript
const running = new Set();  // ← Solo existe en ESTE hilo worker_threads
```

**Problema:** Si hay **2+ instancias de la API** (HA, Kubernetes, pm2 cluster, dev+prd en mismo host), cada una tiene su propio worker y su propio `running` Set. Nada impide que la misma tarea se ejecute simultáneamente en dos instancias.

**Evidencia en código:** `getIntervalTaskProcess()` (interval_task.js:458-510) no filtra por "ya ejecutándose en otro worker". Solo filtra por `status !== RUNNING` y `disabled_by IS NULL`.

---

### 3.2 Hueco 2: Race condition entre `canRun()` y `UPDATE status = RUNNING`

**Flujo actual (worker.js:533-560):**

```javascript
for (const task of app_tasks) {
  const decision = canRun(task, now);  // ← LEE status
  if (!decision.run) continue;

  const key = String(task.idtask);
  running.add(key);                    // ← Marca EN MEMORIA
  lanzadas++;

  // ASÍNCRONO: el UPDATE a RUNNING ocurre DESPUÉS
  updateIntervalTaskStatus(task.idtask, TASK_STATUS.RUNNING, ...)
    .then((transition) => runFetchTask(task, transition?.runtime))
    // ...
}
```

**Problema:** Entre `canRun()` (que ve `status === WAITING`) y el `UPDATE ... SET status = RUNNING`, **otro worker** (o una llamada manual `runNow`) puede leer el mismo `status === WAITING` y decidir lanzar la tarea también.

**Por qué no lo cubre la transacción:** `updateIntervalTaskStatus` con `tareaConocida` (línea 807-813) hace **un solo `UPDATE` sin `SELECT ... FOR UPDATE`**. El camino con transacción (líneas 819-837) sí usa `lock: t.LOCK.UPDATE`, pero **solo se usa cuando NO se pasa `tareaConocida`** — y el worker **sí la pasa** (línea 553) para evitar el round-trip extra.

---

### 3.3 Hueco 3: `exec_time_limit` NO detiene el código del endpoint (EL MÁS GRAVE)

**Lo que pasa hoy:**

1. Worker lanza `fetch` con `timeout = exec_time_limit * 1000` (worker.js:366, 401-412)
2. Si el timeout vence, `AbortController` aborta el **cliente HTTP** (`uFetch`)
3. El `fetch` rechaza → worker marca tarea como `TIMEOUT` (worker.js:464-482)
4. **PERO** el endpoint en el servidor (handler JS, SQL, HIVE, MONGO, etc.) **sigue ejecutándose**

**Por qué no se propaga el abort:**
- El `AbortSignal` del `fetch` **no llega al handler del endpoint**
- Fastify no propaga `request.raw.on('aborted')` a los handlers automáticamente
- Los handlers (JS, SQL, HIVE, MONGO) tienen sus **propios timeouts** (`method.timeout`, `timeoutMs` en custom_data), pero son **independientes** del `exec_time_limit` de la tarea

**Evidencia en handlers:**
- `jsFunction.js`: Ejecuta `method.jsFn(fnVars)` sin signal externo (línea 29)
- `sqlFunctionInsertBulk.js`, `sqlHana.js`, `mongoDB.js`, `hiveDriver.js`: Usan `method.timeout` o `custom_data.timeoutMs` **del endpoint**, no de la tarea
- `fetchFunction.js`: Usa `method.timeout` del endpoint (línea 65-90)
- `createFunctionVM.js`: Tiene su **propio timeout VM** (1 min por defecto, línea 3), ajeno a `exec_time_limit`

**Casos reales citados:** Orquestador 22/09 y 30/09 — la tarea superó `exec_time_limit`, se marcó `TIMEOUT`, pero el endpoint siguió corriendo y generó carga/efectos laterales.

---

### 3.4 Hueco 4: `runNowIntervalTask` no respeta `running` Set del worker

**Archivo:** `src/lib/db/interval_task.js`, líneas 944-999

```javascript
export const runNowIntervalTask = async (idtask) => {
  const task = await IntervalTask.findOne({ where: { idtask } });
  
  // Solo mira status en BD, NO el running Set del worker
  if (task.status === TASK_STATUS.RUNNING && !task.allow_concurrent) {
    return { success: false, message: "La tarea está en ejecución y no permite concurrencia." };
  }
  // ...
  await IntervalTask.update({ next_run: new Date(), failed_attempts: 0, status: TASK_STATUS.WAITING });
  // ...
}
```

**Problema:** 
- Si el worker YA tiene la tarea en `running` Set (la lanzó en el tick anterior y sigue viva), `runNow` **no lo ve** porque el Set es local al worker
- `runNow` pone `next_run = now` y `status = WAITING` → el **próximo tick del worker la volverá a lanzar** (posiblemente mientras la anterior sigue viva)
- `wakeIntervalTaskWorker` despierta al worker inmediatamente → **doble ejecución garantizada** si la anterior no terminó

---

## 4. Análisis de la arquitectura de timeouts (por qué no se comunican)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INTERVAL TASK WORKER                         │
│  ┌─────────────┐    timeout=exec_time_limit*1000    ┌───────────┐  │
│  │  runFetchTask │ ────── uFetch ─────────────────▶ │  Endpoint │  │
│  │  (AbortController)                              │  (Fastify)│  │
│  └─────────────┘                                    └─────┬─────┘  │
│        │                                                    │      │
│        │ abort()                                           │      │
│        ▼                                                    ▼      │
│  fetch rechaza                                          │       │
│  worker marca TIMEOUT                                   │       │
│                                                         │       │
│  ┌──────────────────────────────────────────────────────┘       │
│  │  EL ABORT NO LLEGA AL HANDLER DEL ENDPOINT                    │
│  └──────────────────────────────────────────────────────────────┘
```

**Timeouts independientes por capa:**
| Capa | Timeout | Configurable vía |
|------|---------|------------------|
| Intervalo Task | `exec_time_limit` (default 30s) | Task config |
| Endpoint HTTP | `method.timeout` (default 30s) | Endpoint config |
| JS VM | `timeoutVM` (default 60s) | `createFunctionVM(code, vars, timeout)` |
| SQL/Hive/Mongo | `custom_data.timeoutMs` / `method.timeout` | Endpoint custom_data |
| Fastify Server | `bodyLimit`, `requestTimeout` (no configurado globalmente) | `Fastify({...})` |

**Ninguna capa conoce el timeout de la capa superior.**

---

## 5. Propuestas de solución (ordenadas por impacto)

### 5.1 Crítico: Lock distribuido a nivel BD (soluciona Huecos 1, 2, 4)

**Opción A: `pg_try_advisory_lock` / `sp_getapplock` / `GET_LOCK`** (por dialecto)

```javascript
// En updateIntervalTaskStatus al pasar a RUNNING:
const lockAcquired = await sequelize.query(
  dialect === 'postgres' 
    ? `SELECT pg_try_advisory_lock('x${idtask.replace(/-/g,'')}')`
    : dialect === 'mssql'
    ? `EXEC sp_getapplock @Resource = '${idtask}', @LockMode = 'Exclusive', @LockTimeout = 0`
    : `SELECT GET_LOCK('${idtask}', 0)`
);

if (!lockAcquired) return { run: false, reason: "locked by another process" };
```

**Opción B: Columna `locked_until` + `UPDATE ... WHERE locked_until < NOW()`**

```sql
-- Intento atómico de tomar el lock
UPDATE ofapi_intervaltask 
SET status = 1, locked_until = DATE_ADD(NOW(), INTERVAL exec_time_limit SECOND)
WHERE idtask = ? 
  AND status != 1 
  AND (locked_until IS NULL OR locked_until < NOW())
  AND disabled_by IS NULL;
-- Si affectedRows === 0 → no se pudo tomar el lock
```

**Ventaja:** Funciona en todos los dialectos, survive reinicios, visible en BD.

---

### 5.2 Crítico: Propagar abort al endpoint (soluciona Hueco 3)

**Arquitectura propuesta:** El worker debe pasar un **header de abort** o **token compartido** que el endpoint pueda consultar.

**Opción A: Header `X-OFAPI-Abort-Signal` + polling en handlers**

```javascript
// Worker: pasa header con token único por corrida
const abortToken = crypto.randomUUID();
runAbort.set(key, { controller, token: abortToken });
// ...
uF[verb]({ ..., headers: { ...headers, 'X-OFAPI-Abort-Token': abortToken }});

// Handlers (JS, SQL, HIVE, MONGO): consultan estado periódicamente
// O mejor: endpoint expone /internal/abort-check/:token que devuelve 204/410
```

**Opción B: `AbortSignal` real via `fetch` + `request.signal` en Fastify** (requiere Fastify 4+)

```javascript
// En registerCorePlugins.js o onRequest hook:
request.signal = AbortSignal.any([
  request.raw.signal,           // cliente se desconectó
  AbortSignal.timeout(exec_time_limit * 1000)  // timeout de la tarea
]);

// En handlers: usan request.signal
const result = await runQuery({ signal: request.signal });
```

**Opción C: Endpoint asíncrono + polling de estado** (cambio mayor)
- La tarea lanza el endpoint y recibe `202 Accepted` + `Location: /async/status/:jobId`
- Worker pollea `/async/status/:jobId` con timeout `exec_time_limit`
- Si vence, llama `DELETE /async/jobs/:jobId` → endpoint cancela trabajo real

---

### 5.3 Importante: `runNow` debe consultar estado real del worker

**Solución rápida:** `runNowIntervalTask` debe preguntar al worker vía `TasksInterval` si la tarea está en `running` Set.

```javascript
// En interval_tasks/index.js:350-352
const tasksInterval = params?.reply?.openfusionapi?.server?.TasksInterval;
const workerState = tasksInterval?.getWorkerRunningState?.(idtask);
// O exponer running Set vía mensaje al worker
```

**Solución robusta:** Unificar con lock BD (5.1) — `runNow` intenta tomar el lock igual que el worker.

---

### 5.4 Mejora: `reapStaleRunningTasks` debe también matar proceso hijo si existe

Si el endpoint se ejecuta en `worker_threads` (HIVE, SQL pesado), el reaper debería poder matar el thread. Hoy solo marca `TIMEOUT` en BD.

---

## 6. Matriz de riesgos y priorización

| Solución | Huecos que cierra | Complejidad | Riesgo regresión | Prioridad |
|----------|-------------------|-------------|------------------|-----------|
| Lock BD (`locked_until`) | 1, 2, 4 | Baja | Bajo | **P0 - Crítico** |
| Propagar abort a endpoint | 3 | Media-Alta | Medio | **P0 - Crítico** |
| `runNow` usa lock BD | 4 | Baja (si 5.1 hecho) | Bajo | **P1** |
| `reapStale` mata worker_threads | 3 (parcial) | Media | Medio | **P2** |

---

## 7. Plan de implementación sugerido

### Fase 1 (Inmediato - P0): Lock BD atómico
1. Añadir columna `locked_until` a `ofapi_intervaltask` (migration)
2. Modificar `updateIntervalTaskStatus(status=RUNNING)` para hacer `UPDATE ... WHERE locked_until IS NULL OR locked_until < NOW() RETURNING *`
3. Si `affectedRows === 0` → `canRun` devuelve `false` con `reason: "locked by another process"`
4. `reapStaleRunningTasks` limpia `locked_until` al liberar
5. `runNowIntervalTask` usa misma lógica de lock

### Fase 2 (Corto plazo - P0): Abort propagation
1. Worker genera `abortToken` por corrida, lo pasa en header `X-OFAPI-Abort-Token`
2. Crear endpoint interno `GET /system/interval-tasks/abort-check/:token` → 204 OK / 410 GONE
3. Handlers críticos (JS, SQL, HIVE, MONGO) consultan cada N filas/iteraciones
4. `stop_interval_task_run` marca token como abortado (BD o cache compartido)

### Fase 3 (Mediano - P1): `runNow` robusto
1. `runNowIntervalTask` intenta tomar lock BD (misma query que worker)
2. Si falla → 409 `TASK_RUNNING_ELSEWHERE` con info de quién la tiene

### Fase 4 (Opcional - P2): Limpieza de worker_threads huérfanos
1. `reapStaleRunningTasks` si detecta HIVE/SQL worker → intenta `worker.terminate()`

---

## 8. Referencias de código clave

| Archivo | Función/Línea | Qué hace |
|---------|---------------|----------|
| `src/lib/timer/worker.js` | `canRun()` (494) | Decide si lanzar tarea |
| `src/lib/timer/worker.js` | `runFetchTask()` (317) | Ejecuta fetch con timeout |
| `src/lib/timer/worker.js` | `reapStaleRunningTasks` (853) | Limpia tareas colgadas |
| `src/lib/timer/worker.js` | `runAbort` Map (49) | Controllers para abort selectivo |
| `src/lib/timer/tasks.js` | `abortRun()` (69) | API para parar corrida en vuelo |
| `src/lib/db/interval_task.js` | `updateIntervalTaskStatus` (786) | Transiciones de estado |
| `src/lib/db/interval_task.js` | `runNowIntervalTask` (944) | Forzar ejecución manual |
| `src/lib/db/interval_task.js` | `getIntervalTaskProcess` (458) | Carga tareas vencidas |
| `src/lib/handler/jsFunction.js` | `jsFunction()` (10) | Ejecuta handler JS |
| `src/lib/handler/fetchFunction.js` | `fetchFunction()` | Llama endpoint HTTP |
| `src/lib/server/createFunctionVM.js` | `createFunctionVM()` (9) | Sandbox JS con timeout propio |

---

## 9. Conclusión

**El problema T2 es real y tiene causa raíz clara:** la protección `allow_concurrent: false` es **solo local al worker y solo en memoria**, no sobrevive a:
- Múltiples instancias API
- Race conditions BD
- Timeouts que no matan el handler real
- Llamadas manuales `runNow`

**La solución mínima viable (Fase 1)** es un **lock atómico en BD** (`locked_until` + `UPDATE ... WHERE`) que cubra huecos 1, 2 y 4 de una vez. **La Fase 2 (propagación de abort)** es necesaria para cerrar el hueco 3 que ya causó incidentes reales.

---
*Documento generado tras análisis completo de `src/lib/timer/worker.js`, `src/lib/db/interval_task.js`, `src/lib/timer/tasks.js`, handlers y flujos de timeout.*

## 10. Estado de implementación (12/11/2026)

### ✅ Fase 1: Lock atómico en BD (COMPLETADA)
- **Columna `locked_until`** añadida a `ofapi_intervaltask` (model + migración automática via `ensureIntervalTaskColumns`)
- **`updateIntervalTaskStatus`** modificado: transición a RUNNING usa `UPDATE atómico con WHERE locked_until IS NULL OR locked_until < NOW()`
- **`canRun`** en worker verifica `locked_until` para fast-path
- **`runNowIntervalTask`** respeta lock distribuido (devuelve `TASK_LOCKED` si hay lock activo)
- **`reapStaleRunningTasks`** limpia `locked_until` al liberar tareas colgadas
- **`getIntervalTaskProcess`** y **`getNextIntervalTaskRun`** filtran por `locked_until` para no cargar/despertar por tareas bloqueadas

### ✅ Fase 2: Propagación de abort al endpoint (COMPLETADA - infraestructura)
- **Worker** genera `abortToken` (UUID) por corrida, lo pasa en header `X-OFAPI-Abort-Token`
- **Cache compartido** `globalThis.__ofapi_abort_token_cache` con TTL automático
- **`stop_interval_task_run`** marca token como abortado en cache
- **Endpoint interno** `GET /system/interval-tasks/abort-check/:token` (204 = OK, 410 = abortado)
- **VM JS** expone `$_ABORT_TOKEN_` y `$_ABORT_CHECK()` para que código usuario verifique aborto
- **`fetchFunction`** propaga header `X-OFAPI-Abort-Token` a llamadas salientes
- **`customFunction`** recibe `abortToken` en contexto de ejecución

### ✅ Fase 2: Propagación de abort al endpoint (COMPLETADA - infraestructura + handlers SQL/Mongo/Hive)
- **Worker** genera `abortToken` (UUID) por corrida, lo pasa en header `X-OFAPI-Abort-Token`
- **Cache compartido** `globalThis.__ofapi_abort_token_cache` (Map token → `{aborted, expires}`) con TTL automático
- **`stop_interval_task_run`** marca token como abortado en cache
- **Endpoint interno** `GET /system/interval-tasks/abort-check/:token` (204 = OK, 410 = abortado)
- **VM JS** expone `$_ABORT_TOKEN_` y `$_ABORT_CHECK()` para que código usuario verifique aborto
- **`fetchFunction`** propaga header `X-OFAPI-Abort-Token` a llamadas salientes
- **`customFunction`** recibe `abortToken` en contexto de ejecución
- **sqlHana** → `queryTimeout` en pool HANA (cancela query en BD)
- **ConnectionPool** (PostgreSQL, MySQL, SQLite, Oracle, MSSQL) → propaga `endpointTimeoutMs` a `dialectOptions` (`statement_timeout`, `busyTimeout`, `queryTimeout`, `requestTimeout`)
- **sqlFunctionInsertBulk** + **sqlFunction** → pasan `endpointTimeoutMs` al pool
- **mongoDB** → pasa `abortToken` a sandbox (`fnVars.abortToken`)
- **hiveDriver** + **hive-worker** → pasan `abortToken` a worker thread, chequeo cada 100 fetches

### ✅ Fase 3: Validación E2E (COMPLETADA)
Todas las pruebas pasan:
- `interval_task_upsert_test.js` (13 tests)
- `interval_task_batch_test.js` (5 tests)
- `interval_task_transition_test.js` (6 tests)
- `interval_task_response_outcome_test.js`
- `tasks_interval_supervisor_test.js`
- `delete_interval_task_ids_test.js` (8 tests)
- `endpoint_loader_vm_contract.js`
- `js_return_status_test.js`
- `db_concurrency_test.js`, `db_lock_retry_test.js`
- `log_buffer_test.js`
- `backup_restore_test.js` (incluye interval tasks con nueva columna `locked_until`)

### Archivos modificados
| Archivo | Cambios |
|---------|---------|
| `src/lib/db/models.js` | Columna `locked_until` en `IntervalTask` |
| `src/lib/db/ensureIntervalTaskColumns.js` | Migración automática de `locked_until` |
| `src/lib/db/interval_task.js` | Lock atómico en `updateIntervalTaskStatus`, `runNowIntervalTask`, `reapStaleRunningTasks`, filtros en `getIntervalTaskProcess` y `getNextIntervalTaskRun` |
| `src/lib/timer/worker.js` | `canRun` verifica lock, genera `abortToken`, cache compartido, propaga header |
| `src/lib/server/createFunctionVM.js` | Expone `$_ABORT_TOKEN_` y `$_ABORT_CHECK()` en sandbox |
| `src/lib/handler/jsFunction.js` | Pasa `abortToken` a VM |
| `src/lib/handler/fetchFunction.js` | Propaga header `X-OFAPI-Abort-Token` |
| `src/lib/handler/customFunction.js` | Pasa `abortToken` a función custom |
| `src/lib/handler/sqlHana.js` | `queryTimeout` en pool HANA, pasa `endpointTimeoutMs` |
| `src/lib/handler/ConnectionPool.js` | Propaga `endpointTimeoutMs` a `dialectOptions` (PG/MySQL/SQLite/Oracle/MSSQL) |
| `src/lib/handler/sqlFunctionInsertBulk.js` | Pasa `endpointTimeoutMs` al pool |
| `src/lib/handler/sqlFunction.js` | Pasa `endpointTimeoutMs` al pool + hint MySQL `MAX_EXECUTION_TIME` |
| `src/lib/handler/mongoDB.js` | Pasa `abortToken` a sandbox |
| `src/lib/handler/hiveDriver.js` | Pasa `abortToken` a worker thread |
| `src/lib/handler/hive-worker.js` | Recibe `abortToken`, chequeo cada 100 fetches |
| `src/lib/server/functions/system/prd/interval_tasks/index.js` | Endpoints `fnAbortCheck` + `fnAbortCacheStatus` |
| `src/lib/index.js` | Registra routes `/system/interval-tasks/abort-check/:token` y `/system/interval-tasks/abort-cache` |
| `src/docs/interval_tasks/AI_SKILL.md` | Documenta `TASK_LOCKED`, `$_ABORT_CHECK()`, lock distribuido |

### Qué cubre cada fase
| Hueco | Fase 1 (Lock BD) | Fase 2 (Abort propagation) | Fase 3 (Timeout BD) |
|-------|------------------|----------------------------|---------------------|
| **1. Solo local al worker** | ✅ `locked_until` en BD | | |
| **2. Race condition** | ✅ UPDATE atómico | | |
| **3. Timeout no mata handler** | | ✅ `abortToken` + handlers consultan | ✅ `queryTimeout`/`statement_timeout` en BD + hint MySQL |
| **4. `runNow` bypassa `running` Set** | ✅ Verifica `locked_until` | | |

### Próximos pasos opcionales (COMPLETADOS ✅)
1. ✅ **MySQL/MariaDB**: Hint `/*+ MAX_EXECUTION_TIME(...) */` en query para timeout nativo
2. ✅ **Documentación**: `AI_SKILL.md` actualizado con `TASK_LOCKED` y `$_ABORT_CHECK()`
3. ✅ **Métricas**: Endpoint `GET /system/interval-tasks/abort-cache` para monitorear cache de abort tokens