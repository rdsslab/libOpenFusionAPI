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

#### `list_bots` entregaba el token en el detalle y lo ocultaba en la lista

`getBotCatalog` construye su proyección a mano y deja `token` y `code` fuera salvo que se pidan
con `include_token` / `include_code`. El camino por `idbot` no pasaba por ahí: llamaba a
`getBotById`, que hace `findByPk` **sin restringir atributos**, y Sequelize devuelve entonces la
fila entera. El mismo endpoint entregaba la credencial del bot en el detalle y la ocultaba en la
lista —el orden natural de error, porque el detalle parece justo el sitio donde menos habría que
mirar.

Ambos caminos ahora usan la misma función, `botListingAttributes()`. No basta con copiar la lista
en los dos sitios: con dos listas propias, el día que se añada una columna sensible a una, la otra
se queda atrás sin que nada avise, que es el defecto que se está corrigiendo.

`getBotById` **no** se toca, a propósito: `upsertBot` lo usa para leer el token y el código
previos y preservarlos, y para eso necesita la fila completa. Un arreglo que hubiera recortado
también ese camino habría roto el upsert.

#### `search_code` filtraba por código sin devolver el código

Con `search_code: true` la búsqueda metía `code` en las condiciones del `WHERE` y la proyección
no incluía esa columna. La opción se podía activar, cambiaba el conjunto de resultados, y la
respuesta no daba la evidencia de por qué: el agente recibía un `idendpoint` y tenía que abrir
los resultados uno a uno para reconstruir su propia búsqueda.

Ahora `code` entra en la proyección **cuando se pide**, no siempre. Sigue fuera por defecto
porque es la columna más pesada de la fila, que es el mismo motivo por el que `mcp` está
excluido: meterla siempre convertiría cada búsqueda de keywords en una descarga de fuentes de
código.

#### Un lote de descripciones que no coincidían con el código

Ocho herramientas describían algo que el código no hacía. Aquí lo distinto es **qué** se corrigió:
casi todo se arregla en la documentación y no en el código, porque lo que falla es la promesa y no
el comportamiento, y cambiar el comportamiento habría roto a quien ya depende de él. Donde el
agenteTomaría una decisión de seguridad a partir de lo que dice la herramienta, el aviso es
protagonista, no una nota al pie.

- `list_api_keys` devuelve el `token` de cada clave en claro —la función no restringe la
  proyección— y no lo decía. Ahora lo marca como sensible y recomienda filtrar por `idapp` o
  `idclient` en lugar de por `token`.
- `get_app_list_filters` devuelve cada aplicación **entera**, `jwt_key` incluida, y además
  expande los valores de todas sus AppVars, donde guardan cadenas de conexión. Es la única tool de
  descubrimiento que reparte claves de firma; `apps_list` ya lo avisaba y esta era la excepción
  silenciosa.
- `user_update` y `apiclient_update` guardan la contraseña hasheada pero **sin aplicar la
  política**, que sí se exige al crear. La asimetría no se corrige en el código —sería un cambio de
  comportamiento en herramientas de escritura— sino que se documenta, con la recomendación de
  validar uno mismo antes de llamar.
- `execute_endpoint_test` ofrecía `HEAD` como inocuo, pero `HEAD` no estaba en su `enum`: un
  agente podía leer "es seguro" y no encontrar por dónde pedirlo. Y callaba `QUERY`, que sí está y
  sí lo es. La prosa enumera ahora exactamente los métodos del enum.
- `upsert_interval_task`: el `timezone` se valida solo con `schedule_mode: 'cron'`, que es el
  único modo donde se lee. La descripción decía "rejected at save" sin más, y en modo `interval`
  un nombre IANA inválido se guarda callado.
- `system_health_stats`: la fuente de métricas puede no existir (`system` vuelve `null`) y el
  escaneo se topa en 5000 filas, de modo que los percentiles describen las últimas 5000 y no todo
  el histórico.
- `describe_all_tables`: el esquema declara un solo campo obligatorio (`connection`) y el código
  pide cinco fuera de `sqlite` —`database`, `dialect`, `username`, `password`, `host`—, así
  que enviar solo lo que el esquema dice es un fallo de validación.
- `audit_log_search` devuelve un **sobre** (`rows`, `total`, `limit`, `offset`), no una lista.
  Contar `rows.length` y `total` da dos números distintos y no es evidente cuál es cuál.
- `endpoint_delete` no declaraba `out`: ahora dice que devuelve `success`, `deleted` e
  `idendpoint`.

