# Informe — Las tools MCP de tipo GET ignoran `attributes`

**Objeto:** verificar la novedad reportada «Las tools MCP de tipo GET ignoran `attributes`, y `apps_list` devuelve las `jwt_key`».
**Revisor:** agente (Big Pickle) sobre el repositorio local.
**Versión analizada:** `libOpenFusionAPI` 13.12.8 (`main`, commit `04dfe8a`).
**Fecha:** 2026-10-13.
**Método:** lectura de código + reproducción local (sin servidor) del camino `URLSearchParams` → `fast-querystring` → guarda de las funciones de DB.

---

## 1. Veredicto

**CONFIRMADO. La causa raíz es exacta y el impacto descrito es real, pero el alcance es más amplio de lo reportado.**

- Se confirma la cadena completa: una tool MCP `GET` recibe un array en `attributes`, `uFetch` lo serializa con `new URLSearchParams(...)` como texto separado por comas, Fastify lo entrega como *string* y las funciones de base de datos descartan el filtro porque solo lo aplican si es un array.
- Se confirma que `apps_list` devuelve columnas sensibles (`jwt_key`, `vars`, `params`) aunque se pida `attributes`.
- Se confirman las tres tools afectadas: `apps_list`, `read_endpoint_data` y `app_endpoints`.

**Corrección al alcance del hallazgo:** no es un problema «de MCP». Afecta a **cualquier `GET`** sobre esos endpoints, incluida una llamada HTTP directa (`?attributes=idapp,app`) o un `ofapi.get(...)` interno con `data: { attributes: [...] }`. La variante MCP solo lo hizo visible porque los agentes la usan.

**Observación aparte (logs del 3030):** **no verificable** desde el código. Requiere acceso al servidor. Ver §8.
**`idtask` como `integer`:** **confirmado como no-bug** de la librería. Ver §9.

---

## 2. Severidad

**Media-alta**, como reportó el autor. La descripción de la tool instruye al agente a usar `attributes` justamente para no recibir secretos; esa protección **no existe en la práctica**. El resultado es filtración de la `jwt_key` (clave de firma de tokens de la app), de `vars` / `params` y de AppVars expandidas hacia el contexto del agente y sus transcripciones.

Analogía de control: es un problema de *exposición de secreto por defecto* con un control de mitigación documentado que no funciona. El modo de falla es silencioso (no hay error ni warning), lo que lo hace peor: el cliente cree que pidió pocas columnas.

---

## 3. Cadena del defecto (con referencias al código)

### 3.1 El wrapper MCP manda los argumentos como `data` a `uFetch`

`src/lib/server/endpoint/handlerBuild/mcp.js:1351`:

```js
let request_endpoint = await uF[endpoint.method.toLowerCase()]({
  data: requestData,          // { attributes: ["idapp","app","enabled"] }
  headers: sanitizedHeaders,
});
```

Para `GET`, `uFetch` decide que `data` va en la query string.

### 3.2 uFetch serializa el array con `URLSearchParams`

`node_modules/@rdsslab/uFetch/src/fetch.js:590-606`:

```js
// GET / HEAD / DELETE → data como querystring
if (["GET", "HEAD", "DELETE"].includes(method) && data && typeof data === "object") {
  const sp = new URLSearchParams(data);
  const queryString = sp.toString();
  ...
}
```

`new URLSearchParams({ attributes: ["a","b"] })` no produce claves repetidas: convierte el array a `"a,b"`.

### 3.3 Fastify lo entrega como string

El parser por defecto de Fastify 5 (`fast-querystring`) no puede recomponer un array desde un valor entre comas: `request.query.attributes === "idapp,app,enabled"`.

### 3.4 El handler pasa el string tal cual, sin normalizar

`src/lib/server/functions/system/prd/app/index.js:40-41`:

```js
const attributes = params.request.query?.attributes || params.request.body?.attributes;
const apps = await getAllApps(attributes);
```

