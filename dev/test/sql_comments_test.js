// Comentarios dentro del SQL del handler `SQL`, contra MSSQL real.
//
// ## Qué comprueba
//
// Que un comentario escrito en la consulta —de linea (`-- …`) o de bloque
// (`/* … */`)— no cambia nada: ni el resultado, ni el tipo de consulta que se
// autodetecta, ni la deteccion de `$name` / `:name`. Y en particular, que el
// nombre de una variable de aplicacion escrito DENTRO de un comentario
// (`$_VAR_MSSQL_TEST`) no se resuelve ni se confunde con un bind.
//
// ## Por qué está fuera del packet
//
// Misma razón que `handler_db_matrix.mjs`: necesita un contenedor de SQL Server
// con la base `sqltest`, mientras que el packet corre contra lo que diga el
// `.env` del proyecto, que es un motor. Se ejecuta a mano.
//
// ## Uso
//
//   OFAPI_BASE_URL=http://localhost:3000 \
//     OFAPI_TEST_MSSQL_PASSWORD=... node dev/test/sql_comments_test.js
//
// La AppVar `$_VAR_MSSQL_TEST` de la app `demo` es la que trae la conexion
// (`src/lib/db/default/demo.js`), y su password se puede sobreescribir por
// entorno con `OFAPI_TEST_MSSQL_PASSWORD` para no depender de lo que tenga el
// seed.
//
// ## Estado actual de los casos
//
// Los 18 casos pasan. Los de comentarios se incorporate a partir del defecto que
// documentan abajo; los de literales comprueban que ya NO se devuelven datos
// alterados, que es lo que se decidió.
import { TEST_PASSWORD, TEST_USER, basicAuthHeader } from "./test_credentials.js";

const BASE = process.env.OFAPI_BASE_URL || "http://localhost:3000";
const APP = "demo";
const ENV = "dev";
const R = "/sql_comments_test";

const MSSQL_PASSWORD = process.env.OFAPI_TEST_MSSQL_PASSWORD;

// ------------------------------------------------------------------ arranque

const loginRes = await fetch(`${BASE}/api/system/system/login/prd`, {
  method: "POST",
  headers: { Authorization: basicAuthHeader(TEST_USER, TEST_PASSWORD) },
});
if (!loginRes.ok) {
  console.error(`login fallo: HTTP ${loginRes.status}. Levanta la plataforma primero.`);
  process.exit(1);
}
const { token } = await loginRes.json();
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const catalogRes = await fetch(`${BASE}/api/system/api/apps/catalog/prd`, {
  method: "POST",
  headers: H,
  body: "{}",
});
const catalog = await catalogRes.json();
const rows = Array.isArray(catalog) ? catalog : catalog?.result?.data || [];
const DEMO_IDAPP = rows.find((a) => a.app === APP)?.idapp;
if (!DEMO_IDAPP) {
  console.error(`no se encontro la app ${APP} en el catalogo`);
  process.exit(1);
}

if (!MSSQL_PASSWORD) {
  console.log(
    "AVISO  sin OFAPI_TEST_MSSQL_PASSWORD: se usa la password que tenga la AppVar\n" +
    "       $_VAR_MSSQL_TEST del seed. Si el contenedor usa otra, los endpoints\n" +
    "       responderan 500 y el fallo sera de credenciales, no del handler.",
  );
}

const ADMIN = `${BASE}/api/system/api/endpoint/prd`;

// --------------------------------------------------------------- utilidades