#### Dos hallazgos que se descartaron por no sostenerse

Se verificó cada uno contra el código antes de tocar nada, y dos no eran defectos. Se dejan
constancia porque "descartado" también es un resultado, y porque la próxima auditoría los va a
volver a encontrar:

- `apiclient_login` sin propiedades en su esquema de entrada. No es un defecto: la tool lee las
  credenciales de la cabecera `Authorization: Basic` (`auth_data?.Basic?.username`, línea 164 del
  handler), no del body. Un esquema de entrada vacío es exactamente lo que corresponde, y la
  descripción ya lo dice.
- `trace_summary` contando los 3xx como errores. No los cuenta: `getTraceSummary` los mete en su
  propia familia, y el `sc >= 300` que lo delata es el intervalo del bucket del 3xx
  (`sc >= 300 && sc <= 399`), junto a un 2xx y sendos más.

---

## [13.11.2] - 2026-09-25

Lote de traducción, sin cambios de comportamiento. La documentación del proyecto ya era
mayoritariamente inglesa, así que esto no es unIFIER un texto: es cerrar los huecos que quedaban
dentro de las tres capas que de verdad se consumen —las descripciones de las herramientas MCP, los
`AI_SKILL.md` que sirve `get_handler_skill` y los README de `src/docs/`— más lo que la traducción
destapó al choque contra el código.

### Changed

#### La documentación que llega a humanos y agentes pasa a inglés

| Capa | Qué estaba en español |
|---|---|
| Herramientas MCP | `title` de `get_libopenfusionapi_latest_version` (que además iba mezclado: *«Get last version libOpenFusionAPI versión»*), `description` de `handler_library_documentation` y de `validate_endpoint_code` |
| `AI_SKILL.md` | Los ejemplos de Telegram de `bots/providers/telegram/` —respuestas del bot, textos de teclado y `ctx.reply()`— convivían en español con cadenas ya en inglés en el mismo bloque |
| `src/docs/skills/JS_CORE.md` | El comentario de mantenedores. Este fichero se inyecta en cuatro `AI_SKILL.md` (JS, MONGODB, bots, interval_tasks), así que el español llegaba al agente por vía indirecta |
| `src/docs/logging/README.md` | El fichero entero, siendo la fuente de verdad del contrato `endpoint.ctrl.log` |
| Otros README | `handlers/JS`, `handlers/MONGODB`, `endpoint` y el ejemplo de `$_EXCEPTION_` |
| **Los 80 `.md` generados** | La cabecera `<!-- AUTO-GENERADO ... -->` de `handlers/JS/libraries/`, escrita **sin una sola tilde** |

Ese último caso merece explicación, porque es el que un filtro de acentos no ve: `AUTO-GENERADO`,
`NO EDITAR A MANO` y `a partir de` se escriben sin tildes, así que la cabecera pasaba por limpia en
cualquier revisión basada en `ñ` y `á`. Vivía en la constante `GENERATED_BANNER` de
`generateDocs.js`, y como el directorio se vacía y se reescribe en cada regeneración, corregir los
`.md` a mano se pierde en la siguiente ejecución: el arreglo va en el generador y los 80 ficheros se
regeneran.

Los ejemplos viven en la fuente, no en el markdown. `functionVars.js` alimenta los 80 ficheros y es
lo que devuelve la herramienta publicada `handler_library_documentation`, así que se corrigió ahí y
se regeneró. `docs:js-api:check` verifica que los 81 ficheros (80 detalles más el índice) siguen
coincidiendo con la fuente.

Fuera de alcance, por decisión explícita: los comentarios en español dentro del código — Convención
interna del proyecto que no llega a quien consume la API—, y los informes de auditorías ya cerradas
en `temporales/`, `todo/`, `dev/scratch/` y `dev/test/MCP_VALIDATION_REPORT.md`, que son registro
de trabajo pasado y no documentación de producto.

#### Una contradicción que la traducción destapó

`flows/RUNTIME.md` documentaba el error de handler desconocido como `Handler '<name>' no es valido`
—sin tilde—, mientras que `handler/handler.js` lo emite como `no es válido`. El documento describía
un mensaje que el runtime nunca produce. Corregido el documento para que sea literal.