`src/lib/server/functions/system/prd/endpoint/index.js:302-304` y `318-320`: idéntico patrón para `getEndpointById` y `getEndpointByIdApp`.

### 3.5 La función de DB descarta el filtro si no es array

`src/lib/db/app.js:694`:

```js
if (attributes && Array.isArray(attributes) && attributes.length > 0) {
  options.attributes = attributes;
}
```

`src/lib/db/endpoint.js:460` (`getEndpointById`) y `:570` (`getEndpointByIdApp`): misma guarda.

Con `attributes` como string, la guarda es `false`, `options.attributes` nunca se fija, y `findAll`/`findByPk` devuelven **todas las columnas**. No hay error, ni warning, ni log.

---

## 4. Reproducción local (verificada en este repo)

Se reprodujo el camino exacto sin levantar servidor (`fast-querystring` es la dependencia que usa Fastify):

```
$ node --input-type=module -e "..."
querystring enviado : attributes=idapp%2Capp%2Cenabled
request.query       : {"attributes":"idapp,app,enabled"}
se aplica attributes: false -> findAll() sin filtro: todas las columnas, jwt_key incluida
```

Coincide byte a byte con la salida reportada por el autor contra 13.12.4.

**Verificación contra el servidor (MCP):** no ejecutada aquí (no hay instancia 3030/3033 en este entorno), pero el camino está cerrado de punta a punta por lectura de código; no hay ningún punto intermedio que normalice.

---

## 5. Herramientas afectadas (confirmado)

| Tool MCP | Endpoint | Handler → función DB | Guarda que descarta |
|---|---|---|---|
| `apps_list` | `GET /api/apps` | `fnGetApps` → `getAllApps` | `src/lib/db/app.js:694` |
| `read_endpoint_data` | `GET /api/endpoint` | `fnEndpointGetById` → `getEndpointById` | `src/lib/db/endpoint.js:460` |
| `app_endpoints` | `GET /api/endpoint/...` (por app) | `fnEndpointGetByIdApp` → `getEndpointByIdApp` | `src/lib/db/endpoint.js:570` |

Los tres publican `attributes` como `array` en su `json_schema.in` (seed en `src/lib/db/default/system.js`, líneas 13071, 5664 y 7613), y `apps_list` documenta explícitamente el control que no funciona:

> «Be aware the response includes each application's signing key (`jwt_key`), so treat it as sensitive and request `attributes` when you do not need it.»

El propio seed guarda como ejemplo de respuesta un `data_test` con `jwt_key` de `system`, `demo`, etc. (línea 11192), prueba de que la fila completa es lo que sale por defecto.

---

## 6. Causa raíz

Dos supuestos incompatibles entre capas:

1. **La capa MCP/handler asume que `attributes` puede llegar como array**, porque el `json_schema` lo declara array y el cliente MCP lo envía como array.
2. **La capa HTTP/DB asume que `attributes` es un array solo si el transporte preservó esa forma.** En GET no lo hace: `URLSearchParams` colapsa a string y Fastify no recompone.

La guarda `Array.isArray(attributes)` está escrita defensivamente (evita pasar un string a Sequelize), pero al no existir una normalización en el borde, el efecto neto es *ignorar silenciosamente* un filtro de seguridad en lugar de aplicarlo o rechazarlo.

**Detalle adicional:** esto vale igual para `HEAD` y `DELETE` en uFetch (§3.2), pero no hay endpoints relevantes con `attributes` por esos verbos.

---

## 7. Corrección propuesta

### Recomendada — normalizar en la capa de DB (aceptar array *o* string)

Un único helper compartido, aplicado en `getAllApps` / `getEndpointById` / `getEndpointByIdApp`, es la corrección más robusta: cubre MCP, HTTP directo y llamadas `ofapi.get` internas, y deja la firma retrocompatible (array sigue funcionando).

