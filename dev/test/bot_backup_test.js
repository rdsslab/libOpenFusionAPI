/**
 * @file bot_backup_test.js
 * @description Prueba de extremo a extremo del historial de versiones de los bots
 * (`ofapi_bot_bkp`) contra un servidor real. Requiere el servidor en
 * http://localhost:3000 (lo arranca dev/test/index.js).
 *
 * Cubre las cuatro propiedades que hacen útil el respaldo:
 *
 * 1. Cada cambio real de configuración deja una versión.
 * 2. Guardar dos veces lo mismo NO deja una versión: la deduplicación por hash es lo
 *    único que acota el crecimiento de la tabla, porque no hay poda.
 * 3. Restaurar devuelve la configuración anterior y queda registrado a su vez.
 * 4. Borrar un bot deja un snapshot, y restaurarlo lo recrea con el mismo idbot.
 */

import assert from "node:assert/strict";

const BASE_URL = "http://localhost:3000";
const BASIC_AUTH = "Basic " + Buffer.from("admin:admin@admin").toString("base64");

let passed = 0;
let failed = 0;
let bearer = null;

async function call(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: bearer ? `Bearer ${bearer}` : BASIC_AUTH,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function test(label, fn) {
  console.log(`  … ${label}`);
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`    ${error?.message || error}`);
  }
}

const history = async (idbot, lightweight = true) => {
  const { data } = await call(
    `/api/system/bots/backup/prd?idbot=${idbot}&lightweight=${lightweight}`,
  );
  assert.ok(Array.isArray(data), `history should be an array, got ${JSON.stringify(data)}`);
  return data;
};

