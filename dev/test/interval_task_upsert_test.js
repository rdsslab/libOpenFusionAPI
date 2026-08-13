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
} from "../../src/lib/db/interval_task.js";
import { Endpoint, IntervalTask } from "../../src/lib/db/models.js";

const TEST_APP_ID = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";

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
    console.log("[STEP 1/6] Insert stores the payload and defaults to disabled...");
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
    console.log("[STEP 2/6] Partial update keeps the fields that were not sent...");
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
    console.log("[STEP 3/6] An explicit null clears the field...");
    await upsertIntervalTask({ idtask: created_idtask, dateend: null, note: null });

    const afterNull = await getIntervalTaskById(created_idtask);
    assert.strictEqual(afterNull.dateend, null, "dateend should be cleared");
    assert.strictEqual(afterNull.note, null, "note should be cleared");

    // 4. La telemetría del scheduler no es configurable desde el upsert
    console.log("[STEP 4/6] Scheduler telemetry sent in the payload is ignored...");
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
    console.log("[STEP 5/6] Changing the schedule recomputes next_run...");
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

    // 6. Un idtask inexistente no crea una fila con ese id
    console.log("[STEP 6/6] An unknown idtask is rejected instead of inserted...");
    const GHOST_IDTASK = 987654322;
    await assert.rejects(
      () => upsertIntervalTask({ idtask: GHOST_IDTASK, idendpoint: endpointId }),
      (error) => error?.code === "INTERVAL_TASK_NOT_FOUND",
      "Upserting an unknown idtask should throw INTERVAL_TASK_NOT_FOUND"
    );

    const ghost = await getIntervalTaskById(GHOST_IDTASK);
    assert.strictEqual(ghost, null, "No row should have been created with that id");

    console.log("--- All Interval Task Upsert Tests Passed Successfully! ---");
  } finally {
    if (created_idtask) await deleteIntervalTask(created_idtask);
    await IntervalTask.destroy({ where: { idendpoint: endpointId } });
    await Endpoint.destroy({ where: { idendpoint: endpointId } });
  }
}

runTests().catch((err) => {
  console.error("\nInterval task upsert test suite failed with error:");
  console.error(err);
  process.exit(1);
});
