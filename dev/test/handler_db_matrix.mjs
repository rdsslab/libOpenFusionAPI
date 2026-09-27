// Pruebas del handler SQL / SQL_BULK_I / HANA contra motores REALES.
//
// Crea endpoints efímeros en la app demo y los llama por HTTP, que es el mismo
// camino que usa un cliente. Cada motor se identifica por su config en custom_data.
//
// ## Por qué está fuera del packet
//
// `dev/test/index.js` corre contra lo que haya en el `.env` del proyecto, y ahí el
// motor es uno. Esta matriz necesita los tres a la vez, con una base `sqltest` (o la
// que se le diga) en cada uno, así que no se puede añadir a la lista de suites: en la
// máquina de cualquiera que no tenga los tres contenedores levantados, el packet
// entero pasaría a fallar por un motivo que no tiene que ver con el cambio que está
// probando. Se ejecuta a mano, y por eso vive suelto.
//
// ## Requisitos
//
// 1. La plataforma en marcha, con la app `demo` sembrada.
// 2. Un contenedor por motor, accesible desde donde corre esto. En PostgreSQL y MSSQL
//    el script crea las tablas que usa al arrancar. En HANA hay que sembrarlas antes:
//    es el motor donde el arranque es lento y donde crear el esquema a mano fue lo
//    más rápido (script de referencia: `hana_setup.mjs` en el directorio de trabajo
//    de la auditoría de BD).
//
// ## Uso
//
//   OFAPI_BASE_URL=http://localhost:3000 node handler_db_matrix.mjs
//
// El destino de cada motor se puede mover por entorno y los valores por defecto son
// los de los contenedores de la auditoría, así que sin nada más funciona en un `make
// up` de los de siempre. **La contraseña no tiene valor por defecto y no se escribe en
// el repo**: es lo único que hay que pasar. Un motor sin su contraseña se salta con un
// aviso, en vez de fallar con un error de autenticación que parece un defecto del
// handler:
//
//   OFAPI_TEST_PG_PASSWORD=... OFAPI_TEST_MSSQL_PASSWORD=... \
//     OFAPI_TEST_HANA_PASSWORD=... node handler_db_matrix.mjs
import { TEST_PASSWORD, TEST_USER, basicAuthHeader } from "./test_credentials.js";

const BASE = process.env.OFAPI_BASE_URL || "http://localhost:3000";
const APP = "demo";
const ENV = "dev";

const auth = basicAuthHeader(TEST_USER, TEST_PASSWORD);
const loginRes = await fetch(`${BASE}/api/system/system/login/prd`, {
  method: "POST",
  headers: { Authorization: auth },
});
if (!loginRes.ok) {
  console.error(`login falló: HTTP ${loginRes.status}`);
  process.exit(1);
}
const { token } = await loginRes.json();
const H = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

// El idapp del demo se pide al catalogo, no se fija a mano.
// `/api/apps/catalog` del seed solo acepta POST.
const catalogRes = await fetch(`${BASE}/api/system/api/apps/catalog/prd`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({}),
});
const catalog = await catalogRes.json();
// El catalogo responde con un array plano: {idapp, app, environments}.
const rows = Array.isArray(catalog)
  ? catalog
  : catalog?.result?.data || catalog?.data || catalog?.result || [];
const DEMO_IDAPP = (Array.isArray(rows) ? rows : []).find((a) => a.app === APP)?.idapp;
if (!DEMO_IDAPP) {
  console.error(`no se encontro la app ${APP} en el catalogo: ${JSON.stringify(catalog).slice(0, 300)}`);
  process.exit(1);
}

const PG = {
  label: "postgres",
  database: process.env.OFAPI_TEST_PG_DB || "sqltest",
  username: process.env.OFAPI_TEST_PG_USER || "ofapi",
  password: process.env.OFAPI_TEST_PG_PASSWORD,
  passwordEnv: "OFAPI_TEST_PG_PASSWORD",
  handlerName: "SQL",
  supportsBulk: true,
  options: {
    host: process.env.OFAPI_TEST_PG_HOST || "127.0.0.1",
    port: Number(process.env.OFAPI_TEST_PG_PORT) || 5432,
    dialect: "postgres",
  },
};
const MS = {
  label: "mssql",
  database: process.env.OFAPI_TEST_MSSQL_DB || "sqltest",
  username: process.env.OFAPI_TEST_MSSQL_USER || "sa",
  password: process.env.OFAPI_TEST_MSSQL_PASSWORD,
  passwordEnv: "OFAPI_TEST_MSSQL_PASSWORD",
  handlerName: "SQL",
  supportsBulk: true,
  options: {
    host: process.env.OFAPI_TEST_MSSQL_HOST || "127.0.0.1",
    port: Number(process.env.OFAPI_TEST_MSSQL_PORT) || 1433,
    dialect: "mssql",
  },
};

