import assert from "node:assert/strict";
import {
  esErrorDeBloqueo,
  reintentarAnteBloqueo,
  adjuntarReintentoAnteBloqueo,
} from "../../src/lib/db/lock_retry.js";

/**
 * H34: en MSSQL, un `MERGE ... WITH(HOLDLOCK)` de N conexiones simultaneas elige
 * una victima y devuelve 1205. El `HOLDLOCK` lo pone el dialecto mssql de
 * Sequelize en su `upsert`, no este proyecto.
 *
 * Consecuencia medida en un arranque real: 30 faltas 1205, 16 operaciones fallidas
 * en silencio —5 backups de endpoint perdidos y 6 endpoints sin restaurar— y aun
 * asi "Database created or updated successfully with alter: true".
 *
 * Estos tests son puros: no abren conexion. Comprueban QUIEN se reintenta, CUANTO y
 * CUANDO NO, que es donde esta el riesgo de reintentar de mas. Que el 1205 se
 * repita de verdad esta medido en el informe, contra MSSQL.
 */

/** El error tal como llega de tedious 16, medido a traves de Sequelize 6.37.8. */
const errorTedious = (numero, codigo = "EREQUEST", mensaje = "Deadlock.") => {
  const err = new Error(mensaje);
  err.code = codigo;
  err.number = numero;
  err.state = 1;
  err.class = 13;
  return err;
};

/** El envoltorio de Sequelize: `SequelizeDatabaseError` con `parent` y `original`. */
const errorSequelize = (original) => {
  const err = new Error(original.message);
  err.name = "SequelizeDatabaseError";
  err.parent = original;
  err.original = original;
  return err;
};

/** `DatabaseError` de `pg` con el SQLSTATE en `original.code`. */
const errorPostgres = (sqlstate, mensaje = "deadlock detected") => {
  const original = new Error(mensaje);
  original.code = sqlstate;
  const err = new Error(mensaje);
  err.name = "SequelizeDatabaseError";
  err.original = original;
  return err;
};

// ------------------------------------------------------- quien es error de bloqueo

{
  assert.equal(esErrorDeBloqueo(errorSequelize(errorTedious(1205))), true, "1205: la victima del deadlock");
  assert.equal(esErrorDeBloqueo(errorSequelize(errorTedious(1204, "EREQUEST", "Lock request time out period exceeded."))), true, "1204: espera maxima de bloqueo");
  assert.equal(esErrorDeBloqueo(errorTedious(1205)), true, "el error de tedious sin envolver tambien cuenta");
  assert.equal(errorSequelize(errorTedious(1205)).parent.number, 1205, "el envoltorio conserva el numero del driver");
}

{
  assert.equal(esErrorDeBloqueo(errorPostgres("55P03", "canceling statement due to lock timeout")), true, "55P03: lock_not_available");
  assert.equal(esErrorDeBloqueo(errorPostgres("40P01", "deadlock detected")), true, "40P01: deadlock_detected");
  assert.equal(esErrorDeBloqueo(errorPostgres("40001", "could not serialize access")), true, "40001: serialization_failure");
}

{
  // Lo que NO se reintenta importa tanto como lo que si.
  assert.equal(esErrorDeBloqueo(errorSequelize(errorTedious(2601, "EREQUEST", "Cannot insert duplicate key"))), false, "2601: clave duplicada. Reintentar solo repite el error");
  assert.equal(esErrorDeBloqueo(errorSequelize(errorTedious(2627, "EREQUEST", "Violation of UNIQUE KEY constraint"))), false, "2627: unicidad violada, igual");
  assert.equal(esErrorDeBloqueo(errorPostgres("23505", "duplicate key value violates unique constraint")), false, "23505: unicidad violada en PG");
  assert.equal(esErrorDeBloqueo(errorSequelize(errorTedious(undefined, "ETIMEOUT", "Timeout: Request failed to complete in 15000ms"))), false, "ETIMEOUT no es un error de bloqueo: puede ser una consulta lenta de verdad y reintentarla multiplica el coste");
  assert.equal(esErrorDeBloqueo(new Error("boom")), false);
  assert.equal(esErrorDeBloqueo(undefined), false);
  assert.equal(esErrorDeBloqueo(null), false);
  assert.equal(esErrorDeBloqueo("1205"), false, "un string no es un error");
  assert.equal(esErrorDeBloqueo({ number: "1205" }), false, "el numero llega como numero, no como texto");
}

