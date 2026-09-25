import assert from "node:assert/strict";
import { isConnectionExhaustionError } from "../../src/lib/handler/ConnectionPool.js";

/**
 * H6: el pool reportaba como `Cannot authenticate connection to database: <texto
 * del driver>` absolutamente todo fallo de apertura. El texto del driver se
 * colaba detrás, así que «sorry, too many clients already» —que no tiene nada que
 * ver con credenciales— salía como si el password estuviera mal, y el diagnóstico
 * que seguía era rotar una contraseña que era correcta.
 *
 * Estos tests son puros: no abren conexiones ni tocan la base de datos.
 */

// --- Agotamiento de conexiones: debe reconocerse como tal ------------------
{
  // PostgreSQL: el texto llega en el mensaje, el SQLSTATE en err.original.code.
  assert.equal(
    isConnectionExhaustionError({
      message: "Connection terminated due to administrator command",
      original: {
        code: "53300",
        message: 'sorry, too many clients already',
      },
    }),
    true,
    "Postgres 53300 / too many clients",
  );

  // Solo el texto, sin ningún código estructurado.
  assert.equal(
    isConnectionExhaustionError({ message: "sorry, too many clients already" }),
    true,
    "Postgres solo por texto",
  );

  // MySQL / MariaDB.
  assert.equal(
    isConnectionExhaustionError({
      message: "Too many connections",
      parent: { errno: 1040, code: "ER_CON_COUNT_ERROR" },
    }),
    true,
    "MySQL ER_CON_COUNT_ERROR",
  );
  assert.equal(
    isConnectionExhaustionError({ message: "ER_CON_COUNT_ERROR" }),
    true,
    "MySQL solo por texto",
  );

  // SQL Server: 109 es "too many connections"; 18456 sería autenticación.
  assert.equal(
    isConnectionExhaustionError({
      number: 109,
      message: "Could not open a connection because of too many existing connections",
    }),
    true,
    "SQL Server 109",
  );

  // Variantes de otros gestores y proxies.
  for (const text of [
    "FATAL: sorry, too many clients already",
    "pg_s_overflow: sorry, too many clients already",
    "Max client connections reached",
    "connection limit reached",
    "Too many connections for role",
  ]) {
    assert.equal(
      isConnectionExhaustionError({ message: text }),
      true,
      `debería reconocer agotamiento: ${text}`,
    );
  }
}

// --- Fallos de autenticación: NO deben confundirse con agotamiento ---------
{
  // Postgres: contraseña inválida (28P01).
  assert.equal(
    isConnectionExhaustionError({
      original: { code: "28P01", message: "password authentication failed for user \"app\"" },
      message: "password authentication failed for user \"app\"",
    }),
    false,
    "Postgres 28P01 es autenticación",
  );

  // Postgres: rol inexistente (28000).
  assert.equal(
    isConnectionExhaustionError({
      original: { code: "28000", message: 'role "app" does not exist' },
    }),
    false,
    "Postgres 28000 es autenticación",
  );

  // MySQL: acceso denegado.
  assert.equal(
    isConnectionExhaustionError({
      message: "Access denied for user 'app'@'10.0.0.4' (using password: YES)",
      parent: { errno: 1045, code: "ER_ACCESS_DENIED_ERROR" },
    }),
    false,
    "MySQL 1045 es autenticación",
  );

  // SQL Server: 18456 SÍ es autenticación, y es el que más se confunde con 109.
  assert.equal(
    isConnectionExhaustionError({
      number: 18456,
      message: "Login failed for user 'app'.",
    }),
    false,
    "SQL Server 18456 es autenticación",
  );

  // Red caída: no es agotamiento ni autenticación.
  for (const text of [
    "ECONNREFUSED 127.0.0.1:5432",
    "ETIMEDOUT",
    "getaddrinfo ENOTFOUND db.interno",
    "Connection terminated unexpectedly",
    "the database system is starting up",
    "canceling statement due to statement timeout",
  ]) {
    assert.equal(
      isConnectionExhaustionError({ message: text }),
      false,
      `no debería marcarse como agotamiento: ${text}`,
    );
  }
}

// --- Entradas degeneradas: nunca deben lanzar ni dar un falso positivo -----
{
  for (const bad of [null, undefined, 0, "", [], {}]) {
    assert.equal(isConnectionExhaustionError(bad), false, `entrada ${JSON.stringify(bad)}`);
  }

  // Un error sin mensaje ni código no puede clasificarse: se informa que no.
  assert.equal(isConnectionExhaustionError({ name: "Error" }), false);
}

// --- El patrón de MySQL 1040 no debe confundirse con un 1040 cualquiera ---
{
  // 1040 es ER_CON_COUNT_ERROR solo cuando viene accompanied del texto o del
  // código; un número suelto en un mensaje cualquiera no debe activar la regla.
  assert.equal(
    isConnectionExhaustionError({ message: "el puerto 1040 no responde" }),
    false,
    "un 1040 citado al vuelo no es ER_CON_COUNT_ERROR",
  );
}

console.log("OK  connection_pool_limits_test: agotamiento vs autenticación");