Lo interesante es que ese mensaje **sigue en español**, y es el único español que queda en la
documentación, a propósito. No es prosa: es la cadena exacta que el servidor devuelve al cliente, y
`server/functions/system/prd/endpoint/index.js` la clasifica con un `msg.includes("no es válido")`.
Traducirla no sería un cambio de documentación sino de comportamiento —rompería a cualquier cliente
que case ese texto, y el propio repositorio lo hace—, así que queda fuera de este lote. Anotado aquí
para que una futura traducción de la superficie visible al cliente no lo trate por un descuido.

---

## [13.11.3] - 2026-09-26

Arreglos de la auditoría de base de datos contra motores reales. Esta versión cubre el primero de
ellos: el cuelgue del packet de validación. No cambia el comportamiento de la API.

### Fixed

#### El packet de validación se quedaba esperando una suite que ya había terminado

`dev/test/index.js` lanzaba cada suite y esperaba únicamente al evento `exit` del proceso hijo, sin
ningún límite de tiempo. Cuatro suites abren el pool de la base de datos de la plataforma —directa o
indirectamente— y ese pool mantiene el event loop vivo contra un motor de red: el proceso imprimía
que todas sus aserciones habían pasado y aun así no salía, porque un socket TCP no es un handle que
se vacíe solo. Con SQLite nunca se notó, porque ahí el pool está en memoria.

La consecuencia no era una suite colgada, sino un packet entero abortado: las quince suites que
venían después no se ejecutaban nunca y el proceso moría sin imprimir el resumen, así que el
resultado de la validación era indistinguible del de un corte de red.

| Antes | Ahora |
|---|---|
| Sin límite: la suite 10 de 29 colgaba y las 15 siguientes no se ejecutaban | Límite de 300 s por suite, configurable con `TEST_SUITE_TIMEOUT_MS` |
| Una suite colgada no aparecía en ninguna parte | `FAIL(timeout)` en el resumen, distinto de `FAIL(<código>)` |
| `SIGTERM` sin escalado | `SIGTERM`, y a los 10 s `SIGKILL` si el hijo lo ignora |
| El pool se quedaba abierto al terminar la suite | `closeDb()` al final, también en la ruta de error |

El cierre del pool va en un helper compartido (`dev/test/close_db.js`) en vez de repetido en cada
suite, y espera al `authenticate()` que `sequelize.js` dispara en segundo plano: cerrarlo mientras
esa promesa sigue en vuelo hace que Sequelize responda `pool is draining and cannot accept work`, un
error que aparecía sin que nadie lo pidiera.

Las cuatro suites afectadas eran `interval_task_upsert_test.js`, `backup_restore_test.js`,
`execute_endpoint_test_payload.js` y `js_return_status_integration.js`. Que el síntoma fuera
invisible en SQLite y no lo fuera en PostgreSQL es exactamente la clase de fallo que el límite por
suite convierte en visible: el resto de suites que importan de `src/` siguen sin cierre explícito
porque no abren conexión, y si alguna empezara a hacerlo, el runner la mata y lo dice en el resumen.

---

## [13.11.4] - 2026-09-26

Segundos arreglos de la auditoría de base de datos contra motores reales. Este es el que cambia
comportamiento observable, y el primero que lo hace: **los identificadores y los contadores que la
API entrega como texto en PostgreSQL y en MSSQL ahora se entregan como número donde se puede.**

### Breaking

#### Un `bigint` de la plataforma llega como número, no como texto

Este es el cambio que puede romper un cliente, y conviene decir exactamente a quién.

| Motor | Antes | Ahora |
|---|---|---|
| PostgreSQL | `{"idtask":"7","interval":"600"}` | `{"idtask":7,"interval":600}` |
| MSSQL | `{"idtask":"7","interval":"600"}` | `{"idtask":7,"interval":600}` |
| SQLite | `{"idtask":7,"interval":600}` | sin cambio |

Afecta a las columnas `BIGINT` de los 12 modelos de la plataforma que las tienen (de 20), en las
lecturas **y** en la escritura: un `create()` ya no devuelve un `id` de tipo distinto del que
devuelve al releerlo. Solo cambia lo que cabe en el rango seguro de `Number`; fuera de ese rango el
valor sigue llegando como texto, porque un número al que le han cambiado los últimos dígitos por un
redondeo es peor que un número que llega como texto.

Un cliente afectado tiene que distinguir `"600"` de `600` en sus aserciones. Donde el valor venga de
`Number(...)` o de una comparación con `===` contra un número, sigue funcionando; donde comparara
contra un string, hay que quitar la conversión.

### Fixed

#### `parse_bigint` nunca se había aplicado, ni siquiera en el handler que la ofrece

