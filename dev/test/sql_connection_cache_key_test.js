import assert from "node:assert/strict";
import { buildConnectionCacheKey } from "../../src/lib/handler/utils.js";

/**
 * La clave de caché del pool de conexiones estaba construida a mano con una lista
 * de campos (host, port, dialect, dialectOptions, pool, ssl). El problema de una
 * lista así no es que falten campos, es que el fallo que produce no se ve: no es
 * un error, es una respuesta distinta de la esperada.
 *
 * Con sqlite, `database` es una etiqueta y el archivo real es `options.storage`.
 * Dos endpoints con el mismo `database` y distinto `storage` generaban la misma
 * clave, así que el segundo reutilizaba la conexión del primero y leía la base
 * equivocada sin decir nada. Lo mismo ocurría con el socket unix de MySQL
 * (`path`), con el `search_path` de PostgreSQL (`schema`) y con `timezone`, que es
 * estado de sesión: las tres cambian el resultado de la consulta.
 *
 * Y faltaban dos cosas más, ambas de las que se dan por buenas si no se buscan:
 * la contraseña no estaba en la clave —el segundo endpoint con otra contraseña
 * ejecutaba con las credenciales del primero— y la clave se imprimía entera en los
 * logs del pool, así que cualquier cosa que se serializara en ella quedaba escrita
 * en el log del proceso. La segunda llega a su forma más visible en HANA, cuya clave
 * era `JSON.stringify(config)`: la contraseña iba dentro de la cadena, y esa cadena
 * se imprimía al caducar la entrada del pool.
 *
 * El handler de HANA usaba además una segunda implementación de "cuándo comparten
 * conexión dos peticiones", que es una decisión que tiene que vivir en un solo sitio.
 * La divergencia ya se había pagado una vez: la clave de los handlers SQL dejó de
 * llevar la contraseña y la de HANA ni se enteró. Al pasar por aquí, esta función
 * tenía que aprender además a leer la forma de HANA —raíz, sin `options`, con otros
 * nombres—, porque si no todos sus campos entrarían como `undefined` y dos tenants
 * distintos compartirían entrada.
 *
 * Puro: no abre conexiones.
 */

const key = buildConnectionCacheKey;

/** Dos escrituras de la MISMA configuración deben dar la misma clave. */
{
  const a = { database: "db", username: "u", options: { dialect: "sqlite", storage: "/a.db" } };
  const b = { database: "db", username: "u", options: { storage: "/a.db", dialect: "sqlite" } };
  assert.strictEqual(
    key(a, "dev"),
    key(b, "dev"),
    "el orden de las claves no debe crear dos conexiones al mismo destino",
  );
  // Anidar en un orden distinto tampoco.
  const c = { database: "db", options: { dialect: "postgres", host: "h", dialectOptions: { ssl: true, application_name: "x" } } };
  const d = { database: "db", options: { dialectOptions: { application_name: "x", ssl: true }, host: "h", dialect: "postgres" } };
  assert.strictEqual(key(c, "dev"), key(d, "dev"));
}

/** Cualquier opción que cambie el destino o el resultado debe cambiar la clave. */
{
  const base = { database: "db", username: "u", options: { dialect: "sqlite", storage: "/a.db" } };
  const cambios = [
    ["options.storage (sqlite)", { options: { dialect: "sqlite", storage: "/b.db" } }],
    ["options.dialect", { options: { dialect: "postgres", host: "h", storage: "/a.db" } }],
    ["options.host", { options: { dialect: "sqlite", storage: "/a.db", host: "otro" } }],
    ["options.port", { options: { dialect: "sqlite", storage: "/a.db", port: 5433 } }],
    ["options.path (socket mysql)", { options: { dialect: "mysql", host: "h", path: "/tmp/s.sock" } }],
    ["options.socketPath", { options: { dialect: "mysql", host: "h", socketPath: "/tmp/s.sock" } }],
    ["options.schema (search_path pg)", { options: { dialect: "postgres", host: "h", schema: "otro" } }],
    ["options.timezone", { options: { dialect: "postgres", host: "h", timezone: "Europe/Madrid" } }],
    ["options.ssl", { options: { dialect: "postgres", host: "h", ssl: true } }],
    ["options.pool", { options: { dialect: "postgres", host: "h", pool: { max: 1 } } }],
    ["options.dialectOptions", { options: { dialect: "postgres", host: "h", dialectOptions: { ssl: true } } }],
    ["database", { database: "otra", options: { dialect: "sqlite", storage: "/a.db" } }],
    ["username", { username: "otro", options: { dialect: "sqlite", storage: "/a.db" } }],
    ["parse_bigint", { parse_bigint: true, options: { dialect: "sqlite", storage: "/a.db" } }],
  ];

  for (const [nombre, override] of cambios) {
    assert.notStrictEqual(
      key({ ...base, ...override }, "dev"),
      key(base, "dev"),
      `${nombre} debe entrar en la clave: si no, dos conexiones distintas comparten entrada`,
    );
  }
}

