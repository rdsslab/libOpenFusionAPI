/**
 * Regresion: `attributes` se ignoraba cuando llegaba por query string.
 *
 * Una tool MCP que apunta a un endpoint GET manda sus argumentos como query
 * string (`uFetch` hace `new URLSearchParams(data)`), y un array se aplana a
 * texto separado por comas: `{ attributes: ["idapp","app"] }` ->
 * `?attributes=idapp%2Capp`. Fastify lo entrega como string, y las funciones de
 * DB solo aplicaban el filtro `if (Array.isArray(attributes))`, asi que el
 * filtro se descartaba en silencio y la consulta devolvia TODAS las columnas,
 * `jwt_key` incluida.
 *
 * Lo que se prueba aqui, en orden:
 *   1. `toAttributeList` normaliza array y CSV a la misma lista.
 *   2. `applyAttributesToOptions` descarta columnas inexistentes y nunca deja
 *      pasar `jwt_key` si no se pidio.
 *   3. Las tres funciones reales de DB aplican el filtro con array y con CSV, y
 *      la respuesta ya no trae las columnas sensibles.
 *   4. El fuente de las tres funciones usa el helper compartido (si alguien
 *      vuelve a escribir la guarda `Array.isArray`, esto falla).
 *
 * Se fuerza una base SQLite en memoria para no tocar la del packet ni la del
 * servidor de desarrollo: el punto no es el motor, es que el filtro llegue.
 */

// Antes de cualquier import que arrastre `db/sequelize.js`: aisla la suite.
// Un archivo en el tmp del sistema y no `sqlite::memory:` porque Node emite un
// DeprecationWarning (DEP0170) al parsear esa URL como URL.
const dbFile = join(os.tmpdir(), `ofapi_attr_filter_${process.pid}.sqlite`);
process.env.DATABASE_URL = `sqlite:${dbFile}`;

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const { toAttributeList, applyAttributesToOptions } = await import(
  "../../src/lib/db/utils.js"
);
const { Application, Endpoint } = await import("../../src/lib/db/models.js");
const { getAllApps } = await import("../../src/lib/db/app.js");
const { getEndpointById, getEndpointByIdApp } = await import(
  "../../src/lib/db/endpoint.js"
);
const { closeDb } = await import("./close_db.js");

/* ------------------------------------------------------------------ *
 * 1. Normalizacion pura
 * ------------------------------------------------------------------ */

test("toAttributeList: array y CSV dan la misma lista", () => {
  assert.deepEqual(toAttributeList(["idapp", "app", "enabled"]), [
    "idapp",
    "app",
    "enabled",
  ]);
  assert.deepEqual(toAttributeList("idapp,app,enabled"), [
    "idapp",
    "app",
    "enabled",
  ]);
  // El CSV real que emite URLSearchParams no lleva espacios, pero un cliente
  // escrito a mano si puede mandarlos.
  assert.deepEqual(toAttributeList(" idapp , app "), ["idapp", "app"]);
});

test("toAttributeList: entradas sin filtro devuelven null", () => {
  assert.equal(toAttributeList(undefined), null);
  assert.equal(toAttributeList(null), null);
  assert.equal(toAttributeList(""), null);
  assert.equal(toAttributeList("   "), null);
  assert.equal(toAttributeList(","), null);
  assert.equal(toAttributeList([]), null);
  // Un numero u objeto no son una lista de columnas: no se inventa nada.
  assert.equal(toAttributeList(123), null);
  assert.equal(toAttributeList({ attributes: ["a"] }), null);
});

test("toAttributeList: los huecos vacios del array/CSV se descartan", () => {
  assert.deepEqual(toAttributeList(["idapp", "", " app "]), ["idapp", "app"]);
  assert.deepEqual(toAttributeList("idapp,,app,"), ["idapp", "app"]);
});

/* ------------------------------------------------------------------ *
 * 2. Aplicacion a las opciones de Sequelize
 * ------------------------------------------------------------------ */

const fakeModel = {
  rawAttributes: { idapp: {}, app: {}, enabled: {}, jwt_key: {} },
};

test("applyAttributesToOptions: CSV y array fijan options.attributes", () => {
  assert.deepEqual(
    applyAttributesToOptions({}, "idapp,app,enabled", fakeModel).attributes,
    ["idapp", "app", "enabled"],
  );
  assert.deepEqual(
    applyAttributesToOptions({}, ["idapp", "app"], fakeModel).attributes,
    ["idapp", "app"],
  );
});

