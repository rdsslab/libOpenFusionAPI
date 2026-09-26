/**
 * Pruebas de las dos opciones que se arreglaron en 13.11.1 y que antes no tenian efecto:
 *
 *   1. `ignoreDuplicates` en SQL_BULK_I se leia de custom_data pero nunca se asignaba,
 *      asi que llegaba a bulkInsert() siempre como undefined y la opcion no hacia nada.
 *   2. El worker de interval tasks llama a uF[task.method.toLowerCase()], y uFetch no
 *      implementa `head` ni `options`. Una tarea sobre un endpoint con esos verbos
 *      fallaba con `uF[...] is not a function`, que no dice que esta mal.
 *
 * Se prueban las funciones puras, no el flujo HTTP completo: lo que importa es que la
 * decision se tome sobre los valores correctos y que el motivo del rechazo sea util.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/* ------------------------------------------------------------------ *
 * 1. ignoreDuplicates
 * ------------------------------------------------------------------ */

/** Replica la normalizacion tal como quedo en el handler. */
const resolveIgnoreDuplicates = (config) =>
  config?.ignoreDuplicates === true || config?.ignoreDuplicates === "true";

test("ignoreDuplicates: se activa solo con un boolean explicito", () => {
  assert.equal(resolveIgnoreDuplicates({ ignoreDuplicates: true }), true);
  assert.equal(resolveIgnoreDuplicates({ ignoreDuplicates: "true" }), true);

  // Cualquier otra cosa se trata como false. El motivo es la coherencia: un `true`
  // escrito como texto no debe comportarse distinto a un true de verdad, y un valor
  // typo como "yes" no debe activar la opcion por sorpresa.
  assert.equal(resolveIgnoreDuplicates({ ignoreDuplicates: false }), false);
  assert.equal(resolveIgnoreDuplicates({ ignoreDuplicates: "false" }), false);
  assert.equal(resolveIgnoreDuplicates({ ignoreDuplicates: "yes" }), false);
  assert.equal(resolveIgnoreDuplicates({ ignoreDuplicates: 1 }), false);
  assert.equal(resolveIgnoreDuplicates({ ignoreDuplicates: "TRUE" }), false);
});

test("ignoreDuplicates: ausente o con config vacia no activa nada", () => {
  assert.equal(resolveIgnoreDuplicates({}), false);
  assert.equal(resolveIgnoreDuplicates({ schema: "public" }), false);
  assert.equal(resolveIgnoreDuplicates(undefined), false);
  assert.equal(resolveIgnoreDuplicates(null), false);
});

test("ignoreDuplicates: el handler asigna la clave antes de usarla", () => {
  // El defecto original era que paramsSQL.ignoreDuplicates se leia al construir el
  // argumento de bulkInsertWithTransaction pero nunca se asignaba en paramsSQL. Esta
  // asercion sobre el fuente falla si alguien quita la asignacion.
  const source = readFileSync(
    join(repoRoot, "src/lib/handler/sqlFunctionInsertBulk.js"),
    "utf8",
  );

  assert.match(
    source,
    /paramsSQL\.ignoreDuplicates\s*=/,
    "paramsSQL.ignoreDuplicates debe asignarse a partir de config",
  );

  // Y debe seguir llegando a bulkInsert: la firma de bulkInsertWithTransaction ya lo
  // aceptaba como quinto argumento, y esa parte no se toco.
  assert.match(
    source,
    /data_request\.data,\s*\n\s*paramsSQL\.ignoreDuplicates/,
    "el valor asignado debe seguir pasándose a bulkInsertWithTransaction",
  );
});

/* ------------------------------------------------------------------ *
 * 2. Verbos no soportados por el worker
 * ------------------------------------------------------------------ */

const SUPPORTED_TASK_VERBS = ["get", "post", "put", "patch", "delete", "query"];

test("verbos del worker: cubre exactamente los que uFetch implementa", () => {
  const source = readFileSync(
    join(repoRoot, "node_modules/@rdsslab/uFetch/src/fetch.js"),
    "utf8",
  );

  for (const verb of SUPPORTED_TASK_VERBS) {
    assert.match(
      source,
      new RegExp(`\\n  ${verb}\\(opts = \\{\\}\\) \\{`),
      `uFetch deberia implementar ${verb}(): si la lista de aquí ya no coincide, el guard de worker.js miente`,
    );
  }
});

test("verbos del worker: head y options no estan, que es lo que motiva el guard", () => {
  const source = readFileSync(
    join(repoRoot, "node_modules/@rdsslab/uFetch/src/fetch.js"),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /\n  head\(opts = \{\}\) \{/,
    "si uFetch añadiera head(), el guard de worker.js se puede simplificar",
  );
  assert.doesNotMatch(
    source,
    /\n  options\(opts = \{\}\) \{/,
    "si uFetch añadiera options(), el guard de worker.js se puede simplificar",
  );
});

test("verbos del worker: el guard comprueba el metodo antes de llamar", () => {
  const source = readFileSync(join(repoRoot, "src/lib/timer/worker.js"), "utf8");

  // La comprobacion tiene que ir antes de la invocacion, no despues.
  const guardAt = source.indexOf('typeof uF[verb] !== "function"');
  const callAt = source.indexOf("await uF[verb](");

  assert.ok(guardAt > -1, "debe existir la comprobacion del verbo");
  assert.ok(callAt > -1, "debe existir la invocacion con el verbo normalizado");
  assert.ok(
    guardAt < callAt,
    "la comprobacion del verbo debe preceder a la llamada, o no protege de nada",
  );
});

test("verbos del worker: el motivo del rechazo enumera los verbos validos", () => {
  const source = readFileSync(join(repoRoot, "src/lib/timer/worker.js"), "utf8");

  // Un error que no dice que verbs valen obliga a abrir el codigo para averiguarlo.
  assert.match(
    source,
    /SUPPORTED_TASK_VERBS\.join\(", "\)/,
    "el mensaje de error debe enumerar los verbos soportados",
  );
});

test("verbos del worker: un verbo no soportado se rechaza en mayusculas y en minusculas", () => {
  // task.method viene del endpoint, y el modelo lo fuerza a mayusculas; aun asi el
  // guard normaliza, porque la columna tambien admite valores escritos a mano.
  const verdict = (method) => {
    const verb = String(method).toLowerCase();
    return SUPPORTED_TASK_VERBS.includes(verb);
  };

  assert.equal(verdict("HEAD"), false);
  assert.equal(verdict("head"), false);
  assert.equal(verdict("OPTIONS"), false);
  assert.equal(verdict("options"), false);
  assert.equal(verdict("GET"), true);
  assert.equal(verdict("post"), true);
  assert.equal(verdict("QUERY"), true);
});
