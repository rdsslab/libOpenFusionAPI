/**
 * AppVars de extremo a extremo contra PostgreSQL.
 *
 * `appvar_types_test.js` es puro: fija el contrato sin tocar la base. Esta suite
 * existe para lo que el contrato NO puede ver, que es si el modelo y el runtime se
 * ponen de acuerdo. Concretamente:
 *
 *   1. Un `string` sobrevive a N ciclos de backup y restore sin ganar comillas. El
 *      defecto de 13.12.1 se realimentaba por esa via, no por la escritura.
 *   2. Un `boolean` llega al runtime como boolean de verdad, no como el string
 *      "false", que en JavaScript es truthy.
 *   3. Un tipo desconocido es un 400 con `INVALID_APPVAR_TYPE`, no un 500.
 *   4. Un `object` guardado como tal sale de la columna como `json`.
 *
 * Necesita la BD. Con SQLite en memoria pasaria igual, porque el defecto no es del
 * motor, pero se ejecuta contra la que haya configurada en `DATABASE_URL`.
 */

import assert from "node:assert/strict";

import { closeDb } from "./close_db.js";
import { AppVars } from "../../src/lib/db/models.js";
import { upsertAppVar, getAppVarsByIdApp } from "../../src/lib/db/appvars.js";
import { parseAppVar } from "../../src/lib/db/app.js";

const APP = "c4ca4238-a0b9-2382-0dcc-509a6f75849b"; // app `demo`
const ENV = "prd";

let passed = 0;
let failed = 0;
const failures = [];
const created = [];

const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  }
};

/** Crea un AppVar de prueba y se apunta para borrarlo al final. */
const create = async (name, type, value, environment = ENV) => {
  created.push({ name, environment });
  await upsertAppVar({ idapp: APP, name, environment, type, value });
  return name;
};

/**
 * Reproduce lo que hace el ciclo backup -> restore sin pasar por la GUI.
 *
 * `getAppBackupById` serializa el arbol YA parseado, y el restore escribe ese texto
 * de vuelta en la columna `json`. Ese par es lo que anadia un par de comillas por
 * ciclo. Aqui se hace lo mismo sobre un unico AppVar: parsear, serializar, y
 * escribir el resultado como si fuera el valor.
 */
const cycleBackupRestore = async (name, environment = ENV) => {
  const rows = await getAppVarsByIdApp(APP);
  const row = rows.find((r) => r.name === name && r.environment === environment);
  assert.ok(row, `no existe ${name}/${environment}`);

  // El backup guarda el valor ya parseado.
  const serialized = JSON.parse(JSON.stringify(parseAppVar(row)));

  // Y el restore lo escribe tal cual en la columna. El `idvar` va incluido porque
  // el backup lo trae, y sin el el upsert no resuelve el conflicto por la clave de
  // negocio (idapp + name + environment) sino por la primary key: insertaria una
  // fila duplicada en vez de actualizar. Es el `TODO (2026-08-06) conflictFields`
  // que ya esta anotado en src/lib/db/appvars.js, y por eso el restore real si
  // funciona: pasa el idvar.
  const [updated] = await AppVars.upsert({
    idvar: row.idvar,
    idapp: APP,
    name,
    environment,
    type: row.type,
    value: serialized,
  });

  return { before: row.value, after: updated.value };
};

const cleanup = async () => {
  for (const { name, environment } of created) {
    try {
      await AppVars.destroy({ where: { idapp: APP, name, environment } });
    } catch {
      // Si el nombre no es valido no habra fila; da igual.
    }
  }
};

console.log("\n=== AppVars end to end: el string no gana comillas ===");

