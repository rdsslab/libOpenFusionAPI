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

## [13.12.5] - 2026-10-01

### Fixed

- **`data_test` se guardaba en la forma que el Tester no puede leer.** `data_test` guarda la
  petición de ejemplo que reproduce el Tester del editor, y el body va en
  `data_test.body.json.code` —eso leen el Tester, `execute_endpoint_test` con
  `use_data_test_fallback` y el generador de documentación—. Pero la tool `endpoint_upsert` no lo
  decía: su schema aceptaba cualquier JSON («payload de prueba guardado») y su descripción
  recomendaba «un `data_test` (una petición de ejemplo guardada)». Un cliente que siguió esa guía
  guardó el body en la raíz:

  ```json
  {"corporativos":["1600395592"],"ejecutar_sincronizador":true,"dry_run":true}
  ```

  No fallaba nada: el upsert devolvía 200 y guardaba bien lo que le habían mandado. El fallo era
  que el Tester abría el endpoint y mostraba `{}` en Body → JSON, y `execute_endpoint_test` con
  fallback no encontraba payload. La causa era de documentación, y la documentación era doble: la
  misma frase se repetía en el seed y en el addon de runtime que `mcp.js` concatena a la
  descripción de la tool en `tools/list`, así que arreglar solo el seed no cambiaba lo que el
  agente leía.

  Ahora el schema de `data_test` declara la estructura real —`query`, `headers`, `auth`, `body`
  (`selection`, `json.code`, `xml`, `text`, `form`, `urlencoded`) y `last_response`— y la prosa
  dice que **no es el body crudo**. Se mantiene permisivo (`anyOf` con objeto, array, string y
  `null`) para no romper a quien ya enviaba `null` o un array, que antes pasaban.

- **Un `data_test` con el body crudo en la raíz ahora se guarda donde sí se ve.** `normalizeDataTest`
  (`src/lib/db/endpoint.js`) envuelve lo que parece un body en
  `{body: {selection: 0, json: {code: <valor>}}}` y **no rechaza nada**: hay clientes que llevan
  años guardando así. La respuesta del upsert incluye un `warnings` que dice dónde quedó el body,
  para que quien llamó aprenda la forma buena. El listón para decidir «esto ya venía bien» es
  alto a propósito: las filas de `query`/`headers` tienen que parecer filas
  (`{enabled: <bool>, key}`) y `body`/`auth` tienen que parecerse a los del Tester, porque un body
  crudo que use una clave del Tester por casualidad (`{"query":[{"field":"x"}]}`,
  `{"body":{"texto":"hola"}}`) si no se guardaría roto **y sin aviso**, que es lo peor que puede
  pasar. Cubierto por `dev/test/data_test_normalize_test.js`.

### Changed

- **Autor de endpoints:** `headers_test` se documenta como lo que es —un objeto plano
  `{"Header-Name": "value"}` que `execute_endpoint_test` envía como headers, mezclado con las filas
  habilitadas de `data_test.headers`— y no como «cabeceras de prueba guardadas».

## [13.12.4] - 2026-09-30

### Fixed

- **Todos los endpoints JS y MONGODB que no usaran `$_RETURN_STATUS_` emitían un
  warning por petición.** El sandbox declara la variable en el contexto para poder
  documentarla, y su valor por defecto era el objeto vacío del placeholder (`fn: {}`
  en `src/lib/server/functionVars.js`). Como el wrapper lee `typeof
  $_RETURN_STATUS_ !== "undefined"`, ese `{}` contaba como «el endpoint lo asignó» y
  llegaba a `resolveSuccessStatus` como status: `$_RETURN_STATUS_ = [object Object]
  on endpoint … is not a valid success status … Falling back to 200`. El status que se
  enviaba era el correcto (200), pero el log se llenaba de avisos que describían un
  error de programación inexistente, y sobre todo tapaban los avisos que sí importan:
  un `"201"` en string o un `400` en el camino de éxito. El centinela de «sin
  asignar» es ahora `undefined`, y el aviso sigue saliendo —con la aserción que lo
  cubre en `dev/test/js_return_status_integration.js`— cuando el endpoint se equivoca
  de verdad.

## [13.12.3] - 2026-09-29

### Fixed

- **El read path de los logs no devolvía `query`/`body`/`params`, así que la API no
  distinguía el nivel 1 del 2.** `getLogs` omitía esas tres columnas de
  `fullAttributes` (`src/lib/db/log.js:570`): un log de nivel 2/3 guardado con su
  query, params y body se veía por la API idéntico a uno de nivel 1, con lo que no se
  podía verificar que `endpoint.ctrl.log` estuviera aplicando los niveles. Ahora se
  incluyen (ya parseadas) cuando se pide `lightweight=false`.
- **`?lightweight=false` por query string no funcionaba.** El valor llegaba como el
  string `"false"` (truthy), así que la API seguía devolviendo las columnas compactas;
  solo funcionaba el booleano real por body JSON. `fnGetLogs`
  (`src/lib/server/functions/system/prd/logs/index.js`) normaliza ahora el flag a
  booleano real y acepta ambos caminos, manteniendo el default compacto si no se envía.

### Changed

- **Contrato MCP y documentación del logging al día con el read path.** La herramienta
  `get_system_logs` documenta la respuesta como **array plano** (sin envelope
  `{data: []}`); que con `lightweight=false` las filas incluyen `query`/`body`/`params`
  (nivel 2+) y `req_headers`/`res_headers`/`response_data`/`message` (nivel 3+); la
  descripción del parámetro `lightweight` lista esas columnas; y el `out.schema` enumera
  los 20 campos por fila con su nivel de captura. `src/docs/logging/README.md` gana la
  sección "Reading back what was captured" y `src/docs/logging/AI_SKILL.md` amplía su
  "How to inspect".

---

## [13.12.2] - 2026-09-28

### Fixed

- **`type` de una AppVar no estaba cerrado en ningún sitio, y el desajuste ya había
  costado datos reales.** `type` era un `STRING(25)` sin validador —a diferencia de
  `name`, que sí lo tiene—, así que cualquier cliente (GUI, MCP, `curl`) podía
  escribir cualquier cadena y nada la rechazaba. De ahí que existieran **cuatro listas
  de tipos sin coincidir en nada**:

  | Dónde | Tipos que conocía |
  |---|---|
  | Semillas reales de AppVars | `json` · `string` · `number` · **`boolean`** |
  | `switch` de `parseAppVar` | `number` · `json` · `object` · `js` + `default` |
  | Desplegable Lang de la GUI | `none` · `html` · `js` · `json` · `sql` · `xml` · `string` · `number` |
  | `object` | Exactamente duplicado de la rama `json`. No lo producía ni lo ofrecía nadie. |

  Ahora hay un conjunto canónico en `src/lib/db/appvarType.js`, un validador en el
  modelo que **cubre todos los caminos de escritura** —los seeds, el restore, `create`,
  `bulkCreate`—, y un 400 con sugerencia desde `upsertAppVar`:

  ```
  POST /api/system/app/var/prd   { "type": "strin" }
  → 400 INVALID_APPVAR_TYPE
      Invalid AppVar type "strin": valid types are boolean, html, js, json, none,
      number, sql, string, xml, object. ... Did you mean "string"?
  ```

  `object` se acepta y se reescribe a `json` en vez de rechazarse: no lo produce nadie,
  pero una fila que lo traiga en un backup debe poder restaurarse, y rechazarla
  convertiría un backup existente en un restore parcial.

- **Un flag `boolean` sembrado como el string `"true"` se leía como encendido estando
  apagado.** La app `system` siembra `$_VAR_RESET_EMAIL_ENABLED` y
  `$_VAR_RESET_TELEGRAM_ENABLED` con `type: "boolean"`, y el seed las guardaba como el
  **texto** `"true"`: `json_typeof(value)` devolvía `string`. `parseAppVar` no tenía
  rama para `boolean`, así que entregaba esa cadena al runtime, y en JavaScript
  **el string `"false"` es *truthy***. Cualquier consumidor que escribiera
  `if ($_VAR_RESET_EMAIL_ENABLED)` habría visto el flag apagado como encendido.

  El seed ahora siembra un booleano JSON de verdad, y `parseAppVar` tiene rama para
  `boolean` que entrega siempre un booleano. El vocabulario (`true` / `1` / `yes` /
  `on`) estaba **duplicado** entre `parseAppVar` y `isFlagEnabled` en `src/lib/db/user.js`;
  ahora los dos leen la misma constante, que es lo que evita que vuelvan a separarse.

  Esto **no cambia** el fail-open de `isFlagEnabled` ante una fila ausente: esa es una
  pregunta de existencia, no de valor, y sigue viviendo donde estaba.

- **Los seeds traían el defecto de 13.12.1 escrito dentro.** Tres AppVars de tipo
  `string` estaban sembradas con 2 y 3 capas de comillas acumuladas:

  ```
  $_VAR_ZZ_FLOW_MARKER       "\"\\\"\\\\\\\"before_create_app\\\"\\\"\"\""   → "before_create_app"
  $_VAR_ZZ_TEST_PROBE        3 capas                                          → "ok"
  $_VAR_FETCH                2 capas                                          → "https://fakestoreapi.com/carts"
  ```

  Un despliegue nuevo las sembraba **dañadas de fábrica**. Corregidas.

### Added

- `dev/test/appvar_types_test.js` y `dev/test/appvar_end_to_end_test.js` (46 casos).
  Fijan el contrato por tipo, atan las cuatro listas entre sí para que un tipo nuevo
  tenga que declararse en todas, y cubren lo que ninguna de las dos anteriores comprobaba:
  que `parseAppVar` entrega el valor **sin entrecomillar**, y que tres ciclos seguidos de
  backup y restore no mueven la columna. Sin esto, volver a poner `JSON.stringify` en la
  rama `default` pasaba inadvertido.

### Changed

- Un AppVar con un tipo desconocido ahora devuelve **400** en lugar de aceptarse en
  silencio. Es un cambio de comportamiento observable por quien llame al endpoint, pero
  solo afecta a tipos que ya estaban rotos: nadie podía leerlos ni editarlos.

---

## [13.12.1] - 2026-09-28

### Fixed

- **Una variable de tipo `string` llegaba al runtime con comillas alrededor, y cada
  backup de la app le añadía un par más hasta dejar el valor inservible.** Todo cabe en la
  rama `default` de `parseAppVar` (`src/lib/db/app.js`), que hacía
  `JSON.stringify(appvar.value)`. El modelo ya deserializa la columna `json` antes de
  que el valor llegue ahí, así que esa llamada solo servía para volver a entrecomillar
  lo que el usuario había escrito:

  ```js
  // $_VAR_CNX de type "string", written in the GUI as: caracol
  // column json stores:  "caracol"        (correct: a JSON string)
  // runtime handed to the endpoint:  "caracol"   ← with the quotes as characters
  ```

  Afectaba a los tipos sin rama propia —`string`, `none`, `html`, `sql`, `xml`— y
  **no** a `number`, `json`, `object` ni `js`, que ya devolvían su valor intacto. Por
  eso el síntoma era a medias: una variable `json` se veía bien al lado de otra
  `string` que no lo estaba, y no dependía de la variable sino de su **tipo**.

  Lo que lo hacía irreversible es que el defecto se realimentaba a sí mismo.
  `getAppBackupById` serializa el árbol **ya parseado**, así que el backup guardaba el
  valor entrecomillado; el restore lo escribía de vuelta en la columna `json`, y ahí
  quedaba como texto con comillas dentro de la cadena. Medido contra PostgreSQL
  real, con tres ciclos de "Backup All" → "Restore All" de la GUI:

  ```
  original:  "caracol"
  ciclo 1:   "\"caracol\""
  ciclo 2:   "\"\\\"caracol\\\"\""
  ciclo 3:   "\"\\\"\\\\\\\"caracol\\\\\\\"\\\"\""
  ```

  Un valor de configuración—credenciales SMTP, un token, una URL— deja de ser usable
  al cabo de un backup, y no hay forma de distinguirlo del que el usuario escribió
  porque en pantalla ya se ve con las comillas que ganó por el camino.

  El arreglo es devolver el valor tal cual. Los cuatro tipos con rama propia no
  cambian, así que para ellos esta versión no es una diferencia observable.

  **Para quien ya tenga variables dañadas:** el arreglo evita que seguían, pero no
  repara lo que ya está corrupto. Una variable con las comillas acumuladas sigue
  saliendo con ellas, porque ahora el runtime la devuelve tal cual, sin adivinar que
  había que desenvolverlas. Hay que corregirlas a mano o con una migración que
  deshaga las capas una a una.

  Verificado con la corrección: `parseAppVar` devuelve el valor sin entrecomillar en
  los nueve casos de tipo contra tipo; tres ciclos seguidos de backup y restore ya
  no tocan la columna; el runtime entrega `caracol` para `string` y `none`, `{"a":1}`
  para `json` y `7` para `number`. Packet completo 45/45.

