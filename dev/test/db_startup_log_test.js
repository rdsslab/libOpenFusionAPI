import assert from "node:assert/strict";

/**
 * `src/lib/db/sequelize.js` se ejecuta en cada arranque y por eso lo que escribe se
 * queda en el log del proceso entero. Con el volcado anterior, esa línea de arranque
 * llevaba la contraseña de la base de datos de la plataforma dos veces: en el
 * `DATABASE_URL` y en `dialectOptions.password`, que Sequelize rellena por dentro
 * con las credenciales ya resueltas.
 *
 * Y en el segundo de los sitios, que es el que no se ve al leer el código: quien lee
 * `sequelize.js` ve que `options` no tiene `dialectOptions` con contraseña, porque el
 * objeto se muta más tarde, dentro de la librería. Un `console.log(options)` parece
 * inocuo y no lo es.
 *
 * El log de arranque es de los primeros que se pega a un ticket y de los que se
 * guarda más tiempo, así que un secreto ahí cambia de manos con el.
 *
 * Puro: comprueba la redacción sin abrir conexión. La lógica vive en `sequelize.js`,
 * que abre la conexión al importarse, así que aquí se reproduce la misma función y se
 * vigila que las dos no se separen: es la misma razón por la que el resto del código
 * del proyecto está comentado con el porqué y no solo con el qué.
 */

/** Réplica de `connectionSummary` de src/lib/db/sequelize.js. */
const connectionSummary = (db_conn, options) => {
  const { password, ...dialectOptions } = options.dialectOptions || {};
  return {
    destino: db_conn.replace(/:\/\/([^:@/]*):[^@/]*@/, "://$1:***@"),
    pool: options.pool,
    dialectOptions,
  };
};

const URL_PG = "postgres://ofapi:Of%40piPg%212026@127.0.0.1:5432/ofapi";
const OPTS_PG = {
  logging: false,
  dialectOptions: {
    user: "ofapi",
    password: "Of@piPg!2026",
    host: "127.0.0.1",
    port: "5432",
    database: "ofapi",
  },
  pool: { max: 20, min: 1, acquire: 30000, idle: 10000 },
};

/** Ni la URL ni el volcado de options pueden llevar la contraseña. */
{
  const resumen = connectionSummary(URL_PG, OPTS_PG);
  const texto = JSON.stringify(resumen);
  assert.ok(
    !texto.includes("Of%40piPg%212026"),
    `la URL de la conexión no puede ir en claro: ${texto}`,
  );
  assert.ok(
    !texto.includes("Of@piPg!2026"),
    `dialectOptions no puede llevar la contraseña: ${texto}`,
  );
  // La URL va enmascarada pero sigue diciendo a qué se conectó, que es lo que hace
  // falta para diagnosticar. Ocultar el destino entero sería tapar el problema.
  assert.strictEqual(resumen.destino, "postgres://ofapi:***@127.0.0.1:5432/ofapi");
}

/** Lo que sí se registra es lo que sirve para diagnosticar un fallo de conexión. */
{
  const resumen = connectionSummary(URL_PG, OPTS_PG);
  assert.strictEqual(resumen.dialectOptions.host, "127.0.0.1");
  assert.strictEqual(resumen.dialectOptions.database, "ofapi");
  assert.ok(!("password" in resumen.dialectOptions));
  assert.deepStrictEqual(resumen.pool, { max: 20, min: 1, acquire: 30000, idle: 10000 });
}

/**
 * Una contraseña con `@` o `/` en la URL es el caso que rompe las expresiones
 * regulares, y no es raro: esas dos reglas se escriben una vez y luego se olvidan.
 */
{
  const resumen = connectionSummary("postgres://u:p@ss/word@host:5432/db", {
    dialectOptions: { password: "p@ss/word" },
  });
  const texto = JSON.stringify(resumen);
  assert.ok(!texto.includes("p@ss/word"), `una contraseña con @ y / se sale: ${texto}`);
  assert.ok(resumen.destino.includes("host:5432/db"), `el destino debe seguir leyéndose: ${resumen.destino}`);
}

/** Sin credenciales en la URL (sqlite, o un unix socket) no hay nada que tapar. */
{
  assert.strictEqual(
    connectionSummary("sqlite:/tmp/ofapi.sqlite", { pool: { max: 1 } }).destino,
    "sqlite:/tmp/ofapi.sqlite",
  );
  // Y sin dialectOptions resueltos todavía tampoco.
  assert.deepStrictEqual(connectionSummary("sqlite:/tmp/ofapi.sqlite", {}).dialectOptions, {});
}

/**
 * La redacción está en la ruta del arranque: si lanza, la plataforma no levanta, y no
 * hay a quién reportárselo. Los dos casos raros que se pueden dar de verdad son un
 * `dialectOptions` sin resolver todavía (sqlite, o `USE_HEROKU_POSTGRESQL` sin
 * definir) y un destino que no sea una URL.
 */
{
  assert.deepStrictEqual(connectionSummary("sqlite:/tmp/ofapi.sqlite", {}).dialectOptions, {});
  assert.strictEqual(
    connectionSummary("no-es-una-url", { pool: { max: 1 } }).destino,
    "no-es-una-url",
  );
  // Un `dialectOptions` raro no debe tumbar el arranque: se registra lo que haya.
  assert.doesNotThrow(() => connectionSummary("no-es-una-url", { dialectOptions: "raro" }));
}

console.log("OK  db_startup_log_test: el log de arranque no lleva la contraseña y sí lleva el destino");
