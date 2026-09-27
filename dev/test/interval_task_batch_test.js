import "dotenv/config";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import {
  getIntervalTask,
  getIntervalTaskProcess,
  LOTE_TAREAS_POR_DEFECTO,
} from "../../src/lib/db/interval_task.js";
import { Endpoint, IntervalTask } from "../../src/lib/db/models.js";
import { closeDb } from "./close_db.js";

/**
 * H37: el lote de tareas vencidas que se traen en un viaje.
 *
 * El worker no puede limitar cuantas tareas arrancan a la vez —cada una va a su destino y
 * muchas a bases de datos distintas, y todas tienen una hora programada—, asi que lo
 * acotado es el trabajo por ciclo: un `LIMIT`. Un `LIMIT` solo no basta, y el fallo no es
 * un error de SQL sino un drenaje que no termina.
 *
 * Con `ORDER BY next_run, idtask` el orden es total, asi que a medida que las tareas se van
 * del conjunto elegible —cada lanzamiento manda su `next_run` al futuro— las lecturas
 * siguientes van devolviendo la porcion que toca, sin repetir y sin saltarse ninguna. Sin
 * orden fijo, dos lecturas arbitrarias del mismo conjunto pueden devolver subconjuntos
 * solapados, y la tarea que se solapa se relanza para siempre.
 *
 * Estas pruebas fijan las dos mitades por separado, porque por separado se pueden volver
 * a romper:
 *
 * - Que el SQL **lleve** el orden. Sin esto, el resto puede pasar por casualidad: en
 *   SQLite y MSSQL una consulta sin `ORDER BY` sale en orden de insercion, que ya es un
 *   orden estable.
 * - Que el orden **recorra** el conjunto. Esto hay que simularlo vaciando el conjunto,
 *   porque dos lecturas seguidas de un conjunto que no cambia devuelven el mismo prefijo
 *   y no dicen nada del drenaje.
 *
 * Abre conexion: el `LIMIT` y el `ORDER BY` son de la consulta, y un helper que los
 * compone bien sobre una lista falsa no demuestra nada contra el motor.
 */

const TEST_APP_ID = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";
const CUANTAS = 12;
const LOTE = 5;

