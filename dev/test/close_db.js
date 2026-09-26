import dbsequelize, { connectionReady } from "../../src/lib/db/sequelize.js";

/**
 * Cierra el pool de la BD de pruebas.
 *
 * Las suites que importan `src/lib/db/*` (directamente o a traves de un handler)
 * abren el pool de la plataforma, y con un motor de red ese pool mantiene el
 * event loop vivo: el proceso imprime que todo paso y aun asi no sale, porque un
 * socket TCP no es un handle que se vacie solo. Con SQLite no se nota porque el
 * pool esta en memoria, y por eso el fallo solo aparece al probar contra
 * PostgreSQL o MSSQL.
 *
 * Se espera al `authenticate()` que `sequelize.js` dispara en segundo plano antes
 * de cerrar: cerrarlo mientras esa promesa sigue en vuelo hace que Sequelize
 * responda "pool is draining and cannot accept work".
 *
 * `close()` no debe convertir un test verde en rojo: el proceso va a terminar de
 * todas formas y lo que la suite valida es su resultado, no si el pool se pudo
 * cerrar limpio. Un error aqui se avisa y se sigue.
 */
export async function closeDb() {
  try {
    await connectionReady;
    await dbsequelize.close();
  } catch (err) {
    console.warn("No se pudo cerrar el pool de la base de datos de pruebas:", err?.message ?? err);
  }
}
