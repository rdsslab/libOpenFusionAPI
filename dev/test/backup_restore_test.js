import "dotenv/config";
import assert from "node:assert";
import { v4 as uuidv4 } from "uuid";
import { getAppBackupById, restoreAppFromBackup, getAllAppsBackup, restoreAllAppsFromBackup } from "../../src/lib/db/app.js";
import {
  Endpoint,
  IntervalTask,
  AppVars,
  ApiClient,
  ApiKey,
  Bot,
} from "../../src/lib/db/models.js";
import { BOT_RUNTIME_ATTRIBUTES } from "../../src/lib/db/bot.js";

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const TEST_APP_ID = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";

async function runTests() {
  console.log("--- Starting Backup/Restore Tests ---");

  // Setup: ensure the app has an external user (ApiClient) with an ApiKey so the
  // clients/keys section of the backup has something to exercise.
  console.log("[SETUP] Ensure app has an external user with an api key...");
  const PROBE_KEY_DESC = "backup restore test key";
  let probeClient = await ApiClient.findOne({ where: { username: "apiuser" } });
  let createdProbeClient = false;
  if (!probeClient) {
    probeClient = await ApiClient.create({
      username: "backup_restore_test_user",
      password: "not-a-real-hash",
      email: "backup_restore_test_user@example.com",
      status: "active",
    });
    createdProbeClient = true;
  }
  const probeKey = await ApiKey.create({
    idapp: TEST_APP_ID,
    idclient: probeClient.idclient,
    token: `tok_backup_restore_test_${Date.now()}`,
    description: PROBE_KEY_DESC,
    enabled: true,
  });
  console.log(
    `-> Using client ${probeClient.username} with api key ${probeKey.idkey}.`
  );

  // 1. Backup includes interval tasks at the same level as endpoints
  console.log("[STEP 1/5] Backup includes interval tasks at root level...");
  const backup = await getAppBackupById(TEST_APP_ID);
  assert.ok(backup, "Backup should return app data");
  assert.ok(Array.isArray(backup.endpoints), "Backup should include endpoints array");
  assert.ok(Array.isArray(backup.vrs), "Backup should include app vars array");
  assert.ok(Array.isArray(backup.bots), "Backup should include bots array");
  assert.ok(Array.isArray(backup.tasks), "Backup should include root tasks array");

  const chatEndpoint = backup.endpoints.find(
    (e) => e.resource === "/chat" && e.environment === "dev"
  );
  assert.ok(chatEndpoint, "Demo /chat dev endpoint should exist");
  assert.ok(
    !("tasks" in chatEndpoint),
    "Backup endpoints should NOT carry a nested tasks property"
  );

  // Every task in the backup must reference an endpoint present in the backup
  const backupEndpointIds = new Set(backup.endpoints.map((e) => e.idendpoint));
  for (const t of backup.tasks) {
    assert.ok(
      backupEndpointIds.has(t.idendpoint),
      `Root task ${t.idtask} should reference an endpoint included in the backup`
    );
  }

  const chatTasks = backup.tasks.filter(
    (t) => t.idendpoint === chatEndpoint.idendpoint
  );
  console.log(
    `-> Backup includes ${backup.tasks.length} root task(s), ${chatTasks.length} for /chat dev.`
  );

  // External users and their api keys, also at root level
  assert.ok(Array.isArray(backup.clients), "Backup should include root clients array");
  assert.ok(Array.isArray(backup.keys), "Backup should include root keys array");

  const backupClientIds = new Set(backup.clients.map((c) => c.idclient));
  for (const k of backup.keys) {
    assert.strictEqual(
      k.idapp,
      TEST_APP_ID,
      `Root key ${k.idkey} should belong to the app being backed up`
    );
    assert.ok(
      backupClientIds.has(k.idclient),
      `Root key ${k.idkey} should reference a client included in the backup`
    );
    assert.ok(
      !("client" in k),
      "Backup keys should NOT carry a nested client property"
    );
  }

  const backupKey = backup.keys.find((k) => String(k.idkey) === String(probeKey.idkey));
  assert.ok(backupKey, "The seeded api key should be present in the backup");
  assert.strictEqual(backupKey.token, probeKey.token, "Key token should be exported");

  const backupClient = backup.clients.find(
    (c) => c.idclient === probeClient.idclient
  );
  assert.ok(backupClient, "The key owner should be present in the backup clients");
  assert.ok(backupClient.password, "Client password hash should be exported");
  console.log(
    `-> Backup includes ${backup.clients.length} client(s) and ${backup.keys.length} api key(s).`
  );

  // 2. Create extra records NOT in backup to verify they are preserved
  console.log("[STEP 2/5] Create extra records not present in backup...");

  // Capture original task ids for the chat endpoint so we can clean up new ones later
  const originalChatTaskIds = new Set(chatTasks.map((t) => t.idtask));

  const extraEndpointId = uuidv4();
  const extraEndpoint = await Endpoint.create({
    idendpoint: extraEndpointId,
    idapp: TEST_APP_ID,
    environment: "dev",
    resource: "/extra-endpoint-not-in-backup",
    method: "GET",
    handler: "TEXT",
    enabled: true,
    code: "extra",
  });

  const extraTask = await IntervalTask.create({
    idendpoint: chatEndpoint.idendpoint,
    enabled: true,
    interval: 999,
    note: "extra task not in backup",
  });

  const extraAppVar = await AppVars.create({
    idapp: TEST_APP_ID,
    name: "$_VAR_EXTRA_NOT_IN_BACKUP",
    environment: "dev",
    value: "extra value",
    type: "string",
  });

  console.log("-> Created extra endpoint, task and appvar.");

  // 3. Modify a copy of the backup data
  console.log("[STEP 3/5] Modify backup data...");
  const modifiedBackup = deepClone(backup);

  const modifiedEndpoint = modifiedBackup.endpoints.find(
    (e) => e.resource === "/chat" && e.environment === "dev"
  );
  assert.ok(modifiedEndpoint, "Modified endpoint should exist");
  modifiedEndpoint.title = "MODIFIED BY BACKUP RESTORE TEST";
  modifiedBackup.tasks = modifiedBackup.tasks || [];
  modifiedBackup.tasks.push({
    idendpoint: modifiedEndpoint.idendpoint,
    enabled: true,
    interval: 600,
    note: "new task from backup",
  });

  const modifiedAppVar = modifiedBackup.vrs[0];
  assert.ok(modifiedAppVar, "At least one app var should exist");
  modifiedAppVar.value = "MODIFIED VALUE FROM BACKUP RESTORE TEST";

  const modifiedKey = modifiedBackup.keys.find(
    (k) => String(k.idkey) === String(probeKey.idkey)
  );
  assert.ok(modifiedKey, "Seeded key should exist in the cloned backup");
  modifiedKey.description = "MODIFIED KEY FROM BACKUP RESTORE TEST";

  // 4. Restore from modified backup
  console.log("[STEP 4/5] Restore from modified backup...");
  const restoreResult = await restoreAppFromBackup(modifiedBackup);
  assert.ok(restoreResult, "Restore should return result");
  assert.ok(
    Array.isArray(restoreResult.endpoints),
    "Restore result should include endpoints"
  );
  console.log(`-> Restore completed. Endpoints restored: ${restoreResult.endpoints.length}`);

  // 5. Verify restore behavior
  console.log("[STEP 5/5] Verify restore behavior...");

  // 5.1 Extra records not in backup should be preserved
  const extraEndpointAfter = await Endpoint.findByPk(extraEndpointId);
  assert.ok(extraEndpointAfter, "Extra endpoint not in backup should still exist");

  const extraTaskAfter = await IntervalTask.findByPk(extraTask.idtask);
  assert.ok(extraTaskAfter, "Extra task not in backup should still exist");

  const extraAppVarAfter = await AppVars.findByPk(extraAppVar.idvar);
  assert.ok(extraAppVarAfter, "Extra app var not in backup should still exist");

  // 5.2 Existing records in backup should be replaced
  const afterBackup = await getAppBackupById(TEST_APP_ID);
  const chatAfter = afterBackup.endpoints.find(
    (e) => e.resource === "/chat" && e.environment === "dev"
  );
  assert.ok(chatAfter, "/chat dev endpoint should exist after restore");
  assert.strictEqual(
    chatAfter.title,
    "MODIFIED BY BACKUP RESTORE TEST",
    "Existing endpoint should be replaced by backup data"
  );

  const modifiedAppVarAfter = afterBackup.vrs.find(
    (v) => v.name === modifiedAppVar.name && v.environment === modifiedAppVar.environment
  );
  assert.ok(modifiedAppVarAfter, "Modified app var should exist after restore");
  assert.strictEqual(
    modifiedAppVarAfter.value,
    "MODIFIED VALUE FROM BACKUP RESTORE TEST",
    "Existing app var should be replaced by backup data"
  );

  // 5.3 Interval tasks from backup should be present
  assert.ok(
    Array.isArray(afterBackup.tasks),
    "Restored backup should include root tasks array"
  );
  const hasNewTask = afterBackup.tasks.some(
    (t) =>
      t.idendpoint === chatAfter.idendpoint &&
      t.note === "new task from backup" &&
      t.interval === 600
  );
  assert.ok(hasNewTask, "New task from backup should be present after restore");

  // The pre-existing task created in step 2 must also be exported at root level
  const hasExtraTaskAtRoot = afterBackup.tasks.some(
    (t) =>
      String(t.idtask) === String(extraTask.idtask) &&
      t.idendpoint === chatAfter.idendpoint
  );
  assert.ok(
    hasExtraTaskAtRoot,
    "Pre-existing task should be exported in the root tasks array"
  );

  // 5.4 Api keys from backup should be applied, without duplicating rows
  const keyAfter = afterBackup.keys.find(
    (k) => String(k.idkey) === String(probeKey.idkey)
  );
  assert.ok(keyAfter, "Seeded api key should still exist after restore");
  assert.strictEqual(
    keyAfter.description,
    "MODIFIED KEY FROM BACKUP RESTORE TEST",
    "Existing api key should be replaced by backup data"
  );
  assert.strictEqual(
    keyAfter.idclient,
    probeClient.idclient,
    "Restored api key should keep pointing at its client"
  );

  const sameTokenCount = await ApiKey.count({
    where: { idapp: TEST_APP_ID, token: probeKey.token },
  });
  assert.strictEqual(
    sameTokenCount,
    1,
    "Restoring should not duplicate an api key with the same token"
  );

  const clientAfter = afterBackup.clients.find(
    (c) => c.idclient === probeClient.idclient
  );
  assert.ok(clientAfter, "Key owner should still be present after restore");

  // 6. Scheduler telemetry must not travel back into the database.
  // `status: 1` (running) restored as-is dejaba la tarea colgada hasta que la liberara el
  // reaper, y un failed_attempts cercano al tope la deshabilitaba al primer fallo.
  console.log("[STEP 6/8] Interval task runtime telemetry is not restored...");
  const dirtyBackup = deepClone(afterBackup);
  const dirtyTask = dirtyBackup.tasks.find(
    (t) => t.note === "new task from backup"
  );
  assert.ok(dirtyTask, "Task from step 3 should be present in the re-export");

  const restoredTaskId = dirtyTask.idtask;
  const taskBeforeDirty = await IntervalTask.findByPk(restoredTaskId);
  const statusBefore = taskBeforeDirty.status;
  const attemptsBefore = taskBeforeDirty.failed_attempts;

  dirtyTask.status = 1;
  dirtyTask.failed_attempts = 9;
  dirtyTask.last_exec_time = 123456;
  dirtyTask.last_response = { leaked: "runtime payload" };
  dirtyTask.note = "new task from backup";
  dirtyTask.interval = 601;

  await restoreAppFromBackup(dirtyBackup);

  const taskAfterDirty = await IntervalTask.findByPk(restoredTaskId);
  assert.ok(taskAfterDirty, "Task should still exist after restoring dirty telemetry");
  assert.notStrictEqual(
    taskAfterDirty.status,
    1,
    "Restore must not bring back the running status from the payload"
  );
  assert.strictEqual(
    taskAfterDirty.status,
    statusBefore,
    "The scheduler's observed status must survive a restore untouched"
  );
  assert.strictEqual(
    taskAfterDirty.failed_attempts,
    attemptsBefore,
    "The failure counter must survive a restore untouched"
  );
  assert.strictEqual(
    Number(taskAfterDirty.interval),
    601,
    "Configuration in the backup should still be applied"
  );

  // 7. A task is matched by (idendpoint, note), not by its autoincremental id, so a
  // backup taken on another instance cannot overwrite an unrelated task here.
  console.log("[STEP 7/8] Interval task identity is resolved by natural key...");
  const foreignBackup = deepClone(afterBackup);
  const foreignTask = foreignBackup.tasks.find(
    (t) => t.note === "new task from backup"
  );
  const FOREIGN_IDTASK = 987654321;
  foreignTask.idtask = FOREIGN_IDTASK;
  foreignTask.interval = 602;

  await restoreAppFromBackup(foreignBackup);

  const foreignRow = await IntervalTask.findByPk(FOREIGN_IDTASK);
  assert.strictEqual(
    foreignRow,
    null,
    "Restore must not create a row with the idtask coming from the backup"
  );
  const matchedRow = await IntervalTask.findByPk(restoredTaskId);
  assert.strictEqual(
    Number(matchedRow.interval),
    602,
    "The task with the same (idendpoint, note) should have been updated instead"
  );

  // 8. Bots round-trip: configuration survives, observed runtime state does not.
  console.log("[STEP 8/8] Bot round-trip through backup and restore...");
  const BOT_NAME = `backup_restore_test_bot_${Date.now()}`;
  const probeBot = await Bot.create({
    idapp: TEST_APP_ID,
    name: BOT_NAME,
    description: "original description",
    provider: "telegram",
    environment: "dev",
    token: "tok_bot_backup_restore_test",
    code: "// original bot code",
    enabled: false,
    runtime_status: "QUARANTINED",
    failure_count: 7,
    disabled_reason: "should not travel back",
  });

  const botBackup = await getAppBackupById(TEST_APP_ID);
  const exportedBot = botBackup.bots.find((b) => b.name === BOT_NAME);
  assert.ok(exportedBot, "Bot should be included in the app backup");
  assert.strictEqual(
    exportedBot.token,
    "tok_bot_backup_restore_test",
    "Bot token should travel in the backup"
  );
  assert.strictEqual(
    exportedBot.code,
    "// original bot code",
    "Bot code should travel in the backup"
  );

  const botRestorePayload = deepClone(botBackup);
  const botToRestore = botRestorePayload.bots.find((b) => b.name === BOT_NAME);
  botToRestore.description = "MODIFIED BY BACKUP RESTORE TEST";
  botToRestore.code = "// restored bot code";
  // Un backup de otra instancia trae otro idbot para el mismo bot lógico: sin la clave
  // natural (idapp + environment + name) se creaba una segunda fila y el lifecycle podía
  // arrancar las dos contra el mismo token del provider.
  botToRestore.idbot = uuidv4();
  botToRestore.runtime_status = "RUNNING";
  botToRestore.failure_count = 99;

  await restoreAppFromBackup(botRestorePayload);

  const botsWithName = await Bot.findAll({
    where: { idapp: TEST_APP_ID, environment: "dev", name: BOT_NAME },
  });
  assert.strictEqual(
    botsWithName.length,
    1,
    "Restoring a bot under a new idbot must not duplicate the row"
  );

  const botAfter = botsWithName[0];
  assert.strictEqual(
    botAfter.idbot,
    probeBot.idbot,
    "The existing bot should have been matched by (idapp, environment, name)"
  );
  assert.strictEqual(
    botAfter.description,
    "MODIFIED BY BACKUP RESTORE TEST",
    "Bot configuration should be replaced by backup data"
  );
  assert.strictEqual(
    botAfter.code,
    "// restored bot code",
    "Bot code should be replaced by backup data"
  );
  assert.strictEqual(
    botAfter.failure_count,
    7,
    "Restore must not overwrite the observed runtime state"
  );
  assert.strictEqual(
    botAfter.runtime_status,
    "QUARANTINED",
    "Restore must not overwrite the observed runtime status"
  );
  assert.ok(
    BOT_RUNTIME_ATTRIBUTES.includes("runtime_status"),
    "runtime_status should be declared as a runtime attribute"
  );

  await Bot.destroy({ where: { idbot: probeBot.idbot } });

  // 9. Full server backup: todas las apps en una sola llamada, cada una con el
  // mismo formato que getAppBackupById.
  console.log("[STEP 9] Full server backup includes every app...");
  const full = await getAllAppsBackup();
  assert.strictEqual(full.kind, "ofapi_full_backup", "Full backup should declare its kind");
  assert.ok(Array.isArray(full.apps), "Full backup should include the apps array");
  assert.strictEqual(full.count, full.apps.length, "count should match apps length");
  assert.ok(
    full.apps.some((a) => a.idapp === TEST_APP_ID),
    "Full backup should include the test app"
  );
  assert.ok(
    full.apps.some((a) => a.idapp === "cfcd2084-95d5-65ef-66e7-dff9f98764da"),
    "Full backup should include the system app"
  );
  const fullTestAppEntry = full.apps.find((a) => a.idapp === TEST_APP_ID);
  assert.ok(Array.isArray(fullTestAppEntry.endpoints), "Each entry should carry endpoints");
  assert.ok(Array.isArray(fullTestAppEntry.tasks), "Each entry should carry root tasks");
  assert.ok(Array.isArray(fullTestAppEntry.clients), "Each entry should carry clients");
  assert.ok(Array.isArray(fullTestAppEntry.keys), "Each entry should carry keys");
  console.log(`-> Full backup includes ${full.count} app(s).`);

  // 10. Restore completo desde el backup del servidor: resumen sin fallos y
  // datos intactos tras el round trip.
  console.log("[STEP 10] Full restore from server backup...");
  const summary = await restoreAllAppsFromBackup(full);
  assert.strictEqual(summary.count, full.apps.length, "Summary should cover every app");
  assert.strictEqual(summary.failed, 0, "No app should fail to restore");
  assert.strictEqual(summary.restored, full.apps.length, "Every app should be restored");

  const afterFullRestore = await getAppBackupById(TEST_APP_ID);
  assert.strictEqual(
    afterFullRestore.endpoints.find((e) => e.resource === "/chat" && e.environment === "dev")
      ?.title,
    fullTestAppEntry.endpoints.find(
      (e) => e.resource === "/chat" && e.environment === "dev"
    )?.title,
    "Round trip through full backup/restore should keep endpoint data"
  );
  assert.ok(
    afterFullRestore.keys.some((k) => String(k.idkey) === String(probeKey.idkey)),
    "Api keys should survive the full round trip"
  );

  // El mismo restore acepta también el array plano de backups por app.
  const summaryFromArray = await restoreAllAppsFromBackup(full.apps);
  assert.strictEqual(summaryFromArray.failed, 0, "Plain array payload should be accepted");

  // Payload inválido debe rechazarse sin restaurar nada.
  await assert.rejects(
    () => restoreAllAppsFromBackup({ not_apps: [] }),
    /Invalid full backup payload/
  );
  console.log("-> Full restore completed without failures.");

  // Cleanup: restore original values from the unmodified backup
  console.log("[CLEANUP] Restoring original values...");
  await restoreAppFromBackup(backup);

  // Remove extra records created for the test
  await Endpoint.destroy({ where: { idendpoint: extraEndpointId } });
  await IntervalTask.destroy({ where: { idtask: extraTask.idtask } });
  await AppVars.destroy({ where: { idvar: extraAppVar.idvar } });

  // Remove any new interval tasks that were added during the restore test
  const chatTasksAfter = await IntervalTask.findAll({
    where: { idendpoint: chatEndpoint.idendpoint },
  });
  const newTaskIds = chatTasksAfter
    .filter((t) => !originalChatTaskIds.has(t.idtask))
    .map((t) => t.idtask);
  if (newTaskIds.length > 0) {
    await IntervalTask.destroy({ where: { idtask: newTaskIds } });
  }

  // Remove the seeded api key (and its client, only if the test created it)
  await ApiKey.destroy({ where: { token: probeKey.token } });
  if (createdProbeClient) {
    await ApiClient.destroy({ where: { idclient: probeClient.idclient } });
  }

  console.log("--- All Backup/Restore Tests Passed Successfully! ---");
}

runTests().catch((err) => {
  console.error("\nBackup/Restore test suite failed with error:");
  console.error(err);
  process.exit(1);
});