Al buscar cómo arreglar lo de arriba apareció un hallazgo mayor que el que lo motivaba. La opción
`parse_bigint` de un endpoint SQL está documentada, cableada y **con un test que pasa**, pero no
hace nada: `parse_bigint: true` entrega el mismo `int8` en texto que `parse_bigint: false`.

La causa no está en el proyecto sino en Sequelize, y es que su `connection-manager` sobrescribe
`connectionConfig.types` en **cada** conexión y su lista blanca de `dialectOptions` no incluye
`types`. Un `dialectOptions.types.getTypeParser` se ignora, en silencio. Comprobado por HTTP contra
un endpoint real con las tres variantes de la opción: idéntico resultado en las tres.

Que el test pasara explica por qué nadie lo notó: `sql_parse_bigint_test.js` ejercita el helper como
función pura y el constructor de parsers con OIDs inventados, sin abrir nunca una conexión. La
función es correcta; lo que no llegaba a ejecutarse era la conexión.

Este cambio **no arregla `parse_bigint`**, y es una decisión deliberada: la única vía de inyección
que funciona en PostgreSQL es `pg-types.setTypeParser(20, …)`, que es global al proceso y no se
puede aplicar a una sola conexión. Activarla convertiría la opción en un interruptor que ya no
apaga nada, y cambiaría el comportamiento de cualquier despliegue PostgreSQL existente. Se arregla
en una versión posterior, o no se arregla; pero mientras tanto el test nuevo cubre lo que sí
funciona, que es la normalización de los modelos de la plataforma.

#### La normalización se aplica a las asociaciones, no solo a la fila principal

El respaldo de una app es un único `Application.findOne({ include })` seguido de `toJSON()`, y las
`interval task` viajan dentro. El `afterFind` del modelo incluido no se dispara nunca —una
asociación no es un `find`—, así que una primera versión del arreglo normalizaba la fila principal
y dejaba las tareas como texto. Se notó porque `backup_restore_test.js` seguía fallando en
`interval === 600` con la normalización ya aplicada y en verde. El helper recorre ahora las
asociaciones cargadas, con control de ciclos.

#### Un test que no abría conexión, ahora sí

`dev/test/db_bigint_normalization_test.js` baja a una base de verdad. Comprueba el rango seguro, el
fuera de rango, `create()`, `findByPk`, `raw: true` y que las columnas de texto no se toquen; y
recorre los 20 modelos comprobando que los 12 con `BIGINT` llevan el enganche. En los tres motores
(`postgres`, `mssql`, `sqlite`) pasa, con la expectativa ajustada al dialecto: en SQLite el driver
ya devolvía número, y lo que se valida es que el rango seguro llegue SIEMPRE como número, sea cual
sea el motor. Se comprobó además que **falla sin el arreglo**, por las dos vías: sin el enganche
falla la asercion de presencia del hook, y con el enganche pero sin conversion falla la de valor
(`el id devuelto por create() deberia ser numero, y es string`). Un test que pasara con y sin el
arreglo no seria un test.

#### Un modelo nuevo no puede olvidarse de la normalización

Se envuelve `dbsequelize.define` en `db/sequelize.js` en lugar de enganchar el hook modelo por
modelo. Los hooks globales de `Sequelize#addHook` no sirven aquí: se comprobó que reciben
`options.model` como `undefined`, que es exactamente el dato que hace falta para saber qué columnas
son `BIGINT`. El test falla si algún modelo con `BIGINT` no lleva el enganche.

---

## [13.11.5] - 2026-09-26

**En MSSQL la plataforma no arrancaba. `sync({ alter: true })` no se podía completar y el
`buildDB` dejaba 5 de 22 tablas.** Este arreglo deja el esquema completo y repetible, y son
tres defectos distintos, no uno: el primero tapaba a los otros dos.

El defecto de partida, el del hallazgo H26, es que `ALTER COLUMN` en T-SQL solo admite un tipo
y la nulabilidad:

```sql
ALTER TABLE [t] ALTER COLUMN [c] <tipo> [ NOT NULL | NULL ]
```

Ni `DEFAULT`, ni `IDENTITY`, ni `PRIMARY KEY`, ni `UNIQUE`, ni `CHECK`. Sequelize mete las cinco
cosas a la vez, en este orden fijo, y de ahí sale tal cual

```sql
ALTER TABLE [ofapi_user] ALTER COLUMN [rowkey] SMALLINT DEFAULT 0;
```