```js
// p.ej. src/lib/db/utils.js
export const toAttributeList = (v) => {
  if (Array.isArray(v)) {
    const list = v.map((s) => String(s).trim()).filter(Boolean);
    return list.length > 0 ? list : null;
  }
  if (typeof v === "string" && v.trim()) {
    const list = v.split(",").map((s) => s.trim()).filter(Boolean);
    return list.length > 0 ? list : null;
  }
  return null;
};
```

Y reemplazar la guarda por:

```js
const list = toAttributeList(attributes);
if (list) options.attributes = list;
```

Consideraciones:
- Es seguro dividir por comas: ningún nombre de columna contiene comas.
- Al pasar ahora el filtro, hay que decidir qué hacer con un nombre de columna inexistente. Hoy (al ignorarse) no falla; con el fix, Sequelize puede lanzar. Conviene validar contra la lista de atributos del modelo o degradar a `null` + warning, para no convertir un no-op silencioso en un 500.
- Alternativa acotada al handler (normalizar en `fnGetApps` / `fnEndpointGetById` / `fnEndpointGetByIdApp`): resuelve el caso MCP y el HTTP directo, pero deja otros llamadores internos expuestos. Preferible la de DB.

### Descartadas / a valorar

- **Que `uFetch` serialice arrays como claves repetidas** (`attributes=a&attributes=b`): es un cambio en una dependencia externa (`@rdsslab/uFetch`) con radio de impacto enorme (todas las tools GET de todas las apps, y cualquier consumo actual del formato comas). Mayor riesgo que beneficio para este caso.
- **Que el wrapper MCP codifique en JSON los argumentos no escalares en GET**: cambia el contrato de cable y obliga a `JSON.parse` en los handlers. Peor que normalizar en un solo punto.

### Prueba recomendada

Añadir a `dev/test/` una prueba que (a) llame a `getAllApps("idapp,app,enabled")` y a `getAllApps(["idapp","app","enabled"])` y compruebe el mismo conjunto de columnas, y (b) una de integración que invoque `apps_list` pasando `attributes` a través del wrapper y verifique que la respuesta **no** contiene `jwt_key`. La segunda es la que el autor sugiere y es la que impide la regresión real.

---

## 8. Observación aparte: el 3030 no devolvió logs — NO VERIFICABLE aquí

No se puede confirmar ni descartar desde el repositorio: depende de la configuración de esa instancia y de sus datos. Puntos concretos a revisar por quien tenga acceso:

1. **Escritura de logs.** `createLog` / `createLogEntriesBulk` (`src/lib/db/log.js:61,70`) escriben en `LogEntry` (`ofapi_log`). Si esa instancia no tiene la tabla o fallan los inserts, se registra `Error performing INSERT log` en consola, no en la tabla. Revisar consola del proceso.
2. **Nivel por endpoint (`ctrl.log`).** El `ctrl.log` del endpoint decide qué ejecuciones se persisten (`status_info`, `status_success`, `status_redirect`, `status_client_error`, `status_server_error`; 0 = deshabilitado). Un endpoint `oms` configurado para no registrar `status_client_error`/`status_server_error` explicaría que un `5xx` no aparezca. Ver el `ctrl.log` del endpoint `/api/oms/events/receiver`.
3. **Filtros de `get_system_logs`.** Que `last_hours: 6` y la ventana 08:39–08:41 UTC devolvieran `[]` con otras ejecuciones reales en ese rango apunta a un desajuste de filtro/ventana (por ejemplo, diferencias de zona horaria en `start_date`/`end_date`). Valdría una prueba directa sobre la tabla `ofapi_log` en esa instancia para separar «no se escribió» de «no se encontró».
4. **Tarea en `oms`.** Confirmar si el endpoint de esa tarea escribe `log` a nivel de endpoint o si su `ctrl` lo silencia; el historial de runs (`ofapi_intervaltask_run`, que sí registró 502) no es el mismo almacén que `ofapi_log`.

Conclusión: sin acceso a la instancia es una pregunta abierta, no un bug de librería demostrable. Queda como pendiente de diagnóstico en el servidor.

---

