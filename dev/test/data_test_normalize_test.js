import assert from "node:assert/strict";

import {
  normalizeDataTest,
  AVISO_DATA_TEST_NORMALIZADO,
} from "../../src/lib/db/endpoint.js";
import { closeDb } from "./close_db.js";

/**
 * `data_test` tiene una estructura, y el que la definia era el Tester del editor:
 * el ejemplo JSON va en `body.json.code`, las filas de query y headers en
 * `query` / `headers`. El problema es que nadie se lo decia a quien guardaba el
 * endpoint, y un cliente queguarda el body crudo en la raiz no falla: guarda
 * bien, el upsert devuelve 200 y el Tester muestra `{}` al abrir el endpoint.
 *
 * `normalizeDataTest` rescata ese caso sin rechazar nada. Esta suite fija las
 * dos mitades de esa frase:
 *
 *   1. Un `data_test` que ya viene en el formato del Tester se devuelve INTACTO
 *      — byte a byte, incluidas las filas internas que la GUI anade
 *      (`internal_hash_row`, `_id`). Envolver algo que ya estaba bien destruye
 *      datos, no los arregla.
 *   2. Todo lo demas se envuelve en `body.json.code` y se marca como normalizado
 *      para que la respuesta lo diga.
 *
 * Y la parte que mas facilmente se haria mal: el criterio de "esto ya venia
 * bien". Un body crudo como `{"query":[{"field":"x"}]}` es un payload valido, y
 * con la regla simple ("query es un array, luego es del Tester") se guardaba
 * tal cual y sin aviso. Las filas tienen que PARECER filas.
 *
 * Es pura: asserta el retorno del helper, no un guardado. Un `data_test` que es
 * una string no parseable pasaria aqui y es un error de base de datos en
 * Postgres, asi que comprobarlo writingsaliria de su competencia.
 */

/** Un `data_test` tal cual lo deja el editor, con las claves internas de la GUI. */
const dataTestDelEditor = Object.freeze({
  query: [
    {
      enabled: true,
      key: "idapp",
      value: "abc",
      type: 1,
      internal_hash_row: "c5c647b0",
      _id: "d8xh0y1o4",
    },
  ],
  body: {
    selection: 0,
    json: { code: { campo: "valor" } },
    xml: { code: "" },
    text: { value: "" },
    form: [],
    urlencoded: [],
  },
  headers: [{ enabled: false, key: "", value: "", type: 1 }],
  auth: {
    selection: 0,
    basic: { username: "", password: "" },
    bearer: { token: "" },
  },
  last_response: { data: "", sizeKBResponse: -1 },
});

const envuelto = (code) => ({ body: { selection: 0, json: { code } } });