que SQL Server rechaza con el error 156. Como el `DEFAULT` viene del `defaultValue` de cada
atributo, el problema alcanzaba a unas 70 columnas de 20 modelos.

#### Por qué no se quitan los `defaultValue` de los modelos

Es lo que parecía el arreglo obvious y no lo es, así que conviene dejar por escrito por qué se
descartó. `defaultValue` no es solo DDL: Sequelize lo aplica en **cada ruta de escritura** —
`create`, `upsert`, `findOrCreate` y `bulkCreate`, con `individualHooks` en `true` o en
`false`—, así que borrarlo cambiaría el comportamiento. El caso concreto es `LogEntry`, cuyo
`id` es clave primaria con `defaultValue: UUIDV4` y cuyo `bulkCreate` desactiva los hooks a
propósito para ir más rápido (`db/log.js`, "para mejor performance"): sin ese default, el
log de auditoría se inserta sin clave primaria. Se comprobó además que un `beforeValidate`
**no** reproduce el comportamiento, y que la clave primaria se resiste a que un hook la
rellene: en las seis rutas de escritura, la `PK` queda `null` tanto con `inst.id = x` como con
`inst.set("id", x, { raw: true })`.

Lo que se hace es recortar la definición **solo en el `ALTER`**. El `CREATE TABLE` sigue
emitiendo los defaults intactos, y perderlos en el `ALTER` tampoco destruye los que ya tuviera
la columna: en T-SQL un `ALTER COLUMN` sin `DEFAULT` los deja como estaban, que es lo que
produce el `INSERT` de la columna de prueba (`7`, `dev`) y lo que se verificó en el esquema real.

#### El recorte es gramatical, no una lista de palabras prohibidas

La primera versión quita `DEFAULT`, `IDENTITY` y `PRIMARY KEY` uno a uno, y al probar contra
el motor aparecieron `UNIQUE` y luego `CHECK`; cada uno era un `ALTER COLUMN` distinto que
fallaba. En vez de seguir sumando palabras, `limpiarDefinicionAlterColumn` reduce la definición
a lo que la gramática admite y conserva el tipo, la nulabilidad y las dos colas que
`changeColumnQuery` mueve de sitio por su cuenta.

Las dos colas se conservan **a propósito, no por descuido**: `REFERENCES` acaba en una cláusula
`ADD FOREIGN KEY` aparte y `COMMENT` en el `sp_addextendedproperty`. Si el saneador se las
comiera, un `alter` borraría las claves foráneas de la tabla. Por eso el recorrido salta los
literales: un `DEFAULT N'dato REFERENCES'` no es una clave foránea, y una búsqueda a pelo
confundiría las dos cosas. También compara palabras completas, que es lo que impide que
`UNIQUE` rompa `UNIQUEIDENTIFIER`, que es un tipo de columna de T-SQL.

#### Segundo defecto: un nombre de constraint repetido

`AppVars` y `Endpoint` declaraban las dos `uniqueKeys: { unique_av_combo: ... }`. En MSSQL el
nombre de una constraint `UNIQUE` es **de ámbito de base de datos**, no de tabla, así que la
segunda creaba `There is already an object named 'unique_av_combo' in the database`. En
PostgreSQL y SQLite el nombre es por tabla y ahí nunca se notó. Se renombra la de `Endpoint` a
`unique_endpoint_av_combo`, que es la diferencia mínima que evita el choque. Sin este arreglo el
`sync()` a secas que se usa de reserva tampoco funciona, y con él el `fallback` de `buildDB`
dejaba 5 tablas de 22.

#### Tercer defecto: el comentario de columna no era idempotente

`commentTemplate` escribe con `sp_addextendedproperty`, que en T-SQL no es idempotente: si la
propiedad ya existe responde `Property 'MS_Description' already exists for
'dbo.ofapi_user.start_date'`. Es decir que el `ALTER` solo podía completarse la primera vez, y
**a partir del segundo arranque** el `sync({ alter: true })` volvía a fallar. Con un
`IF NOT EXISTS` delante, si no existe se agrega y si existe se actualiza.