### Changed

- El editor de variables de la GUI sigue como estaba: se comprobó con la pantalla
  real, tres guardados seguidos sin tocar el valor, y el `POST` de
  `/api/system/app/var/prd` manda el mismo valor cada vez. La escritura nunca añadió
  las comillas; solo las hacía visibles un valor que ya venía alterado de antes.

## [13.12.0] - 2026-09-28

### Added

- **El handler `SQL` HANA se ha comprobado contra un HANA de verdad, y eso ha destapado un
  tercer defecto del arreglo de la 13.11.33.** La suite de la 13.11.33
  (`sql_hana_comments_test.js`) comprueba el texto que el sustituidor entrega al driver, y
  para eso no necesita base de datos. Lo que no comprobaba es lo que hace el **motor** con
  ese texto, y ahí faltaba un síntoma entero:

  ```sql
  /* el filtro real es $name */   SELECT ... WHERE name <> $name
  → HTTP 500  Too many parameters for the SQL statement
  ```

  Si el comentario mencionaba un nombre que **también** era un marcador real, los dos se
  sustituían y la sentencia llegaba con un `?` de más para los que HANA contaba. Es el
  síntoma más incómodo de los tres porque parece otro cosa: el mismo nombre no hace nada
  malo salvo que colisione por casualidad con un parámetro de la petición, así que si un
  endpoint funcionaba dependía del payload con el que lo llamaran. Ninguna prueba sobre el
  texto sustituido puede verlo, porque la cuenta la hace el driver.

  La cobertura nueva es `dev/test/hana_comments_live_test.js`: **21 casos** que llaman por
  HTTP a endpoints efímeros del handler HANA, el mismo camino que un cliente, contra un
  `hanaexpress` con el tenant `HXE`. Pasan los 21, y **revirtiendo solo el estado de
  comentario del sustituidor fallan 10**, que es la comprobación de que los hace pasar el
  arreglo y no la casualidad. Está fuera del packet, como las demás de motor real, y a
  diferencia de PostgreSQL y MSSQL necesita el esquema `items`/`counters` sembrado a mano.

  Dos cosas más que solo el live podía resolver:

  - **`uid` / `pwd` funcionan**, la pareja que documenta el `AI_SKILL` del handler, y no
    solo `user` / `password`, que es la que prefiere el driver. No era una suposición: el
    techo de credenciales de la `connection_override` nombra las cuatro formas, y sin
    connectarlas no había forma de saber cuáles acepta de verdad el pool.
  - **El defecto del apostrofe necesita un número *impar* de comillas en el comentario para
    morder.** `/* don't, really don't */` tiene dos, y el alternador de comillas antiguo se
    compensaba solo; `/* it's a note */` tiene una, y no. Dos de los casos pasan contra el
    parser roto por pura casualidad, que es la medida justa de lo fino que era ese código.

  Regresión del handler con los tres motores levantados: matriz de 52 comprobaciones,
  **52 pass / 0 fail**.

### Changed

- El `AI_SKILL.md` del handler HANA y el `dev/test/README.md` cuentan los tres síntomas
  con su mensaje real, incluido el que solo aparecía en vivo.

## [13.11.33] - 2026-09-28

### Fixed

- **El mismo defecto, en el handler `SQL` HANA, seguía vivo.** El arreglo de la 13.11.32
  se hizo sobre Sequelize, y HANA no usa Sequelize: lleva su propio sustituidor
  (`construirComandoHana`, en `handler/sqlHana.js`), que convierte `:nombre` y `$nombre` en
  `?` posicionales antes de entregar el texto al driver. Ese bucle llevaba cuenta de
  comillas y nada más, así que un comentario era indistinguible del código, y salían dos
  fallos:

  1. `/* sale de $_VAR_HANA_DB */` se leía como un marcador sin valor y la consulta moría
     con `Missing parameter value for $_VAR_HANA_DB` → **500**. Es el mismo síntoma que
     se corrigió en `SQL`, y por la misma razón: `$_VAR_…` tiene exactamente la forma de
     un marcador nombrado.
  2. **Más traicionero, y este no lo había detectado nadie.** Un apostrofe dentro de un
     comentario —`/* it's a note */`, o `-- don't filter`— alternaba el estado de comillas
     y lo dejaba **pegado**. A partir de ahí el sustituidor creía que seguía dentro de una
     cadena, así que los marcadores **reales** que vinieran después ya no se veían: `$a`
     viajaba literal a la base de datos, sin valor. La consulta llegaba al motor con un
     `$a` suelto y la respuesta era un error de sintaxis de HANA, en lugar del fallo claro
     del caso 1. Un comentario neutro convertía un filtro en un error de sintaxis.

  El arreglo añade al bucle el estado de comentario (`--` hasta el fin de línea, `/* … */`
  de bloque), de modo que dentro de un comentario no se lee ni una comilla ni un marcador.
  Para llegar hasta ese bucle hizo falta sacarlo de `executeQuery` a una función exportada,
  `construirComandoHana()`: es trabajo de cadenas sin tocar el pool, y hasta entonces no
  había forma de probarlo sin un HANA delante. Aquí **no** hace falta neutralizar nada, al
  contrario que en `SQL`: HANA ya recibe los `?` puestos, así que el texto del comentario
  llega al driver **intacto**, tal cual lo escribió el autor.

  **Para el autor de endpoints:** los comentarios vuelven a ser seguros en HANA, y da igual
  si mencionan el nombre de una AppVar, un `:nombre`, un `$nombre` repetido, o si llevan
  comillas y apóstrofos dentro. Un `$nombre` o `:nombre` dentro de un literal o de un
  identificador entrecomillado nunca se tocó y se sigue sin tocar: es lo que escribió el
  autor. `@nombre` no es marcador en este handler —el `@` solo se quita de las **claves**
  del body, no del SQL— y eso tampoco cambia.

  Detalle en el `AI_SKILL.md` del handler HANA. Cobertura en `dev/test/sql_hana_comments_test.js`:
  30 casos, puro y sin HANA delante, y falla 14 de 30 contra el bucle anterior. El tercer
  síntoma del defecto —que solo se ve con una base delante— se documenta en la 13.12.0.

- **`:nombre` y `@nombre` dentro de un comentario, en el handler `SQL`.** Comprobado que
  nunca fueron un problema y no hacía falta arreglar nada, pero conviene dejarlo escrito
  porque son las dos cosas que alguien da por perdidas después de sufrir el defecto del
  `$`:

  - `:nombre` va por `injectReplacements` de Sequelize, que es un escáner a mano y **sí**
    distingue comentarios, literales, identificadores entrecomillados y cuerpos
    `$$…$$`. Dentro de un comentario no se toca, ni antes ni después del arreglo.
  - `@nombre` **no es marcador** en este handler. El `@` se quita del prefijo de las
    **claves** del body, para que una clave `@name` ate a `$name`; en el texto SQL un
    `@name` no se sustituye nunca y viaja literal al motor. En MSSQL eso es una variable
    T-SQL, así que en un comentario es doblemente inerte.

## [13.11.32] - 2026-09-28

### Fixed

- **Un `$nombre` escrito dentro de un comentario tumbaba la consulta entera en el handler
  `SQL` y `SQL_BULK_I`.** Escribir el nombre de una variable de aplicación en un comentario
  —`/* sale de $_VAR_MSSQL_TEST */`— hacía que el endpoint devolviera **500** con
  `Named bind parameter "$_VAR_MSSQL_TEST" has no value in the given object`, aunque el
  comentario no significara nada para el motor. La causa era que el escáner del handler ya
  sabía distinguir un `$nombre` real de uno que vive en un comentario, pero ese
  conocimiento nunca llegaba a la sustitución: la hace Sequelize, con una regex
  (`sql.replace(/\B\$(\$|\w+)/g, …)`, en `dialects/abstract/query.js`) que no ve
  comentarios. El otro camino de sustitución de Sequelize, `injectReplacements` (`:nombre`,
  `?`), nunca sufre esto porque es un escáner a mano; esa asimetría era el defecto entero.

  Lo que se hace es intercalar un espacio entre el `$` y el nombre **dentro del comentario**
  (`$_VAR_X` → `$ _VAR_X`), que es justo lo que hace que la regex deje de casar, y que para
  la base de datos es inerte: el comentario sigue siendo un comentario con el mismo texto.
  El espacio tiene que ir detrás del `$`; puesto delante, el `$` sigue pegado al
  identificador y la regex casa igual.

  El parche se instala en `ConnectionPool.js`, en `buildSequelize()` —el único sitio del
  proyecto donde nace una instancia Sequelize de endpoint—, así que cubre los endpoints que
  ya existen y los que se creen después sin tocar la definición de ninguno. Se sombrea
  `dialect.Query` con una subclase **de esa instancia** y no se asigna
  `dialect.Query.formatBindParameters`, porque `Query` vive en el prototipo de la clase del
  dialecto y las instancias del mismo motor comparten ese mismo objeto: una asignación
  normal las cambiaría a todas, incluida `lib/db/sequelize.js`, que es la conexión propia de
  la plataforma.

  **Para el autor de endpoints:** se acabaron los 500 por menciones en comentarios. Da igual
  si el comentario es de línea, de bloque, multilínea, o si menciona un nombre que también
  es un parámetro real de la consulta.

- **Un `$nombre` dentro de un literal de texto devolvía 200 con el dato cambiado.** El caso
  hermano, que era peor porque no se veía: `SELECT 'coste: $name'` contestaba HTTP 200 y el
  literal volvía como `coste: @name` — Sequelize sustituye el `$nombre` del literal por el
  valor del parámetro, y quien consume la respuesta no tenía forma de saber que lo que leyó
  no es lo que se escribió. Con un `"identificador entrecomillado"` igual, y con un cuerpo
  `$$…$$` de PostgreSQL.

  Aquí **no** se neutraliza, porque neutralizarlo exigiría reescribir el literal con
  concatenación —`+` en T-SQL, `||` en el resto—, que depende del dialecto, cambia el texto
  que recibe el cliente, y no se puede aplicar ni a un identificador entrecomillado ni
  dentro de un cuerpo `$$…$$`, donde no hay por dónde partirlo. En su lugar, la consulta se
  **rechaza con un 400** explicando el conflicto. Para las consultas que ya fallaban, es una
  mejora; para las que "funcionaban" con el dato alterado, es el fin de un 200 que mentía.

  **Para el cliente que llama a un endpoint:** es un cambio observable. Una consulta con un
  `$nombre` dentro de un literal o de un identificador entrecomillado que antes respondía 200
  ahora responde 400, con el motivo en el campo `error`. Para llegar a ese 400 antes
  tenía que venir en el `bind` de la petición el nombre del parámetro; si no coincidía con
  ninguno, la consulta reventaba con otro 500. El error lleva internamente
  `code: "SQL_BIND_INSIDE_LITERAL"`, que va al log del servidor; el cuerpo de la respuesta
  es `{ error, trace_id }` como el de cualquier otro error del handler.

  **Para el operador:** nada que migrar. La lista es el texto de los comentarios de las
  consultas, que ahora llevan un espacio de más delante del nombre; solo lo nota quien mire
  el log de consultas del motor, y ese log antes no era citable porque la consulta no llegaba
  a ejecutarse.

  Pruebas: `dev/test/sql_comments_test.js` (contra MSSQL real, 19 casos) y los 48 casos de
  `dev/test/sql_param_detection_test.js` para la parte pura.

## [13.11.31] - 2026-09-27

### Added

- **`stop_interval_task_run`: detener una corrida de interval task ya lanzada.**
  Antes no había forma de cortar una ejecución en vuelo: `exec_time_limit` (timeout) era el único
  backstop y deshabilitar la tarea solo evitaba corridas futuras. Ahora el worker registra un
  `AbortController` por corrida en vuelo y la nueva herramienta (POST `/interval_tasks/stop`,
  tool `stop_interval_task_run`) pide cortar el fetch real, con ack del worker para no prometer un
  aborto que no se confirmó. La corrida queda registrada como **estado 5 (aborted)** tanto en la
  tarea como en `ofapi_intervaltask_run`, y el filtro de historial lo acepta. Un aborto NO cuenta
  como fallo: no toca `failed_attempts`, no dispara backoff y no puede auto-deshabilitar; el
  horario se mantiene. Si la corrida ya terminó, responde `stopped: false` con
  `reason: "NOT_RUNNING"`.

  **Para el operador:** nada que migrar: el worker (`src/lib/timer/worker.js`), el supervisor
  (`src/lib/timer/tasks.js`) y el seed del endpoint van con el despliegue normal.

  **Para agentes y clientes:** nueva herramienta de escritura con contrato `{stopped, reason,
  message}`; 400 si falta `idtask`, 404 si no existe o no es UUID. Detalle en
  `src/docs/interval_tasks/AI_SKILL.md`.