async function runTests() {
  console.log("--- Starting Interval Task Batch Tests ---");

  const endpointId = uuidv4();
  const endpoint = await Endpoint.create({
    idendpoint: endpointId,
    idapp: TEST_APP_ID,
    environment: "dev",
    resource: `/interval-task-batch-test-${Date.now()}`,
    method: "GET",
    handler: "TEXT",
    enabled: true,
    code: "ok",
  });

  try {
    // 1. Tareas elegibles, vencidas y con vencimientos distintos
    console.log(`[STEP 1/5] Creating ${CUANTAS} due tasks with distinct deadlines...`);
    const base = new Date("2021-03-04T05:06:07.000Z").getTime();
    for (let i = 0; i < CUANTAS; i++) {
      await IntervalTask.create({
        idendpoint: endpoint.idendpoint,
        enabled: true,
        interval: 900,
        // Vencidas de sobra y a minutos distintos: el orden de `next_run` es lo unico
        // que las distingue, que es justo lo que se quiere comprobar.
        next_run: new Date(base + i * 60_000),
        note: `lote test ${i}`,
      });
    }
    const creadas = await IntervalTask.findAll({
      attributes: ["idtask"],
      where: { idendpoint: endpoint.idendpoint },
      raw: true,
    });
    assert.strictEqual(creadas.length, CUANTAS, "se han creado todas las tareas");
    const mias = new Set(creadas.map((t) => t.idtask));

    /** De un lote, solo mis tareas y en el orden en que han venido. */
    const misTareas = (lote) => lote.filter((t) => mias.has(t.idtask)).map((t) => t.idtask);

    // 2. El orden de referencia lo da la propia consulta, sin lote
    console.log("[STEP 2/5] The reference order comes from the query itself...");
    const todo = await getIntervalTaskProcess({ limite: LOTE * 10 });
    assert.ok(todo.length > LOTE, `debe haber mas tareas que un lote; hay ${todo.length}`);
    const esperadas = misTareas(todo);
    assert.strictEqual(esperadas.length, CUANTAS, "y en particular las doce de esta prueba");

    // 3. El limite se respeta y lo que entra es lo mas vencido
    console.log("[STEP 3/5] The limit is honoured and the order is the due one...");
    const lote = await getIntervalTaskProcess({ limite: LOTE });
    assert.ok(lote.length <= LOTE, `un lote de ${LOTE} no puede traer ${lote.length} filas`);
    const enLote = misTareas(lote);
    assert.deepStrictEqual(
      enLote,
      esperadas.slice(0, enLote.length),
      "el lote se llena por orden de vencimiento, no con lo que la consulta devuelve primero",
    );

    // El SQL tiene que llevar el orden. Sin comprobarlo, el paso 3 puede pasar por
    // casualidad, como se explica en la cabecera.
    const sqlCapturadas = [];
    const loggingOriginal = IntervalTask.sequelize.options.logging;
    IntervalTask.sequelize.options.logging = (sql) => sqlCapturadas.push(sql);
    try {
      await getIntervalTaskProcess({ limite: LOTE });
    } finally {
      IntervalTask.sequelize.options.logging = loggingOriginal;
    }
    const consulta = sqlCapturadas.find((s) => /intervaltask/i.test(s));
    assert.ok(consulta, "la consulta de tareas debe quedar registrada; no se registro ninguna");
    assert.match(
      consulta,
      /ORDER\s+BY/i,
      `un LIMIT sin ORDER BY devuelve un subconjunto arbitrario y el drenaje no termina. SQL: ${consulta}`,
    );
    assert.match(consulta, /next_run/i, `el orden empieza por next_run. SQL: ${consulta}`);
    assert.match(consulta, /idtask/i, `idtask va de segundo criterio, para desempatar. SQL: ${consulta}`);

    // 4. Drenar: vaciar el conjunto, como hace el worker al lanzar
    console.log("[STEP 4/5] Draining the batch walks the set once...");
    const recorridas = [];
    for (let tanda = 0; tanda < 10; tanda++) {
      const parte = await getIntervalTaskProcess({ limite: LOTE });
      if (parte.length === 0) break;

      const suyas = misTareas(parte);
      assert.deepStrictEqual(
        suyas,
        esperadas.slice(recorridas.length, recorridas.length + suyas.length),
        `la tanda ${tanda + 1} no sigue donde termino la anterior: el drenaje repetiria tareas`,
      );
      recorridas.push(...suyas);

      // Lo que hace el worker al lanzar: la transicion a RUNNING manda `next_run` al
      // futuro, y con eso la tarea sale del conjunto elegible.
      await IntervalTask.update(
        { next_run: new Date(Date.now() + 3_600_000) },
        { where: { idtask: parte.map((t) => t.idtask) } },
      );
    }
    assert.deepStrictEqual(
      recorridas,
      esperadas,
      `drenando tendrian que salir las ${CUANTAS} tareas en orden y sin repetir; salieron ${recorridas.length}`,
    );
    assert.strictEqual(new Set(recorridas).size, CUANTAS, "y ninguna sale dos veces");

    // 5. El listado de la API no se pagina
    console.log("[STEP 5/5] The API listing is not paginated...");
    // El drenaje vacio el conjunto elegible a proposito, asi que hay que volver a armarlo
    // para poder medir nada: con el conjunto vacio cualquier consulta devuelve el
    // limite que se le pida y la comprobacion no valdria.
    await IntervalTask.update(
      { next_run: new Date(base) },
      { where: { idendpoint: endpoint.idendpoint } },
    );
    const listado = await getIntervalTask({});
    assert.ok(
      listado.length > LOTE,
      `getIntervalTask sin opciones sigue devolviendo todo; devolvio ${listado.length}`,
    );
    assert.strictEqual(
      misTareas(listado).length,
      CUANTAS,
      "el limite es del planificador, no del contrato del endpoint de listado",
    );
    assert.strictEqual(LOTE_TAREAS_POR_DEFECTO, 200, "el lote por defecto son 200 tareas");
    for (const limite of [0, -3, "muchos", null]) {
      const conLoteRaro = await getIntervalTaskProcess({ limite });
      assert.ok(
        conLoteRaro.length > LOTE,
        `un limite que no es un entero >= 1 (${JSON.stringify(limite)}) cae al de por defecto, ` +
          `no a un lote vacio ni a un error; devolvio ${conLoteRaro.length}`,
      );
    }

    console.log("--- All Interval Task Batch Tests Passed Successfully! ---");
  } finally {
    await IntervalTask.destroy({ where: { idendpoint: endpoint.idendpoint } });
    await Endpoint.destroy({ where: { idendpoint: endpoint.idendpoint } });
  }
}

runTests()
  .then(closeDb)
  .catch(async (err) => {
    console.error("\nInterval task batch test suite failed with error:");
    console.error(err);
    await closeDb();
    process.exit(1);
  });