## 9. `idtask` como `integer` — confirmado como no-bug

Se verificó el seed vigente: `upsert_interval_task` (`system.js:7195`), `run_interval_task_now` (`:14315`), `reset_interval_task_attempts` (`:14421`) y `stop_interval_task_run` (`:14527`) declaran `idtask` como `"type": "string", "format": "uuid"`.

El esquema `integer` que veía el cliente corresponde a un `tools/list` cacheado de una versión anterior (pre-13.11.30, `656addf`). **No hay defecto en la librería**; se resuelve reconectando el MCP para refrescar la lista de tools. Se confirma el descarte del autor.

---

## 10. Implementación aplicada (2026-10-13)

Se implementó la corrección recomendada (§7), con el endurecimiento previsto para nombres de columna desconocidos.

### 10.1 Helper compartido

`src/lib/db/utils.js` — dos funciones puras, sin dependencias nuevas:

- `toAttributeList(value)` → normaliza `array` **o** `string` CSV a `string[]` (trim, descarta vacíos) y devuelve `null` si no hay filtro. Con esto, `"idapp,app"` y `["idapp","app"]` producen exactamente la misma lista.
- `applyAttributesToOptions(options, value, model)` → fija `options.attributes` a partir de `toAttributeList`, **filtrando contra `model.rawAttributes`**. Un nombre inexistente no llega a Sequelize (evita convertir un filtro mal escrito en un 500); se descarta con un `console.warn`. Si no queda ningún nombre válido, se devuelve la fila completa, que es el comportamiento histórico.

### 10.2 Puntos de uso

| Archivo | Función | Antes | Ahora |
|---|---|---|---|
| `src/lib/db/app.js` | `getAllApps` | `if (attributes && Array.isArray(...))` | `applyAttributesToOptions({}, attributes, Application)` |
| `src/lib/db/endpoint.js` | `getEndpointById` | idem (guarda `Array.isArray`) | `applyAttributesToOptions({}, attributes, Endpoint)` |
| `src/lib/db/endpoint.js` | `getEndpointByIdApp` | idem | `applyAttributesToOptions({ where }, attributes, Endpoint)` |

No hizo falta tocar handlers ni el wrapper MCP: la firma sigue aceptando `array` (retrocompatible) y ahora también el `string` que produce la query string. De paso se corrigió el mensaje de error de `getEndpointById`, que decía `"Error retrieving user"`.

### 10.3 Prueba de regresión

Nueva suite `dev/test/get_attributes_filter_test.js`, registrada en `dev/test/index.js`. Fuerza una SQLite temporal propia (no toca la del packet ni la del servidor de desarrollo) y cubre:

1. `toAttributeList`: array y CSV → misma lista; entradas sin filtro → `null`; huecos vacíos descartados.
2. `applyAttributesToOptions`: fija `attributes`; descarta columnas inexistentes; solo-inexistentes → fila completa.
3. Las tres funciones reales de DB: con CSV y con array, la respuesta **no** trae `jwt_key` / `code`; sin filtro sí las trae.
4. Guarda de fuente: las tres funciones usan el helper y ninguna readoptó `Array.isArray(attributes)`.

Resultado: **11/11 en verde** (`node dev/test/get_attributes_filter_test.js`).

---

## 11. Revisión del proyecto hermano `libOpenFusionAPIGUI`

**Conclusión: el defecto de `attributes` NO existe en el GUI, y no hay nada que corregir allí *por este bug*.**

- Es un cliente SvelteKit puro: una sola ruta (`src/routes/+page.svelte`) y componentes; no contiene código servidor ni de base de datos.
- No usa `attributes` en ningún punto de `src/` (búsqueda sin coincidencias). Todas las llamadas GET que revisa la novedad (`apps_list`, `endpoint`, `app/endpoints`) se hacen sin `attributes`.
- `getListApps` (`Application/utils/request.js:688`) pide `apps_list` sin `attributes` y recibe `jwt_key` **a propósito**: es el panel de administración y `widgets/basic/basic.svelte` muestra/genera esa clave para la app. No es una fuga: no hay control que se esté ignorando.
- Depende de `@rdsslab/uFetch` 5.2.0, la misma versión que el servidor; no lleva ninguna copia de `libOpenFusionAPI`.

