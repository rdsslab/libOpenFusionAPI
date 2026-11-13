import "dotenv/config";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import {
  upsertIntervalTask,
  deleteIntervalTask,
  updateIntervalTaskStatus,
  runNowIntervalTask,
} from "../../src/lib/db/interval_task.js";
import { ensureIntervalTaskColumns } from "../../src/lib/db/ensureIntervalTaskColumns.js";
import { Endpoint, IntervalTask } from "../../src/lib/db/models.js";
import { TASK_STATUS } from "../../src/lib/timer/schedule.js";
import { closeDb } from "./close_db.js";

/**
 * H4: mutual exclusion between different interval tasks (`exclusive_group`).
 *
 * What is pinned here:
 *
 * 1. A task in a group whose lease is valid is rejected when it tries to go
 *    RUNNING (`updateIntervalTaskStatus`) and when it is forced with runNow.
 * 2. The rejection is machine-readable: `TASK_GROUP_LOCKED` (409 in runNow).
 * 3. Once the holder's lease expires, the group is free again with no cleanup.
 * 4. `allow_concurrent: true` opts out of the group check.
 */

const TEST_APP_ID = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";

async function createTask(endpointId, group, extra = {}) {
  const inserted = await upsertIntervalTask({
    idendpoint: endpointId,
    interval: 900,
    note: "exclusive group test",
    enabled: true,
    exclusive_group: group,
    ...extra,
  });
  return inserted.result.idtask;
}

async function runTests() {
  console.log("--- Starting Interval Task Exclusive Group Tests ---");
  await ensureIntervalTaskColumns(console.log);

  const endpointId = uuidv4();
  await Endpoint.create({
    idendpoint: endpointId,
    idapp: TEST_APP_ID,
    environment: "dev",
    resource: `/exclusive-group-test-${Date.now()}`,
    method: "GET",
    handler: "TEXT",
    enabled: true,
    code: "ok",
  });

  const group = `group-${uuidv4()}`;
  const created = [];

  try {
    const holderId = await createTask(endpointId, group);
    const blockedId = await createTask(endpointId, group);
    created.push(holderId, blockedId);

    // The holder is RUNNING with a valid lease.
    const future = new Date(Date.now() + 60_000);
    await IntervalTask.update(
      { status: TASK_STATUS.RUNNING, locked_until: future },
      { where: { idtask: holderId } },
    );

    // 1) updateIntervalTaskStatus must reject the second task.
    console.log("[1/5] updateIntervalTaskStatus rejects a busy group...");
    const transition = await updateIntervalTaskStatus(blockedId, TASK_STATUS.RUNNING);
    assert.equal(transition.success, false, "the group is busy");
    assert.equal(transition.code, "TASK_GROUP_LOCKED");
    assert.match(transition.message, /exclusive group/i);

    // 2) runNow must reject it too.
    console.log("[2/5] runNowIntervalTask rejects a busy group...");
    const forced = await runNowIntervalTask(blockedId);
    assert.equal(forced.success, false, "the group is busy");
    assert.equal(forced.code, 409);
    assert.equal(forced.reason, "TASK_GROUP_LOCKED");
    assert.match(forced.message, /exclusive group/i);

    // 3) Expiring the holder frees the group with no cleanup.
    console.log("[3/5] An expired lease frees the group...");
    await IntervalTask.update(
      { locked_until: new Date(Date.now() - 60_000) },
      { where: { idtask: holderId } },
    );
    const afterExpiry = await updateIntervalTaskStatus(blockedId, TASK_STATUS.RUNNING);
    assert.equal(afterExpiry.success, true, "the group is free after the lease expires");

    // 4) A concurrent task opts out of the group check.
    console.log("[4/5] allow_concurrent bypasses the group check...");
    const concurrentId = await createTask(endpointId, group, { allow_concurrent: true });
    created.push(concurrentId);
    await IntervalTask.update(
      { status: TASK_STATUS.RUNNING, locked_until: future },
      { where: { idtask: holderId } },
    );
    const concurrent = await updateIntervalTaskStatus(concurrentId, TASK_STATUS.RUNNING);
    assert.equal(concurrent.success, true, "allow_concurrent must not be blocked by the group");

    // 5) A task with no group is never blocked by another group.
    console.log("[5/5] Tasks without a group are unaffected...");
    const noGroupId = await createTask(endpointId, null);
    created.push(noGroupId);
    const noGroup = await updateIntervalTaskStatus(noGroupId, TASK_STATUS.RUNNING);
    assert.equal(noGroup.success, true, "no group means no group restriction");

    console.log("--- All Interval Task Exclusive Group Tests Passed Successfully! ---");
  } finally {
    for (const idtask of created) {
      try {
        await deleteIntervalTask(idtask);
      } catch (error) {
        // Best-effort cleanup.
      }
    }
    try {
      await Endpoint.destroy({ where: { idendpoint: endpointId } });
    } catch (error) {
      // Best-effort cleanup.
    }
  }
}

runTests()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