### Changed

- **La versión del proyecto dejó de vivir en dos ficheros: `src/lib/server/version.js`
  desapareció.** La única fuente es `package.json`, que ahora lee `getVersion.js` en el
  arranque (`import.meta.url`, no el cwd). El modo de fallo que cerró la entrada `Fixed` de
  la versión anterior —un bump que no pasaba por `npm run set_version` dejaba el
  `version.js` desincronizado y la plataforma servía otra versión— ya no es representable:
  no hay segundo fichero que olvidar. `set_version.js` solo sube el parche en
  `package.json`, y `version_sync_test.js` sigue atando los tres sitios que importan (la
  constante exportada, lo que responde `/api/system/server/version/prd` y la entrada más
  reciente del CHANGELOG), porque el tercero sigue siendo la otra mitad del mismo commit.

  **Para el operador:** nada que hacer en el despliegue. Quien consuma la versión sigue
  leyéndola del mismo endpoint; solo cambia el origen interno del número.

### Fixed

- **Los handlers FUNCTION no podían llegar al worker: el wake de `run_interval_task_now`
  (y `reset_interval_task_attempts` y `delete_interval_task`) era un no-op silencioso.**
  `reply.openfusionapi.server` solo se adjuntaba cuando `handler == "JS"`, así que
  cualquier handler FUNCTION del app `system` (incluido el nuevo `stop_interval_task_run`)
  veía `TasksInterval === undefined` y la orden se descartaba sin error: `run_now` seguía
  funcionando pero la corrida solo arrancaba en el siguiente ciclo (hasta 60 s después),
  y el stop habría respondido `WORKER_UNAVAILABLE`. Ahora `serverApi` se expone a todos
  los handlers y la orden llega al worker de inmediato.

  **Para el operador:** nada que migrar; es un cambio de flujo que va con el despliegue.

## [13.11.30] - 2026-09-27

### Fixed

- **La versión que informaba la plataforma era falsa.** `GET /api/system/server/version/prd`
  —el endpoint que el README documenta para comprobar qué se ha instalado— respondía
  `13.11.15` con el árbol en `13.11.29`: **catorce parches de retraso**, y nada en el repo
  lo delataba.

  La causa es que el número de versión vive en dos sitios y solo uno se regenera.
  `set_version.js` lee `package.json`, le suma uno al parche, lo escribe ahí **y escribe a
  mano `src/lib/server/version.js`**. Ese segundo fichero es el que importa el endpoint, a
  través de la constante de `fnGetServerVersion` (`src/lib/server/functions/system/prd/index.js`).
  Basta con subir la versión en `package.json` sin pasar por `npm run set_version` para que
  el commit parezca completo y la plataforma siga diciendo otra cosa. Ninguna vez en catorce
  commits alguien se dio cuenta, porque no había nada que lo dijera.

  Medido antes y después, no deducido:

  ```
  $ curl localhost:3999/api/system/server/version/prd
  {"version":"13.11.15","ddbb":"sqlite"}
  $ node -p "require('./package.json').version"
  13.11.29
  ```

  Con `13.11.30` los tres sitios —`package.json`, `src/lib/server/version.js` y la entrada
  más reciente de este CHANGELOG— dicen lo mismo, y el endpoint responde
  `{"version":"13.11.30",...}`.

  Consecuencia práctica más allá de la trazabilidad: si el despliegue compara la versión que
  devuelve la API con la que espera para continuar, esa comparación llevaba catorce parches
  decidiendo sobre un número que no era el del código.

- `dev/test/version_sync_test.js`: suite pura, registrada en el packet, que vigila los tres
  sitios. No se queda en comparar dos ficheros: el paso 2 llama a `fnGetServerVersion` de
  verdad y comprueba que lo que sale por la API es esa versión, porque la deriva importaba
  justo por eso. Con `version.js` desincronizado da `13.11.15` contra `13.11.29`; con el
  endpoint desconectado de la constante da `0.0.0` contra la de `package.json`; y con el
  bump sin entrada en este CHANGELOG, el paso 3. Los tres se comprobaron en rojo.

### Changed

- **El `idtask` de las interval tasks dejó de ser un entero autoincremental y es un UUID.**
  `note` deja de participar en cualquier llave y queda como etiqueta de texto libre para el
  humano — puede repetirse o faltar sin romper nada.

  La causa: un `idtask` autoincremental designa una fila de *esta* base en *este* instante, y
  la identidad de una tarea tiene que valer entre instancias. El seed declaraba los ids 2..6
  y el seeder los descartaba dejando que la base asignara 1..5, así que el arranque siguiente
  encontraba el idtask=3 del seed ("events scan") apuntando a la fila 3, que contenía el
  *digest* —ambas tareas comparten endpoint— y la pisaba; el digest se reinsertaba como fila
  nueva y quedaba una "events scan" duplicada disparando cada 60 s. El restore del backup
  intentaba arbitrar esto con `(idendpoint, note)` como clave natural, y la `note` no lo es:
  es opcional y puede repetirse, de modo que dos tareas sin nota colapsaban en el mismo match
  y el restore les heredaba el idtask a cualquiera de ellas, dejando el historial de
  `ofapi_intervaltask_run` apuntando a la tarea equivocada.

  Ahora el UUID genera la identidad y viaja en el backup. El restore honra el `idtask` del
  backup (lo inserta tal cual si no existe), el seed declara los UUIDs fijos de sus 5 tareas
  y `validateSystemTasks` los comprueba por id en vez de por `(idendpoint, note)`.

  **Para el operador (despliegue):** es un cambio de esquema. Hay que soltar las dos tablas
  `ofapi_intervaltask` y `ofapi_intervaltask_run` y dejar que el arranque las recree con el
  esquema UUID; la reconstrucción recrea las 5 tareas del seed con sus UUIDs fijos y el
  historial de ejecuciones (**`ofapi_intervaltask_run`**) se pierde — era descartable. Un
  backup de aplicación tomado antes de la migración se restaura igual: trae `idtask`
  enteros, que no se consultan contra la columna uuid (sería `22P02` en PostgreSQL y
  tumbaba el restore entero) y se insertan con un UUID nuevo.

  **Para quien llama a la API o al MCP:** `idtask` sale y entra como **string UUID** (los 5
  esquemas MCP de la app `system` pasaron de `integer` a `string` + `format: uuid`). Un
  `idtask` inexistente sigue siendo 404 — no se crea una tarea con ese id. Los `dev/test`
  con el contrato (`interval_task_upsert_test.js`, `backup_restore_test.js`) se actualizaron,
  y el paso 7b de `backup_restore_test.js` fija la regresión exacta del bug: dos tareas del
  mismo endpoint sin `note` sobreviven a un restore sin pisarse.

## [13.11.29] - 2026-09-27

### Documentation

- `README.md`: sección nueva, **«🌱 The Seed And Your Data»**, que dice qué le hace un
  arranque a una base de datos que ya tiene datos. Antes solo había una línea suelta dentro de
  las notas de operación, y no recogía lo que más importa al operador.

  La línea anterior no era inexacta, pero sí insuficiente: `BUILD_DB=true` no es un
  instalador de una sola vez —en **cada** arranque corre `dbAPIs.sync({ alter: true })` y se
  vuelven a aplicar las apps, usuarios, api clients, métodos y tareas por defecto—, y eso no
  se decía en ninguna parte. Ahora queda escrito, y con el detalle que faltaba:

  - **Qué reemplaza un arranque.** Para un endpoint que está en el backup de `system` o
    `demo`: el código editado vuelve al del seed (también si se editó por
    `POST /api/endpoint`), un `enabled: false` vuelve a `true`, y un endpoint del seed que se
    borró se repone. Es lo correcto para un backup, y `system` es la app de administración:
    sus endpoints se mantienen en `src/lib/db/default/`, no a mano.
  - **Qué no toca.** Los endpoints que **no** están en ese backup son del operador: su
    código, su `enabled`, su bloque `mcp`, y las app vars, tareas de intervalo y usuarios de
    cualquier app. También los endpoints que se añadan a `system` o a `demo`.
  - **La política de la propiedad del `mcp.name`**, con el mensaje del log tal cual sale y la
    razón de que se desactive además de quitarse el nombre: el listado de herramientas filtra
    por `mcp.enabled` y no mira el nombre.
  - **Que un cambio revertido no está perdido**: cada escritura deja copia en
    `ofapi_endpoint_bkp` y `POST /api/endpoint/restore` la recupera. La excepción es el
    esquema, que va justo en el punto siguiente.
  - **Que el esquema es del código.** `sync({ alter: true })` hace que las tablas coincidan con
    los modelos de `src/lib/db/models.js`: una columna que el modelo no conoce se dropea. Es
    deliberado —la base no se edita a mano, se cambia el modelo— y es la única parte del
    arranque que destruye algo sin copia en ninguna parte.

  Todo lo anterior está medido en PostgreSQL y en MSSQL, y la parte del borrado por conflicto
  de nombre MCP es lo que arregla 13.11.28.

## [13.11.28] - 2026-09-27

### Fixed

- **El arranque ya no borra endpoints que no están en el backup.** Al aplicar el seed
  (`defaultApps()` → `restoreAppFromBackup`), un endpoint del operador que compartiera
  `mcp.name` con uno del backup **desaparecía** de la base, y el único rastro era una línea
  de log con un UUID y las palabras `before restore`, que leen como un paso mecánico del
  restore. Medido de punta a punta en PostgreSQL y en MSSQL, y por la API sin tocar la base
  a mano: `DELETE /api/endpoint` sobre un endpoint del seed, `POST /api/endpoint` para crear
  uno propio reutilizando su `mcp.name`, reinicio, y el endpoint propio ya no está. Se
  llegaba con un `Endpoint.destroy` sin backup previo, y un backup no puede borrar lo que no
  trae.

  Ahora se distinguen los dos casos que antes se trataban como uno:

  | El que tiene el nombre | Qué hace el arranque |
  |---|---|
  | Es un endpoint **del propio backup** (una versión anterior del seed lo dejó en otra ruta y conservó el `mcp.name`) | Se borra, como siempre. Sin esto el seed deja de reponer sus propios endpoints, y eso también falla en silencio. |
  | Es un endpoint **propio del operador** | **Conserva su fila** y deja de exponerse como herramienta MCP: se le quita el `mcp.name` en disputa y se pone `mcp.enabled = false`. |

  Desactivar además de quitar el nombre no es un detalle: el listado de herramientas MCP
  filtra por `mcp.enabled` y no mira el nombre, así que un `enabled` sin `name` sería una
  herramienta expuesta con el nombre vacío. Sin `mcp.name` el conflicto tampoco se repite en
  el siguiente arranque.

  El mensaje del log dice ahora de quién era el endpoint —su `resource`, su `method`, su
  `environment`— y que conserva la fila, en vez de un UUID suelto. El nombre MCP lo gana el
  seed porque el backup es la fuente de verdad de `system` y `demo`.

  Lo que el arranque **sí** sigue haciendo, y es lo correcto para un backup: revertir el
  código editado, reactivar lo que se desactivó y reponer lo que se borró, en los endpoints
  que el backup trae. Lo que no puede es tocar los que no trae.

- `dev/test/mcp_conflict_on_restore_test.js`: suite nueva, registrada en el packet, que
  ejecuta la función real contra un doble de `Endpoint` y comprueba qué caso toma cada
  endpoint. Un `grep` sobre el fuente no distinguiría nada: pasaría con el `destroy`
  escribiendo en una rama muerta, y pasaría también con el `destroy` correcto, que se queda
  para los endpoints que sí son del backup.

## [13.11.27] - 2026-09-27

### Changed

- `dev/test/README.md`: el apartado sobre el único fichero que lee la base de datos cuenta
  ahora que desde 13.11.25 también **escribe** en ella. Explica por qué —el lote de limpieza no
  puede borrar por la API al usuario `as_admin` que la propia suite crea, porque esa protección
  es correcta— y por qué el borrado se hace en el mismo orden que `deleteUser`. Es una razón
  más para que ese fichero no entre en el packet como suite.