{
  // `parent` y `original` suelen ser el MISMO objeto, y un error construido a mano
  // puede cerrar el ciclo. Un clasificador que se cuelgue en un `while` deja el
  // proceso entero sin poder arrancar.
  const a = new Error("a");
  const b = new Error("b");
  a.original = b;
  b.parent = a;
  assert.equal(esErrorDeBloqueo(a), false, "ciclo sin numero dentro: no debe colgarse");

  // Con el 1205 en la cabeza del ciclo se encuentra, y tampoco se cuelga.
  const d = errorTedious(1205);
  const e = new Error("e");
  d.original = e;
  e.parent = d;
  assert.equal(esErrorDeBloqueo(d), true, "ciclo con un 1205 en la cabeza: lo encuentra y no se cuelga");

  // Autorreferencia: el 1205 esta en un envoltorio al que ya no se llega, asi que la
  // respuesta correcta es `false` y no "se corta el recorrido a mitad y se dice que si".
  const f = errorSequelize(errorTedious(1205));
  f.original = f;
  f.parent = f;
  assert.equal(esErrorDeBloqueo(f), false, "el 1205 es inalcanzable por el ciclo: no se reintenta");
}

// ------------------------------------------------------- cuanto se reintenta

{
  let llamadas = 0;
  const fallo = () => {
    llamadas++;
    throw errorSequelize(errorTedious(1205));
  };

  // Se agota y sale con el ULTIMO error, no con el primero: el mensaje del ultimo
  // es el que describe el estado real cuando se rindio.
  let capturado;
  try {
    await reintentarAnteBloqueo(fallo, { intentos: 3, baseMs: 0, jitter: 0 });
  } catch (e) {
    capturado = e;
  }
  assert.equal(llamadas, 3, "tres intentos: el original y dos reintentos");
  assert.ok(capturado, "un 1205 persistente no puede tragarse el error");
  assert.match(capturado.message, /Deadlock/);
}

{
  let llamadas = 0;
  const valor = await reintentarAnteBloqueo(
    async () => {
      llamadas++;
      if (llamadas < 3) throw errorSequelize(errorTedious(1204));
      return "ok";
    },
    { intentos: 4, baseMs: 0, jitter: 0, alReintentar: () => {} },
  );
  assert.equal(valor, "ok");
  assert.equal(llamadas, 3, "reintenta hasta que sale bien");
}

{
  let llamadas = 0;
  await reintentarAnteBloqueo(
    async () => {
      llamadas++;
      throw new Error("no es de bloqueo");
    },
    { intentos: 5, baseMs: 0, jitter: 0, alReintentar: () => {} },
  ).then(
    () => assert.fail("un error que no es de bloqueo debe propagarse"),
    () => {},
  );
  assert.equal(llamadas, 1, "lo que no es de bloqueo no se reintenta: un error de sintaxis no se arregla esperando");
}

{
  // La espera tiene que crecer y estar acotada. Con `jitter: 0` es determinista.
  const esperas = [];
  await reintentarAnteBloqueo(
    async () => {
      throw errorSequelize(errorTedious(1205));
    },
    {
      intentos: 6,
      baseMs: 10,
      factor: 2,
      topeMs: 50,
      jitter: 0,
      dormir: (ms) => {
        esperas.push(ms);
        return Promise.resolve();
      },
    },
  ).catch(() => {});
  assert.deepEqual(esperas, [10, 20, 40, 50, 50], "crece hasta el tope y no lo pasa");
}

{
  // El jitter es lo que impide que las victimas choquen otra vez a la vez. Con
  // `jitter: 0` la espera es exacta; con jitter por defecto tiene que variar.
  const esperas = new Set();
  for (let tanda = 0; tanda < 12; tanda++) {
    await reintentarAnteBloqueo(
      async () => {
        throw errorSequelize(errorTedious(1205));
      },
      {
        intentos: 2,
        baseMs: 40,
        factor: 2,
        topeMs: 1000,
        jitter: 1,
        dormir: (ms) => {
          esperas.add(ms);
          return Promise.resolve();
        },
      },
    ).catch(() => {});
  }
  assert.ok(esperas.size > 1, `el jitter tiene que dispersar las esperas, salieron siempre iguales: ${[...esperas]}`);
  for (const ms of esperas) {
    assert.ok(ms >= 0 && ms <= 40, `la espera con jitter no puede pasar la de base sin tope: ${ms}`);
  }
}

// ------------------------------------------------------- donde se engancha