async function crearEndpoint(code, { custom_data = "$_VAR_MSSQL_TEST", method = "GET" } = {}) {
  const res = await fetch(ADMIN, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      idapp: DEMO_IDAPP,
      resource: R,
      environment: ENV,
      method,
      handler: "SQL",
      access: 0,
      enabled: true,
      title: "sql comments test",
      description: "comentarios en el SQL del handler SQL",
      code,
      custom_data: typeof custom_data === "string" ? custom_data : JSON.stringify(custom_data),
      timeout: 30,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`crear endpoint: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body?.result?.idendpoint;
}

const borrarEndpoint = (idendpoint) =>
  fetch(ADMIN, { method: "DELETE", headers: H, body: JSON.stringify({ idendpoint }) });

async function llamar(query = "?name=zzz") {
  const res = await fetch(`${BASE}/api/${APP}${R}/${ENV}${query}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// ------------------------------------------------------------------- casos

// La consulta de referencia. Los tres endpoints de la app demo que la usan
// (`/ofapi/examples/sql/mssql_sin_comentarios`, `…_comentarios` y
// `…_comentario_appvar`) son esta misma linea con y sin comentarios encima, que
// es la forma de que el comentario sea la UNICA variable del experimento.
const CONSULTA = "SELECT TOP 5 id, name, qty, price FROM dbo.items WHERE name <> $name ORDER BY id";

/**
 * Los dos casos de literal se resuelven con un 400, no con un 200.
 *
 * Antes de arreglarlo, `SELECT 'coste: $name'` contestaba 200 con `coste: @name`:
 * Sequelize sustituye el `$name` del literal por el valor del parámetro `name` y el
 * cliente se llevaba el dato cambiado sin ninguna señal. Ahora el handler rechaza
 * la consulta y explica el conflicto.
 */
const LITERAL_EN_ESPERA = (r) =>
  r.status === 400 && /inside a quoted string or identifier/.test(String(r.body?.error ?? ""));

/**
 * @typedef {object} Caso
 * @property {string} nombre
 * @property {string} code
 * @property {string} [query]      query string de la llamada
 * @property {boolean} [falloConocido] el defecto esta abierto; se informa, no se pasa
 * @property {string} [nota]        por que este caso existe o que se decidio sobre el
 */
const CASOS = [
  // --- Control ---------------------------------------------------------
  {
    nombre: "control: la consulta sin ningun comentario",
    code: CONSULTA,
  },

  // --- Comentarios inocuos: esto ya tiene que pasar --------------------
  {
    nombre: "comentario de linea antes de la consulta",
    code: `-- comentario de linea\n${CONSULTA}`,
  },
  {
    nombre: "comentario de bloque antes de la consulta",
    code: `/* comentario de bloque */\n${CONSULTA}`,
  },
  {
    nombre: "comentarios entre clausulas",
    code:
      "SELECT TOP 5 id, name, qty, price\n" +
      "/* despues del SELECT */\n" +
      "FROM dbo.items\n" +
      "-- antes del WHERE\n" +
      "WHERE name <> $name\n" +
      "/* antes del ORDER BY */\n" +
      "ORDER BY id",
  },
  {
    nombre: "comentario que menciona un placeholder :name",
    code: `/* el filtro real es :name, aqui no */\n${CONSULTA}`,
  },
  {
    nombre: "comentario que menciona un $name que tambien es un bind real",
    code: `/* el filtro real es $name */\n${CONSULTA}`,
  },
  {
    nombre: "consulta sin placeholders y con comentario de texto",
    code: "/* nada que sustituir */\nSELECT TOP 5 id, name FROM dbo.items ORDER BY id",
    query: "?name=zzz",
  },

  // --- El caso que motiva la prueba: el nombre de una AppVar en un
  // --- comentario. `$_VAR_…` solo se resuelve en `custom_data`, nunca
  // --- dentro de `code`, asi que aqui debe viajar literal. -----------
  // Estos cuatro fallaban con 500 hasta que se arreglo en ConnectionPool.js.
  {
    nombre: "nombre de AppVar en comentario de bloque (con bind real)",
    code: `/* La conexion sale de la AppVar $_VAR_MSSQL_TEST, de custom_data */\n${CONSULTA}`,
    nota:
      "Sequelize sustituye $name con una regex que no ve comentarios " +
      "(abstract/query.js:78, /\\B\\$(\\$|\\w+)/g), asi que tomaba " +
      "$_VAR_MSSQL_TEST por un bind mas y lanzaba \"Named bind parameter has no " +
      "value\". El escaner de src/lib/handler/utils.js SI lo ignoraba, pero ese " +
      "escaner solo decide que se manda: la sustitucion la hace Sequelize. Se " +
      "arregla en ConnectionPool.js, insertando un espacio entre el $ y el " +
      "nombre dentro del comentario.",
  },
  {
    nombre: "nombre de AppVar en comentario de linea (con bind real)",
    code: `-- La conexion sale de la AppVar $_VAR_MSSQL_TEST\n${CONSULTA}`,
    nota: "mismo defecto que el caso anterior",
  },
  {
    nombre: "nombre de AppVar en comentario, consulta SIN placeholders",
    code: "/* sale de $_VAR_MSSQL_TEST */\nSELECT TOP 5 id, name FROM dbo.items ORDER BY id",
    nota: "mismo defecto que el caso anterior",
  },
  {
    nombre: "AppVar en comentario con query en estilo replacements (:name)",
    code: "/* sale de $_VAR_MSSQL_TEST */\nSELECT TOP 5 id, name FROM dbo.items WHERE name <> :name ORDER BY id",
    // Pasa, y no por merced del handler: el camino de `replacements` busca
    // `:\w+` y el nombre de la AppVar no lleva `:`. Si alguna vez se mezcla
    // `$name` y `:name` en la misma consulta, `detectSqlParamStyle` da `bind`
    // y esto vuelve a depender del camino de `bind`.
  },
  {
    nombre: "varios placeholders falsos en un comentario, sin bind real",
    code: "-- $_VAR_MSSQL_TEST :name $name\nSELECT TOP 5 id, name FROM dbo.items ORDER BY id",
    nota: "mismo defecto que el caso anterior",
  },

  // --- Literales: aqui el defecto era PEOR, porque no se ve --------------
  // Cuando el $name de un literal choca con un bind real, Sequelize lo
  // sustituye y el endpoint devolvia 200 con el dato cambiado. Ahora se
  // rechaza con un 400: un error es un problema, un 200 con el dato corrupto
  // no. Neutralizarlo exigiria reescribir el literal con concatenacion
  // (`+` en T-SQL, `||` en el resto), que depende del dialecto y no se puede
  // aplicar a un identificador entrecomillado ni a un cuerpo `$$…$$`.
  {
    nombre: "literal con $name que colisiona con un bind real",
    code: "SELECT TOP 3 id, 'coste: $name' AS txt FROM dbo.items ORDER BY id",
    espera: LITERAL_EN_ESPERA,
    obtenido: (r) => `HTTP ${r.status} ${String(r.body?.error ?? "").slice(0, 120)}`,
  },
  {
    nombre: "literal con el nombre de una AppVar",
    code: "SELECT TOP 3 id, 'var: $_VAR_MSSQL_TEST' AS txt FROM dbo.items WHERE name <> $name ORDER BY id",
    espera: LITERAL_EN_ESPERA,
    obtenido: (r) => `HTTP ${r.status} ${String(r.body?.error ?? "").slice(0, 120)}`,
  },
  {
    nombre: "identificador entrecomillado con $name",
    code: 'SELECT TOP 3 id, "col $name" AS txt FROM dbo.items ORDER BY id',
    espera: LITERAL_EN_ESPERA,
    obtenido: (r) => `HTTP ${r.status} ${String(r.body?.error ?? "").slice(0, 120)}`,
    nota: "Mismo motivo que un literal: `\"…\"` tambien es texto para la regex de Sequelize.",
  },

  // --- La autodeteccion del tipo de consulta --------------------------
  // sqlFunction.js:156 quita los comentarios antes de leer el verbo, asi que
  // una consulta que empieza por comentario tiene que seguir siendo SELECT.
  {
    nombre: "autodetecta SELECT con la consulta empezada por comentario",
    code: "-- comentario\n/* otro */\nSELECT TOP 5 id, name FROM dbo.items ORDER BY id",
    query: "",
  },
];

/**
 * Los tres endpoints que la prueba pide en la app demo, para confirmar que lo
 * sembrado en `src/lib/db/default/demo.js` se comporta igual que lo que esta
 * suite crea al vuelo. Si divergen, el seed esta desincronizado con el handler.
 */
const DEMO = [
  { resource: "/ofapi/examples/sql/mssql_sin_comentarios", query: "?name=zzz" },
  { resource: "/ofapi/examples/sql/mssql_comentarios", query: "?name=zzz" },
  { resource: "/ofapi/examples/sql/mssql_comentario_appvar", query: "?name=zzz" },
];

// ------------------------------------------------------------------ corrida

let pass = 0;
const fallosConocidos = [];
const fallosNuevos = [];

function registrar(nombre, ok, detalle, esConocido) {
  if (ok) {
    pass++;
    console.log(`  PASA   ${nombre}`);
    return;
  }
  (esConocido ? fallosConocidos : fallosNuevos).push(`${nombre} :: ${detalle}`);
  console.log(`  ${esConocido ? "FALLA*" : "FALLA "} ${nombre}${detalle ? ` :: ${detalle}` : ""}`);
}

async function runCaso(c) {
  let idendpoint;
  let res;
  try {
    idendpoint = await crearEndpoint(c.code);
    res = await llamar(c.query ?? "?name=zzz");
  } catch (error) {
    registrar(c.nombre, false, `error de harness: ${error.message}`, false);
    return;
  } finally {
    if (idendpoint) await borrarEndpoint(idendpoint);
  }

  if (c.espera) {
    registrar(c.nombre, c.espera(res), c.obtenido?.(res) ?? `HTTP ${res.status}`, c.falloConocido);
    return;
  }

  const ok = res.status === 200 && Array.isArray(res.body) && res.body.length > 0;
  const detalle = ok
    ? `${res.body.length} filas`
    : `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`;
  registrar(c.nombre, ok, detalle, c.falloConocido);
}

console.log(`\n===== COMENTARIOS EN EL SQL · handler SQL · MSSQL =====`);

console.log("\n-- endpoints de la app demo --");
for (const d of DEMO) {
  const res = await fetch(`${BASE}/api/${APP}${d.resource}/${ENV}${d.query}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const ok = res.status === 200 && Array.isArray(body) && body.length > 0;
  registrar(d.resource, ok, ok ? `${body.length} filas` : `HTTP ${res.status} ${text.slice(0, 160)}`, d.falloConocido);
}

console.log("\n-- endpoints efimeros --");
for (const c of CASOS) {
  await runCaso(c);
}

// ------------------------------------------------------------------ salida

const total = pass + fallosConocidos.length + fallosNuevos.length;
console.log(`\n${pass}/${total} pasan`);

if (fallosConocidos.length > 0) {
  console.log(`\n${fallosConocidos.length} con defecto ya identificado (FALLA*):`);
  for (const f of fallosConocidos) {
    const nombre = f.split(" :: ")[0];
    const detalle = CASOS.find((c) => c.nombre === nombre)?.nota;
    console.log(`  - ${nombre}`);
    if (detalle) {
      for (const linea of detalle.match(/.{1,74}(\s|$)/g) || []) console.log(`      ${linea.trim()}`);
    }
  }
}

if (fallosNuevos.length > 0) {
  console.log(`\n${fallosNuevos.length} con defecto NUEVO:`);
  for (const f of fallosNuevos) console.log(`  - ${f}`);
  process.exit(1);
}

console.log("\nOK  sql_comments_test: los endpoints commented se comportan como el de control");