---

## [13.11.26] - 2026-09-27

### Fixed

**La comprobación de huérfanos comparaba contra el número de tareas de intervalo de un seed que ya
no existe.** Cierra el segundo colateral que 13.11.24 dejó documentado, y con él el último `FAIL`
de `mcp_exhaustive_validation.js`.

```js
const dbTasks = db.prepare("SELECT COUNT(*) AS n FROM ofapi_intervaltask").get().n;
check("solo quedan las tareas de intervalo seed (1 disable y 1 cleanup)", dbTasks === 2, `n=${dbTasks}`);
//                                                                                   ^^ el numero
//                                                                               y el comentario
```

El `=== 2` llevaba un comentario que explicaba de dónde salía el 2, y el seed de hoy crea **5**:
limpieza de recuperaciones, dos de avisos de admin, uno de grupos de app y uno de poda del log de
auditoría. Los cinco son legítimos y `enabled=1`.

**Poner 5 habría sido el arreglo fácil y el equivocado.** No afloja una aserción: la aserción
—«no ha quedado nada de lo que la suite creó»— seguía siendo correcta, lo caducado era el número
de la derecha. Y un número escrito a mano se pudre otra vez en cuanto el seed crezca, que es
justo lo que pasó.

Lo que no puede pudrirse es una **foto**. El preflight toma la tabla antes de que la suite toque
nada, y el lote de limpieza la compara:

```js
const intervalTasksAtStart = db.prepare("SELECT idtask, note FROM ofapi_intervaltask ORDER BY idtask").all();
// …al final…
check("ninguna tarea de intervalo creada por la suite sobrevive, y ninguna del seed desaparece",
  sobran.length === 0 && faltan.length === 0, /* … */);
```

Si el seed crece, la foto crece con él y la comparación sigue valiendo. Se comparan `idtask` y
`note`, no estados, porque el planificador va cambiando `enabled` y `status` de las suyas mientras
la suite corre y eso no es que la suite haya dejado nada.

**El detalle nombra qué filas sobran o faltan**, no cuántas, que es la diferencia entre un fallo
diagnosticable y otro que obliga a ir a mirar la tabla.

**Verificación, por las dos vías.** En rojo, con una fila de más y una de menos insertadas en una
copia del fichero justo después de la foto: el check nuevo nombra las dos —
`sobran=6:Tarea Inventada Por La Prueba` y `faltan=2:Admin Alerts - events scan`— frente al
`n=5` mudo del check viejo. Y con `antes=5 despues=5`: **el recuento bruto era idéntico**, así que
el `=== 2` no habría dicho ni una palabra de qué estaba mal. En verde, base creada desde cero:
**79/79**, y el fichero sale con 0 por primera vez.

---

## [13.11.25] - 2026-09-27

### Fixed

**`mcp_exhaustive_validation.js` exigía borrar por MCP un usuario que la propia suite había creado
como `as_admin`, y la comprobación que lo detectaba no decía por qué.** Cierra el primer
colateral que 13.11.24 dejó documentado. **El defecto es de la suite, no del producto.**

El actor de estas llamadas es la api key del app `system`, y ese usuario no es `as_admin`; el
usuario A sí lo es, porque el BUG-8 necesita que lo tenga. La ruta hace lo correcto:

```json
{"error":"Permission denied: cannot delete an as_admin account."}
```

El usuario B, creado sin permisos, se borra sin problema. O sea: una cuenta sin `as_admin` no
puede borrar una con `as_admin`, y esa protección **no se toca**. Arreglarlo debilitando la ruta
para que la limpieza de un test sea más cómoda sería arreglar el producto desde el test.

Lo que corresponde es lo que un lote de limpieza promete de verdad: que la plataforma se niegue y
que el huérfano desaparezca igualmente.

```js
// antes: espera algo que por diseño no puede pasar, y sin detalle que lo explique
check("user_delete A", !delU.isError && delU.data?.success === true);

// ahora: comprueba el denegado correcto, y limpia por la base en el orden de `deleteUser`
const denegado = delA.isError && /cannot delete an as_admin account/.test(String(delA.data?.error || ""));
check("user_delete A (as_admin) denegado al actor sin as_admin, por diseño", denegado, /* ... */);
db.prepare("DELETE FROM ofapi_password_recovery WHERE iduser = ?").run(userAId);
db.prepare("DELETE FROM ofapi_user WHERE iduser = ?").run(userAId);
```

El orden no es libre: `ofapi_password_recovery` va antes que `ofapi_user` porque es clave foránea,
y es el mismo criterio que usa `deleteUser` al borrar. El `as_admin` de A se queda en la base hasta
el final a propósito, porque hace falta para el BUG-8.

**De paso, los otros 16 checks que tampoco pasaban `detail`.** El defecto no era de esa línea sino
del fichero entero: de 68 llamadas a `check()`, **17 no tenían tercer argumento**, así que cuando
fallaban no decían nada. Con el arreglo son **0**. Los dos que comprobaban sintaxis ahora
recogen el mensaje del `catch` en vez de tragárselo, y el que verifies el código recuperado
distingue "0 chars" de "no devolvió código".

**Y una que no podía fallar nunca.** `check("servidor sigue vivo tras arranque de bot con token
falso", true)` tenía el segundo argumento constante. Ahora sondea de verdad, por el mismo endpoint
público que usa el preflight, y va en `try` porque `http()` no captura y `fetch` lanza si no hay
nadie escuchando: sin el, el escenario que esa comprobación existe para detectar —que el bot lo
tumbe— no daría un `FAIL` con motivo sino una excepción sin resumen.

**La comprobación de cascada no comprobaba cascadas.** Decía `no quedan filas de recuperación
para A (CASCADE)` y las dos cosas eran falsas: A ya no pasa por `deleteUser`, y `deleteUser` borra
las recuperaciones con un `destroy` explícito, no con una cascada. Ahora apunta a B, que sí pasa por
`deleteUser`, se llama como lo que verifica, y hay una segunda que cubre a los dos usuarios.

**Verificación, por las dos vías.** En rojo, con solo el bloque de `user_delete` en su estado
anterior —el resto del fichero intacto, porque revertirlo entero devolvería el fallo del punto 6—
: **74/77**, con `user_delete A` en `FAIL` y el `detail` vacío, y el de recuperación en `FAIL`.
En verde, mismo servidor y misma base: **78/79**, los dos fallos fuera y el único que queda es la
aserción caducada del punto 8. 77 → 79 comprobaciones, dos de ellas nuevas.

### Changed

- `dev/test/mcp_exhaustive_validation.js`: 17 comprobaciones con motivo de fallo, una tautología
  convertida en comprobación real, y el lote de limpieza de usuarios reescrito para no exigir lo
  que la plataforma no debe permitir.

---

## [13.11.24] - 2026-09-27

### Fixed

**`mcp_exhaustive_validation.js` leía la base de datos de una ruta que no es la de nadie, y no
había forma de decirle otra.** Cierra el punto 6 que 13.11.23 destapó al arreglar el punto 5.

```js
const DB_PATH = path.join(REPO_ROOT, "temporales", "ofapi12.sqlite");   // antes
const DB_PATH = path.resolve(
  process.env.OFAPI_TEST_DB_PATH?.trim() || path.join(REPO_ROOT, "temporales", "ofapi12.sqlite"),
);                                                                       // ahora
```

**El fallo era peor que no encontrar el fichero.** `DatabaseSync` **crea** el fichero si no
existe, así que en una máquina donde alguien lo creó a mano una vez, ahí sigue, con 0 bytes, y
la suite moría con `no such table: ofapi_password_recovery`: una queja sobre las tablas cuando
la causa es la ruta. Con el `TMPDIR` del packet, donde la plataforma escribe su SQLite en
`$TMPDIR/ofapi.sqlite`, no hay nada que leer y las comprobaciones que dependen de la base
fallaban por otra causa.

Es el mismo patrón y el mismo criterio que `OFAPI_BASE_URL` en 13.11.21–13.11.23, y con la misma
convención de normalización: **un valor inválido cae al por defecto, no a un valor degenerado**.
De ahí el `?.trim()`. Sin él, `OFAPI_TEST_DB_PATH="   "` es *truthy*, un `||` a secas lo deja
pasar y `path.resolve` devuelve la ruta absoluta de un directorio llamado con espacios. El
defecto —la ruta antigua— **no se mueve**: es lo que permite distinguir "arreglado" de
"cambiado de sitio".

Lo que no cubre el arreglo: `DATABASE_URL`. Este fichero abre SQLite con `node:sqlite` para
acuñar api keys firmadas con el `jwt_key` de una app igual que hace su procesador, así que
contra PostgreSQL, MSSQL o HANA **sigue sin poder ejecutarse**, y ahora se dice en su cabecera
en vez de que se descubra al usarlo.

**Verificación, por las dos vías.** En rojo, con `OFAPI_TEST_DB_PATH` apuntando a una base que
*sí* tiene `ofapi_password_recovery`: exit 2, `no such table`, y el check de `ctrl.as_admin`
(BUG-8) fallando por leer una base vacía. En verde, mismo comando: cero ocurrencias de las tres
firmas del rojo, 74/77 comprobaciones OK, y el fichero **llega por fin al final**, que antes no
llegaba. La regresión es `db_path_override_test.js`, nueva suite pura registrada en el packet
(41 → 42).

**Y un aviso, porque el arreglo destapa lo que tapaba.** El fichero moría en el lote R, antes
del lote de limpieza, así que la última tanda de comprobaciones **nunca se había ejecutado en
esta máquina**. Ahora se ejecuta, y de 77 salen 3 fallos. No son de este arreglo —este solo
cambia de dónde se lee— pero solo se ven porque este las desbloqueó:

- **`user_delete` vía MCP no borra al usuario `as_admin`** (el B, sin permisos, sí se borra), y
  en cascada se queda su fila en `ofapi_password_recovery`. El check que lo detecta no le pasa
  `detail` a `check()`, así que además pierde el motivo: **una comprobación que falla sin decir
  por qué es media comprobación**.
- **La aserción del seed está caducada.** Dice `dbTasks === 2` con el comentario «1 disable y 1
  cleanup», y el seed actual crea **5**: cleanup de recuperaciones, dos de avisos de admin, uno
  de grupos de app y uno de poda del log de auditoría. El número es un número mágico que se
  pudrió; el arreglo es que no se pudra.

Ninguno de los dos se toca aquí, porque son hallazgos nuevos y esta serie va de uno en uno. Quedan
documentados y pendientes de decisión.

### Changed

- `dev/test/README.md`: el apartado de ficheros huérfanos dice ahora de dónde lee la base
  `mcp_exhaustive_validation.js`, y por qué `DATABASE_URL` no le sirve.

---

## [13.11.23] - 2026-09-27

### Fixed

**Nueve ficheros más de `dev/test` leían mal la URL base. Ocho son suites del packet, así que
esto estaba en el camino de cada `npm test`.**

Cierra el punto 5 que 13.11.21 abrió y 13.11.22 contaba con las cifras exactas. De los
catorce ficheros que nombran un servidor, **los nueve que lo hacían mal lo hacen bien ahora**:
trece leen `OFAPI_BASE_URL` y el único que no, el runner, es porque no debe.

| fichero | antes | ahora |
|---|---|---|
| `bot_backup_test.js`, `bot_crud_test.js`, `bot_resilience_test.js`, `fetch_timeout_test.js`, `integration_test.js`, `mcp_exhaustive_validation.js` | `localhost:3000` escrito a pelo, sin override | `TEST_BASE_URL` |
| `cache_validation.js` | `CACHE_TEST_BASE_URL` | `OFAPI_BASE_URL`, con el nombre viejo de repliegue |
| `owasp_top10.js` | `OWASP_BASE_URL` | ídem |
| `ws_cache_events.js` | `WS_CACHE_TEST_BASE_URL` | ídem |

Los tres nombres privados se quedan como repliegue en vez de desaparecer: hoy funcionan, y
tirarlos sin avisar costaría una hora a quien los tenga puestos.

**La comprobación de las seis primeras no era la que parecía.** Con `OFAPI_BASE_URL` apuntando a
un puerto cerrado, cinco de las seis fallan con `ECONNREFUSED` y
`mcp_exhaustive_validation.js` falla por otra cosa. Y las tres del segundo grupo **no fallan en
absoluto**: `cache_validation.js`, `owasp_top10.js` y `ws_cache_events.js` arrancan su propio
servidor. No es un detalle: si la sonda de readiness no encuentra nada en el puerto de la URL,
hacen `spawn` de `src/server.js` con `PORT` tomado de esa misma URL, así que apuntar a un puerto
vacío no las rompe: se levantan ahí y probando lo de siempre, contra su propio servidor. Esa
razón es justo la que explica que tuvieran una variable con nombre propio.

