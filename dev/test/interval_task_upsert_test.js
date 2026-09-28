/**
 * Contrato del upsert de interval tasks.
 *
 * `IntervalTask.upsert(data)` construye la fila con `Model.build()`, así que un payload
 * parcial reescribía con los defaults del modelo todo lo que no viniera: actualizar una
 * tarea enviando sólo `{idtask, note}` devolvía `interval` a 300 y apagaba la tarea. Estas
 * pruebas fijan el comportamiento contrario.
 */

import "dotenv/config";
import assert from "node:assert";
import { v4 as uuidv4 } from "uuid";
import {
  upsertIntervalTask,
  deleteIntervalTask,
  getIntervalTaskById,
  INTERVAL_TASK_RUNTIME_ATTRIBUTES,
  updateIntervalTaskStatus,
} from "../../src/lib/db/interval_task.js";
import { Endpoint, IntervalTask } from "../../src/lib/db/models.js";
import { defaultApps } from "../../src/lib/db/app.js";
import { TASK_STATUS } from "../../src/lib/timer/schedule.js";
import { closeDb } from "./close_db.js";

const TEST_APP_ID = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";

/** Identidad de cada interval task: `idtask` (UUID). `note` es etiqueta, se incluye para leerla. */
const taskIdentities = async () => {
  const rows = await IntervalTask.findAll({
    attributes: ["idtask", "idendpoint", "note"],
    order: [["idtask", "ASC"]],
    raw: true,
  });
  return rows.map((r) => ({ idtask: r.idtask, idendpoint: r.idendpoint, note: r.note }));
};