/** El entorno sigue separando una conexión de `prd` de otra de `dev`. */
{
  const base = { database: "db", options: { dialect: "sqlite", storage: "/a.db" } };
  assert.notStrictEqual(key(base, "prd"), key(base, "dev"));
  assert.strictEqual(key(base, "prd"), key({ ...base }, "prd"));
}

/** `undefined` no es un dato: no debe separar dos configuraciones iguales. */
{
  const base = { database: "db", options: { dialect: "sqlite", storage: "/a.db" } };
  assert.strictEqual(
    key({ ...base, options: { ...base.options, driver: undefined } }, "dev"),
    key(base, "dev"),
  );
  assert.strictEqual(key({ ...base, password: undefined }, "dev"), key(base, "dev"));
}

/** Entradas degeneradas: no debe lanzar, y todo vacío es lo mismo. */
{
  assert.strictEqual(key(), key({}), key({}, "dev"), key(undefined, undefined));
  assert.strictEqual(key({ options: null }, "dev"), key({}, "dev"));
  assert.strictEqual(key({ options: [] }, "dev"), key({}, "dev"));
  // `parse_bigint` se normaliza: "true" y true describen lo mismo.
  const base = { database: "db", options: { dialect: "postgres", host: "h" } };
  assert.strictEqual(key({ ...base, parse_bigint: "true" }, "dev"), key({ ...base, parse_bigint: true }, "dev"));
  assert.strictEqual(key({ ...base, parse_bigint: "1" }, "dev"), key({ ...base, parse_bigint: true }, "dev"));
  assert.strictEqual(key({ ...base, parse_bigint: "false" }, "dev"), key(base, "dev"));
  assert.strictEqual(key({ ...base, parse_bigint: 1 }, "dev"), key(base, "dev"), "un 1 numérico no es un sí");
}

/**
 * La contraseña es lo que separa dos conexiones al mismo servidor, y no estaba.
 *
 * El síntoma no es un error de autenticación: es que el endpoint con la contraseña
 * caducada hereda la sesión abierta por el que sí la tenía y contesta con sus
 * datos. Y en sentido inverso, el endpoint con la contraseña equivocada contesta con
 * lo que el otro tenía, en lugar de fallar.
 */
{
  const base = {
    database: "db",
    username: "u",
    password: "correcta",
    options: { dialect: "postgres", host: "h" },
  };
  assert.notStrictEqual(
    key({ ...base, password: "otra" }, "dev"),
    key(base, "dev"),
    "la contraseña debe entrar en la clave: si no, un endpoint sin credencial válida ejecuta con las de otro",
  );
  // La misma contraseña escrita en el sitio que usa HANA también discrimina.
  assert.notStrictEqual(
    key({ databaseName: "T1", user: "u", pwd: "otra", host: "h" }, "dev"),
    key({ databaseName: "T1", user: "u", pwd: "correcta", host: "h" }, "dev"),
  );
  // Y una credencial anidada en `options` también: hay drivers que la leen de ahí.
  assert.notStrictEqual(
    key(
      { database: "db", username: "u", options: { dialect: "mssql", host: "h", dialectOptions: { password: "otra" } } },
      "dev",
    ),
    key(
      { database: "db", username: "u", options: { dialect: "mssql", host: "h", dialectOptions: { password: "correcta" } } },
      "dev",
    ),
  );
}