Dos detalles que costaron encontrar y que conviene no volver a tropezar: `escape()` ya antepone
la `N` de Unicode, así que `OBJECT_ID(N` + `escape(...)`)` produce `NN'...'`; y el punto y coma
del `EXEC` **hay que conservarlo**, porque el cuerpo de un `IF` en T-SQL es una sentencia y sin
él queda `EXEC a ELSE EXEC b`, que no parsea.

#### Verificación

Desde base limpia en MSSQL: `sync({ alter: true })` completa y da **21 tablas, 62 defaults y 41
constraints únicas con 41 nombres distintos**. Y se repite: tres `sync({ alter: true })`
seguidos sobre la misma base, sin error, que es justamente el caso del segundo arranque que
fallaba antes. El test `mssql_alter_column_test.js` cubre 26 definiciones de T-SQL, incluidas
las que llevan `REFERENCES` y `COMMENT`, y falla si alguna conserva algo prohibido.

#### Lo que sigue roto en MSSQL, y no es de este arreglo

Corregido el esquema, la plataforma llega un poco más allá y se estrella en otra cosa:

```
Error: Primary Key or Unique key should be passed to upsert query
    at MSSQLQueryGenerator.upsertQuery (...)
    at upsertIntervalTask (src/lib/db/interval_task.js:115)
```

Es un **defecto preexistente y aparte**, no una consecuencia de este arreglo: `upsertQuery` de
MSSQL exige que la carga útil traiga la clave primaria o alguna única, y `restoreIntervalTasks`
borra `idtask` a propósito para que la base lo asigne (`db/app.js`, "Deja que la base asigne el
idtask"). Aislado del resto, sobre los tres motores: en PostgreSQL y SQLite el `upsert` sin
`idtask` funciona, y en MSSQL con `idtask` también; solo la combinación MSSQL sin `idtask` falla.

Que no estuviera en la auditoría original es fácil de explicar: hasta ahora no se podía llegar
hasta ahí, porque el esquema no se completaba. **MSSQL sigue sin poder servir** por esta razón,
y queda como pendiente, no como algo resuelto.

---

## [13.11.6] - 2026-09-26

**MSSQL ya arranca.** Cierra el pendiente que dejó 13.11.5, y son dos defectos distintos. El
segundo no lo buscaba nadie: estaba debajo del primero y llevaba tiempo dormido.

#### Un alta no es un `upsert`

`upsertIntervalTask` usaba `IntervalTask.upsert()` tanto para actualizar una tarea existente
como para crear una nueva. La diferencia se decide por la presencia de `idtask`: si viene, se
fusiona con la fila guardada y se actualiza; si no viene, lo que se pide es un alta y que la
base asigne el id. Lo segundo no es un `upsert`, y en MSSQL no se puede expresar:

```
Error: Primary Key or Unique key should be passed to upsert query
    at MSSQLQueryGenerator.upsertQuery (...)
    at upsertIntervalTask (src/lib/db/interval_task.js:115)
```

`upsertQuery` de MSSQL construye un `MERGE`, así que necesita un punto de unión, y exige que la
carga útil traiga la clave primaria o alguna única. Sin `idtask` —que es justo el caso del alta—
no encuentra ninguna y lanza. En PostgreSQL y SQLite no fallaba, **pero por casualidad**:
`upsertKeys` cae a la PK, el conflicto nunca llega a producirse porque `idtask` lo asigna la
secuencia, y el resultado es un `INSERT` con otro nombre. El mismo código, tres resultados
distintos, y el equivocado es el que no se ve.

Ahora el alta va por `IntervalTask.create()`, que dice lo mismo en los tres motores. Y
`restoreIntervalTasks` sigue haciendo lo que ya hacía: borrar `idtask` para que la base lo
asigne, en vez de inventarse un id.

#### El rechazo sin manejador tumbaba la plataforma entera

Este es el que no buscaba nadie, y merece explicación porque parece que el código ya lo tenía
resuelto. `restoreIntervalTasks` empuja cada tarea a un array y las espera al final:

```js
pending.push(upsertIntervalTask(data));   // línea 219
...
const results = await Promise.allSettled(pending);   // línea 236
```

`allSettled` está ahí y además se avisa de cada fallo por `console.error`, así que a primera
vista el error está contenido. No lo está. Entre el `push` y el `allSettled` el bucle sigue
iterando y se hace `await` en consultas a la base, y **Node da por perdido un rechazo en el
turno en que ocurre si no hay manejador en ese momento**. La promesa ya rechazada atraviesa
varios turnos del bucle de eventos sin que nadie la enganche, saltan `unhandledRejection` y
—desde Node 15, con el valor por defecto— el proceso muere. `allSettled` llega demasiado tarde
para recogerlo.

La corrección es una línea y no cambia el resultado: se engancha un `catch` vacío en el momento
del `push`. El rechazo sigue siendo el mismo y `allSettled` sigue informando igual, pero ya
nunca hay una promesa rechazada sin manejar. Se hace lo mismo en `restoreBots`, que tenía el
mismo patrón y habría caído igual ante cualquier error de base de datos.

#### Verificación

Arranque en MSSQL desde base limpia: esquema completo, **escucha en el puerto**, sin excepción no
capturada, 209 endpoints, 2 aplicaciones, 4 usuarios y **5 interval tasks** sembradas — que es
justo el camino del alta. Y el **segundo arranque** sobre la misma base también levanta, que es
el caso que se caía antes, y sin duplicar tareas: siguen siendo 5.

El paso nuevo del test (`interval_task_upsert_test.js`, paso 10) sabotea `IntervalTask.upsert` y
comprueba que el alta no pasa por ahí. Se comprobó que **falla sin el arreglo** y pasa con él.
Se hace así, y no contra la base de datos, porque en PostgreSQL el comportamiento antiguo es
idéntico: sin la comprobación, esta regresión volvería a pasar inadvertida en el dialecto donde
nunca se nota.

---

## [13.11.7] - 2026-09-26

**Un endpoint con la contraseña caducada leía los datos de otro, y la contraseña de la base de
datos estaba escrita en los logs.** Las dos cosas son la misma línea de código: la clave con la
que el pool decide si dos peticiones comparten conexión.

#### El fallo

`buildConnectionCacheKey` serializaba `environment`, `database`, `username`, `parse_bigint` y el
`options` entero. La contraseña no estaba. Dos endpoints sobre la misma base y el mismo usuario
con distinta contraseña producían la misma clave, así que el segundo **heredaba la conexión que
abrió el primero** y se ejecutaba con sus credenciales sin saberlo. Medido sobre la plataforma en
marcha, contra PostgreSQL:

```
INFO  postgres: password erronea -> HTTP 200
FAIL  postgres: credencial invalida no entrega datos
      :: HTTP 200 devolvio filas con una password incorrecta