test("applyAttributesToOptions: sin valor no toca las opciones", () => {
  const options = {};
  applyAttributesToOptions(options, undefined, fakeModel);
  assert.deepEqual(options, {});
});

test("applyAttributesToOptions: las columnas desconocidas no pasan a Sequelize", () => {
  // Si "bogus" llegara a options.attributes, Sequelize lanzaria al construir el
  // SELECT: un filtro mal escrito convertiria una respuesta valida en un 500.
  const options = applyAttributesToOptions({}, "idapp,bogus", fakeModel);
  assert.deepEqual(options.attributes, ["idapp"]);
});

test("applyAttributesToOptions: solo columnas desconocidas => fila completa", () => {
  const options = applyAttributesToOptions({}, "bogus,nope", fakeModel);
  assert.equal(options.attributes, undefined);
});

/* ------------------------------------------------------------------ *
 * 3. Las funciones reales, contra una base en memoria
 * ------------------------------------------------------------------ */

test("getAllApps: el CSV no devuelve jwt_key", async () => {
  await Application.sync({ force: true });
  await Application.create({
    app: "atrrts_probe",
    jwt_key: "11111111-1111-1111-1111-111111111111",
    vars: { secret: "s" },
    params: { users: [] },
  });

  const filtered = await getAllApps("idapp,app,enabled");
  assert.equal(filtered.length, 1);
  const keys = Object.keys(filtered[0].toJSON()).sort();
  assert.deepEqual(keys, ["app", "enabled", "idapp"]);
  assert.ok(!keys.includes("jwt_key"), "la respuesta no debe traer jwt_key");

  // El array sigue funcionando igual.
  const asArray = await getAllApps(["idapp", "app", "enabled"]);
  assert.deepEqual(
    Object.keys(asArray[0].toJSON()).sort(),
    ["app", "enabled", "idapp"],
  );

  // Sin filtro si se devuelven todas las columnas: el fix no recorta de mas.
  const all = await getAllApps();
  assert.ok("jwt_key" in all[0].toJSON());
});

test("getEndpointById: el CSV no devuelve el code", async () => {
  const app = await Application.findOne();
  await Endpoint.sync({ force: true });
  const created = await Endpoint.create({
    idapp: app.idapp,
    resource: "/api/atrrts/probe",
    method: "GET",
    handler: "JS",
    code: "// sentinel-code-no-debe-salir",
  });

  const filtered = await getEndpointById(created.idendpoint, "idendpoint,resource,method");
  const keys = Object.keys(filtered.toJSON()).sort();
  assert.deepEqual(keys, ["idendpoint", "method", "resource"]);
  assert.ok(!keys.includes("code"), "la respuesta no debe traer code");

  const all = await getEndpointById(created.idendpoint);
  assert.ok("code" in all.toJSON());
});

test("getEndpointByIdApp: el CSV no devuelve el code", async () => {
  const app = await Application.findOne();
  const rows = await getEndpointByIdApp(app.idapp, "idendpoint,resource");
  assert.equal(rows.length, 1);
  const keys = Object.keys(rows[0].toJSON()).sort();
  assert.deepEqual(keys, ["idendpoint", "resource"]);
});

/* ------------------------------------------------------------------ *
 * 4. Guarda contra la regresion en el fuente
 * ------------------------------------------------------------------ */

test("las tres funciones usan el helper compartido", () => {
  const appSrc = readFileSync(join(repoRoot, "src/lib/db/app.js"), "utf8");
  const endpointSrc = readFileSync(
    join(repoRoot, "src/lib/db/endpoint.js"),
    "utf8",
  );

  assert.match(appSrc, /applyAttributesToOptions\(\{\}, attributes, Application\)/);
  assert.match(endpointSrc, /applyAttributesToOptions\(\{\}, attributes, Endpoint\)/);
  assert.match(
    endpointSrc,
    /applyAttributesToOptions\(\{\s*where\s*\}, attributes, Endpoint\)/,
  );

  // Y ninguna de las dos puede volver a la guarda que causaba el bug.
  assert.doesNotMatch(appSrc, /Array\.isArray\(attributes\)/);
  assert.doesNotMatch(endpointSrc, /Array\.isArray\(attributes\)/);
});

// `after` y no un `await closeDb()` al final del modulo: los callbacks de
// `test()` se ejecutan despues de que el modulo termina de evaluarse, asi que un
// cierre en linea ocurriria ANTES que las pruebas y el pool llegaria cerrado.
after(async () => {
  await closeDb();
  try {
    rmSync(dbFile, { force: true });
  } catch {
    // El archivo temporal es descartable: no convertir un test verde en rojo.
  }
});