Por eso el rojo hubo que medirse con otro instrumento. Se puso un servidor **falso** en el 3999
que contesta 200 a todo y **cuenta quién le habla**, y se comparó el código viejo con el nuevo
sobre la misma corrida:

| suite | código viejo, `OFAPI_BASE_URL=:3999` | código nuevo, `OFAPI_BASE_URL=:3999` | código nuevo, sin variable |
|---|---|---|---|
| `cache_validation.js` | salida 0, **0 peticiones** al falso | salida 1, **7 peticiones** | salida 0, 0 al falso |
| `owasp_top10.js` | salida 0, **0 peticiones** | salida 1, **3 peticiones** | salida 0, 0 al falso |
| `ws_cache_events.js` | salida 0, **0 peticiones** | salida 1, **3 peticiones** | salida 0, 0 al falso |

Cero peticiones con el código viejo es la prueba: se fueron a `localhost:3000` con la variable
puesta a otra cosa. Y que sin variable sigan en verde, con cero peticiones al falso, es lo que
confirma que el caso normal no se ha roto.

**Una decisión mía que estaba mal, corregida por medición.** Al derivar la URL base de
`ws_cache_events.js` escribí que su websocket **no** debía derivarse, porque montar a mano la URL
del protocolo parece inventarse una ruta que puede no ser la real. Al probar se vio que era
justo al revés: con la base en otro puerto y el websocket en el de por defecto, la suite fallaba
**sin `ECONNREFUSED`**, que es la forma más difícil de leer que hay. Lo que cambia con la
instancia es el host y el puerto, que es justo lo que trae la URL base; lo único que no se
inventa es la ruta del protocolo, que es fija y se conoce. Así que ahora se deriva la parte que
se sabe:

```js
const WS_URL =
  process.env.WS_CACHE_TEST_WS_URL ||
  `${BASE_URL.replace(/^http/, "ws")}/ws/system/websocket/server/prd`;
```

Con la base por defecto el valor es **byte a byte el mismo** que el de antes
(`ws://localhost:3000/ws/system/websocket/server/prd`), y `https` produce `wss`. El nombre
propio se respeta si está puesto: con `WS_CACHE_TEST_WS_URL` apuntando al falso, el handshake
llega al falso.

**Regresión:** el packet pasa de 41/41 a **41/41** con los nueve ficheros cambiados dentro,
0 fallos y 0 saltadas. Ocho de ellos se ejecutan en cada pasada del packet, así que el verde de
41/41 es la prueba de que el cambio no rompió ninguna.

**Un defecto que se ha visto de paso y que no se arregla aquí:** `mcp_exhaustive_validation.js`
lee la base por una ruta escrita a pelo, `temporales/ofapi12.sqlite`, y con la base actual del
packet eso le da `no such table: ofapi_password_recovery`. Es la misma familia de fallo que
este commit —una ruta fija en vez de configurable— pero arreglarlo pide decidir de dónde lee,
que no es una decisión de una línea.

## [13.11.22] - 2026-09-27

### Fixed

**Las cifras del punto 5 de 13.11.21 eran falsas, y se corrigen a contadas.**

13.11.21 afirmaba «son 2 de 10 ficheros con la convención correcta, y 8 con la suya propia
o ninguna». Recuento de ficheros de uno en uno, son **catorce ficheros los que nombran un
servidor**: cuatro lo hacen bien, nueve lo hacen mal y uno lo hace a propósito. El error no
era de criterio sino de recuento, y venía de contar mal la primera vez: la búsqueda inicial no
pillaba ni `const BASE = "http://localhost:3000"` ni el `fetch` suelto del runner, así que
salieron dos ficheros menos y el total se quedó en diez.

Lo que se corrige:

| | decía 13.11.21 | son |
|---|---|---|
| Ficheros que nombran un servidor | 10 | **14** |
| Con la convención correcta | 2 | **4** |
| Sin override, URL a pelo | 5 | **6** |
| Con variable privada propia | — | **3** |
| El runner, a propósito | — | **1** |
| De los que la hacen mal, registrados en el packet | 8 | **8**, pero ahora se sabe que de nueve, no de ocho |

La conclusión de 13.11.21 se sostiene y es la que importa: poner `OFAPI_BASE_URL` y lanzar
`npm test` sigue apuntando a `localhost:3000` en ocho de las suites que el packet ejecuta. Lo
que se cae es el recuento, no la conclusión.

Ninguna de estas correcciones toca código: solo los números y la tabla que los acompaña, en el
CHANGELOG y en el README de `dev/test`. La versión sube porque en esta serie cada commit la
sube, no porque el comportamiento cambie.

## [13.11.21] - 2026-09-27

### Fixed

**Dos suites de `dev/test` ignoraban `OFAPI_BASE_URL` en silencio, así que se podían pasar
contra el servidor equivocado.**

`system_test.js` llevaba la URL escrita a pelo: `const baseUrl = "http://localhost:3000"`. No
es que no se pudiera apuntar a otra instancia; es peor que eso. Poner `OFAPI_BASE_URL` a otra
dirección no daba ningún error, ni warning, ni cambio de comportamiento: la suite se iba
contra `localhost:3000` y salía con código 0. Una prueba que se ejecuta contra el sitio que
no es no es una prueba que falle, es una garantía falsa, y de las caras.

El fallo se ve mejor desde dentro. `test_credentials.js` exporta `TEST_BASE_URL`, que ya lee
`OFAPI_BASE_URL` con `http://localhost:3000` por defecto, y lo usan las 11 suites que se
autentican con el par `admin`. `system_test.js` importaba de ese mismo fichero —para las
credenciales— y aun así se definía su propia URL. La convención ya estaba escrita; el
fichero era la excepción.

`exception_payload_test.js` tenía el mismo defecto con otro nombre: leía `OFAPI_TEST_URL`, que
no aparece en ningún otro fichero del repositorio, no está en `env.example` y no está en
ningún README. Ahora ambos toman `OFAPI_BASE_URL`, y `OFAPI_TEST_URL` se queda como repliegue
silencioso en vez de desaparecer: dos nombres para lo mismo acaban siendo dos que no
coinciden, y tirarlo sin avisar costaría una hora a quien lo tuviera puesto.

Verificado en rojo antes que en verde, y por las dos vías, con un servidor vivo en `:3000` para
que el rojo significara algo:

- **En rojo**: con el código anterior, `OFAPI_BASE_URL=http://localhost:3999` —un puerto
  cerrado— salía con **código 0** y las cuatro etapas en verde. Se había ejecutado entera
  contra el servidor de siempre, que es exactamente el fallo.
- **En verde**, las siete comprobaciones, con la suite real y el puerto cerrado:

| suite | sin variable | `OFAPI_BASE_URL=:3000` | `OFAPI_TEST_URL=:3000` | `OFAPI_BASE_URL=:3999` |
|---|---|---|---|---|
| `system_test.js` | 0 | 0 | — | 1, `ECONNREFUSED` |
| `exception_payload_test.js` | 0 | 0 | 0 | 1, `ECONNREFUSED` |

Que el puerto cerrado ahora dé `ECONNREFUSED` en vez de pasar es el resultado que importa: la
variable manda. Y que las tres primeras columnas sigan en 0 confirma que no se rompió el caso
normal, que es el que se ejecuta siempre.

Ninguna de las dos suites está en el packet, y `OFAPI_BASE_URL` no toca la plataforma: solo
afecta a estos dos scripts de prueba.

**Lo que este arreglo no arregla, y conviene no dejarlo en un rincon:** este directorio no
tiene una convención de URL base, tiene tres, y ninguna está completa. De los catorce
ficheros que nombran un servidor, **cuatro la leen bien** —los dos de este commit,
`test_credentials.js` y `handler_db_matrix.mjs`—, **nueve la hacen mal** y uno la ignora a
propósito. De los nueve:

- **Seis la tienen escrita a pelo**, sin override: `bot_backup_test.js`, `bot_crud_test.js`,
  `bot_resilience_test.js`, `fetch_timeout_test.js`, `integration_test.js` y
  `mcp_exhaustive_validation.js`. Cinco de esos seis son suites del packet.
- **Tres se inventaron una variable privada**: `CACHE_TEST_BASE_URL` en `cache_validation.js`,
  `OWASP_BASE_URL` en `owasp_top10.js`, y `WS_CACHE_TEST_BASE_URL` más
  `WS_CACHE_TEST_WS_URL` en `ws_cache_events.js`. Las tres son suites del packet.

El décimo fichero es `index.js`, que arranca el servidor en `:3000` y sondea `:3000`: ahí
ignorar la variable es lo correcto, con la consecuencia de que **el packet entero no se puede
apuntar a otra instancia**. Poner `OFAPI_BASE_URL` y lanzar `npm test` sigue yendo a
`localhost:3000` en ocho de las suites que lo ejecutan.

## [13.11.20] - 2026-09-27

### Changed

**Tres scripts de `dev/test` que no ejecutaba nadie dicen ahora, en su propia cabecera, qué
son y por qué nadie los ejecuta.**

`dev/test/` tiene 53 ficheros y 41 de ellos son suites del packet. Los tres que quedan en esa
categoría —`mcp_live_validation.js`, `mcp_exhaustive_validation.js` y
`mcp_schema_conversion.js`— no están registrados ni tienen npm script, así que solo arrancan
escribiendo el nombre. Un script de validación de 600 líneas en el repositorio aparenta
cobertura que no existe, y eso es peor que no tenerlo.

La causa no era que nadie hubiera decidído ejecutarlos: era que **nadie había leído lo que
hacen**. Al comprobarlo para escribir las cabeceras:

- **`mcp_schema_conversion.js` no convierte esquemas.** Su `main()` llama en vivo a la tool MCP
  `validate_json_schema_for_mcp` y comprueba que la respuesta no traiga banderas de
  incompatibilidad. El nombre del fichero prometía una transformación pura de ficheros y no
  lo es: necesita la plataforma en marcha, como los otros dos.
- **`mcp_exhaustive_validation.js` muta de verdad**: crea usuarios, crea `api_clients` y deja
  filas de recuperación de contraseña. Es el único de los tres que **no debe entrar nunca en
  el packet**, porque ensuciaría el estado que las demás suites comprueban. Lo declaran sus
  14 llamadas de escritura, sin necesidad de leerlas enteras.
- Los tres necesitan la plataforma en marcha, y eso no lo decía nada.

También se corrigen tres datos de `dev/test/README.md` que 13.11.17 a 13.11.19 dejaron
desfasados: las suites registradas pasan de 37 a 41, los ficheros que no son suites de 17 a
13, y `system_test.js` ya no está en rojo.

Nada de esto cambia el comportamiento de nada. Lo que cambia es que un fichero que puede
parecer una suite y no lo es lo dice en su primera línea, y que su nombre ya no promete lo que
no hace.

## [13.11.19] - 2026-09-27

### Fixed

**Un fallo de `system_test.js` dejaba el endpoint `/test_ping_js` puesto en la app `demo`.**

La suite creaba el endpoint, ejecutaba los pasos 4 y 5 y lo borraba al final, sin nada en medio.
Un fallo en cualquiera de esos dos pasos se llevaba por delante el borrado, y como el paso 5
llevaba roto desde antes de esta serie, el endpoint se quedaba ahí en todas las pasadas. Se
vio al reproducir ese fallo: la suite terminó sin imprimir ni `Cleaning up`.

La solución obvia —meter el borrado en un `finally`— **no habría funcionado**:
`process.exit()` no ejecuta el `finally`, que es justo lo que hacían los dos `process.exit(1)`
de esos pasos. Con ellos dentro, el `finally` da una sensación de seguridad que no tiene. Así
que los dos `process.exit(1)` de dentro son ahora `throw`, y el error se relanza después de la
limpieza. Los dos que quedan fuera (login y catálogo de apps) sí son legítimos: en esos
pasos todavía no hay nada que limpiar.

El `idendpoint` se lee ahora dentro del bloque protegido. Antes se leía fuera, así que un
`data` o un `result` ausente reventaba con un `TypeError` en esa línea, ya con el endpoint
creado y sin limpieza posible. Si aún así no hay id —un `200` sin `idendpoint` en el cuerpo—
el borrado es imposible, porque el `DELETE` va por id, y la suite lo dice en voz alta en vez de
fingir que limpió.

