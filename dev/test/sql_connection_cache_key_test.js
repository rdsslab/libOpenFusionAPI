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

console.log("OK  sql_connection_cache_key_test: la clave cubre todo options, sin falsos positivos");