async function run() {
  // --- Lo que ya venia bien no se toca -------------------------------------
  const intacto = normalizeDataTest(dataTestDelEditor);
  assert.equal(intacto.normalized, false, "El formato del Tester no debe normalizarse.");
  assert.deepEqual(intacto.value, dataTestDelEditor);
  assert.equal(
    intacto.value.query[0].internal_hash_row,
    "c5c647b0",
    "Las claves internas de la GUI (internal_hash_row, _id) deben sobrevivir: el editor las usa para reconciliar sus filas.",
  );
  assert.equal(
    intacto.value.query[0]._id,
    "d8xh0y1o4",
    "El _id de fila que antepone la GUI debe sobrevivir al guardado.",
  );

  // Idempotencia: normalizar dos veces no acumula bodies.
  const dosVeces = normalizeDataTest(intacto.value);
  assert.deepEqual(dosVeces.value, intacto.value);
  assert.equal(dosVeces.normalized, false);

  // Las señales canonicas sueltas tambien cuentan como formato del Tester.
  for (const [nombre, value] of [
    ["solo body.selection", { body: { selection: 2, text: { value: "hola" } } }],
    ["solo body.json.code", { body: { json: { code: { a: 1 } } } }],
    ["solo body.xml", { body: { xml: { code: "<a/>" } } }],
    ["solo body.form", { body: { selection: 3, form: [] } }],
    ["solo auth.selection", { auth: { selection: 2, bearer: { token: "t" } } }],
    ["solo last_response", { last_response: { data: "ok", sizeKBResponse: 0.5 } }],
    ["query con filas", { query: [{ enabled: true, key: "a", value: "1" }] }],
    ["query vacia", { query: [] }],
    ["headers con filas", { headers: [{ enabled: true, key: "X-Trace", value: "1" }] }],
  ]) {
    const res = normalizeDataTest(value);
    assert.equal(res.normalized, false, `${nombre} ya viene en formato del Tester.`);
    assert.deepEqual(res.value, value, `${nombre} debe volver intacto.`);
  }

  // --- El fallo que motivationo el cambio ----------------------------------
  const bodyCrudo = {
    corporativos: ["1600395592"],
    ejecutar_sincronizador: true,
    forzar_sincronizador: false,
    dry_run: true,
  };
  const crudo = normalizeDataTest(bodyCrudo);
  assert.equal(crudo.normalized, true, "Un body crudo en la raiz debe normalizarse.");
  assert.deepEqual(
    crudo.value,
    envuelto(bodyCrudo),
    "El body crudo debe quedar accesible en data_test.body.json.code, que es donde lo leen el Tester y execute_endpoint_test.",
  );
  assert.equal(crudo.value.body.json.code, bodyCrudo);
  assert.equal(
    crudo.value.body.selection,
    0,
    "selection 0 es JSON: sin el, el Tester no sabria que body usar.",
  );

  // Un array tambien es un body valido (un endpoint puede esperar una lista).
  const arrayCrudo = normalizeDataTest([{ a: 1 }, { a: 2 }]);
  assert.equal(arrayCrudo.normalized, true);
  assert.deepEqual(arrayCrudo.value, envuelto([{ a: 1 }, { a: 2 }]));

  // --- Los falsos positivos que rompen en silencio -------------------------
  // Un body crudo puede tener un array llamado `query` o `headers`. Si se
  // aceptara como formato del Tester, se guardaria roto y SIN aviso.
  for (const [nombre, value] of [
    ["query como array de no-filas", { query: [{ field: "x" }], params: [1, 2] }],
    ["headers como array de no-filas", { headers: [{ name: "X-Trace" }] }],
    ["query como array de strings", { query: ["a=1", "b=2"] }],
    ["query como array vacio junto a un body", { query: [], campo: "valor" }],
  ]) {
    const res = normalizeDataTest(value);
    assert.equal(res.normalized, true, `${nombre} es un body crudo y debe enveloparse.`);
    assert.deepEqual(
      res.value,
      envuelto(value),
      `${nombre} debe quedar completo dentro de body.json.code.`,
    );
  }

  // Un body crudo cuya clave es `body` pero que no es la configuracion del
  // Tester: es un body mas, y envolverlo es lo unico que lo hace jugable.
  const bodyConClaveBody = normalizeDataTest({ body: { texto: "hola" } });
  assert.equal(bodyConClaveBody.normalized, true);
  assert.deepEqual(bodyConClaveBody.value, envuelto({ body: { texto: "hola" } }));

  // --- Strings, null y vacio -----------------------------------------------
  // Una string con JSON es como llega el body desde un formulario o un cliente
  // que no sabe mandar objetos: se parsea y se envuelve.
  const stringJson = normalizeDataTest(JSON.stringify({ campo: "valor" }));
  assert.equal(stringJson.normalized, true);
  assert.deepEqual(stringJson.value, envuelto({ campo: "valor" }));

  // Una string que ya es la estructura del Tester llega como texto (form-data,
  // guardado por clientes HTTP). Se parsea y se respeta tal cual.
  const stringCanonica = normalizeDataTest(JSON.stringify(dataTestDelEditor));
  assert.equal(stringCanonica.normalized, false);
  assert.deepEqual(stringCanonica.value, dataTestDelEditor);

  // Una string que no es JSON no se toca: no es nuestro trabajo decidir que
  // contiene, y en Postgres guardarla seria un error de base de datos.
  const stringRota = normalizeDataTest("{no es json");
  assert.equal(stringRota.normalized, false);
  assert.equal(stringRota.value, "{no es json");

  for (const vacio of [null, undefined, {}]) {
    const res = normalizeDataTest(vacio);
    assert.equal(res.normalized, false, `${JSON.stringify(vacio)} no se normaliza.`);
    assert.deepEqual(res.value, vacio);
  }

  // Un numero o un booleano sueltos tambien son bodies validos.
  assert.deepEqual(normalizeDataTest(42).value, envuelto(42));
  assert.deepEqual(normalizeDataTest(true).value, envuelto(true));
  assert.equal(normalizeDataTest("42").normalized, true, "Una string numerica es un body.");
  assert.deepEqual(normalizeDataTest("42").value, envuelto(42));

  // --- El aviso ------------------------------------------------------------
  // El texto nombra la ruta exacta porque es lo unico que lee el agente que
  // acaba de llamar. Sin la ruta, el aviso no Corrige nada.
  assert.ok(
    AVISO_DATA_TEST_NORMALIZADO.includes("data_test.body.json.code"),
    `El aviso tiene que decir donde quedo el body, no solo que algo cambio: "${AVISO_DATA_TEST_NORMALIZADO}".`,
  );

  console.log("data_test normalization regression checks passed.");
}

run()
  .then(closeDb)
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });