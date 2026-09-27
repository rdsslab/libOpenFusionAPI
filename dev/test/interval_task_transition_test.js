import assert from "node:assert/strict";
import { updateIntervalTaskStatus } from "../../src/lib/db/interval_task.js";
import { IntervalTask } from "../../src/lib/db/models.js";
import { TASK_STATUS, debeDrenarLote } from "../../src/lib/timer/schedule.js";
import { closeDb } from "./close_db.js";

/**
 * H37: la transicion de estado de una tarea de intervalo.
 *
 * Lo que se fija aqui son tres cosas del contrato de `updateIntervalTaskStatus`:
 *
 * 1. **Con la fila a mano, una sola sentencia.** El worker se la trae con el endpoint y
 *    la app para decidir si lanza la tarea, y la volvia a pedir aqui. Ese segundo viaje
 *    estaba en el camino que retarda el arranque de cada ejecucion, que es justo lo que
 *    en un despliegue con cientos de tareas no se puede permitir. Con la fila, un solo
 *    `UPDATE`: ni lectura, ni transaccion. Un `UPDATE` con sus propios valores ya es
 *    atomico, asi que una transaccion aqui solo costaria viajes.
 * 2. **Sin la fila, lectura y escritura en la misma transaccion**, pidiendo el bloqueo de
 *    fila. Es el caso de `ERROR` y `TIMEOUT`, donde se incrementa `failed_attempts`:
 *    leer y escribir son dos sentencias y entre medias otra puede cambiar la fila.
 * 3. **Un estado que no existe no escribe nada.** Antes caia en
 *    `IntervalTask.update({}, ...)`, que es un `UPDATE` sin nada que poner.
 *
 * Ademas se comprueba `debeDrenarLote`, que decide si el worker vuelve a preguntar
 * tareas de inmediato o se duerme. Vive en `schedule.js` y no en el worker porque el
 * worker es un hilo con efectos al importarse: una decision que se puede volver a
 * romper sin que se note tiene que estar en una funcion pura.
 *
 * Puro: no abre conexion. Se instrumentan `findOne`, `update` y la transaccion del
 * modelo, que es donde se puede ver cuantas sentencias salen de verdad.
 */

/** Fila de tarea creible para el calculo de horarios y de fallos. */
const TAREA = () => ({
  idtask: 7,
  interval: 300,
  schedule_mode: "interval",
  cron: null,
  timezone: null,
  next_run: new Date("2020-01-01T00:00:00.000Z"),
  last_run: new Date("2019-12-31T23:55:00.000Z"),
  failed_attempts: 3,
  max_failed_attempts: 10,
  backoff_enabled: true,
  max_backoff_seconds: 300,
  status: TASK_STATUS.RUNNING,
  history_limit: 0,
  window_start: null,
  window_end: null,
  window_days: null,
});

/**
 * Sustituye las tres piezas que tocan la base por contadores.
 *
 * @param {{fila?: object}} opciones `fila` es lo que devolvera el `findOne` simulado.
 */
function instrumentar({ fila = TAREA() } = {}) {
  const reales = {
    findOne: IntervalTask.findOne,
    update: IntervalTask.update,
    transaction: IntervalTask.sequelize.transaction,
  };
  const cuenta = { findOne: 0, update: 0, transaccion: 0, escribio: [] };

  IntervalTask.findOne = async (opciones) => {
    cuenta.findOne++;
    cuenta.findOneEnTransaccion = Boolean(opciones?.transaction);
    cuenta.lockPedido = opciones?.lock ?? null;
    return { ...fila, toJSON: () => ({ ...fila }) };
  };

  IntervalTask.update = async (datos, opciones) => {
    cuenta.update++;
    cuenta.updateEnTransaccion = Boolean(opciones?.transaction);
    cuenta.escribio.push(datos);
    return [1, fila.idtask];
  };

  // Transaccion falsa: se ejecuta el cuerpo y se anota que hubo transaccion. Lo que
  // importa del contrato es cuantas sentencias salen y de donde, no la semantica de
  // BEGIN/COMMIT, que es de Sequelize.
  IntervalTask.sequelize.transaction = async (cuerpo) => {
    cuenta.transaccion++;
    return cuerpo({ LOCK: { UPDATE: "UPDATE" }, id: "t-falsa" });
  };

  return {
    cuenta,
    restaurar: () => {
      IntervalTask.findOne = reales.findOne;
      IntervalTask.update = reales.update;
      IntervalTask.sequelize.transaction = reales.transaction;
    },
  };
}

async function runTests() {
  console.log("--- Starting Interval Task Transition Tests ---");

  // 1. Con la fila: un UPDATE, nada mas
  console.log("[STEP 1/5] A known row costs one UPDATE and no read...");
  {
    const { cuenta, restaurar } = instrumentar();
    try {
      const r = await updateIntervalTaskStatus(7, TASK_STATUS.RUNNING, undefined, undefined, TAREA());

      assert.strictEqual(r.success, true, `debe actualizar: ${JSON.stringify(r)}`);
      assert.strictEqual(cuenta.findOne, 0, "no debe releer una fila que ya tiene");
      assert.strictEqual(cuenta.transaccion, 0, "un UPDATE con sus valores ya es atomico");
      assert.strictEqual(cuenta.update, 1, "exactamente una escritura");
      assert.strictEqual(cuenta.updateEnTransaccion, false);
      assert.strictEqual(cuenta.escribio[0].status, TASK_STATUS.RUNNING);
      assert.ok(
        cuenta.escribio[0].next_run > TAREA().next_run,
        "el arranque ancla la siguiente corrida al horario previsto, mas adelante que el vencido",
      );
      // El worker usa esto para el evento en vivo: tiene que ser lo que se escribio.
      assert.deepStrictEqual(r.runtime, cuenta.escribio[0]);
    } finally {
      restaurar();
    }
  }

  // 2. Sin la fila: lectura y escritura en la misma transaccion, con bloqueo
  console.log("[STEP 2/5] Without the row, read and write share a transaction...");
  {
    const { cuenta, restaurar } = instrumentar();
    try {
      const r = await updateIntervalTaskStatus(7, TASK_STATUS.ERROR, { error: "boom" }, 120);

      assert.strictEqual(r.success, true, `debe actualizar: ${JSON.stringify(r)}`);
      assert.strictEqual(cuenta.transaccion, 1, "leer y escribir van en la misma transaccion");
      assert.strictEqual(cuenta.findOne, 1, "una sola lectura");
      assert.strictEqual(cuenta.findOneEnTransaccion, true, "la lectura va dentro de la transaccion");
      assert.strictEqual(
        cuenta.lockPedido,
        "UPDATE",
        "se pide el bloqueo de fila; el motor lo acepta o lo ignora, pero se pide",
      );
      assert.strictEqual(cuenta.update, 1, "una escritura");
      assert.strictEqual(cuenta.updateEnTransaccion, true, "la escritura va dentro de la misma transaccion");
      assert.strictEqual(cuenta.escribio[0].failed_attempts, 4, "un fallo mas sobre los 3 que tenia");
    } finally {
      restaurar();
    }
  }

  // 3. Un estado inexistente no escribe
  console.log("[STEP 3/5] An unknown status writes nothing...");
  {
    const { cuenta, restaurar } = instrumentar();
    try {
      const r = await updateIntervalTaskStatus(7, 99, undefined, undefined, TAREA());

      assert.strictEqual(r.success, true, "un estado desconocido no es un error de la base");
      assert.strictEqual(cuenta.update, 0, "no hay nada que escribir: antes era un UPDATE vacio");
      assert.deepStrictEqual(r.runtime, {}, "y no se inventa un runtime con datos");
    } finally {
      restaurar();
    }
  }

  // 4. DONE deja los fallos a cero y adelanta la corrida si ya vencio
  console.log("[STEP 4/5] DONE clears the failures and moves on a past schedule...");
  {
    const { cuenta, restaurar } = instrumentar();
    try {
      const r = await updateIntervalTaskStatus(7, TASK_STATUS.DONE, { ok: true }, 42, TAREA());

      assert.strictEqual(r.success, true);
      assert.strictEqual(cuenta.findOne, 0, "con la fila a mano tampoco relee");
      assert.strictEqual(cuenta.escribio[0].failed_attempts, 0, "tras un DONE no quedan fallos pendientes");
      assert.strictEqual(cuenta.escribio[0].last_exec_time, 42);
      assert.ok(
        cuenta.escribio[0].next_run > new Date("2020-01-01T00:00:00.000Z"),
        "el next_run vencido durante la ejecucion se avanza al siguiente hueco",
      );
    } finally {
      restaurar();
    }
  }

  // 5. El drenaje solo cuando el ciclo avanzo
  console.log("[STEP 5/5] The batch drains only when the cycle made progress...");
  {
    const base = { limite: 200, lanzadas: 0, reprogramadas: 0 };

    assert.strictEqual(debeDrenarLote({ ...base, llevo: 200, lanzadas: 1 }), true, "lote lleno y algo lanzado");
    assert.strictEqual(
      debeDrenarLote({ ...base, llevo: 200, lanzadas: 0, reprogramadas: 1 }),
      true,
      "una reprogramacion correcta tambien saca la tarea del conjunto",
    );
    assert.strictEqual(
      debeDrenarLote({ ...base, llevo: 200 }),
      false,
      "lote lleno pero nada avanzo: pedir lo mismo otra vez no termina nunca",
    );
    assert.strictEqual(
      debeDrenarLote({ ...base, llevo: 200, lanzadas: 1, limite: 0 }),
      false,
      "un lote de 0 no es un lote: sin limite no hay nada que drenar",
    );
    assert.strictEqual(
      debeDrenarLote({ ...base, llevo: 12, lanzadas: 12 }),
      false,
      "lote a medias: no hay motivo para saltarse el descanso",
    );
    assert.strictEqual(debeDrenarLote(), false, "sin estado no se drena: el worker duerme");
  }

  console.log("--- All Interval Task Transition Tests Passed Successfully! ---");
}

runTests()
  .then(closeDb)
  .catch(async (err) => {
    console.error("\nInterval task transition test suite failed with error:");
    console.error(err);
    await closeDb();
    process.exit(1);
  });