Verificado en rojo antes que en verde, y por las dos vías:

- **Con un fallo inyectado** en mitad del paso 4, la suite sale con código 1 **y borra**:
  `Endpoint deleted.` aparece en la salida y la tabla `ofapi_endpoint` se queda sin filas de
  `/test_ping_js`.
- **Con un `200` sin `idendpoint` inyectado**, la rama que no puede borrar avisa con `NO SE PUDO
  LIMPIAR` y sale con código 1, que es lo único honesto que puede hacer.
- **En verde**, contra la plataforma real: código 0, 79 herramientas MCP descubiertas y cero
  filas de residuo.

Un matiz que hace el fallo menos grave de lo que suena, y que conviene no callar: el paso 3
hace `upsert` sobre el recurso, así que la fila huérfana no se acumula sin límite —la
siguiente pasada la reutiliza y la borra si llega al final. Lo que sí pasó era que, con el
paso 5 roto, ninguna pasada llegaba nunca al final.

La suite **sigue fuera del packet**, y ahora por una razón que se sostiene: muta la app `demo`,
así que meterla en el packet hace que cada pasada cree y borre un endpoint compartido.

## [13.11.18] - 2026-09-27

### Added

**Cuatro suites que pasaban y que nadie ejecutaba entran en el packet de validación.**

`dev/test/index.js` es una lista escrita a mano: dejar un fichero en `dev/test/` no lo
registra, y por eso había cuatro suites en verde que no se ejecutaban en ninguna pasada. No
es un detalle de forma, porque las cuatro cubren código que esta misma serie de arreglos
tocó.

| Suite | Qué cubre |
|---|---|
| `interval_task_schedule_test.js` | `src/lib/timer/schedule.js`: cálculo de `next_run`, backoff, suelo y techo del retraso del planificador, cron y corte por fallos |
| `interval_task_response_outcome_test.js` | `src/lib/timer/responseOutcome.js`: cómo se lee el éxito o el fallo de la respuesta de una tarea |
| `tasks_interval_supervisor_test.js` | `src/lib/timer/tasks.js`: el supervisor que lanza el worker del planificador, con un worker falso |
| `code_validator_callback_chain_test.js` | La regla del validador que marca un `return` dentro de una cadena de `await` en un handler de grammy |

Las tres primeras son las que importan para lo arreglado hace poco: los topes
`MIN_SCHEDULER_DELAY_MS` y `MAX_SCHEDULER_DELAY_MS` viven en el mismo módulo que la
primera, y el criterio que decide si una tarea se marca DONE o ERROR —y por tanto si se
reprograma— es lo que comprueba la segunda. Un fallo ahí no se ve en la pasada en la que
se introduce: se ve semanas después, como una tarea que no se ejecuta nunca.

Verificado: el packet pasa de **37/37 a 41/41** con las cuatro dentro, en verde, con 0
fallos y 0 saltadas. Tardan entre 0.0 y 0.1 s cada una, porque no abren ni servidor ni
conexión: son unitarias puras sobre `src/`.

## [13.11.17] - 2026-09-27

### Fixed

**`system_test.js` no pasaba desde antes de la serie H23-H38, y el motivo no era el MCP.**

El endpoint `/api/system/mcp/server/:environment` no contesta JSON: contesta SSE
(`content-type: text/event-stream`), con un bloque `event: message` y el JSON-RPC entero en
la línea `data:`. El helper `call()` de la suite lo leía con `res.json()`, que revienta; el
helper se tragaba el error y devolvía `data: null`, así que la suite moría en la línea
siguiente con

```
TypeError: Cannot read properties of null (reading 'result')
```

que es el síntoma más caro de los posibles, porque parece un servidor MCP roto y es un test
roto. Peor: la línea que reventaba estaba a mitad del fichero, muy lejos del helper que había
fallado, así que el mensaje no señalaba el paso 5 sino el principio.

Con `admin:admin@admin` fijo, que el seed nunca creó, la suite no llegaba ni al paso 5; el
commit `a67e99a` lo cambió por `basicAuthHeader()` y arregló el login de paso, que es lo que
dejó al descubierto este fallo.

El arreglo son 25 líneas y ninguna toca la plataforma. El helper decide por `content-type` y,
cuando es SSE, lee el texto y saca el payload de las líneas `data:`. Se añade una aserción
antes de la existente para que un payload ilegible se distinga de un MCP que contesta sin
`result`: los dos casos caían en el mismo `TypeError`.

Verificado en rojo antes que en verde, y por las dos vías:

- **En rojo**, con la suite sin tocar: `TypeError` en `system_test.js:118`, en el paso 5, con
  los cuatro pasos anteriores en verde.
- **En verde**, contra la plataforma real: `MCP Discovery OK. Found 79 tools`, salida 0, y el
  endpoint que crea la suite se borra al final.
- **El helper muerde**, con siete entradas comprobadas una a una: SSE bien formado, `data:`
  con espacios de sobra, varios eventos (gana el último), payload truncado, cuerpo sin
  `data:`, cuerpo vacío y HTML donde se esperaba SSE. Las cuatro últimas devuelven `null` sin
  reventar, que es justo lo que convierte el `TypeError` en un mensaje que dice qué pasó.

La suite **sigue fuera del packet**: pedir tres motores a propósito la deja fuera, y esto no
cambia eso. Lo que cambia es que ahora pasa cuando se ejecuta a mano, que es lo que se le
reprochaba.

## [13.11.16] - 2026-09-27

### Changed

**El README de `dev/test` describía un directorio de pruebas que no existe.**

El fichero llevaba 38 líneas y no era README de este directorio: describía una carpeta
`test/` que no está en el repo, unos ficheros `.cjs` que no existen, y un `npm run test`
que no existe. Quien lo abría para entender cómo validar un cambio se iba con una
imagen falsa del mecanismo, y lo peor es que una imagen falsa de un mecanismo de pruebas
no falla nunca a la vista: no hay ningún síntoma.

El fichero ahora describe lo que hay, que es lo que se comprobó leyendo y ejecutando:

- **Las 37 suites se registran a mano** en el array `testRuns` de `dev/test/index.js`.
  Dejar un fichero en el directorio no lo registra: no lo corre `npm test` y ninguna
  regresión suya la detecta nadie.
- **El runner arranca la plataforma real** desde la raíz del proyecto, no desde
  `dev/test`, con `PORT=3000`, `BUILD_DB=true` y `AUTH_MAX_FAILURES=1000`; espera hasta
  180 s a que responda y luego lanza cada suite en su propio proceso, con 300 s de
  límite por suite, `SIGTERM` y `SIGKILL` 10 s después.
- **`JWT_KEY` es la trampa que más cuesta tiempo**, y no se documentaba en ninguna parte.
  Los hashes de contraseña son `HMAC-SHA256(contraseña, JWT_KEY)`, así que **una base
  sembrada con una `JWT_KEY` no autentica con otra**: todos los usuarios responden
  `401 Invalid credentials`, idéntico a una contraseña equivocada y sin nada en la
  respuesta ni en el log que apunte a la clave.
- **Dos trampas de residuos**: la limpieza de `backup_restore_test.js` está al final del
  camino feliz y **sin `finally`**, así que si la suite falla deja las filas que creó; y
  las credenciales sembradas **sí sobreviven** a un packet completo, siempre que la
  `JWT_KEY` sea la misma con la que se sembró.
- **Seis ficheros con aspecto de test que no están en el packet** — cuatro puros que
  pasan y podrían registrarse hoy, `exception_payload_test.js` que necesita un servidor
  vivo, y `system_test.js` que **falla**: parsea como JSON una respuesta MCP que llega en
  SSE, y ya fallaba antes de este trabajo.
- Los 17 ficheros que no son suites, clasificados: helpers, runner, scripts con npm
  script propio y **tres huérfanos** (`mcp_live_validation.js`,
  `mcp_exhaustive_validation.js`, `mcp_schema_conversion.js`) que no están registrados ni
  tienen script y solo se ejecutan escribiendo el nombre.

Nada de esto cambia el comportamiento de la plataforma. Lo que cambia es que un
documento que era falso pasa a ser cierto, que es la única forma de que sirva para lo
único que puede servir un README: que alguien que no escribió el código sepa qué hacer
con él.

## [13.11.15] - 2026-09-27

### Changed

#### `saveAppWithEndpoints` queda comentado, con el motivo al lado

Con esto queda cerrado el alcance de la auditoría H23–H38 de base de datos.

**No se ha arreglado: se ha comentado.** Y conviene decir por qué, porque "comentar el
código" es exactamente lo que parece una evasión y aquí no lo es: **la función no tiene
ningún llamador vivo**. Su único, `fnSaveApp`
(`src/lib/server/functions/system/prd/app/index.js`), ya estaba comentado desde antes de
esta serie, así que hoy no se puede alcanzar desde ninguna parte. Arreglarla sería trabajo
sobre código inalcanzable, y un arreglo que nadie ejercita tampoco está probado.

Lo que le faltaba, queda escrito junto al bloque para el que lo levante:

- **Dos bucles sin cota.** El primero borra los endpoints que se fueron de la app; el
  segundo hace un `Promise.allSettled` sobre **todos** los endpoints. Con los 209 endpoints
  de la app por defecto serían 209 `MERGE` simultáneos, y el `MERGE` de Sequelize en MSSQL
  es `MERGE ... WITH(HOLDLOCK)`: exactamente el patrón que produjo el error 1205 de
  deadlock. La puerta global de 13.11.12 (`OFAPI_RESTORE_CONCURRENCY`) acota el camino
  vivo —`defaultApps` y `restoreAppFromBackup`—, pero esta función se la saltaba entera:
  escribía con `Endpoint.upsert()` sin pasar por la puerta.
- **El borrado y el guardado no estaban atados.** El borrado iba en un `try`/`catch` que
  se tragaba el error con un `console.error`, y el guardado en otro que lo relanzaba. Si
  el borrado fallaba, la app se guardaba igual y quedaban endpoints huérfanos de una fila
  que ya no existía; y no había transacción que atara las dos mitades, así que para
  cuando el guardado fallaba el borrado ya había ocurrido y no había vuelta atrás.
- `if (app.idapp)` se leía dos veces con propósitos distintos, y un `else` final lanzaba un
  error genérico (`"App could not be saved"`) sin decir qué había fallado ni dónde.

### Removed

- Los imports que solo esta función usaba (`deleteEndpoint` y `uuidv4`). Vuelven a
  Hacerse falta si se levanta el bloque; está anotado junto al comentario.

### Added

- `dev/test/db_unbounded_writes_test.js`, puro. Comprueba que la función no se exporta y
  que su único llamador tampoco, **juntas**: `fnSaveApp` la invoca por un nombre, así que
  levantar solo una de las dos deja el servidor sin arrancar, o devuelve a producción el
  camino sin cota. Mira el espacio de nombres del módulo en vez de su texto, porque "no se
  exporta" es un hecho exacto y un hecho exacto no se rompe por un reformateo. También
  comprueba que la nota del motivo siga junto al código: un bloque comentado sin
  explicación es código muerto sin contexto, y el siguiente que lo lea lo borrará por
  limpieza.

### Known limitations

- **No queda ninguna limitación conocida de esta serie.** Las de 13.11.10 (clave de caché
  de plataforma en HANA), 13.11.11 (sin reintento ante bloqueo) y 13.11.12 (puerta de paso
  del arranque) están resueltas o retiradas; las de 13.11.14 (el bloqueo de fila solo es
  real en PostgreSQL) y esta entrada (el camino sin cota está comentado, no arreglado) no
  son defectos activos: son decisiones ya tomadas y documentadas.
- Cuando alguien reactive `saveAppWithEndpoints`, el orden importa y está anotado en el
  código: pasar por la puerta global, meter las dos mitades en una transacción, y añadir
  pruebas que lo ejecuten de verdad. Sin las tres, vuelve a ser el mismo hallazgo.

---

## [13.11.14] - 2026-09-27

### Fixed

#### El planificador de tareas de intervalo se traía todas las vencidas y releía cada una dos veces

Con esto queda resuelta la segunda de las dos limitaciones conocidas de 13.11.12.

**El planificador no puede limitar cuántas tareas arranca a la vez.** Es lo primero que
hay que decir, porque es lo que descarta el arreglo obvio. Cada tarea va a su propio
endpoint y muchas veces a una base de datos distinta, y todas tienen una hora programada:
un despliegue con cientos de tareas vencidas a la vez las necesita todas lanzadas. Un
límite de concurrencia aquí no protegería la base de datos de la plataforma —que no es la
que esas tareas tocan—, sino que retrasaría ejecuciones que el operador quiere puntuales.
Así que **no hay ninguna puerta entre el ciclo y el arranque de la ejecución**.

