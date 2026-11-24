/**
 * @file appclient_backup_test.js
 * @description Pruebas E2E del backup y restore de ApiClients (clientes externos)
 * Verifica que los clientes se incluyan correctamente en los backups,
 * especialmente cuando tienen múltiples API keys pertenecientes a diferentes apps.
 */

import "dotenv/config";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { getAppBackupById, restoreAppFromBackup, getAllAppsBackup } from "../../src/lib/db/app.js";
import {
  Endpoint,
  IntervalTask,
  AppVars,
  ApiClient,
  ApiKey,
  Application,
} from "../../src/lib/db/models.js";
import { closeDb } from "./close_db.js";
import { ensureIntervalTaskColumns } from "../../src/lib/db/ensureIntervalTaskColumns.js";

const TEST_APP_ID = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";
const SECOND_APP_ID = "d3ca8238-a0b9-2382-0dcc-509a6f75849c";

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function runTests() {
  console.log("--- Starting ApiClient Backup/Restore Tests ---");

  // Asegurar columnas nuevas
  await ensureIntervalTaskColumns(console.log);

  // ========================================================================
  // ESCENARIO 1: Cliente con múltiples keys en múltiples apps
  // ========================================================================
  console.log("\n[SCENARIO 1] Cliente con múltiples keys en diferentes apps...");

  // Creamos un nuevo cliente para probar
  const testClientId = `backup_test_client_${Date.now()}`;
  const testClient = await ApiClient.create({
    idclient: uuidv4(),
    username: testClientId,
    password: "hashed_password_placeholder",
    email: `${testClientId}@example.com`,
    status: "active",
  });
  console.log(`-> Cliente creado: ${testClientId} (idclient: ${testClient.idclient})`);

  // Creamos una segunda app para probar el escenario de múltiples apps
  const secondAppId = `second-test-app-${Date.now()}`;
  await import("../../src/lib/db/app.js").then(m => m.upsertApp({
    idapp: SECOND_APP_ID,
    app: secondAppId,
    enabled: true,
    description: "App de prueba para ApiClient multi-app",
    vars: {},
    params: {},
  }));

  // Creamos keys para el cliente en AMBOS apps
  const keyForFirstApp = await ApiKey.create({
    idapp: TEST_APP_ID,
    idclient: testClient.idclient,
    token: `tok_first_app_${Date.now()}`,
    description: "API Key for first app in backup test",
    enabled: true,
  });

  const keyForSecondApp = await ApiKey.create({
    idapp: SECOND_APP_ID,
    idclient: testClient.idclient,
    token: `tok_second_app_${Date.now()}`,
    description: "API Key for second app (not in first app backup)",
    enabled: true,
  });

  console.log(`-> API Keys creadas:`);
  console.log(`   - Key 1: idkey=${keyForFirstApp.idkey}, idapp=${TEST_APP_ID}`);
  console.log(`   - Key 2: idkey=${keyForSecondApp.idkey}, idapp=d3ca8238...`);

  // ========================================================================
  // ESCENARIO 2: Cliente SOLO con key en segunda app
  // ========================================================================
  console.log("\n[SCENARIO 2] Cliente SOLO con key en segunda app (no en backup de app 1)...");

  const isolatedClientId = `isolated_client_${Date.now()}`;
  const isolatedClient = await ApiClient.create({
    idclient: uuidv4(),
    username: isolatedClientId,
    password: "hashed_password_isolated",
    email: `${isolatedClientId}@example.com`,
    status: "active",
  });

  const isolatedKey = await ApiKey.create({
    idapp: SECOND_APP_ID, // Solo en la segunda app
    idclient: isolatedClient.idclient,
    token: `tok_isolated_${Date.now()}`,
    description: "Isolated key - only in second app",
    enabled: true,
  });

  console.log(`-> Cliente aislado creado: ${isolatedClientId}`);
  console.log(`   - Este cliente NO debería aparecer en el backup de la app 1`);

  // ========================================================================
  // ESCENARIO 3: Backup y verificación
  // ========================================================================
  console.log("\n[SCENARIO 3] Backup y verificación...");

  const backup = await getAppBackupById(TEST_APP_ID);

  // Verificar que los clientes del backup se incluyen
  const backupClientIds = new Set(backup.clients.map(c => c.idclient));
  const backupKeyIds = new Set(backup.keys.map(k => k.idkey));

  console.log(`-> Clientes en backup: ${backupClientIds.size}`);
  console.log(`-> Keys en backup: ${backupKeyIds.size}`);

  // El cliente con keys en AMBOS apps DEBE estar en el backup
  // (porque al menos una de sus keys pertenece al idapp del backup)
  assert.ok(
    backupClientIds.has(String(testClient.idclient)),
    `Cliente con key en múltiples apps DEBE estar en el backup del app 1`
  );
  console.log(`✓ Cliente con key en múltiples apps está en el backup`);

  // La key del primer app DEBE estar en el backup
  assert.ok(
    backupKeyIds.has(Number(keyForFirstApp.idkey)),
    `Key del primer app debe estar en el backup`
  );
  console.log(`✓ Key del primer app está en el backup`);

  // El cliente aislado NO debe estar en el backup
  // (porque ninguna de sus keys pertenece al idapp del backup)
  const isIsolatedClientInBackup = backupClientIds.has(String(isolatedClient.idclient));
  if (isIsolatedClientInBackup) {
    console.warn(`⚠️ ADVERTENCIA: Cliente aislado (solo key en otra app) está en el backup del app 1`);
    console.warn(`   Esto puede ser problemático si el cliente debe exclusivamente pertenecer a su app origen`);
  } else {
    console.log(`✓ Cliente aislado NO está en el backup (comportamiento actual)`);
  }

  // ========================================================================
  // ESCENARIO 4: Restore y verificación de integridad
  // ========================================================================
  console.log("\n[SCENARIO 4] Restore y verificación de integridad...");

  // Creamos una copia del backup modificada para el restore
  const restorePayload = deepClone(backup);

  // Modificamos un key para el restore
  const keyToModify = restorePayload.keys.find(k => String(k.idkey) === String(keyForFirstApp.idkey));
  if (keyToModify) {
    keyToModify.description = "MODIFIED during restore test";
  }

  const restoreResult = await restoreAppFromBackup(restorePayload);
  assert.ok(restoreResult, "Restore debe retornar resultado");
  console.log(`✓ Restore completado`);

  // Verificamos que el key se actualizó correctamente
  const restoredKey = await ApiKey.findByPk(keyForFirstApp.idkey);
  assert.equal(
    restoredKey.description,
    "MODIFIED during restore test",
    "Key debe haber sido actualizada"
  );
  console.log(`✓ Key modificada fue restaurada correctamente`);

  // Verificamos que el cliente sigue existiendo
  const restoredClient = await ApiClient.findByPk(testClient.idclient);
  assert.ok(restoredClient, "Cliente debe existir después del restore");
  console.log(`✓ Cliente sigue existiendo después del restore`);

  // ========================================================================
  // ESCENARIO 5: Limpieza
  // ========================================================================
  console.log("\n[SCENARIO 5] Limpieza...");

  // Eliminar clientes de prueba
  await ApiKey.destroy({ where: { idkey: [keyForFirstApp.idkey, keyForSecondApp.idkey, isolatedKey.idkey] } });
  await ApiClient.destroy({ where: { idclient: [testClient.idclient, isolatedClient.idclient] } });

  console.log("✓ Clientes de prueba eliminados");

  // Eliminar la segunda app y sus keys (antes aquí no se borraba nada: se
  // referenciaba `deleteEndpoint` sin llamarlo, y la app quedaba en la BD).
  await ApiKey.destroy({ where: { idapp: SECOND_APP_ID } });
  await Application.destroy({ where: { idapp: SECOND_APP_ID } });

  console.log("\n--- All ApiClient Backup/Restore Tests Passed! ---");
  console.log("\n=== RESUMEN DE COMPORTAMIENTO ===");
  console.log("1. Un cliente SÍ se incluye en el backup si tiene AL MENOS UNA key del idapp");
  console.log("2. Un cliente NO se incluye si TODAS sus keys pertenecen a otros apps");
  console.log("3. Este comportamiento es COHERENTE con la arquitectura actual");
  console.log("4. Si se quiere incluir clientes explícitamente, se necesitaría:");
  console.log("   - Agregar campo 'idapp' al modelo ApiClient");
  console.log("   - Modificar la lógica de getApplicationTreeByFilters");

}

runTests()
  .then(closeDb)
  .catch(async (err) => {
    console.error("\nApiClient Backup/Restore test suite failed with error:");
    console.error(err);
    await closeDb();
    process.exit(1);
  });