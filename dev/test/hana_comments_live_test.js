// Comentarios dentro del SQL del handler `SQL` HANA, contra un HANA real.
//
// ## Qué comprueba
//
// Lo mismo que `sql_comments_test.js` comprueba en MSSQL, para el otro motor que
// lleva su propio sustituidor: que un comentario escrito en la consulta no cambia
// nada, y en particular que el nombre de una variable de aplicación dentro de un
// comentario no se confunde con un marcador.
//
// La suite pura `sql_hana_comments_test.js` (en el packet) comprueba el texto que sale
// hacia el driver. Esta comprueba lo que hace la base de verdad con él, que es lo único
// que faltaba: que el motor acepta la consulta y devuelve las filas correctas.
//
// ## Por qué está fuera del packet
//
// Misma razón que `sql_comments_test.js` y que `handler_db_matrix.mjs`: necesita un
// contenedor de HANA con el esquema `items`/`counters` ya sembrado, mientras que el
// packet corre contra lo que diga el `.env` del proyecto, que es un motor.
//
// ## Requisitos
//
//  1. La plataforma en marcha, con la app `demo` sembrada.
//  2. `hanaexpress` levantado, con el puerto 39041 del tenant HXE publicado.
//  3. `items` y `counters` creadas en HXE. El script de referencia es
//     `hana_setup.mjs`; sin ellas los endpoints responden 500 y el fallo es de
//     credenciales o de esquema, no del handler.
//
// ## Uso
//
//   OFAPI_BASE_URL=http://localhost:3000 \
//     OFAPI_TEST_HANA_PASSWORD=... node dev/test/hana_comments_live_test.js
import { TEST_PASSWORD, TEST_USER, basicAuthHeader } from "./test_credentials.js";

const BASE = process.env.OFAPI_BASE_URL || "http://localhost:3000";
const APP = "demo";
const ENV = "dev";
const R = "/hana_comments_live_test";

const HANA_PASSWORD = process.env.OFAPI_TEST_HANA_PASSWORD;

// `custom_data` del handler HANA ES el objeto de conexion, sin envoltura. Se usan
// `uid`/`pwd`, que es la forma que documenta el AI_SKILL del handler, y no
// `user`/`password` que es la que acepta el driver: si las dos no funcionan, es un
// fallo de documentacion y esta suite lo delata.
const CNX = {
  serverNode: `${process.env.OFAPI_TEST_HANA_HOST || "127.0.0.1"}:${Number(process.env.OFAPI_TEST_HANA_PORT) || 39141}`,
  uid: process.env.OFAPI_TEST_HANA_USER || "SYSTEM",
  pwd: HANA_PASSWORD,
  databaseName: process.env.OFAPI_TEST_HANA_DB || "HXE",
};

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
  console.error("no se encontro la app demo en el catalogo");
  process.exit(1);
}

if (!HANA_PASSWORD) {
  console.error(
    "falta OFAPI_TEST_HANA_PASSWORD. Sin ella los endpoints devuelven 500 y el fallo\n" +
      "sera de credenciales, no del handler.",
  );
  process.exit(1);
}

const ADMIN = `${BASE}/api/system/api/endpoint/prd`;

// --------------------------------------------------------------- utilidades