{
  // `query` es el unico punto por el que pasa TODO el SQL de Sequelize: los
  // `QueryInterface.select/insert/update/upsert/bulkInsert` de todos los modelos
  // terminan aqui. Engancharse ahi es lo que hace que esto cubra el arranque entero
  // sin tocar los 20 modelos.
  let llamadas = 0;
  const falso = {
    async query(sql, options) {
      llamadas++;
      assert.equal(sql, "SELECT 1");
      assert.deepEqual(options, { marca: 1 });
      if (llamadas < 3) throw errorSequelize(errorTedious(1205));
      return "listo";
    },
    otraCosa() {
      return "intacta";
    },
  };

  // El log de contencion se sustituye por un contador: asi el test comprueba que la
  // cuenta del estado sube sin ensuciar la salida del packet con lineas de aviso.
  const avisos = [];
  const estado = adjuntarReintentoAnteBloqueo(falso, {
    intentos: 4,
    baseMs: 0,
    jitter: 0,
    alRegistrar: (info) => avisos.push(info),
  });
  assert.equal(await falso.query("SELECT 1", { marca: 1 }), "listo");
  assert.equal(llamadas, 3);
  assert.equal(falso.otraCosa(), "intacta", "solo se envuelve `query`");
  assert.equal(estado.reintentos, 2, "el estado lleva la cuenta, que es lo que ve el operador");
  assert.equal(avisos.length, 2, "y un aviso por reintento, con el numero del error");
  assert.match(avisos[0].error.parent.message, /Deadlock/);
  assert.deepEqual(estado.enSentencia, ["SELECT 1", "SELECT 1"], "una entrada por reintento, con la forma de la sentencia y sin los valores");

  // Idempotente: envolver dos veces no apila reintentos.
  assert.equal(adjuntarReintentoAnteBloqueo(falso, { intentos: 9 }), estado, "la segunda llamada devuelve el mismo estado");
  await falso.query("SELECT 1", { marca: 1 });
  assert.equal(llamadas, 4, "y no vuelve a envolver `query`");
}

{
  // DENTRO de una transaccion explicita no se reintenta, y esta es la parte que hay
  // que tener bien: 1205 aborta la transaccion victima entera y 1204 aborta la
  // sentencia, asi que volver a lanzar la sentencia sobre la misma transaccion
  // falla por un motivo mas raro que el original. Un deadlock aqui no se arregla
  // reintentando: se arregla ordenando las transacciones, que es otra cosa.
  let llamadas = 0;
  let fallar = true;
  const transaccion = { COMMIT: "COMMIT" };
  const falso = {
    async query() {
      if (fallar) {
        llamadas++;
        throw errorSequelize(errorTedious(1205));
      }
      return "ok";
    },
  };

  adjuntarReintentoAnteBloqueo(falso, { intentos: 5, baseMs: 0, jitter: 0, alReintentar: () => {} });
  await falso
    .query("SELECT 1", { transaction: transaccion })
    .then(
      () => assert.fail("dentro de una transaccion el 1205 se propaga"),
      (e) => assert.match(e.message, /Deadlock/),
    );
  assert.equal(llamadas, 1, "un intento y nada mas dentro de una transaccion");

  // Y fuera de transaccion la MISMA instancia si reintenta: que la decision se tome
  // por sentencia y no una vez al envolver no deja al pool en un estado raro.
  fallar = true;
  llamadas = 0;
  await falso.query("SELECT 1").catch(() => {});
  assert.equal(llamadas, 5, "fuera de transaccion, los cinco intentos");

  fallar = false;
  assert.equal(await falso.query("SELECT 1"), "ok");
}

{
  // El DDL del `sync({ alter: true })` pasa por aqui tambien, y reintentar un
  // `ALTER TABLE` que ya se aplico es seguro: si la segunda vez falla con
  // "ya existe", el error es el de verdad y sale.
  const llamadas = [];
  const falso = {
    async query(sql) {
      llamadas.push(sql);
      if (llamadas.length < 2) throw errorSequelize(errorTedious(1204));
      return 0;
    },
  };
  adjuntarReintentoAnteBloqueo(falso, { intentos: 3, baseMs: 0, jitter: 0, alReintentar: () => {} });
  assert.equal(await falso.query("ALTER TABLE ofapi_endpoint ADD ..."), 0);
  assert.deepEqual(llamadas, ["ALTER TABLE ofapi_endpoint ADD ...", "ALTER TABLE ofapi_endpoint ADD ..."]);
}

console.log("OK  db_lock_retry_test: el 1205 se reintenta, lo demas no, y nunca dentro de una transaccion");
