# Changelog

Cambios de comportamiento de OpenFusion API entre versiones.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
versionado es [SemVer](https://semver.org/lang/es/).

Cada cambio va a la audiencia que puede actuar sobre él:

| Audiencia | Qué le importa de aquí |
|---|---|
| **Cliente que llama a un endpoint** | Solo `Breaking`. |
| **Autor de endpoints** (humano o agente) | `Added` y `Changed`: capacidades y restricciones nuevas. Detalle en el `AI_SKILL.md` del handler y en su `manifest.json`. |
| **Operador** | Variables de entorno, logs y migraciones de esquema. Detalle en `README.md` y `env.example`. |

Para consultas sobre versiones anteriores o migraciones antiguas de la estructura del
proyecto, ver [MIGRATION.md](./MIGRATION.md).

---

## [13.11.0] - 2026-09-25

Revisión de hallazgos sobre la versión 13.10.0: once hallazgos verificados contra
el código, dos de ellos con cambio de comportamiento observable y uno refutado
durante la propia revisión.

### Breaking

#### `run_interval_task_now` responde 409 en una tarea deshabilitada

**Antes:** devolvía `{ success: true, message: "La tarea se ejecutará en el próximo ciclo." }`.
Pero el planificador solo recoge tareas con `enabled: true`, así que la tarea **no se
ejecutaba nunca**. Era un éxito falso: sin error, sin excepción y sin entrada de log. Además
reseteaba `failed_attempts` a 0, con lo que la tarea parecía en buen estado.

**Ahora:** responde `409` con `reason: "TASK_DISABLED"` y un mensaje que indica cómo
habilitarla. La tarea no se toca.

**Acción:** si usabas run-now como forma de reintentar una tarea auto-deshabilitada, ahora
recibes 409 en vez de un éxito que no ocurriera. Habilítala antes con
`upsert_interval_task` (`enabled: true`) y trata el `409` como respuesta esperada.

#### La clave de caché de conexiones cubre ahora todas las `options`

**Antes:** la clave se armaba a mano con `host`, `port`, `dialect`, `dialectOptions`, `pool`
y `ssl`. Quedaban fuera opciones que **sí cambian a qué servidor se conecta**, y el síntoma no
era un error sino una respuesta distinta de la esperada.

El caso más grave es SQLite: ahí `database` es solo una etiqueta y el archivo real es
`options.storage`. Dos endpoints con el mismo `database` y distinto `storage` generaban la
misma clave, así que el segundo reutilizaba la conexión del primero y **leía la base
equivocada sin decir nada**. También quedaban fuera el socket unix de MySQL (`path` /
`socketPath`), el `search_path` de PostgreSQL (`schema`) y `timezone`, que es estado de sesión.

**Ahora:** la clave se serializa canónica sobre todo el objeto `options`, con las claves
ordenadas, de modo que dos escrituras de la misma configuración dan la misma clave.

**Acción, dos efectos que conviene revisar antes de actualizar:**

1. Los endpoints SQLite multi-tenant que cambian `options.storage` desde el body **empiezan a
   leer la base que pedían**. Si venía leyendo datos de otra base, la respuesta va a cambiar. No
   es una regresión: es que el bug estaba ahí. Pero conviene auditar qué base estaba sirviendo
   cada endpoint antes de confiar en la nueva.
2. Dos endpoints que solo se diferenciaban en una opción que la clave antigua ignoraba **ya no
   comparten conexión**, así que ocupan una entrada propia del pool. Con el límite por defecto
   de 50, vigila el aviso `[ConnectionPool] Pool at capacity` si tienes muchos endpoints
   sobre la misma base. El límite es configurable con `OFAPI_SQL_POOL_MAX_CONNECTIONS`.

### Added

#### `$_RETURN_STATUS_` en los handlers JS y MONGODB

El camino de éxito solo podía responder `200`. Ahora se puede asignar un entero entre **200 y
399** a `$_RETURN_STATUS_` para responder con otro código. El body sigue yendo en
`$_RETURN_DATA_`; lo único que cambia es el status.

- Asigna un **número**. `"201"` se rechaza y cae a 200 con un aviso en el log: una cadena que
  un `Number()` convertiría en silencio escondería el error en lugar de señalarlo.
- **4xx y 5xx no se aceptan aquí.** Los errores se levantan con `$_EXCEPTION_`, que es la vía
  que construye el cuerpo de error estándar con su `trace_id`. Un valor fuera de rango degrada
  a **200**, no a 500, y avisa por log: el endpoint produjo datos válidos y quien llama no debe
  pagar por un número mal escrito.
- **204 y 304 no envían body**, porque el protocolo no lo permite.
- El status **sobrevive a la caché de respuestas**: un endpoint que respondió 203 responde 203
  también desde caché.
- Un 3xx sin cabecera `Location` avisa por log. Se envía igualmente.

Disponible en JS y MONGODB, que comparten sandbox. En bots no aplica: no hay respuesta HTTP.

#### `connection_override_allow` para acotar el override de conexión

Un llamante puede reemplazar parte de la conexión almacenada enviando `connection` en el body.
Seguirá funcionando **sin restricción por defecto**, que es deliberado: la capacidad es más
antigua que esta opción y apagarla rompería los endpoints multi-tenant que la usan.

`connection_override_allow` en la config del endpoint acota qué rutas puede cambiar el body
(`"database"`, `"options.host"`, `"options.storage"`). Nombrar un padre abre todo lo que cuelga
de él. **Solo puede estrechar, nunca ampliar**: la lista efectiva es la intersección con el
techo del handler, así que un body que se declare su propia allowlist no puede pasar de ese
techo. Aplica a los tres handlers SQL; HANA conserva además su techo de credenciales.

**Acción:** opcional. Sin el campo no cambia nada. Úsalo sobre todo en endpoints SQL
**públicos** (`access: 0`), donde hoy cualquier llamante puede redirigir la consulta del
endpoint a otro servidor o, con SQLite, a otro archivo en disco.

#### Registro del uso del override de conexión

Cada uso se escribe en la **consola del proceso** con el endpoint, el entorno y **qué rutas
cambiaron, nunca sus valores**: un valor puede ser una contraseña o una ruta interna, y el log
no es el sitio para copiarlos. Un descarte se registra con `warn`, y una aplicación esperada con
`info`.

Va a la consola y no a `ofapi_log` a propósito: esa tabla registra peticiones y alimenta los
gráficos de tráfico, y una fila que no es una petición los deformaría. Si algún día hace falta
un histórico consultable, lo que corresponde es una tabla dedicada, igual que los bots usan
`ofapi_bot_log`.

#### `OFAPI_SQL_POOL_MAX_CONNECTIONS`

Límite de conexiones del pool de SQL. Por defecto 50, tope duro 500. Antes el 50 estaba fijo en
el código y no había forma de cambiarlo sin recompilar.

#### `DB_CONNECTION_LIMIT_REACHED`

Todo error de apertura de conexión se reportaba como `Cannot authenticate connection to
database: <mensaje del driver>`. Eso convertía «too many clients already» —que no tiene nada que
ver con credenciales— en un «Cannot authenticate», y el diagnóstico que seguía era que el
password estaba mal. Ahora se distinguen el agotamiento de conexiones de los fallos de
autenticación, con su propio código.

Cuando el pool llega al límite, se registra `[ConnectionPool] Pool at capacity` con el consejo
accionable, en lugar de expulsar entradas en silencio.

#### Aviso de incoherencia entre los dos relojes de una tarea

Una tarea tiene su propio timeout y el endpoint que ejecuta tiene otro, y solo uno de los dos
gobierna. `upsert_interval_task` devuelve ahora un aviso cuando no coinciden, porque esa
desalineación produce síntomas que parecen bugs de la tarea y no lo son.

#### `parse_bigint` en los handlers SQL

`pg` devuelve `int8`/`bigint` como string para no perder precisión. Con `"parse_bigint": true`
en la config del endpoint, los valores que caben en `Number.MAX_SAFE_INTEGER` llegan como
número y el resto sigue siendo string. Numéricos y decimales nunca se convierten.

Es opt-in porque el comportamiento por defecto de `pg` es el correcto. La opción está en el
manifiesto y en el `AI_SKILL.md` del handler SQL.

### Changed

#### La detección de placeholders ya no confunde un cast `::` con un parámetro

La detección era un único test de `/:[a-zA-Z_][a-zA-Z0-9_]*/` sobre la consulta. En una query de
PostgreSQL con un cast, `SELECT $1::text AS v`, el `:text` del cast hacía que la consulta se
clasificara como estilo *replacements*, y el `$1` **no llegaba a sustituirse nunca**. Esos
endpoints estaban rotos.

Ahora un escáner distingue ambos estilos correctamente.

**Acción:** un endpoint que creías roto puede empezar a devolver datos. No es una regresión: es
que el fallo estaba ahí. Conviene revisarlo, porque una respuesta que aparece donde antes había
un error se lee al revés si nadie lo explica.

Como efecto secundario, en el camino de *bind* los parámetros omitidos se rellenan ahora con
cadena vacía, igual que ya se hacía en el camino de *replacements*.

#### `max_failed_attempts: 0` significa ahora «nunca deshabilitar»

**Antes:** `0` no significaba nada y el valor caía al tope por defecto de 10, así que una tarea
con `0` se deshabilitaba igual tras 10 fallos. Era una lectura casi seguro no intencionada.

**Ahora:** `0` significa explícitamente nunca deshabilitar. Cualquier otro valor positivo se
respeta, y si la tarea no define el campo el tope sigue siendo 10.

#### `backoff_enabled` y `max_backoff_seconds`

El backoff ya existía como tope global fijo de 1 hora y no se podía desactivar. Ahora
`backoff_enabled` lo controla y `max_backoff_seconds` sustituye a la constante cuando está
definido. **`backoff_enabled` vale `true` por defecto**, que conserva el comportamiento previo:
una tarea existente no cambia.

Sirve para el chequeo de monitoreo, que es contraproducente ralentizar justo cuando el sistema
observado está fallando. La columna nueva es idempotente y se aplica al arrancar.

#### MONGODB honra `$_RETURN_STATUS_`

MONGODB corre el mismo sandbox que el handler JS, así que la variable llegaba igual y se ignoraba
en silencio. Ahora aplica las mismas reglas. Ignorarla obligaba a los dos handlers a documentar
cosas distintas para la misma variable.

#### `environment` en los atributos ligeros del log

`getLogs` sin `environment` devolvía un conjunto más amplio, nunca más restringido, y la capa MCP
no inyecta el filtro. Añadirlo a los atributos ligeros hace que el filtro se aplique también en
la vía rápida, sin cambiar el resultado.

---

## [13.11.1] - 2026-09-25

Auditoría de la documentación que consume un agente —descripciones MCP, `AI_SKILL.md`,
`manifest.json`, README— contrastada contra el código, más los arreglos de comportamiento que esa
contradicción destapó. El motivo de fondo es que la documentación describía *el comportamiento que el
código tenía cuando se escribió*, y un agente que la lee y luego llama a la herramienta no tiene
forma de saber cuál de las dos es la verdad.

### Fixed

#### Dos opciones que se aceptaban y no hacían nada

`ignoreDuplicates` en `SQL_BULK_I` se leía de `custom_data`, se pasaba a `bulkInsert()`... y nunca se
asignaba. Llegaba siempre como `undefined`, así que la opción llevaba desde su introducción sin
efecto. Ahora se lee y se normaliza: solo el booleano `true` o la cadena `"true"` la activan, para
que un `true` escrito como texto no se comporte distinto a un `true` de verdad.

Esto es un cambio de comportamiento deliberado: un endpoint que ya tuviera la clave puesta empieza a
respetarla al actualizar, y un lote que antes fallaba por una clave duplicada ahora se inserta a
medias. **No hay aviso en tiempo de ejecución**, porque no hay forma de saber si quien configuró la
clave quería ese comportamiento o la puso esperando que hiciese algo.

La opción tampoco es universal. Sequelize la traduce a lo que cada motor escribe, y solo cuatro de
los cinco dialectos que documenta el proyecto lo implementan:

| `options.dialect` | SQL emitida | ¿Funciona? |
|---|---|---|
| `sqlite` | `INSERT OR IGNORE` | sí |
| `postgres` | `ON CONFLICT DO NOTHING` | sí |
| `mysql` / `mariadb` | `INSERT IGNORE` | sí |
| `mssql` | — | **no** |

En `mssql` la opción sigue sin hacer nada, y una clave duplicada sigue tumbando el lote sin ningún
error que lo diga. Si necesitas saltarte duplicados en SQL Server, filtra las filas antes de
enviarlas. Queda documentado en la skill y en el manifest; no se ha añadido un aviso en runtime
porque sería una función nueva y no una corrección.

#### El worker de interval tasks fallaba con un `TypeError` en vez de un motivo

`worker.js` despachaba la petición con `uF[task.method.toLowerCase()]`, y el cliente saliente
implementa `GET`, `POST`, `PUT`, `PATCH`, `DELETE` y `QUERY`: no tiene `head` ni `options`. Como
`endpoint_upsert` **sí** admite un endpoint `HEAD` o `OPTIONS`, una interval task podía apuntar a
uno, y entonces cada corrida terminaba en `uF[task.method.toLowerCase()] is not a function` —un
mensaje que no dice qué está mal ni qué verbos sí valen— y la acababa auto-deshabilitando.

Ahora el verbo se comprueba antes de la llamada y el motivo enumera los válidos. La ejecución se
sigue registrando como error y el auto-deshabilitado por fallos consecutivos no cambia: lo que
cambia es que el motivo sea accionable.

#### La tool que promete una versión no la daba

`get_libopenfusionapi_latest_version` no consultaba ninguna versión. Los metadatos MCP estaban
montados sobre el **único** endpoint en `/database/hooks`, cuyo `code` es
`ofapi.server.checkwebHookDB(request)`: mete el body en la invalidación de caché y en un
broadcast websocket, y no devuelve cuerpo. Un agente que la llamara recibía un resultado vacío y,
de paso, un efecto lateral que no había pedido.

La implementación que sí funciona estaba al lado, en `/libopenfusionapi/version/last`: consulta
GitHub, nunca falla (si GitHub no responde devuelve 200 con el último valor cacheado, marcado
`stale`) y guarda el resultado en una AppVar. Estaba con `mcp.enabled: false`, así que ningún
agente podía leerla. **El frontend sí la veía actualizada porque consume ese resource por HTTP**,
que es lo que hacía que a simple vista todo pareciera en orden: la función estaba viva, el nombre
que la prometía no.

Los metadatos se han movido al endpoint correcto. Tres cosas más corrigen el traslado, y ninguna es
adorno:

- `operation_mode` deja de ser `read`. La implementación real mintea un token de sistema y hace
  `upsert` de una AppVar, o sea que **escribe**. Declararla de solo lectura habría sido la misma
  mentira que se acababa de corregir en otras tres herramientas. Como el proyecto exige el prefijo
  `WRITE OPERATION:` para las tools de escritura, la descripción ahora lo lleva.
- `side_effects` nombra la AppVar que la llamada modifica, para que el agente sepa que usarla
  para «saber la versión» cambia estado global.
- Se habilita `json_schema.in`, que estaba a `false` y hacía que MCP publicase un inputSchema
  vacío. La tool no admite parámetros, así que toma la forma de las de su clase.

El receptor de hooks conserva su endpoint y su descripción, y simplemente deja de publicado como
tool.

#### La contraseña de cada cliente API se mandaba a un correo personal

`apiclient_create` enviaba la contraseña **en claro** a `edwinspire@gmail.com`, una dirección
personal fija en el código, en cada alta de cliente y con independencia del email del cliente. Es
decir: la credencial de creación de todos los clientes API de una instalación acababa en el buzón de
quien mantiene el proyecto.

Y el envío se hacía **después** de crear la fila, sin protección: si fallaba, la excepción subía y
la tool devolvía 500 con el cliente ya creado. Quien reintentara creaba un segundo cliente con otra
contraseña, y el primero quedaba existiendo sin que nadie lo supiera. El propio código lo
sabía —había un `// TODO: Si falla el envio al correo guardar en log` sin hacer.

Ahora el correo va al `email` del propio cliente, y su fallo ya no tumba la llamada: se registra
en el log y la respuesta lleva un `warning` que explica que el correo no salió y que la contraseña
del cuerpo es la única copia. La ruta de éxito es idéntica byte a byte, así que nada que leiera la
respuesta antes se entera.

#### `apiclient_create`: el username no toma «el prefijo del email»

El esquema decía *"Username. Defaults to the email prefix if omitted"*. El hook `beforeValidate` de
ApiClient asigna `instance.username = instance.email`: el email **entero**. Quien diseñara un
esquema de nombres contando con el prefijo acaba con `ana@acme.com` donde esperaba `ana`.

#### `audit_log_search`: el filtro `idclient` no filtraba

El filtro venía documentado en la prosa y en el esquema, y `idclient` aparecía en el archivo
—pero solo en la lista de `attributes`, que es la proyección. Nunca llegaba al `where`. Pedir
"qué hizo el cliente API X" devolvía **todas** las filas, con la columna `idclient` a la vista,
que es exactamente lo que hace que un filtro roto parezca funcionar. En una herramienta de
auditoría de seguridad no es cosmético.

Ahora el filtro se aplica. El test nuevo no se limita a comprobar esa línea: recorre todos los
filtros que el esquema declara y exige que cada uno tenga su construcción en el `where`, con
`from`/`to` por su camino propio (`dateFilter` sobre `where.timestamp`), para que el
siguiente filtro decorativo falle en el test y no en producción.

De paso, la prosa describía una lista plana cuando `getAuditLogs` devuelve un sobre
`{ rows, total, offset, limit }`, y se saltaba el filtro `actor_kind`. Como el `out` schema
está deshabilitado, nada más lo decía.

#### `user_create`: el schema decía que sin password la cuenta no puede entrar

`"If omitted, login is disabled"`. Es falso, y falso en la dirección peligrosa: `createUser`
genera una contraseña aleatoria, la guarda **hasheada** y la devuelve una sola vez en
`temporaryPassword`. La cuenta sí inicia sesión con ella. Un administrador que creara un
usuario confiando en el schema dejaría una credencial activa, y además sería la primera vez que
la ve.

#### `execute_endpoint_test`: la prosa daba 10 minutos de default donde hay 5

Decía `default 600000 ms / 10 minutes`, pero 600000 es el **máximo**: el default real es 300000
(5 minutos), tanto en el esquema como en el código. No es cosmético en el caso que la propia
descripción advierte: un test legítimo de `prd` que tarde entre 5 y 10 minutos se aborta a los
5 con HTTP 504, con escrituras reales a medias y sin rollback, que es justo lo que esa prosa
promete no dejar pasar.

#### `agent_onboarding`: el `outputSchema` declaraba cinco enlaces que no llegaban

Declaraba 18 claves en `links` y el código devolvía 13. Tres eran herramientas **reales y
publicadas** que el onboarding simplemente se había olvidado enlazar (`endpoint_migrate`,
`appvar_migrate`, `audit_log_search`); dos no existían en ninguna parte (`mcp_readme`,
`mcp_skill`). Las tres primeras están enlazadas ya —lo que además convierte en cierta la promesa
de la descripción sobre promover endpoints y appvars entre entornos, que hasta ahora no tenía
respuesta—, y las dos inventadas se han quitado del esquema, porque un esquema que declara campos
que nunca llegan hace que un cliente los espere para siempre.

El test comprueba la coherencia en las dos direcciones: ninguna clave declarada sin devolver, y
ninguna devuelta sin declarar.

#### Las skills mandaban crear endpoints por herramientas que ya no existen

Siete `AI_SKILL.md` de handlers y el reporte de arquitectura de la documentación recomendaban usar
`upsert_<handler>_endpoint_handler`. Esas ocho herramientas se retiraron del MCP el 2026-08-08 por
redundantes con `endpoint_upsert`, y su propia descripción lo dice: *"Agents must call
'endpoint_upsert' with handler=JS directly"*. Ningún agente podía llamarlas: no están en el
catálogo MCP, así que la sección "Common Payload Shape for Creation/Updates" describía un payload
que no había por dónde enviar. Las skills describen ahora `endpoint_upsert` con el `handler` que
corresponda, y los nombres de campo que indicaban (`js_code`, `target_url`, `mongo_config`,
`table_name`, `text_content`, `hana_code`, `soap_config`) son ahora los reales (`code` y
`custom_data`).

Los tres README que citaban `upsert_app`, `upsert_endpoint` y `upsert_appvar` usaban la convención
de nombres anterior a la vigente: los reales son `app_create_update`, `endpoint_upsert` y
`appvar_upsert`.

#### `custom_data.config` no existe en HANA ni en SQL_BULK_I

Las skills de ambos handlers indicaban anidar la conexión un nivel más de lo que se hace. El campo
`custom_data` **es** el objeto de configuración; una clave `config` anidada se ignoraba y el
endpoint no lograba conectarse. En SQL la misma skill ya decía `custom_data` plano, así que el
documento se contradecía a sí mismo.

#### La clave del override de conexión no es la misma en los tres handlers SQL

`SQL` lee `connection`; `SQL_BULK_I` y `HANA` leen `config`. La skill de SQL afirmaba que la
funcionalidad aplicaba a los tres usando `connection`, de modo que un endpoint bulk o HANA recibía
la clave equivocada, la ignoraba **en silencio** y respondía desde la base configurada en lugar de
la solicitada. Ahora cada skill indica su clave y advierte del silencio.

#### El override no se limitaba a `database` y `password`

La skill de SQL describía `connection_override_allow` como si restrictivo. Sin él —el
comportamiento por defecto, pensado para endpoints multi-tenant— el cuerpo también puede cambiar
`options.host`, `options.port`, `options.dialect` y `options.storage`, es decir, redirigir la
consulta a otro servidor o a otro archivo SQLite. Documentado en los tres handlers SQL.

#### Afirmaciones que el código contradecía

- `{"headers": {...}}` sin `data` se describía como una trampa que descartaba los headers. El
  worker los aplica correctamente; solo un objeto sin `data` **ni** `headers` se envía entero como
  payload. Corregido en la skill y en la descripción de `params` de `upsert_interval_task`.
- El manifest de SOAP decía que `custom_data` no se usaba, cuando `custom_data.wsdl` es una de
  las dos fuentes de la configuración; la otra es `code`.
- La prioridad `replacements` > `bind` > `params` en HANA no estaba documentada. Un `params` en el
  cuerpo se lee como el conjunto de binds y **descarta el resto en silencio**.
- La precedencia de SOAP se describía como reemplazo total; es un merge profundo, así que el
  cuerpo sigue aportando las claves que la configuración no menciona.
- `user_data` en FUNCTION se describía como body y query combinados; es el body si no está vacío
  y el query solo cuando el body lo está.
- El ejemplo de bulk insert enviaba el array en la raíz del body. El handler lee `body.data`, así
  que ese ejemplo fallaba en runtime.
- TEXT documentaba un campo `text_content` inexistente y un ejemplo de payload que no es un
  string; el handler exige `code` como string y responde 400 en caso contrario.
- Se declaraba un tope de 1 MB para el payload de TEXT que ningún código aplica.
- Se ofrecía `TOP <n>` como forma válida de limitar filas en HANA; es sintaxis de T-SQL y HANA la
  rechaza.
- `get_interval_task_runs` aparecía como devolviendo `error` y `response`, que solo llegan con
  `include_response: true`; sin él, una ejecución fallida sale sin rastro de su causa.
- El truncado a 4096 caracteres se atribuía a `last_response`; solo aplica al historial de
  ejecuciones, y `last_response` se guarda entero.
- `resource` no incluye el prefijo `/api/{app}`, que añade el framework; el ejemplo de FUNCTION lo
  traía incluido.
- La lista de herramientas de descubrimiento del handler MCP omitía
  `validate_json_schema_for_mcp` y `get_endpoint_tool_docs`.
- El manifest de NA decía que `code` no aplicaba, cuando NA degrada a TEXT y `code` es el payload.
- La skill de FETCH listaba los headers hop-by-hop que se eliminan como "p. ej." y se quedaba
  corto: también se quitan `origin` y `x-forwarded-for`, y lo que sí se preserva a propósito es
  `ofapi-trace-id`. Y no decía que el verbo tiene que ser uno de los que el cliente implementa:
  cualquier otro —`HEAD` y `OPTIONS` incluidos, que `endpoint_upsert` sí deja crear— recibía un
  `405` en cada llamada.
- HANA no documentaba que `sslValidateCertificate` viene por defecto en `false`.

#### La documentación de H5 y H10 estaba en herramientas que nadie puede leer

Las descripciones de `connection_override_allow` y `parse_bigint` se habían añadido a
`upsert_sql_endpoint_handler`, `upsert_sql_bulk_i_endpoint_handler` y
`upsert_hana_endpoint_handler`, las tres con `mcp.enabled: false`. Ningún agente las ve. La
documentación real está ahora en la descripción de `endpoint_upsert`, acotada por handler, y en los
`AI_SKILL.md` de SQL, SQL_BULK_I y HANA, que es lo que sirve `get_handler_skill`.

#### El reporte de arquitectura describía un árbol de directorios inexistente

`DOCUMENTATION_SYSTEM_REPORT.md` situaba la documentación en `docs/` en la raíz del repositorio,
cuando está en `src/docs/`, y omitía ocho directorios reales. Además invertía la recomendación de
creación de endpoints: pedía usar las ocho herramientas retiradas en lugar de `endpoint_upsert`.

### Changed

#### La validación de docs distingue claves de configuración de nombres de herramienta

`validateHandlerDocs.js` comprobaba forma: que un campo declarado exista y que el JSON sea válido.
Daba por bueno un manifest que afirmaba que `custom_data` no se usaba cuando sí. Las reglas de
`test:mcp-contract` tratan ahora las claves de configuración citadas entre backticks —como
`connection_override_allow`— como identificadores de dominio y no como referencias cruzadas a
herramientas, para que la regla de referencias cruzadas pueda seguir señalando nombres de
herramienta que de verdad no existen.

---

## Referencia

- Versionado: `package.json`
- Comprobación del contrato MCP tras cambios de documentación: `npm run test:mcp-contract`
- Validación de documentación de handlers: `npm run docs:handlers`