/**
 * La clave se imprime entera en los logs del pool (conexión caduca, pool lleno,
 * entrada vieja) y esos logs se guardan y se comparten. Serializar la contraseña es
 * escribirla en el log la primera vez que una conexión se recicla.
 *
 * Lo que va en su sitio es la huella: distingue una contraseña de otra, que es lo
 * que la clave necesita, y no se puede leer de vuelta.
 */
{
  const secretas = [
    { database: "db", username: "u", password: "clave-secreta", options: { dialect: "postgres", host: "h" } },
    { databaseName: "T1", user: "u", pwd: "clave-secreta", host: "h" },
    { databaseName: "T1", uid: "u", password: "clave-secreta", serverNode: "h:39041" },
    // También anidada, que es donde se cuelan las que nadie mira.
    { database: "db", options: { dialect: "mssql", host: "h", dialectOptions: { password: "clave-secreta" } } },
    { database: "db", username: "u", options: { dialect: "postgres", host: "h", ssl: { password: "clave-secreta" } } },
  ];

  for (const cfg of secretas) {
    const k = key(cfg, "dev");
    assert.ok(
      !k.includes("clave-secreta"),
      `la clave no puede llevar la contraseña en claro: ${k}`,
    );
    assert.ok(
      k.includes("sha256:"),
      `la clave debería llevar la huella de la credencial: ${k}`,
    );
  }

  // Dos configs con la MISMA contraseña siguen compartiendo conexión: la huella
  // discrimina sin romper la reutilización.
  const a = { database: "db", username: "u", password: "igual", options: { dialect: "postgres", host: "h" } };
  assert.strictEqual(key(a, "dev"), key({ ...a }, "dev"));
}

/**
 * HANA no pasa por Sequelize: su config no trae `options` y describe la conexión en
 * la raíz con otros nombres. Una función que solo leyera `database`, `username` y
 * `password` devolvería `undefined` en los tres casos y dos tenants de HANA
 * distintos —mismo usuario, misma contraseña, distinta base— compartirían entrada.
 *
 * El handler de HANA no pasaba por aquí (usaba `JSON.stringify`), así que esto no
 * describe un fallo que se viera en producción: describe el fallo que habría
 * introducido el moverlo aquí sin enseñarle antes la forma de HANA, que es el orden
 * en que estas cosas se rompen.
 */
{
  const base = {
    databaseName: "HXE",
    user: "SYSTEM",
    password: "secreta",
    host: "10.0.0.5",
    port: 30015,
  };
  const cambios = [
    ["databaseName (tenant)", { databaseName: "OTRO" }],
    ["host", { host: "10.0.0.6" }],
    ["port", { port: 30041 }],
    ["serverNode", { serverNode: "10.0.0.5:30015" }],
    ["user", { user: "OTRO" }],
    ["encrypt", { encrypt: false }],
    ["sslValidateCertificate", { sslValidateCertificate: true }],
  ];

  for (const [nombre, override] of cambios) {
    assert.notStrictEqual(
      key({ ...base, ...override }, "dev"),
      key(base, "dev"),
      `HANA: ${nombre} debe entrar en la clave: si no, dos conexiones distintas comparten pool`,
    );
  }

  // Dos escrituras de la misma config de HANA, en distinto orden, siguen siendo la
  // misma: la clave anterior era `JSON.stringify`, que respeta el orden de inserción.
  const a = { databaseName: "HXE", user: "SYSTEM", password: "s", host: "h", port: 30015 };
  const b = { port: 30015, host: "h", password: "s", user: "SYSTEM", databaseName: "HXE" };
  assert.strictEqual(key(a, "dev"), key(b, "dev"));

  // Y el entorno también separa, como en los handlers de Sequelize.
  assert.notStrictEqual(key(base, "prd"), key(base, "dev"));
}

/**
 * Al revés: las claves que usa la plataforma para sí misma NO cambian a qué
 * servidor se conecta, así que no pueden partir el pool. Dos endpoints HANA con las
 * mismas credenciales pero distinta allowlist comparten conexión de verdad, y
 * separarlos multiplicaría las entradas del pool sin motivo.
 */
{
  const base = {
    databaseName: "HXE",
    user: "SYSTEM",
    password: "s",
    host: "h",
    port: 30015,
    connection_override_allow: ["options.dialect"],
    query_type: "SELECT",
  };
  assert.strictEqual(
    key({ ...base, connection_override_allow: ["host", "port"] }, "dev"),
    key(base, "dev"),
  );
  assert.strictEqual(key({ ...base, query_type: "INSERT" }, "dev"), key(base, "dev"));
  // Con `options` presente manda la forma de Sequelize y la raíz se lee por campos.
  const seq = { database: "db", username: "u", password: "s", options: { dialect: "postgres", host: "h" }, connection_override_allow: ["host"] };
  assert.strictEqual(key(seq, "dev"), key({ ...seq, connection_override_allow: ["otro.campo"] }, "dev"));
}

console.log("OK  sql_connection_cache_key_test: la clave cubre destino, credenciales y forma de config, sin filtrar secretos");