### 11.1 Hallazgo relacionado (misma causa raíz, distinto endpoint)

La misma serialización de uFetch (§3.2) sí produce un defecto **visible en el GUI**, aunque ajeno a `attributes`:

- `widgets/interval_tasks/index.svelte:453` (y un duplicado en `widgets/apikeys/index.svelte:286`) hace `uF.DELETE({ url: deleteIntervalTasksByIdTask, data: idtasks })` con `idtasks` como **array**.
- uFetch solo enruta el body a la query string y colapsa el array: `idtask=a%2Cb`.
- El servidor lo lee tal cual (`src/lib/server/functions/system/prd/interval_tasks/index.js:340`) y `deleteIntervalTask` (`src/lib/db/interval_task.js:559`) hace `where: { idtask: idtaskList }`; con `"a,b"` no casa ninguna fila.

Efecto: **borrar varias tareas a la vez no borra nada** y no da error (el GUI ignora el booleano y recarga). Con un solo id sí funciona, porque `String(["uuid"])` coincide con el uuid.

Medio de corrección: normalizar el CSV en el servidor, igual que con `attributes`. **Implementado** (2026-10-13):

- `src/lib/db/utils.js` — el normalizador genérico se extrae a `toStringList`; `toAttributeList` pasa a ser un alias suyo.
- `src/lib/db/interval_task.js` — `deleteIntervalTask` normaliza con `toStringList` y filtra con `esUUIDTask` (un id que no sea UUID no llega a la columna, evitando el 22P02 de PostgreSQL); lista vacía → `false` sin tocar la tabla. Además se corrigió el mensaje de error, que decía `"Error deleting idendpoint"`.
- `src/lib/server/functions/system/prd/interval_tasks/index.js` — `fndeleteIntervalTask` normaliza el crudo a lista antes de la auditoría, de modo que un CSV ya no se registra como `entity_id: "a,b"`; un solo id conserva su `entity_id`.
- Prueba `dev/test/delete_interval_task_ids_test.js` (registrada en `dev/test/index.js`, **8/8 en verde**): CSV y array borran igual, id suelto, ids no-UUID descartados, y lista vacía/no válida no borra nada.

Esto arregla a la vez el GUI y la tool MCP `delete_interval_task` cuando recibe un array, que sufría exactamente lo mismo por ser `DELETE`. Las llamadas con array por `POST` (`clearCache`, `getAppDocumentation`, `migrateEndpoints`) están bien: uFetch conserva el body.

---

## 12. Anexo — evidencia mínima

- `src/lib/server/endpoint/handlerBuild/mcp.js:1351` — paso de `data` a uFetch en GET.
- `node_modules/@rdsslab/uFetch/src/fetch.js:590-606` — `new URLSearchParams(data)` para GET/HEAD/DELETE.
- `src/lib/server/functions/system/prd/app/index.js:40` — `attributes` sin normalizar.
- `src/lib/server/functions/system/prd/endpoint/index.js:302,318` — idem.
- `src/lib/db/app.js:694`, `src/lib/db/endpoint.js:460,570` — guarda `Array.isArray` (ya sustituida por el helper).
- `src/lib/db/default/system.js:13050-13080` — `apps_list`: descripción del control y schema de `attributes`.
- `dev/test/get_attributes_filter_test.js` — prueba de regresión de `attributes` (11 asserts en verde).
- `src/lib/db/interval_task.js:568` y `src/lib/server/functions/system/prd/interval_tasks/index.js:347` — normalización del borrado en lote.
- `dev/test/delete_interval_task_ids_test.js` — prueba de regresión del borrado en lote (8 asserts en verde).
- Salida de la reproducción local (comandos en §4).