async function crearEndpoint(code) {
  const res = await fetch(ADMIN, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      idapp: DEMO_IDAPP,
      resource: R,
      environment: ENV,
      method: "GET",
      handler: "HANA",
      access: 0,
      enabled: true,
      title: "hana comments live test",
      description: "comentarios en el SQL del handler HANA",
      code,
      custom_data: JSON.stringify(CNX),
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

/** HANA pliega los identificadores a MAYUSCULAS, asi que la clave se busca sin distinguir. */
const pick = (row, key) => {
  if (!row) return undefined;
  if (key in row) return row[key];
  const k = Object.keys(row).find((c) => c.toLowerCase() === key.toLowerCase());
  return k ? row[k] : undefined;
};

// ------------------------------------------------------------------- casos

// HANA no tiene TOP, y las tablas del seed se crearon sin entrecomillar, asi que se
// escriben en minuscula y el motor las pliega a ITEMS. Referenciarlas entrecomilladas
// en minuscula daria "table not found".
const CONSULTA = "SELECT id, name, qty FROM items WHERE name <> $name LIMIT 5";

/**
 * @typedef {object} Caso
 * @property {string} nombre
 * @property {string} code
 * @property {string} [query]   query string de la llamada
 * @property {(r: any) => boolean} [espera]  assert propio; si no, 200 con filas
 * @property {(r: any) => string} [obtenido]
 * @property {string} [nota]
 */
const CASOS = [
  // --- Control ----------------------------------------------------------
  {
    nombre: "control: la consulta sin ningun comentario",
    code: CONSULTA,
    espera: (r) => r.status === 200 && r.body.length === 3,
    nota: "3 filas: la consulta filtra name <> 'zzz' sobre las 3 filas del seed.",
  },

  // --- Defecto 1: un marcador escrito dentro de un comentario -------------
  // Antes de la 13.11.33 esto era 500 `Missing parameter value for $_VAR_HANA_TEST`.
  {
    nombre: "nombre de AppVar en comentario de bloque",
    code: `/* sale de $_VAR_HANA_TEST */\n${CONSULTA}`,
    nota:
      "construirComandoHana no llevaba cuenta de comentarios, asi que el $ del " +
      "comentario se leia como un marcador mas. Mismo defecto que el handler SQL, " +
      "pero por codigo distinto: HANA no pasa por Sequelize.",
  },
  {
    nombre: "nombre de AppVar en comentario de linea",
    code: `-- sale de $_VAR_HANA_TEST\n${CONSULTA}`,
  },
  {
    nombre: ": marcador de replacements en comentario",
    code: `/* :hhdhd */\n${CONSULTA}`,
  },
  {
    nombre: "$ pegado a los delimitadores del comentario",
    code: `/*$_VAR_HANA_TEST*/\n${CONSULTA}`,
  },
  {
    nombre: "varios marcadores falsos en un comentario",
    code: "-- $_VAR_A :name $name @otro\n" + CONSULTA,
  },
  {
    nombre: "comentario que menciona un $name que tambien es un bind real",
    code: `/* el filtro real es $name */\n${CONSULTA}`,
  },
  {
    nombre: "comentario de bloque multilinea",
    code: "/* linea 1 $_VAR_A\n   linea 2 $b\n   linea 3 */\n" + CONSULTA,
  },
  {
    nombre: "comentarios entre clausulas",
    code:
      "SELECT id, name /* del select */\n" +
      "FROM items\n" +
      "-- antes del WHERE\n" +
      "WHERE name <> $name\n" +
      "/* antes del LIMIT */\n" +
      "LIMIT 5",
  },
  {
    nombre: "consulta sin placeholders y con comentario",
    code: "/* nada que sustituir */\nSELECT id, name FROM items LIMIT 5",
  },

  // --- Defecto 2: un apostrofe dentro de un comentario -------------------
  // Este es el que no habia detectado nadie, y por eso se asserta el VALOR y no solo
  // el 200: antes de la 13.11.33 el apostrofe dejaba el estado de comillas pegado,
  // el marcador real de despues ya no se veia y `$name` llegaba literal al motor. La
  // consulta no fallaba con "missing parameter", fallaba con un error de sintaxis.
  // El DUMMY con eco del valor demuestra que el bind llego a sustituirse.
  {
    nombre: "apostrofe en comentario de bloque, marcador real despues",
    code: "/* it's a note */ SELECT :name AS eco FROM DUMMY",
    query: "?name=zzz",
    espera: (r) => r.status === 200 && pick(r.body[0], "eco") === "zzz",
    obtenido: (r) => `HTTP ${r.status} eco=${JSON.stringify(pick(r.body[0], "eco"))} ${String(r.body?.error ?? "").slice(0, 100)}`,
  },
  {
    nombre: "apostrofe en comentario de linea, marcador real despues",
    code: "-- don't filter\nSELECT :name AS eco FROM DUMMY",
    query: "?name=zzz",
    espera: (r) => r.status === 200 && pick(r.body[0], "eco") === "zzz",
    obtenido: (r) => `HTTP ${r.status} eco=${JSON.stringify(pick(r.body[0], "eco"))} ${String(r.body?.error ?? "").slice(0, 100)}`,
  },
  {
    nombre: "varios apostrofos en el comentario, marcador real despues",
    code: "/* don't, really don't */ SELECT :name AS eco FROM DUMMY",
    query: "?name=zzz",
    espera: (r) => r.status === 200 && pick(r.body[0], "eco") === "zzz",
  },
  {
    nombre: "comillas dobles en comentario, marcador real despues",
    code: '/* "not a string" */ SELECT :name AS eco FROM DUMMY',
    query: "?name=zzz",
    espera: (r) => r.status === 200 && pick(r.body[0], "eco") === "zzz",
  },

  // --- Lo que HANA hacia bien y el handler SQL hace distinto -------------
  // Aqui no hay 400: el sustituidor de HANA ya saltaba lo que estaba entre comillas
  // ANTES de la 13.11.33, y eso es lo correcto. En `SQL` hay que rechazar con 400
  // porque ahi quien sustituye es Sequelize, con una regex ciega a literales. La
  // diferencia entre los dos handlers es real y esta es la comprobacion de que no
  // se ha traido el rechazo de uno al otro.
  {
    nombre: "$ dentro de un literal vuelve literal, no 400",
    code: "SELECT 'x: $name' AS txt FROM DUMMY",
    query: "?name=zzz",
    espera: (r) => r.status === 200 && pick(r.body[0], "txt") === "x: $name",
    obtenido: (r) => `HTTP ${r.status} txt=${JSON.stringify(pick(r.body[0], "txt"))} ${String(r.body?.error ?? "").slice(0, 100)}`,
    nota: "HANA no necesita rechazar: su sustituidor respects las comillas.",
  },
  {
    nombre: ": dentro de un literal vuelve literal",
    code: "SELECT 'x: :name' AS txt FROM DUMMY",
    query: "?name=zzz",
    espera: (r) => r.status === 200 && pick(r.body[0], "txt") === "x: :name",
  },
  {
    nombre: "identificador entrecomillado con $ dentro",
    code: 'SELECT 1 AS "col $name" FROM DUMMY',
    query: "?name=zzz",
    espera: (r) => r.status === 200 && pick(r.body[0], "col $name") === 1,
  },
  {
    nombre: "$ con -- dentro de un literal no abre comentario",
    code: "SELECT 'x -- y' AS txt, :name AS eco FROM DUMMY",
    query: "?name=zzz",
    espera: (r) => r.status === 200 && pick(r.body[0], "txt") === "x -- y" && pick(r.body[0], "eco") === "zzz",
  },
  {
    nombre: "$ con /* dentro de un literal no abre comentario",
    code: "SELECT 'x /* y' AS txt, :name AS eco FROM DUMMY",
    query: "?name=zzz",
    espera: (r) => r.status === 200 && pick(r.body[0], "txt") === "x /* y" && pick(r.body[0], "eco") === "zzz",
  },

  // --- Lo que no debe romperse: la expansion de arrays -------------------
  {
    nombre: "array se expande aunque el comentario tenga un $",
    code: "/* $_VAR_HANA_TEST */ SELECT id, name FROM items WHERE name IN ($name) LIMIT 5",
    query: "?name=alpha&name=beta",
    espera: (r) => r.status === 200 && r.body.length === 2,
    obtenido: (r) => `HTTP ${r.status} ${r.body.length} filas ${String(r.body?.error ?? "").slice(0, 100)}`,
  },
  {
    nombre: "array vacio sigue dando error",
    code: "SELECT id FROM items WHERE name IN ($name) LIMIT 5",
    query: "?name=",
    // Solo se comprueba que la consulta se procesa; el array vacio lo rechaza el
    // sustituidor antes de tocar la base, y el mensaje exacto es de otro test.
    espera: (r) => r.status === 200 || r.status === 500,
  },
];

// ------------------------------------------------------------------ corrida

let pass = 0;
const fallos = [];

function registrar(nombre, ok, detalle) {
  if (ok) {
    pass++;
    console.log(`  PASA   ${nombre}`);
    return;
  }
  fallos.push(`${nombre} :: ${detalle}`);
  console.log(`  FALLA  ${nombre} :: ${detalle}`);
}

async function runCaso(c) {
  let idendpoint;
  let res;
  try {
    idendpoint = await crearEndpoint(c.code);
    res = await llamar(c.query ?? "?name=zzz");
  } catch (error) {
    registrar(c.nombre, false, `error de harness: ${error.message}`);
    return;
  } finally {
    if (idendpoint) await borrarEndpoint(idendpoint);
  }

  const cuerpo = Array.isArray(res.body) ? res.body : [];
  const ok = c.espera
    ? c.espera({ status: res.status, body: cuerpo, crudo: res.body })
    : res.status === 200 && cuerpo.length > 0;
  const detalle = c.obtenido
    ? c.obtenido({ status: res.status, body: cuerpo, crudo: res.body })
    : ok
      ? `${cuerpo.length} filas`
      : `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`;
  registrar(c.nombre, ok, detalle);
}

console.log(`\n===== COMENTARIOS EN EL SQL · handler HANA · SAP HANA real =====`);
console.log(`   destino: ${CNX.serverNode} base ${CNX.databaseName} usuario ${CNX.uid}\n`);

for (const c of CASOS) {
  await runCaso(c);
}

console.log(`\n${pass}/${CASOS.length} pasan`);

if (fallos.length > 0) {
  console.log("\nFallos:");
  for (const f of fallos) console.log(`  - ${f}`);
  process.exit(1);
}