```

El síntoma no es un error de autenticación, y esa es la parte incómoda: es una respuesta. El
endpoint con la contraseña vencida lee los datos del que sí la tenía, y el endpoint con la
contraseña equivocada contesta con lo que el otro tenía. En MSSQL se notaba menos porque
`tedious` reautentica al tomar la conexión de la pool; en PostgreSQL la sesión reutilizada
respondía 200 y no decía nada.

#### La misma línea, en los logs

La clave se imprime entera en el pool cuando una conexión caduca, cuando el pool está lleno y
cuando una entrada vieja se recicla. Y en HANA era mucho peor: su clave era
`JSON.stringify(paramsSQL.config)`, es decir **la config entera, con la contraseña dentro**, y esa
cadena se imprimía tal cual:

```js
console.log(`HANA Pool expired: ${configHash}`);        // sqlHana.js:41
console.log(`Closing idle HANA pool: ${oldestHash}`);   // sqlHana.js:68
```

Con el código anterior, esa línea en un servidor con un endpoint de HANA contiene la contraseña
de la base de datos del cliente, en claro. No hace falta que nadie la lea: basta con que el log
llegue a donde llega un log. Reproducido sobre la plataforma en marcha, esperando a que la
entrada del pool superara su TTL de 10 minutos:

```
HANA Pool expired: {"databaseName":"HXE","user":"SYSTEM","password":"Hana#Exp2026!x",
                    "host":"127.0.0.1","port":39141,"encrypt":true,
                    "sslValidateCertificate":false}
```

Con el arreglo, la misma línea sale así, y la contraseña no aparece en ninguna parte del log del
proceso:

```
HANA Pool expired: {"database":"HXE","databaseName":"HXE","encrypt":true,"environment":"dev",
                    "host":"127.0.0.1","parse_bigint":false,
                    "password":"sha256:f3d62d29b9225f9…","port":39141,
                    "sslValidateCertificate":false,"user":"SYSTEM","username":"SYSTEM"}
