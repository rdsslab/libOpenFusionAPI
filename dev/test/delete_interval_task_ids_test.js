/**
 * Regresion: borrar varias interval tasks a la vez no borraba nada.
 *
 * `deleteIntervalTask` recibia el valor tal cual y lo ponia en
 * `where: { idtask }`. Un array funciona, pero un GET/HEAD/DELETE pasa el payload
 * por la query string de uFetch, que usa `new URLSearchParams` y aplana el array
 * a texto separado por comas: `[a,b]` -> `"a,b"`. Comparar la columna `uuid`
 * contra `"a,b"` no casa ninguna fila (y en PostgreSQL aborta con 22P02). El
 * sintoma era un borrado en lote que no hacia nada y no daba error, tanto en la
 * tool MCP `delete_interval_task` como en el GUI.
 *
 * Ahora `deleteIntervalTask` normaliza array o CSV a lista y descarta lo que no
 * tenga forma de UUID, por la misma razon que el restore (ver `esUUIDTask`).
 *
 * Se usa una SQLite temporal propia para no tocar la del packet ni la del
 * servidor de desarrollo.
 */

// Antes de cualquier import que arrastre `db/sequelize.js`: aisla la suite.
import os from "node:os";
import { dirname, join } from "node:path";

const dbFile = join(os.tmpdir(), `ofapi_del_task_${process.pid}.sqlite`);
process.env.DATABASE_URL = `sqlite:${dbFile}`;

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const { toStringList } = await import("../../src/lib/db/utils.js");
const { Application, Endpoint, IntervalTask } = await import(
  "../../src/lib/db/models.js"
);
const { deleteIntervalTask } = await import("../../src/lib/db/interval_task.js");
const { closeDb } = await import("./close_db.js");

/** Cada prueba parte de tabla vacia: no se apoyan en lo que dejo la anterior. */
const limpiarTareas = () => IntervalTask.destroy({ where: {}, truncate: true });

/* ------------------------------------------------------------------ *
 * 1. Normalizacion pura
 * ------------------------------------------------------------------ */

test("toStringList: array y CSV dan la misma lista", () => {
  assert.deepEqual(toStringList(["a", "b"]), ["a", "b"]);
  assert.deepEqual(toStringList("a,b"), ["a", "b"]);
  assert.deepEqual(toStringList(" a , b "), ["a", "b"]);
  assert.deepEqual(toStringList(["a", "", " b "]), ["a", "b"]);
});

test("toStringList: sin valor no hay lista", () => {
  assert.equal(toStringList(undefined), null);
  assert.equal(toStringList(null), null);
  assert.equal(toStringList(""), null);
  assert.equal(toStringList("   "), null);
  assert.equal(toStringList(","), null);
  assert.equal(toStringList([]), null);
  assert.equal(toStringList(123), null);
});

/* ------------------------------------------------------------------ *
 * 2. Borrado real, contra una base en memoria
 * ------------------------------------------------------------------ */

let idendpoint;

test("preparar app, endpoint y tareas", async () => {
  await Application.sync({ force: true });
  await Endpoint.sync({ force: true });
  await IntervalTask.sync({ force: true });

  const app = await Application.create({ app: "del_task_probe" });
  const endpoint = await Endpoint.create({
    idapp: app.idapp,
    resource: "/api/del/task",
    method: "GET",
    handler: "JS",
  });
  idendpoint = endpoint.idendpoint;
});

test("deleteIntervalTask: el CSV de un borrado en lote borra todas", async () => {
  await limpiarTareas();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const idtask of ids) {
    await IntervalTask.create({ idendpoint, idtask });
  }
  assert.equal(await IntervalTask.count(), 3);

  // Lo que realmente llega desde MCP/GUI en un DELETE.
  const csv = [ids[0], ids[1]].join(",");
  assert.equal(await deleteIntervalTask(csv), true);

  const restantes = await IntervalTask.findAll({ raw: true });
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].idtask, ids[2]);
});

test("deleteIntervalTask: tambien acepta el array y el id suelto", async () => {
  await limpiarTareas();
  const a = randomUUID();
  const b = randomUUID();
  await IntervalTask.create({ idendpoint, idtask: a });
  await IntervalTask.create({ idendpoint, idtask: b });

  assert.equal(await deleteIntervalTask([a]), true);
  assert.equal(await deleteIntervalTask(b), true);
  assert.equal(await IntervalTask.count(), 0);
});

test("deleteIntervalTask: descarta ids que no son UUID", async () => {
  // Un id invalido en la lista no debe tumbar el borrado de los validos, ni
  // llegar a la columna uuid (22P02 en PostgreSQL).
  await limpiarTareas();
  const a = randomUUID();
  const b = randomUUID();
  await IntervalTask.create({ idendpoint, idtask: a });
  await IntervalTask.create({ idendpoint, idtask: b });

  assert.equal(await deleteIntervalTask(`${a},no-es-un-uuid,${b}`), true);
  assert.equal(await IntervalTask.count(), 0);
});

test("deleteIntervalTask: sin ids validos no toca la tabla", async () => {
  await limpiarTareas();
  const a = randomUUID();
  await IntervalTask.create({ idendpoint, idtask: a });

  assert.equal(await deleteIntervalTask(undefined), false);
  assert.equal(await deleteIntervalTask(null), false);
  assert.equal(await deleteIntervalTask([]), false);
  assert.equal(await deleteIntervalTask("no-es-un-uuid"), false);
  assert.equal(await IntervalTask.count(), 1); // no borra todo por un where vacio
});

/* ------------------------------------------------------------------ *
 * 3. Guarda contra la regresion en el fuente
 * ------------------------------------------------------------------ */

test("deleteIntervalTask y el handler normalizan la lista", () => {
  const dbSrc = readFileSync(
    join(repoRoot, "src/lib/db/interval_task.js"),
    "utf8",
  );
  const handlerSrc = readFileSync(
    join(
      repoRoot,
      "src/lib/server/functions/system/prd/interval_tasks/index.js",
    ),
    "utf8",
  );

  assert.match(dbSrc, /toStringList\(idtaskList\)/);
  assert.match(dbSrc, /\.filter\(esUUIDTask\)/);
  assert.match(handlerSrc, /toStringList\(raw\)/);
});

after(async () => {
  await closeDb();
  try {
    rmSync(dbFile, { force: true });
  } catch {
    // El archivo temporal es descartable: no convertir un test verde en rojo.
  }
});