Lo que estaba mal eran dos cosas que multiplicaban el trabajo contra la base de datos de
la propia plataforma, que es la que sí hay que cuidar:

1. **La consulta de elegibilidad no tenía `LIMIT`.** El ciclo se traía *todas* las tareas
   vencidas, con dos `JOIN` y 29 columnas de la tarea más las del endpoint y su app, y
   repetía esa consulta en cada ciclo, que puede ser cada 250 ms. Ahora trae un lote de
   **200** (`OFAPI_TASK_BATCH_SIZE`).
2. **Cada tarea se releía una fila que el ciclo ya tenía en la mano.** El ciclo se traía la
   tarea con su endpoint y su app para decidir si la lanzaba, y `updateIntervalTaskStatus`
   volvía a pedirla entera. Ese segundo viaje estaba en el camino que retarda el arranque
   de cada ejecución. Con la fila a mano, la transición a `RUNNING` es **un `UPDATE` y
   ninguna lectura**: una sentencia en vez de dos, y con 200 tareas venciendo a la vez son
   200 lecturas menos de golpe.

### Added

- `OFAPI_TASK_BATCH_SIZE` (por defecto `200`): cuántas tareas vencidas se traen en cada
  viaje. Un valor que no sea un entero ≥ 1 se avisa y cae al de por defecto; un `3.5` se
  trunca a 3, que es lo razonable para un número que acaba siendo un `LIMIT`.
- `dev/test/interval_task_transition_test.js`, puro, y `dev/test/interval_task_batch_test.js`,
  que abre conexión. Los dos verificados contra SQLite, PostgreSQL y SQL Server, junto con
  la suite de contrato de tareas de intervalo que ya existía.

### Changed

- **`ORDER BY next_run, idtask` en la consulta de elegibilidad.** Sin esto el `LIMIT` es un
  subconjunto arbitrario, y dos lecturas del mismo conjunto pueden devolver filas solapadas.
  El efecto no es un error de SQL: es que el drenaje de lotes puede no terminar nunca.
  `idtask` va de segundo criterio no por estética, sino para que el orden sea total y dos
  lecturas del mismo conjunto devuelvan el mismo prefijo.
- El lote **se drena en vez de esperar**: si el lote vino lleno y el ciclo avançó, el worker
  vuelve a preguntar de inmediato en vez de dormirse hasta el próximo vencimiento. Una
  tarea que no cabe en este lote entra en el siguiente, y el siguiente sale ya, así que
  **ninguna tarea espera por el lote**. El drenaje se detiene solo cuando un ciclo no avanza
  —nada lanzado, nada reprogramado—, y hay un tope de 200 drenajes seguidos para el caso
  que eso no cubre: un lote que se llenara solo de tareas cuya transición de estado falla
  una y otra vez, que se releen igual porque su `next_run` no se movió.
- La lectura y la escritura de una transición de estado que **no** viene con la fila van
  ahora en la misma transacción, pidiendo el bloqueo de fila. Es el caso de `ERROR` y
  `TIMEOUT`, donde se incrementa `failed_attempts`: leer y escribir son dos sentencias y
  entre medias otra puede cambiar la fila. La transición a `RUNNING` se queda sin
  transacción a propósito, porque es un `UPDATE` con sus propios valores y ya es atómico:
  una transacción ahí solo añadiría dos viajes, en el camino que más debe ser rápido.
- Un estado que no existe ya no escribe. Caía en `IntervalTask.update({}, ...)`, que es un
  `UPDATE` sin nada que poner.
- Cuando el tope de drenajes seguidos se alcanza, el worker lo avisa por log en vez de
  seguir encadenando ciclos en silencio.

### Known limitations

- **El bloqueo de fila solo es real en PostgreSQL.** Sequelize 6.37.8 declara
  `supports.lock = false` en MSSQL, así que allí la transacción sale sin pista de bloqueo y
  el `SELECT` va pelado; en SQLite se ignora, que es lo correcto porque hay un solo
  escritor. No se puede prometer el bloqueo en MSSQL sin escribir SQL a mano con
  `WITH (UPDLOCK, ROWLOCK)`, y no compensa por una fila que solo escribe su propia tarea.
  La carrera tampoco es posible entre dos tareas distintas, porque cada una escribe la suya.
- Queda un punto del alcance sin resolver, y **no era un defecto activo**:
  `saveAppWithEndpoints` (`src/lib/db/app.js`) tiene dos bucles sin cota, el segundo un
  `Promise.allSettled` sobre todos los endpoints de la app, que serían 209
  `MERGE ... WITH(HOLDLOCK)` simultáneos —el mismo patrón que produjo el 1205—. Su único
  llamador, `fnSaveApp`, está comentado desde antes de esta serie. En 13.11.15 queda
  comentado el propio `saveAppWithEndpoints`.

---

## [13.11.13] - 2026-09-27

### Fixed

#### El seed de métodos declaraba estar terminado antes de empezar

Con esto queda resuelta la primera de las dos limitaciones conocidas de 13.11.12.

`defaultMethods` (`src/lib/db/method.js`) sembraba los once métodos con
`methods.forEach(async (m) => { await Method.upsert(...) })`, dentro de una función que
**ni siquiera era `async`**: devolvía `undefined` en el acto, así que el
`await defaultMethods()` de `src/lib/index.js` no esperaba nada. Dos fallos en la misma línea:
`forEach` no serializa, y la función que lo contiene no devuelve promesa.

El síntoma no era un error, sino su ausencia: el arranque imprimía el seed como terminado y
seguía adelante, con las once escrituras todavía en vuelo. Y las once escrituras iban a la
vez, que en MSSQL son once `MERGE INTO [ofapi_method] WITH(HOLDLOCK)` a la vez — el `MERGE`
sin acotar más numeroso que quedaba, y el que la puerta de 13.11.12 no cubría porque el
método no pasa por ella. No había producido ningún 1205 —son once filas de una tabla que
nadie más toca durante el arranque—, pero era el pico de escrituras más alto del arranque
entero, por encima de los cuatro que fija la puerta.

Ahora el seed va en serie, con un `for...of` y un `await` por método, y la función es `async`:
una escritura en vuelo, y el arranque no continúa hasta que la tabla de métodos está
sembrada.

**Medido** con `Method.upsert` instrumentado, sobre la misma función:

| | Antes | Después |
|---|---|---|
| Lo que devuelve la función | `undefined` | promesa que resuelve con el seed terminado |
| Escrituras en vuelo al resolver el `await` | 11 | **0** |
| Escrituras terminadas al resolver el `await` | 0 | **11** |
| Pico de escrituras simultáneas | 11 | **1** |

**Acción:** ninguna. No cambia la forma de la respuesta ni el esquema. Lo único observable es
que el arranque tarda lo que tarda el seed en lugar de declarar que ya terminó, y que un
método que falle ahora dice en el log **qué** método falló: antes el `catch` imprimía once
errores idénticos sin decir cuál era cuál.

### Added

- `dev/test/db_method_seed_test.js`, puro, en el packet. Fija las tres cosas que se pueden
  volver a romper sin que se note: que la función devuelva una promesa, que al resolver
  estén las once escrituras **terminadas** (no solo lanzadas) y que el pico sea 1. La
  tercera es la que mide el daño: un test que solo mirara el número de métodos sembrados
  pasaría con el `forEach` puesto.

### Known limitations

- Queda una sola limitación de 13.11.12 y es la otra: el planificador de tareas de intervalo
  (`src/lib/timer/worker.js`) lanza todas las tareas vencidas en un mismo tick, sin cota, y
  `getIntervalTaskProcess()` no tiene `LIMIT`. No lo cubre esta versión porque escribe con
  `UPDATE` e `INSERT`, no con `upsert`, y en MSSQL eso no lleva `WITH(HOLDLOCK)`: no produce
  deadlocks hoy. Lo que tiene es agotamiento del pool del hilo del worker y un `findOne` +
  `update` sin transacción.

---

## [13.11.12] - 2026-09-27

### Fixed

#### El límite de concurrencia del arranque era por app, y el bucle de appvars no tenía ninguno

13.11.11 acotó el bucle de endpoints a cuatro. Era la pieza correcta pero mal dimensionada,
y el patrón que arreglaba se repetía justo debajo, en el bucle de appvars.

**El límite era por app, no de la plataforma.** `defaultApps` lanza las apps en paralelo, así
que un límite de cuatro en cada bucle es un tope real de `4 × nº de apps`: con las 2 apps por
defecto eran 8, que era exactamente el pico medido (8 sentencias en vuelo sobre
`ofapi_endpoint`); con 5 apps habría sido 20 —el `pool.max` de la plataforma— y con 6 lo
habría superado, momento en el que el único freno pasa a ser el reintento.

**Appvars no estaba acotado.** Era el bucle más concurrente del arranque, y el que producía
los 20 deadlocks que la versión anterior declaraba como limitación conocida. En un arranque
real, 35 sentencias en vuelo de 40, todas `MERGE INTO [ofapi_appvars]`.

Ambos bucles comparten ahora una **puerta de paso del proceso** en lugar de un límite por
llamada. La puerta también recoge los upserts de bots y de tareas de intervalo, que estaban
sin acotar por la misma razón y con el mismo `MERGE`.

**Medido en un arranque real contra SQL Server, desde base limpia.** Las cifras son el pico
de sentencias **en vuelo** por tabla, con el arranque entero instrumentado:

| | 13.11.11 | 13.11.12 |
|---|---|---|
| Escrituras en vuelo, pico por tabla (restore) | 35 en `ofapi_appvars` | **4 en las seis tablas** |
| Escrituras en vuelo en `ofapi_endpoint` | 8 (= 4 × 2 apps) | **4** |
| Escrituras en vuelo en `ofapi_endpoint_bkp` | 6 | **4** |
| Reintentos por 1205 en el arranque | 67 | **0** |
| AppVars que agotan los 4 intentos | 20 | **0** |
| Endpoints o backups perdidos | 5 | **0** |
| Filas en `ofapi_endpoint` / `ofapi_endpoint_bkp` | 209 / 209 | **209 / 209** |

Las seis tablas que pasan por la puerta (appvars, endpoint, endpoint_bkp, bot, bot_bkp,
intervaltask) quedan en un pico de 4, que es el límite puesto. El pico global de escrituras
del arranque es 11, y **todo** son `MERGE INTO [ofapi_method]`: los once métodos que
`defaultMethods` lanza con un `forEach(async)` y que no pasan por la puerta. No ha producido
ningún 1205 —son once filas de una tabla que nadie más toca en ese momento—, pero es el
`MERGE` con `WITH(HOLDLOCK)` más numeroso que queda sin acotar, y por eso está en las
limitaciones conocidas de abajo.

**Acción del operador:** `OFAPI_RESTORE_ENDPOINTS_CONCURRENCY` se renombra a
`OFAPI_RESTORE_CONCURRENCY` y ahora gobierna **todas** las escrituras del arranque, no solo
los endpoints. Si la tenías fijada a un valor, funciona igual: el nombre nuevo gana y el
antiguo se ignora. El valor por defecto sigue siendo 4. Un valor que no sea un entero ≥ 1
avisa por consola y usa el de por defecto, igual que antes.

### Changed

- `mapConLimite` desaparece de `src/lib/db/concurrency.js`. Se queda sin ningún uso en
  producción al sustituirlo la puerta, y dejar un limitador por llamada junto a la puerta es
  invitar a volver a acotar donde no toca: la diferencia entre los dos es justo la que hizo
  que el arreglo de 13.11.11 no acotara el arranque.

### Known limitations

- `defaultMethods` (`src/lib/db/method.js`) usa `forEach(async)` en una función que no es
  `async`, así que `await defaultMethods()` no espera nada y el arranque sigue con sus once
  upserts en vuelo. Medido: es el pico de escrituras más alto que queda, 11 `MERGE` con
  `WITH(HOLDLOCK)` sobre `ofapi_method`, y es lo único que la puerta no cubre. No ha
  producido ningún 1205 porque son once filas de una tabla que nadie más toca durante el
  arranque, pero sigue siendo el `MERGE` sin acotar más numeroso.