```

(`sha256("Hana#Exp2026!x")` es `f3d62d29b9225f9…`: la huella es la del secreto, verificada contra
la contraseña real del contenedor de prueba.)

La corrección es que en la clave la credencial va **hasheada** (`sha256`, en hexadecimal), con
prefijo `sha256:` para que se distinga de un valor de verdad. La regla se aplica por nombre de
clave —`password` y `pwd`— y a cualquier nivel, porque la credencial también puede venir anidada
en `options` (`dialectOptions.password`), que es donde se cuelan las que nadie mira.

`SHA-256` sin sal, y es deliberado: la huella tiene que ser estable, porque es la que decide si
dos peticiones comparten el pool, y porque una clave de caché que cambiara en cada arranque
haría imposible correlacionar dos entradas del mismo log. El residuo se dice aquí y no se disfraza:
el `sha256` de una contraseña corta se adivina por fuerza bruta, así que una clave filtrada no
equivale a una contraseña filtrada, pero tampoco es inocua. **El log sigue siendo un sitio
sensible**, y ahora es sensible por una razón que se puede explicar.

#### HANA tenía su propia clave

El handler de HANA no usaba `buildConnectionCacheKey`: construía la suya con `JSON.stringify`. Es
la segunda implementación de una decisión que tiene que vivir en un solo sitio, y la divergencia
ya se había pagado una vez: la clave de los handlers SQL dejó de llevar la contraseña y la de
HANA ni se enteró. Ahora usa la función común.

Para que eso no rompiera HANA, la función tuvo que aprender a leer su forma, que no es la de
Sequelize: la conexión está descrita **en la raíz, sin `options`**, y con otros nombres —
`serverNode`, `databaseName`, `user` o `uid`, `encrypt`, `sslValidateCertificate`. Una función que
solo leyera `database`, `username` y `password` devolvería `undefined` en los tres casos, y dos
tenants de HANA con el mismo usuario y la misma contraseña compartirían entrada. Para esa forma el
config entero se despliega en la clave, igual que ya se hacía con `options` en el camino de
Sequelize: es lo que evita mantener una lista de campos a mano que se queda corta en el siguiente
campo nuevo.

El despliegue se hace **solo cuando no hay `options`**, y se quitan antes `query_type`,
`parse_bigint` y `connection_override_allow`. Ahí la lista es de exclusión, al revés que en el
camino de Sequelize, y la asimetría es intencionada: olvidarse de una clave de esa lista cuesta
una entrada de pool de más, mientras que olvidarse de un campo de conexión reparte los datos de un
tenant entre endpoints que no lo comparten. El entorno también entra ahora en la clave de HANA, que
antes no lo tenía.

#### Verificación

El caso de credenciales inválidas es el que estaba en rojo, y pasa en los tres motores:

| | antes | ahora |
|---|---|---|
| postgres | **FAIL** — HTTP 200 con filas | PASS — HTTP 500 |
| mssql | PASS — HTTP 500 | PASS — HTTP 500 |
| hana | PASS — HTTP 500 | PASS — HTTP 500 |

Matriz completa de handlers contra los tres motores (SQL, SQL_BULK_I y HANA): **50 pass / 1 fail →
52 pass / 0 fail**. El caso nuevo es de HANA: dos endpoints con el mismo usuario y contraseña y
`databaseName` distintos, donde el segundo apunta a una base que no existe. Si compartieran
entrada, respondería con las filas de la otra. No es un fallo que se viera antes —la clave
vieja de HANA era el config entero, que sí incluía el `databaseName`— sino el que habría
introducido el mover esa clave a la función común sin enseñarle antes la forma de HANA, que es
justo el orden en que se rompen estas cosas. Queda como guarda de esa decisión.

`sql_connection_cache_key_test.js` (puro, sin abrir conexiones) pasa de 14 comprobaciones en 5
bloques a 26 en 9: contraseña raíz y anidada, huella presente y contraseña ausente de la clave, y
los siete campos que distinguen una conexión de HANA de otra. Se comprobó que **falla sin el
arreglo** por las dos vías —la de Sequelize y la de HANA—, porque una prueba que solo pasa con el
arreglo puesto no distingue nada.

#### Lo que esto cuesta

Un pool por combinación real de conexión. Un endpoint multi-tenant que cambia la contraseña en
cada petición —el patrón que documenta el override de conexión— ahora abre una entrada por
contraseña distinta, donde antes compartía una. **No es un defecto que se pueda evitar**: dos
peticiones con credenciales distintas no pueden usar la misma conexión, y el motivo por el que
antes sí lo hacían era precisamente el que se arregla aquí. Lo que cambia es cuándo se nota: el
pool avisa al llenarse con un mensaje que dice qué hacer (`OFAPI_SQL_POOL_MAX_CONNECTIONS` o
consolidar los overrides), y ese aviso ahora aparece antes en las implantaciones que viven de
esta reutilización.

---

## Referencia

- Versionado: `package.json`
- Comprobación del contrato MCP tras cambios de documentación: `npm run test:mcp-contract`
- Validación de documentación de handlers: `npm run docs:handlers`