let passed = 0;
let failed = 0;
const failures = [];

/**
 * HANA devuelve los identificadores en MAYUSCULAS (no entrecomilla los nombres, asi
 * que los pliega), mientras que PostgreSQL y MSSQL los devuelven en minuscula. Para no
 * repetir el mismo assert en minúscula y mayúscula, se busca la clave sin distinguir
 * el caso. La diferencia de caja se reporta aparte como hallazgo de contrato.
 */
function pick(row, key) {
  if (!row) return undefined;
  if (key in row) return row[key];
  const k = Object.keys(row).find((c) => c.toLowerCase() === key.toLowerCase());
  return k ? row[k] : undefined;
}

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- endpoints

const ADMIN = `${BASE}/api/system/api/endpoint/prd`;

async function createEndpoint(resource, { handler, code, custom_data, timeout, method = "POST" }) {
  const res = await fetch(ADMIN, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      idapp: DEMO_IDAPP,
      resource,
      environment: ENV,
      method,
      handler,
      access: 0,
      enabled: true,
      title: "db matrix",
      description: "prueba de matriz de bases de datos",
      code,
      custom_data: typeof custom_data === "string" ? custom_data : JSON.stringify(custom_data),
      timeout,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`crear ${resource}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body?.result?.idendpoint;
}

async function deleteEndpoint(idendpoint) {
  if (!idendpoint) return;
  await fetch(ADMIN, { method: "DELETE", headers: H, body: JSON.stringify({ idendpoint }) });
}

async function call(resource, body, { method = "POST" } = {}) {
  const url = `${BASE}/api/${APP}${resource}/${ENV}`;
  const res = await fetch(url, {
    method,
    headers: method === "GET" ? { Authorization: `Bearer ${token}` } : H,
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, raw: text };
}

// ------------------------------------------------------------------- matrices

// Una entrada por motor: la forma de la consulta la ajusta cada motor.
const ENGINES = [
  {
    ...PG,
    select: "SELECT id, name, qty, price FROM items ORDER BY id",
    selectOne: (v) => `SELECT id, name, qty FROM items WHERE name = '${v}'`,
    selectBind: "SELECT id, name, qty FROM items WHERE name = $name",
    selectRepl: "SELECT id, name, qty FROM items WHERE name = :name",
    insert: (n, q) => `INSERT INTO items (name, qty, price) VALUES ('${n}', ${q}, 1.00)`,
    update: (n) => `UPDATE items SET qty = 99 WHERE name = '${n}'`,
    delete: (n) => `DELETE FROM items WHERE name = '${n}'`,
    bigints: "SELECT id, big FROM counters ORDER BY id",
    sleep: (ms) => `WAITFOR DELAY '00:00:0${Math.floor(ms / 1000)}'`,
    syntaxError: "SELEKT * FROM items",
  },
  {
    ...MS,
    select: "SELECT id, name, qty, price FROM items ORDER BY id",
    selectOne: (v) => `SELECT TOP 1 id, name, qty FROM items WHERE name = '${v}'`,
    selectBind: "SELECT TOP 1 id, name, qty FROM items WHERE name = $name",
    selectRepl: "SELECT TOP 1 id, name, qty FROM items WHERE name = :name",
    insert: (n, q) => `INSERT INTO items (name, qty, price) VALUES ('${n}', ${q}, 1.00)`,
    update: (n) => `UPDATE items SET qty = 99 WHERE name = '${n}'`,
    delete: (n) => `DELETE FROM items WHERE name = '${n}'`,
    bigints: "SELECT id, big FROM counters ORDER BY id",
    sleep: (ms) => `WAITFOR DELAY '00:00:0${Math.floor(ms / 1000)}'`,
    syntaxError: "SELEKT * FROM items",
  },
  {
    // HANA no pasa por Sequelize: usa su propio handler y las claves nativas del
    // driver (@sap/hana-client), que son user/password/databaseName, no username/
    // database. Tampoco admite VALUES multi-fila, asi que el bulk por Sequelize
    // (SQL_BULK_I) no aplica aqui.
    label: "hana",
    database: process.env.OFAPI_TEST_HANA_DB || "HXE",
    username: process.env.OFAPI_TEST_HANA_USER || "SYSTEM",
    password: process.env.OFAPI_TEST_HANA_PASSWORD,
    passwordEnv: "OFAPI_TEST_HANA_PASSWORD",
    handlerName: "HANA",
    supportsBulk: false,
    options: {
      host: process.env.OFAPI_TEST_HANA_HOST || "127.0.0.1",
      port: Number(process.env.OFAPI_TEST_HANA_PORT) || 39141,
    },
    select: "SELECT id, name, qty, price FROM items ORDER BY id",
    selectOne: (v) => `SELECT id, name, qty FROM items WHERE name = '${v}'`,
    selectBind: "SELECT id, name, qty FROM items WHERE name = $name",
    // executeQuery (sqlHana.js:386) reescribe solo los marcadores `$name` y `:name` a
    // `?` posicional. Un `?` literal en la consulta no lo toca y llega al driver sin
    // parametros, que responde "not all variables bound". Se prueba como caso negativo.
    selectBindQuestion: "SELECT id, name, qty FROM items WHERE name = ?",
    selectRepl: "SELECT id, name, qty FROM items WHERE name = :name",
    insert: (n, q) => `INSERT INTO items (name, qty, price) VALUES ('${n}', ${q}, 1.00)`,
    update: (n) => `UPDATE items SET qty = 99 WHERE name = '${n}'`,
    delete: (n) => `DELETE FROM items WHERE name = '${n}'`,
    bigints: "SELECT id, big FROM counters ORDER BY id",
    sleep: (ms) => `SELECT SLEEP(${ms}) FROM DUMMY`,
    syntaxError: "SELEKT * FROM items",
  },
];

/**
 * Construye el `custom_data` del endpoint con la forma que espera cada handler.
 * Sequelize (SQL, SQL_BULK_I) usa database/username/password + options.dialect;
 * el driver de HANA usa databaseName/user/password y no lleva dialect.
 */
function cd(eng, { password = eng.password, options = eng.options, query_type, databaseName = eng.database } = {}) {
  if (eng.handlerName === "HANA") {
    return {
      databaseName,
      user: eng.username,
      password,
      ...options,
    };
  }
  return {
    database: eng.database,
    username: eng.username,
    password,
    ...(query_type ? { query_type } : {}),
    options,
  };
}

async function runEngine(eng) {
  console.log(`\n===== MOTOR: ${eng.label} =====`);
  const r = `/dbm_${eng.label}`;

  // --- SELECT simple
  const ep1 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.select,
    custom_data: cd(eng, { query_type: "SELECT" }),
  });
  let res = await call(r, {});
  check(`${eng.label}: SELECT simple devuelve filas`, res.status === 200 && Array.isArray(res.body) && res.body.length >= 3,
    `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  const qty = pick(res.body?.[0], "qty");
  check(`${eng.label}: qty llega como numero`, typeof qty === "number",
    `typeof qty = ${typeof qty} (${JSON.stringify(res.body?.[0])})`);
  if (eng.label === "hana") {
    console.log(`  INFO  hana: los nombres de columna llegan en MAYUSCULAS (${JSON.stringify(Object.keys(res.body?.[0] ?? {}))})`);
  }
  await deleteEndpoint(ep1);

  // --- bind
  // El bind no es igual en los tres motores. En los de Sequelize (`$name`) el handler
  // lo traduce; en HANA el driver solo enlaza arrays, y el handler convierte siempre
  // a objeto, asi que un payload de objeto no enlaza nada. Se prueban las dos formas
  // para dejar el contraste medido en vez de asumido.
  const ep2 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.selectBind,
    custom_data: cd(eng, { query_type: "SELECT" }),
  });
  res = await call(r, { name: "beta" });
  check(`${eng.label}: bind devuelve la fila pedida`,
    res.status === 200 && res.body?.length === 1 && pick(res.body[0], "name") === "beta",
    `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  if (eng.handlerName === "HANA") {
    // Contraprueba: `?` posicional no es un marcador que executeQuery sepa reescribir.
    const ep2b = await createEndpoint(r, {
      handler: eng.handlerName,
      code: eng.selectBindQuestion,
      custom_data: cd(eng),
    });
    res = await call(r, { name: "beta" });
    check(`hana: bind con "?" posicional no funciona (solo $name / :name)`, res.status >= 400,
      `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 130)}`);
    console.log(`  INFO  hana: el handler solo reescribe $name y :name a positional; un "?" literal pasa sin enlazar`);
    await deleteEndpoint(ep2b);
  } else {
    res = await call(r, {});
    check(`${eng.label}: bind sin param no rompe (rellena "")`, res.status === 200,
      `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
  }
  await deleteEndpoint(ep2);

  // --- replacements (:name)
  const ep3 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.selectRepl,
    custom_data: cd(eng, { query_type: "SELECT" }),
  });
  res = await call(r, { name: "gamma" });
  check(`${eng.label}: replacements :name devuelve la fila`,
    res.status === 200 && res.body?.length === 1 && pick(res.body[0], "name") === "gamma",
    `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  await deleteEndpoint(ep3);

  // --- escritura + lectura de vuelta
  const ep4 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.insert("delta_probe", 5),
    custom_data: cd(eng, { query_type: "INSERT" }),
  });
  res = await call(r, {});
  check(`${eng.label}: INSERT responde 2xx`, res.status >= 200 && res.status < 300, `HTTP ${res.status}`);
  await deleteEndpoint(ep4);

  const ep5 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.selectOne("delta_probe"),
    custom_data: cd(eng, { query_type: "SELECT" }),
  });
  res = await call(r, {});
  check(`${eng.label}: la fila insertada se lee de vuelta`, res.status === 200 && res.body?.length === 1 && pick(res.body[0], "qty") === 5,
    `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  await deleteEndpoint(ep5);

  const ep6 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.update("delta_probe"),
    custom_data: cd(eng, { query_type: "UPDATE" }),
  });
  res = await call(r, {});
  check(`${eng.label}: UPDATE responde 2xx`, res.status >= 200 && res.status < 300, `HTTP ${res.status}`);
  await deleteEndpoint(ep6);

  const ep7 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.selectOne("delta_probe"),
    custom_data: cd(eng, { query_type: "SELECT" }),
  });
  res = await call(r, {});
  check(`${eng.label}: el UPDATE se ve en la lectura`, pick(res.body?.[0], "qty") === 99, `qty = ${pick(res.body?.[0], "qty")}`);
  await deleteEndpoint(ep7);

  const ep8 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.delete("delta_probe"),
    custom_data: cd(eng, { query_type: "DELETE" }),
  });
  res = await call(r, {});
  check(`${eng.label}: DELETE responde 2xx`, res.status >= 200 && res.status < 300, `HTTP ${res.status}`);
  await deleteEndpoint(ep8);

  // --- error de sintaxis: ¿queda claro que es del motor y no del handler?
  const ep9 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.syntaxError,
    custom_data: cd(eng, { query_type: "SELECT" }),
  });
  res = await call(r, {});
  check(`${eng.label}: error de sintaxis devuelve 4xx/5xx (no 200)`, res.status >= 400,
    `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  await deleteEndpoint(ep9);

  // --- credenciales incorrectas
  // La clave de cache del pool incluye la huella de la password, asi que este
  // endpoint cae en una entrada DISTINTA a la del endpoint con la password buena de
  // mas arriba y tiene que authenticarse de verdad. Antes de que la clave llevara la
  // huella, caia en la misma entrada: en MSSQL el driver reautenticaba al tomar la
  // conexion y el fallo salia igual, pero en PostgreSQL la sesion reutilizada
  // respondia 200 con las filas de la base, y en HANA tampoco se notaba porque su
  // clave era el config entero, que si incluia la password.
  const ep10 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.select,
    custom_data: cd(eng, { password: "password-incorrecta", query_type: "SELECT" }),
  });
  res = await call(r, {});
  const credLeak = res.status === 200;
  console.log(`  INFO  ${eng.label}: password erronea -> HTTP ${res.status}${credLeak ? " (OJO: devolvio datos)" : ""}`);
  check(`${eng.label}: credencial invalida no entrega datos`, !credLeak,
    `HTTP ${res.status} devolvio filas con una password incorrecta`);
  await deleteEndpoint(ep10);

  // --- HANA: dos tenants distintos no comparten pool
  // La config de HANA no trae `options`: describe la conexion en la raiz y con otros
  // nombres. Si la clave de cache no los leyera, este endpoint caeria en la entrada
  // del de arriba —mismo usuario, misma contrasena, otra base— y responderia con las
  // filas de la base que NO existe, que es el modo en que se cuela una fuga entre
  // tenants: sin error, con datos.
  if (eng.handlerName === "HANA") {
    const ep10b = await createEndpoint(r, {
      handler: eng.handlerName,
      code: eng.select,
      custom_data: cd(eng, { databaseName: "TENANT_QUE_NO_EXISTE", query_type: "SELECT" }),
    });
    res = await call(r, {});
    const Crosstalk = res.status === 200 && Array.isArray(res.body) && res.body.length > 0;
    check(`hana: un databaseName distinto NO lee la base del otro tenant`, !Crosstalk,
      `HTTP ${res.status} devolvio ${Array.isArray(res.body) ? res.body.length : "?"} filas de un tenant inexistente`);
    await deleteEndpoint(ep10b);
  }

  // --- bigint
  const ep11 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.bigints,
    custom_data: cd(eng, { query_type: "SELECT" }),
  });
  res = await call(r, {});
  const safe = pick(res.body?.find?.((c) => String(pick(c, "id")) === "1"), "big");
  const unsafe = pick(res.body?.find?.((c) => String(pick(c, "id")) === "2"), "big");
  check(`${eng.label}: bigint dentro del rango seguro llega como numero`, typeof safe === "number" || typeof safe === "string",
    `safe = ${JSON.stringify(safe)} (${typeof safe})`);
  check(`${eng.label}: bigint fuera de rango llega como texto (sin perder precision)`,
    String(unsafe) === "9223372036854775807", `unsafe = ${JSON.stringify(unsafe)} (${typeof unsafe})`);
  await deleteEndpoint(ep11);

  // --- timeout del endpoint
  const ep12 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.select,
    custom_data: cd(eng, { query_type: "SELECT" }),
    timeout: 1,
  });
  res = await call(r, {});
  check(`${eng.label}: endpoint con timeout=1s sigue respondiendo bien`, res.status === 200, `HTTP ${res.status}`);
  await deleteEndpoint(ep12);

  // --- dialecto ausente
  // Solo aplica a los motores que pasan por Sequelize: HANA no pide dialect.
  if (eng.handlerName === "SQL") {
    const ep13 = await createEndpoint(r, {
      handler: eng.handlerName,
      code: eng.select,
      custom_data: cd(eng, { options: { host: "127.0.0.1", port: eng.options.port }, query_type: "SELECT" }),
    });
    res = await call(r, {});
    check(`${eng.label}: sin dialecto falla con mensaje util`, res.status >= 400 && /dialect/i.test(JSON.stringify(res.body)),
      `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    await deleteEndpoint(ep13);
  }

  if (!eng.supportsBulk) {
    console.log(`  INFO  ${eng.label}: SQL_BULK_I no aplica (el bulk de Sequelize no cubre este motor)`);
    return;
  }

  // --- SQL_BULK_I
  const ep14 = await createEndpoint(r, {
    handler: "SQL_BULK_I",
    code: "items",
    custom_data: cd(eng),
  });
  res = await call(r, {
    data: [
      { name: "bulk1", qty: 1, price: 1.5 },
      { name: "bulk2", qty: 2, price: 2.5 },
    ],
  });
  check(`${eng.label}: SQL_BULK_I inserta filas`, res.status === 200, `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  await deleteEndpoint(ep14);

  // --- SQL_BULK_I con GET debe rechazarse
  // El 405 vive en sqlFunctionInsertBulk.js:54, detras del enrutado. Con el endpoint
  // registrado como POST, un GET muere en el router con 404 y nunca llega al handler,
  // asi que hace falta registrarlo como GET para alcanzar la guarda.
  const rGet = `/dbm_get_${eng.label}`;
  const ep15 = await createEndpoint(rGet, {
    method: "GET",
    handler: "SQL_BULK_I",
    code: "items",
    custom_data: cd(eng),
  });
  res = await call(rGet, {}, { method: "GET" });
  check(`${eng.label}: SQL_BULK_I rechaza GET con 405`, res.status === 405,
    `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
  await deleteEndpoint(ep15);

  // limpiar filas de sonda
  const ep16 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.delete("bulk1"),
    custom_data: cd(eng, { query_type: "DELETE" }),
  });
  await call(r, {});
  const ep17 = await createEndpoint(r, {
    handler: eng.handlerName,
    code: eng.delete("bulk2"),
    custom_data: cd(eng, { query_type: "DELETE" }),
  });
  await call(r, {});
  await deleteEndpoint(ep17);
}

for (const eng of ENGINES) {
  if (!eng.password) {
    console.log(`\n===== MOTOR: ${eng.label} =====`);
    console.log(`  SKIP  sin ${eng.passwordEnv}: no se puede autenticar`);
    continue;
  }
  try {
    await runEngine(eng);
  } catch (err) {
    failed++;
    failures.push(`${eng.label}: excepcion no controlada :: ${err.message}`);
    console.log(`  FAIL  ${eng.label}: excepcion no controlada :: ${err.message}`);
  }
}

console.log(`\n===== RESUMEN: ${passed} pass, ${failed} fail =====`);
if (failures.length > 0) {
  console.log("fallos:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