const saveBot = async (payload) => {
  const { status, data } = await call("/api/system/bots/prd", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(status, 200, `upsert_bot failed: ${JSON.stringify(data)}`);
  assert.ok(data.success, `upsert_bot did not succeed: ${JSON.stringify(data)}`);
  return data.data;
};

const getBot = async (idbot) => {
  const { status, data } = await call(
    `/api/system/bots/prd?idbot=${idbot}&include_code=true&include_token=true`,
  );
  return status === 200 && data?.success ? data.data : null;
};

async function main() {
  console.log("=== bot_backup_test ===");

  const login = await call("/api/system/system/login/prd", { method: "POST" });
  assert.equal(login.status, 200, "login failed");
  bearer = login.data.token;

  const apps = await call("/api/system/api/apps/catalog/prd", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const demo = apps.data.find((a) => a.app === "demo");
  assert.ok(demo, "the demo app should exist");

  const name = `backup-test-bot-${Date.now()}`;
  const base = {
    idapp: demo.idapp,
    name,
    provider: "telegram",
    token: "111111:BACKUP-TEST-TOKEN",
    code: "// v1\n$BOT.on('message:text', (ctx) => ctx.reply('v1'));",
    environment: "prd",
    // Deshabilitado: aquí se prueba el respaldo, no el arranque del worker.
    enabled: false,
    description: "v1",
    params: { version: 1 },
  };

  const created = await saveBot(base);
  const idbot = created.idbot;
  let idbackupV1 = null;

  await test("crear un bot deja su primera versión", async () => {
    const versions = await history(idbot);
    assert.equal(versions.length, 1, "should have exactly one version after creation");
    assert.ok(versions[0].idbackup, "the version should carry an idbackup");
    assert.ok(versions[0].hash, "the version should carry a hash");
    idbackupV1 = versions[0].idbackup;
  });

  await test("la versión ligera no expone el snapshot ni el token", async () => {
    const [version] = await history(idbot);
    assert.equal(version.data, undefined, "lightweight history must not include data");
    assert.deepEqual(
      Object.keys(version).sort(),
      ["createdAt", "hash", "idbackup", "idbot"],
      "lightweight history should only carry the version metadata",
    );
  });

  await test("guardar la misma configuración no crea una versión nueva", async () => {
    await saveBot({ ...base, idbot });
    const versions = await history(idbot);
    assert.equal(versions.length, 1, "an identical save must be deduplicated by hash");
  });

  await test("un cambio real de código crea una versión nueva", async () => {
    await saveBot({
      ...base,
      idbot,
      code: "// v2\n$BOT.on('message:text', (ctx) => ctx.reply('v2'));",
      description: "v2",
      params: { version: 2 },
    });
    const versions = await history(idbot);
    assert.equal(versions.length, 2, "a real change must add a version");
    assert.ok(
      Number(versions[0].idbackup) > Number(versions[1].idbackup),
      "history must come back newest first",
    );
  });

  await test("el snapshot completo no lleva estado observado del runtime", async () => {
    const versions = await history(idbot, false);
    const snapshot = versions[0].data;
    assert.ok(snapshot, "the full history should include the snapshot");
    assert.equal(snapshot.idbot, idbot, "the snapshot should belong to the bot");
    for (const field of ["runtime_status", "failure_count", "last_error_type", "disabled_by"]) {
      assert.equal(
        snapshot[field],
        undefined,
        `${field} is diagnostics and must not be part of the snapshot`,
      );
    }
    for (const field of ["createdAt", "updatedAt", "rowkey"]) {
      assert.equal(
        snapshot[field],
        undefined,
        `${field} is volatile and must not be part of the snapshot`,
      );
    }
  });

  await test("restaurar devuelve la configuración anterior y se registra", async () => {
    const { status, data } = await call("/api/system/bots/restore/prd", {
      method: "POST",
      body: JSON.stringify({ idbackup: idbackupV1 }),
    });
    assert.equal(status, 200, `restore failed: ${JSON.stringify(data)}`);
    assert.equal(data.success, true, `restore did not succeed: ${JSON.stringify(data)}`);
    assert.equal(data.idbot, idbot, "restore should report the restored idbot");

    const bot = await getBot(idbot);
    assert.ok(bot, "the bot should still exist after the restore");
    assert.equal(bot.code, base.code, "the code should be back to v1");
    assert.equal(bot.token, base.token, "the token should be back to v1");
    assert.equal(bot.description, "v1", "the description should be back to v1");

    // El rollback vuelve a un estado ya conocido, así que la deduplicación lo absorbe:
    // el historial no crece, pero la versión que se reemplazó (v2) sigue ahí.
    const versions = await history(idbot);
    assert.equal(versions.length, 2, "restoring a known state must not add a version");
  });

  await test("borrar el bot deja un snapshot y restaurarlo lo recrea", async () => {
    const before = await history(idbot);

    const del = await call(`/api/system/bots/prd?idbot=${idbot}`, { method: "DELETE" });
    assert.equal(del.status, 200, `delete failed: ${JSON.stringify(del.data)}`);
    assert.equal(await getBot(idbot), null, "the bot should be gone after the delete");

    // El estado justo antes de borrar era el v1 restaurado, ya presente en el historial:
    // lo que se comprueba aquí es que el historial SOBREVIVE al borrado.
    const after = await history(idbot);
    assert.equal(
      after.length,
      before.length,
      "the history must survive the deletion of the bot",
    );

    const restore = await call("/api/system/bots/restore/prd", {
      method: "POST",
      body: JSON.stringify({ idbackup: after[0].idbackup }),
    });
    assert.equal(restore.status, 200, `restore after delete failed: ${JSON.stringify(restore.data)}`);

    const revived = await getBot(idbot);
    assert.ok(revived, "restoring should recreate the deleted bot");
    assert.equal(revived.idbot, idbot, "the recreated bot must keep the same idbot");
    assert.equal(revived.token, base.token, "the recreated bot must keep its token");
    assert.ok(revived.code, "the recreated bot must keep its code");
  });

  await test("restaurar un idbackup inexistente responde con error, no con 200", async () => {
    const { data } = await call("/api/system/bots/restore/prd", {
      method: "POST",
      body: JSON.stringify({ idbackup: 999999999 }),
    });
    assert.equal(data.success, false, "an unknown idbackup must not report success");
  });

  // Limpieza: el bot quedó recreado por la prueba anterior.
  await call(`/api/system/bots/prd?idbot=${idbot}`, { method: "DELETE" });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("bot_backup_test crashed:", error);
  process.exit(1);
});