await test("tres ciclos de backup y restore dejan un string intacto", async () => {
  const name = await create("$_VAR_T_CICLOS", "string", "caracol");

  for (let i = 1; i <= 3; i++) {
    const { before, after } = await cycleBackupRestore(name);
    assert.equal(after, before, `el ciclo ${i} cambio el valor: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }

  // Y el runtime lo entrega sin comillas.
  const rows = await getAppVarsByIdApp(APP);
  const row = rows.find((r) => r.name === name);
  const runtime = parseAppVar(row);
  assert.equal(runtime, "caracol");
  assert.equal(typeof runtime, "string");
});

await test("un json tampoco cambia con los ciclos", async () => {
  const name = await create("$_VAR_T_CICLOS_J", "json", { a: 1 });
  for (let i = 1; i <= 3; i++) {
    const { before, after } = await cycleBackupRestore(name);
    assert.deepEqual(after, before, `el ciclo ${i} cambio el valor`);
  }
  const rows = await getAppVarsByIdApp(APP);
  assert.deepEqual(parseAppVar(rows.find((r) => r.name === name)), { a: 1 });
});

await test("un numero tampoco cambia con los ciclos", async () => {
  const name = await create("$_VAR_T_CICLOS_N", "number", 7);
  for (let i = 1; i <= 3; i++) {
    const { before, after } = await cycleBackupRestore(name);
    assert.equal(after, before, `el ciclo ${i} cambio el valor`);
  }
});

console.log("\n=== AppVars end to end: el boolean llega como boolean ===");

await test("un boolean guardado como el string \"false\" llega como false", async () => {
  // Esta es la fila que produce el seed de `system` en una instalacion real: el
  // texto "true"/"false" en la columna json, con `type` = "boolean".
  const name = await create("$_VAR_T_FLAG", "boolean", "false");

  const rows = await getAppVarsByIdApp(APP);
  const row = rows.find((r) => r.name === name);
  const runtime = parseAppVar(row);

  assert.equal(typeof runtime, "boolean", `llego ${typeof runtime}, no boolean`);
  assert.equal(runtime, false, 'llego truthy: el string "false" se leeria como encendido');
});

await test("un boolean real se mantiene y no se convierte en texto", async () => {
  const name = await create("$_VAR_T_FLAG_REAL", "boolean", false);
  const rows = await getAppVarsByIdApp(APP);
  const runtime = parseAppVar(rows.find((r) => r.name === name));
  assert.equal(runtime, false);
  assert.equal(typeof runtime, "boolean");
});

await test("un boolean sobrevive a los ciclos como boolean", async () => {
  const name = await create("$_VAR_T_FLAG_CICLO", "boolean", false);
  for (let i = 1; i <= 3; i++) {
    const { before, after } = await cycleBackupRestore(name);
    assert.equal(after, before, `el ciclo ${i} cambio el flag`);
  }
});

console.log("\n=== AppVars end to end: el tipo se valida al escribir ===");

await test("un tipo desconocido es un 400 con INVALID_APPVAR_TYPE", async () => {
  await assert.rejects(
    () =>
      upsertAppVar({
        idapp: APP,
        name: "$_VAR_T_MAL",
        environment: ENV,
        type: "inventado",
        value: "x",
      }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "INVALID_APPVAR_TYPE");
      assert.ok(Array.isArray(error.details?.valid_types));
      assert.ok(error.details.valid_types.includes("json"));
      return true;
    },
  );
  // Y no queda fila.
  const rows = await getAppVarsByIdApp(APP);
  assert.equal(rows.find((r) => r.name === "$_VAR_T_MAL"), undefined);
});

await test("un tipo casi correcto se rechaza pero con la sugerencia", async () => {
  await assert.rejects(
    () =>
      upsertAppVar({
        idapp: APP,
        name: "$_VAR_T_TYPO",
        environment: ENV,
        type: "strin",
        value: "x",
      }),
    (error) => {
      assert.equal(error.code, "INVALID_APPVAR_TYPE");
      assert.equal(error.details.suggestion, "string");
      return true;
    },
  );
});

await test("un nombre malo y un tipo malo se distinguen en el error", async () => {
  await assert.rejects(
    () => upsertAppVar({ idapp: APP, name: "MALO", environment: ENV, type: "json", value: 1 }),
    (error) => {
      assert.equal(error.code, "INVALID_APPVAR_NAME");
      return true;
    },
  );
  await assert.rejects(
    () => upsertAppVar({ idapp: APP, name: "$_VAR_T_MAL2", environment: ENV, type: "zzz", value: 1 }),
    (error) => {
      assert.equal(error.code, "INVALID_APPVAR_TYPE");
      return true;
    },
  );
});

await test("`object` se guarda y sale de la columna como `json`", async () => {
  const name = await create("$_VAR_T_ALIAS", "object", { a: 1 });
  const rows = await getAppVarsByIdApp(APP);
  const row = rows.find((r) => r.name === name);
  assert.equal(row.type, "json", `la columna quedo con type=${row.type}`);
  // Y el runtime lo resuelve igual, porque `object` nunca fue otra cosa que `json`.
  assert.deepEqual(parseAppVar(row), { a: 1 });
});

await test("un tipo en mayusculas se normaliza al guardar", async () => {
  const name = await create("$_VAR_T_MAYUS", "STRING", "caracol");
  const rows = await getAppVarsByIdApp(APP);
  assert.equal(rows.find((r) => r.name === name).type, "string");
});

console.log("\n=== AppVars end to end: cada tipo llega como su tipo ===");

await test("el valor en el runtime respeta el tipo declarado", async () => {
  const cases = [
    ["$_VAR_T_TIP_STRING", "string", "caracol", (v) => typeof v === "string" && v === "caracol"],
    ["$_VAR_T_TIP_NUM", "number", "12", (v) => typeof v === "number" && v === 12],
    ["$_VAR_T_TIP_JSON", "json", '{"a":1}', (v) => typeof v === "object" && v.a === 1],
    ["$_VAR_T_TIP_BOOL_T", "boolean", "true", (v) => v === true],
    ["$_VAR_T_TIP_BOOL_F", "boolean", "false", (v) => v === false],
    ["$_VAR_T_TIP_NONE", "none", "texto", (v) => v === "texto"],
  ];

  for (const [name, type, value, check] of cases) {
    await create(name, type, value);
  }

  const rows = await getAppVarsByIdApp(APP);
  for (const [name, type, , check] of cases) {
    const row = rows.find((r) => r.name === name);
    const runtime = parseAppVar(row);
    assert.ok(
      check(runtime),
      `${name} (type=${type}) llego como ${JSON.stringify(runtime)} (${typeof runtime})`,
    );
  }
});

console.log("\n=== AppVars end to end: limpieza ===");

await test("las variables de prueba se borran", async () => {
  await cleanup();
  const rows = await getAppVarsByIdApp(APP);
  const left = rows.filter((r) => r.name.startsWith("$_VAR_T_"));
  assert.deepEqual(left.map((r) => r.name), [], `quedaron: ${left.map((r) => r.name).join(", ")}`);
});

console.log(`\n${passed} pass, ${failed} fail`);
if (failed > 0) {
  console.error("\n=== FALLOS ===");
  for (const { name, error } of failures) {
    console.error(`\n--- ${name}\n${error.stack}`);
  }
}
console.log("=== AppVars end to end: all good ===");

await closeDb();
process.exit(failed > 0 ? 1 : 0);