async function runTests() {
  console.log("--- Starting Interval Task Upsert Tests ---");

  const endpointId = uuidv4();
  await Endpoint.create({
    idendpoint: endpointId,
    idapp: TEST_APP_ID,
    environment: "dev",
    resource: `/interval-task-upsert-test-${Date.now()}`,
    method: "GET",
    handler: "TEXT",
    enabled: true,
    code: "ok",
  });

  let created_idtask = null;

  try {
    // 1. INSERT
    console.log("[STEP 1/9] Insert stores the payload and defaults to disabled...");
    const inserted = await upsertIntervalTask({
      idendpoint: endpointId,
      interval: 900,
      note: "upsert contract test",
      params: { data: { mode: "full" }, headers: { "x-test": "1" } },
      exec_time_limit: 120,
    });

    // `created` es null en sqlite: el dialecto no informa si la fila era nueva.
    assert.ok(inserted?.result?.idtask, "First upsert should return the new task");
    created_idtask = inserted.result.idtask;

    const afterInsert = await getIntervalTaskById(created_idtask);
    assert.strictEqual(Number(afterInsert.interval), 900, "interval should be stored");
    assert.strictEqual(
      afterInsert.enabled,
      false,
      "A new task must not run until it is explicitly enabled"
    );
    assert.strictEqual(Number(afterInsert.exec_time_limit), 120);

    // 2. UPDATE parcial
    console.log("[STEP 2/9] Partial update keeps the fields that were not sent...");
    await upsertIntervalTask({ idtask: created_idtask, enabled: true });

    const afterPartial = await getIntervalTaskById(created_idtask);
    assert.strictEqual(afterPartial.enabled, true, "enabled should be applied");
    assert.strictEqual(
      Number(afterPartial.interval),
      900,
      "interval must survive an update that did not mention it"
    );
    assert.strictEqual(
      Number(afterPartial.exec_time_limit),
      120,
      "exec_time_limit must survive an update that did not mention it"
    );
    assert.strictEqual(
      afterPartial.note,
      "upsert contract test",
      "note must survive an update that did not mention it"
    );

    const params = typeof afterPartial.params === "string"
      ? JSON.parse(afterPartial.params)
      : afterPartial.params;
    assert.strictEqual(
      params?.data?.mode,
      "full",
      "params must survive an update that did not mention it"
    );

    // 3. null explícito
    console.log("[STEP 3/9] An explicit null clears the field...");
    await upsertIntervalTask({ idtask: created_idtask, dateend: null, note: null });

    const afterNull = await getIntervalTaskById(created_idtask);
    assert.strictEqual(afterNull.dateend, null, "dateend should be cleared");
    assert.strictEqual(afterNull.note, null, "note should be cleared");

    // 4. La telemetría del scheduler no es configurable desde el upsert
    console.log("[STEP 4/9] Scheduler telemetry sent in the payload is ignored...");
    await IntervalTask.update(
      { failed_attempts: 4, status: 3 },
      { where: { idtask: created_idtask } }
    );
    await upsertIntervalTask({
      idtask: created_idtask,
      failed_attempts: 0,
      status: 0,
      last_response: { forced: true },
      note: "telemetry check",
    });

    const afterTelemetry = await getIntervalTaskById(created_idtask);
    assert.strictEqual(
      afterTelemetry.failed_attempts,
      4,
      "failed_attempts is owned by the scheduler and must not be writable here"
    );
    assert.strictEqual(
      afterTelemetry.status,
      3,
      "status is owned by the scheduler and must not be writable here"
    );
    assert.strictEqual(afterTelemetry.note, "telemetry check");
    assert.ok(
      INTERVAL_TASK_RUNTIME_ATTRIBUTES.includes("failed_attempts"),
      "failed_attempts should be declared as a runtime attribute"
    );

    // 5. Cambiar la programación recalcula la próxima ejecución
    console.log("[STEP 5/9] Changing the schedule recomputes next_run...");
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await IntervalTask.update(
      { next_run: farFuture },
      { where: { idtask: created_idtask } }
    );

    await upsertIntervalTask({ idtask: created_idtask, interval: 60 });

    const afterReschedule = await getIntervalTaskById(created_idtask);
    assert.ok(
      new Date(afterReschedule.next_run).getTime() < farFuture.getTime(),
      "next_run must be recomputed when the interval changes"
    );

    // 6. La transición devuelve los mismos campos que persiste para publicarlos en vivo
    console.log("[STEP 6/9] Runtime transition exposes the persisted live patch...");
    const runningTransition = await updateIntervalTaskStatus(
      created_idtask,
      TASK_STATUS.RUNNING
    );
    assert.strictEqual(runningTransition.success, true);
    assert.strictEqual(runningTransition.runtime.status, TASK_STATUS.RUNNING);
    assert.ok(runningTransition.runtime.last_run instanceof Date);
    assert.ok(runningTransition.runtime.next_run instanceof Date);

    // 7. La validación usa la fila fusionada, también en updates parciales
    console.log("[STEP 7/9] Partial cron updates validate the merged schedule...");
    await upsertIntervalTask({
      idtask: created_idtask,
      schedule_mode: "cron",
      cron: "0 7 * * 1-5",
      timezone: "America/Guayaquil",
    });
    await assert.rejects(
      () => upsertIntervalTask({ idtask: created_idtask, timezone: "Invalid/Zone" }),
      (error) => error?.code === "INVALID_TASK_SCHEDULE"
    );
    await assert.rejects(
      () => upsertIntervalTask({ idtask: created_idtask, cron: "not-a-cron" }),
      (error) => error?.code === "INVALID_TASK_SCHEDULE"
    );

    // 8. Un idtask inexistente no crea una fila con ese id
    console.log("[STEP 8/9] An unknown idtask is rejected instead of inserted...");
    const GHOST_IDTASK = 987654322;
    await assert.rejects(
      () => upsertIntervalTask({ idtask: GHOST_IDTASK, idendpoint: endpointId }),
      (error) => error?.code === "INTERVAL_TASK_NOT_FOUND",
      "Upserting an unknown idtask should throw INTERVAL_TASK_NOT_FOUND"
    );

    const ghost = await getIntervalTaskById(GHOST_IDTASK);
    assert.strictEqual(ghost, null, "No row should have been created with that id");

    // 9. Una segunda pasada de seed no debe pisar ni duplicar una tarea
    console.log("[STEP 9/9] A second seed pass does not clobber an existing task...");
    // defaultApps() corre en CADA arranque, no solo con BUILD_DB. El seed declara los
    // `idtask` del sistema con UUIDs fijos, así que cada pasada encuentra las mismas
    // tareas por su id y las actualiza en su sitio: no hay ids que reasignar y no hay
    // "tareas del mismo endpoint" que dependan de la nota para distinguirse. Antes
    // esto era el bug de la secuencia desalineada: el seeder descartaba los ids 2..6 y
    // la base asignaba 1..5, así que el idtask=3 del seed ("events scan") encontraba
    // la fila 3, que contenia el digest, y la pisaba — las tareas de "Admin Alerts"
    // comparten endpoint, y la única forma de distinguirlas era el texto de la nota.
    const before = await taskIdentities();
    assert.ok(before.length > 0, "the seed must have created interval tasks");

    await defaultApps();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const after = await taskIdentities();
    const notes = after.map((t) => t.note);
    const duplicated = [...new Set(notes.filter((n, i, a) => a.indexOf(n) !== i))];
    assert.deepStrictEqual(
      duplicated,
      [],
      `A second seed pass duplicated task(s): ${duplicated.join(", ")}`
    );
    assert.strictEqual(
      after.length,
      before.length,
      "A second seed pass must not add interval tasks"
    );

    // La identidad de una tarea es su `idtask` UUID: quien la conserva conserva su
    // idtask, y con el la vinculacion de su historial en ofapi_intervaltask_run.
    // (La nota queda como etiqueta: puede repetirse o faltar sin romper nada.)
    for (const t of before) {
      const same = after.find((o) => o.idtask === t.idtask);
      assert.ok(same, `task "${t.note}" disappeared after a second seed pass`);
    }

    // 10. Un alta NO puede pasar por `upsert()`.
    //
    // Sin `idtask` lo que se pide es una tarea nueva, y en MSSQL el `upsertQuery`
    // lanza "Primary Key or Unique key should be passed to upsert query" porque la
    // carga útil no trae ni la PK ni ninguna única. En PostgreSQL y SQLite pasaba
    // sin quejarse, de forma accidental: `upsertKeys` cae a la PK, el conflicto no
    // llega a producirse porque `idtask` lo asigna la secuencia y el resultado es
    // un INSERT. Por eso esto se comprueba con `upsert` saboteado y no con la
    // base de datos: si el alta volviera a pasar por `upsert`, esta prueba falla
    // en los tres motores, no solo en el que sufria el crash.
    console.log("[STEP 10/10] A new task is created without going through upsert...");
    const upsertReal = IntervalTask.upsert;
    const createReal = IntervalTask.create;
    let upsertTocado = false;

    IntervalTask.upsert = () => {
      upsertTocado = true;
      return Promise.reject(
        new Error("upsert() no debe usarse para un alta: MSSQL exige clave primaria o unica")
      );
    };

    let alta;
    try {
      alta = await upsertIntervalTask({
        idendpoint: endpointId,
        note: "sonda de alta sin idtask",
      });
    } finally {
      IntervalTask.upsert = upsertReal;
      IntervalTask.create = createReal;
    }

    assert.strictEqual(upsertTocado, false, "el alta sin idtask no debe llamar a upsert()");
    assert.strictEqual(alta.created, true, "un alta sin idtask debe informar created: true");
    assert.strictEqual(alta.previous, null, "un alta no tiene una version previa");
    assert.ok(alta.result?.idtask, "el alta debe traer el id que asigno la base");
    created_idtask = alta.result.idtask;

    console.log("--- All Interval Task Upsert Tests Passed Successfully! ---");
  } finally {
    if (created_idtask) await deleteIntervalTask(created_idtask);
    await IntervalTask.destroy({ where: { idendpoint: endpointId } });
    await Endpoint.destroy({ where: { idendpoint: endpointId } });
  }
}

runTests()
  .then(closeDb)
  .catch(async (err) => {
    console.error("\nInterval task upsert test suite failed with error:");
    console.error(err);
    await closeDb();
    process.exit(1);
  });