- El planificador de tareas de intervalo (`src/lib/timer/worker.js`) lanza todas las tareas
  vencidas en un mismo tick, sin cota, y `getIntervalTaskProcess()` no tiene `LIMIT`. No lo
  cubre esta versión porque escribe con `UPDATE` e `INSERT`, no con `upsert`, y en MSSQL eso
  no lleva `WITH(HOLDLOCK)`: no produce deadlocks hoy. Lo que tiene es agotamiento del pool
  del hilo del worker y un `findOne` + `update` sin transacción.

---

## [13.11.11] - 2026-09-26

### Fixed

#### En MSSQL, el arranque perdía endpoints y backups de endpoint sin decir nada

El `upsert` del dialecto mssql de Sequelize emite `MERGE INTO ... WITH(HOLDLOCK)`, con el
`WITH(HOLDLOCK)` fijo en su query generator. Eso convierte cada escritura en un SERIALIZABLE
que se lleva bloqueos hasta el COMMIT, y `restoreAppFromBackup` lanzaba los upserts de todos
los endpoints del backup a la vez con un `Promise.allSettled` sobre un `map`. Con N a la vez
el motor no bloquea: rompe el deadlock.

**Medido en un arranque real contra SQL Server, desde base limpia:**

| | Antes | Después |
|---|---|---|
| `MERGE` que murieron de 1205 | 30 de 100 | **0** |
| Backups de endpoint perdidos | 5 | **0** |
| Endpoints no restaurados | 6 | **0** |
| `Error creating endpoint backup` | 10 | **0** |
| Filas en `ofapi_endpoint` / `ofapi_endpoint_bkp` | 209 / 204 | **209 / 209** |

El arranque seguía imprimiendo `Database created or updated successfully with alter: true`
en ambos casos. Los seis endpoints no se perdían por el `upsert`, sino porque el 1205 mataba
el `findAll` de `ensureUniqueEnabledMcpName` que va antes.

**El arreglo tiene dos partes, y las dos hacen falta:**

1. **Concurrencia acotada** en `restoreAppFromBackup`: de todos los endpoints a la vez a
   cuatro a la vez (`OFAPI_RESTORE_ENDPOINTS_CONCURRENCY`). Cuatro y no uno porque el bucle
   también valida código de endpoints JS y parsea backups de versiones antiguas, y eso no
   usa conexión pero tarda más que la sentencia. En serie el mismo trabajo tardaba 6512 ms
   frente a 20341 ms en paralelo: el deadlock no se paga solo una vez, se paga la espera, la
   víctima, el reintento del motor y la vuelta a empezar.
2. **Reintento con backoff y jitter** para 1205 y 1204, enganchado a `Sequelize#query`.
   La víctima de un deadlock siempre se puede reintentar: su transacción ya se abortó y la
   razón por la que perdió ya no existe. El jitter es lo que impide que las víctimas, que
   mueren casi a la vez, vuelvan a la vez y reconstruyan el mismo grafo.

**Acción:** ninguna. No cambia la forma de la respuesta ni el esquema. Se puede bajar el
límite a 1 en bases lentas; el reintento no se puede desactivar y no hace falta.

### Added

- `restoreAppFromBackup` devuelve `endpoints_rejected` cuando algún endpoint no se pudo
  restaurar, con la misma forma que ya usaba `appvars_rejected`. Antes `upsertEndpoint`
  registra el error en su `catch` y devuelve `undefined` en vez de lanzar, así que un
  restore con endpoints caidos devolvía exactamente la misma respuesta que uno completo y
  `restoreAllAppsFromBackup` lo marcaba como `ok: true`.
- Log de contención `[db:lock]`, una línea cada 5 s con el acumulado. Reintentar en
  silencio convierte un error visible en uno invisible, y quien tiene que mirar ese log es
  quien puede arreglar el código que abre demasiadas transacciones a la vez.
- `dev/test/db_lock_retry_test.js` y `dev/test/db_concurrency_test.js`, puros, en el packet.

### Known limitations

- **Quedan 20 deadlocks por arranque en MSSQL, y no son de endpoints.** Los 60 `MERGE` que
  quedan en el log son todos `ofapi_appvars`, desde otro `Promise.allSettled` sin acotar en
  `src/lib/db/app.js:903`. El reintento absorbe 67 y 20 agotan los 4 intentos; esos ya se
  reportan en `appvars_rejected`. El patrón está repetido y está pendiente de la fase de
  análisis de llamadas paralelas.
- El `1204` está clasificado por su forma —idéntica al `1205`, un `RequestError` de tedious
  con `.number`— y su clasificación tiene test, pero **no se ha reproducido un 1204 real**.
- `ETIMEOUT` de tedious ("Request failed to complete in 15000ms") **no** se reintenta a
  propósito: puede ser una consulta lenta de verdad, y reintentarla multiplica el coste. Se
  reproduce cuando la conexión de la plataforma espera por un lock, porque su `requestTimeout`
  es el de tedious, 15 s, mientras que el pool de los endpoints SQL fija 30 s.

---

## [13.11.10] - 2026-09-26

### Breaking

#### Se retira la clave `parse_bigint` de la conexión de los endpoints SQL

**Antes:** `custom_data.parse_bigint` estaba documentada en el `AI_SKILL.md` y el
`manifest.json` del handler SQL, cableada en `ConnectionPool.js`, incluida en la clave
de caché del pool, y cubierta por un test que pasaba. No hacía nada. Con la clave puesta,
sin ella o mal escrita, la respuesta era byte a byte la misma.

**Ahora:** la clave no existe. Se ignora, y un `console.warn` por proceso avisa la primera
vez que aparece una config que todavía la lleva, porque el resto es un silencio y quien la
configuró hace meses que espera una conversión que nunca ocurrió.

**Por qué se retira en vez de arreglarse:** Sequelize sobrescribe
`connectionConfig.types` en cada conexión y su lista blanca de `dialectOptions` no incluye
`types`, así que `dialectOptions.types.getTypeParser` se descarta sin avisar. El único
punto de inyección que funciona en PostgreSQL es `pg-types.setTypeParser(20, ...)`, que es
global al proceso y no se puede acotar a una conexión: activarlo volvería la opción algo
que ya no se puede desactivar, y cambiaría el comportamiento de toda instalación
PostgreSQL existente. De los tres motores, solo en el que podía funcionar es
exactamente donde no funcionaba: `types` es un parámetro de `pg`, y `tedious` y
`@sap/hana-client` nunca lo miran.

**Acción:** si usabas `parse_bigint: true`, quítalo. No cambia lo que recibes, porque no
cambiaría nada igual. Si lo que querías eran números en vez de texto, el sitio para
conseguirlo es la consulta (`::float8`, `::numeric`) o el cliente; la conversión de
`bigint` a número que sí funciona en esta plataforma es la de sus propias tablas
(`ofapi_endpoint`, `ofapi_intervaltask`, …), no una clave del endpoint. Un endpoint
antiguo con la clave en su `custom_data` abre el mismo pool que antes: el nombre se
mantiene en la lista de exclusión de la clave de caché para que no parta el pool por sí
solo.

### Changed

#### La clave `parse_bigint` ya no parte el pool de conexiones

`buildConnectionCacheKey` la incluía para que dos endpoints que difirieran en ella
recibieran `int8` distinto. Como la opción no cambiaba nada, esa separación solo compraba
dos entradas de pool y dos conjuntos de conexiones para entregar la misma respuesta.
Ahora dos endpoints idénticos salvo en esa clave comparten conexión.

**Detalle en `dev/test/sql_connection_cache_key_test.js`**, que cubre también el camino de
HANA, donde la clave se excluía por nombre y no por valor.

### Removed

- `dev/test/sql_parse_bigint_test.js` y su entrada en el packet. Era el único test de la
  opción y no comprobaba el comportamiento: ejercitaba el helper como función pura sobre
  OIDs inventados, sin abrir nunca una conexión. Lo que queda cubriendo esta materia,
  `dev/test/db_bigint_normalization_test.js`, sí abre una conexión real.
- `isParseBigintEnabled`, `buildBigintAwareTypeParser`, `parseBigintBinaryIfSafe` y el
  reexport de `parseBigintIfSafe` desde `ConnectionPool.js`. `parseBigintIfSafe` **no** se
  borra: la usa la normalización de `bigint` de los modelos de la plataforma, que es lo
  que sí funcionaba.

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

## [13.11.8] - 2026-09-26

**La matriz de handlers contra motores reales entra en el repo, sin contraseñas dentro.**

`dev/test/handler_db_matrix.mjs` crea endpoints efímeros en la app `demo` y los llama por HTTP, que
es el mismo camino que usa un cliente, y los recorre contra PostgreSQL, MSSQL y SAP HANA: 52
comprobaciones que cubren el handler `SQL`, el `SQL_BULK_I` y el de HANA, con sus diferencias
reales de dialecto. Vive fuera del packet a propósito —`dev/test/index.js` es una lista explícita y
corre contra el motor del `.env`, que es uno solo—, y ahora se puede además mover de sitio sin tocar
el código: destino, puerto, base, usuario y contraseña de cada motor salen del entorno.

**La contraseña es lo único que no tiene valor por defecto**, y el motivo es que una clave de
conexión escrita en un repositorio está copiada en todos los clones y en todos los CI, y no se
puede revocar. Un motor sin su contraseña se salta con un aviso que dice qué variable falta, en vez
de fallar con un error de autenticación que en el informe de salida es indistinguible de un defecto
del handler. Un `SKIP` declarado y un `FAIL` que se confunde con un bug no son el mismo resultado,
y quien lee la salida de una prueba necesita poder distinguirlos.

La cabecera del script documenta los requisitos (plataforma en marcha con la app `demo` sembrada, un
contenedor por motor) y cómo sembrar HANA, que es el motor donde crear el esquema a mano fue lo más
rápido. En PostgreSQL y MSSQL las tablas las crea el propio script.

---

## [13.11.9] - 2026-09-26

**El log de arranque de la plataforma llevaba su propia contraseña de base de datos, en claro, en
todos los reinicios.**

Salió al buscar la fuga de 13.11.7 y es independiente de ella: no es la clave del pool de un tenant,
es la conexión de la propia plataforma. `src/lib/db/sequelize.js` abría la conexión al importarse y
registraba, en los dos caminos —éxito y error—:

```js
console.log(">>>>>>>>> Connection has been established successfully to " + db_conn, options);
```

Con eso la contraseña aparecía **dos veces por arranque**, en la URL y en el volcado, y cinco
ocurrencias en el log de una sola puesta en marcha.

El segundo sitio es el que no se ve leyendo el código, y por eso merece la pena explicarlo. El objeto
`options` que se declara arriba **no tiene `dialectOptions` con credenciales**; Sequelize se lo
rellena por dentro con las credenciales ya resueltas, mutando el mismo objeto. Quien lee
`sequelize.js` ve un volcado de tres campos, `logging`, `dialectOptions` y `pool`, y no ve ningún
secreto: la contraseña llega después y se cuela en la línea siguiente. Un `console.log(options)`
parece inocuo hasta que se lee el log de arranque de verdad.

La línea ahora registra lo que hace falta para diagnosticar un fallo de conexión —destino, pool y
opciones de dialecto— con la URL enmascarada y sin el campo `password`:

```
>>>>>>>>> Connection has been established successfully {
  destino: 'postgres://ofapi:***@127.0.0.1:5432/ofapi',
  pool: { max: 20, min: 1, acquire: 30000, idle: 10000 },
  dialectOptions: { user: 'ofapi', host: '127.0.0.1', port: '5432', database: 'ofapi' }
}
```

Ocultar el destino entero habría tapado el problema en vez de resolverlo: `ofapi:***@...` sigue
diciendo a qué base y a qué puerto se conectó la plataforma, que es lo que se necesita para
diagnosticar.

Un log de arranque es de los primeros que se pega a un ticket y de los que se guarda más tiempo, y
un secreto en él cambia de manos con el.

#### Verificación

`db_startup_log_test.js` (puro, 5 bloques) fija las tres reglas de la redacción: ni la URL ni el
volcado llevan la contraseña, el destino sigue siendo legible, y las dos entradas raras que pueden
darse de verdad —`dialectOptions` sin resolver todavía y un destino que no sea URL— no tumban el
arranque, que es el riesgo real de tocar una línea que se ejecuta antes de que exista nadie a quien
reportarle un fallo.

Medido sobre el arranque real: **5 → 0** ocurrencias de la contraseña en el log, en las dos formas en
que aparecía (la URL con el password URL-encoded y el volcado en claro). Packet de PostgreSQL:
32/32.

---

## Referencia

- Versionado: `package.json`
- Comprobación del contrato MCP tras cambios de documentación: `npm run test:mcp-contract`
- Validación de documentación de handlers: `npm run docs:handlers`
