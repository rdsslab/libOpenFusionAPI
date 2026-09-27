import assert from "node:assert/strict";
import { defaultMethods } from "../../src/lib/db/method.js";
import { Method } from "../../src/lib/db/models.js";
import { closeDb } from "./close_db.js";

/**
 * H38: `defaultMethods` declaraba terminado un seed que no habia terminado.
 *
 * El bucle era `methods.forEach(async (m) => { await Method.upsert(...) })` dentro de
 * una funcion que ni siquiera era `async`: `forEach` no serializa y la funcion devolvia
 * `undefined` en el acto, asi que el `await defaultMethods()` de `src/lib/index.js:676`
 * no esperaba nada. Medido: 11 escrituras simultaneas sobre `ofapi_method` —el pico mas
 * alto que quedaba tras H35/H36— y, en MSSQL, 11 `MERGE INTO [ofapi_method]` a la vez,
 * que es justo el patron que produce el 1205.
 *
 * El fallo no era visible en el arranque porque el seed "terminaba bien": lo que pasaba
 * es que se declaraba acabado antes de empezar. Estos tests son puros —instrumentan
 * `Method.upsert` y no abren conexion— porque lo que hay que fijar es la promesa que
 * devuelve la funcion, no lo que la base de datos contenga.
 */

const METODOS_ESPERADOS = [
  "NA",
  "CONNECT",
  "GET",
  "DELETE",
  "HEAD",
  "PATCH",
  "POST",
  "PUT",
  "QUERY",
  "WS",
  "OPTIONS",
];

/**
 * Sustituye `Method.upsert` por uno instrumentado.
 *
 * Cada llamada se cuenta en vuelo antes de esperar, para poder medir el pico: con el
 * `forEach` los once `upsert` salen a la vez sin que ninguno haya terminado, y ese
 * numero es el que interesa. `settled` lleva la cuenta de los que YA terminaron, que
 * es lo que separa "lanzo las escrituras" de "termine las escrituras".
 */
function instrumentarUpsert({ fallaPara = null, retardoMs = 15 } = {}) {
  const upsertOriginal = Method.upsert;
  const telemetria = { llamado: [], enVuelo: 0, picoEnVuelo: 0, settled: 0 };

  Method.upsert = async (payload) => {
    telemetria.enVuelo += 1;
    telemetria.picoEnVuelo = Math.max(telemetria.picoEnVuelo, telemetria.enVuelo);
    telemetria.llamado.push({ payload: { ...payload }, enVuelo: telemetria.enVuelo });
    try {
      if (fallaPara !== null && payload.method === fallaPara) {
        throw new Error(`fallo simulado en ${payload.method}`);
      }
      await new Promise((resolve) => setTimeout(resolve, retardoMs));
      return [payload, true];
    } finally {
      telemetria.enVuelo -= 1;
      telemetria.settled += 1;
    }
  };

  return {
    telemetria,
    restaurar: () => {
      Method.upsert = upsertOriginal;
    },
  };
}

/** Captura lo que se escribe por `console.error` mientras corre `accion`. */
async function capturandoErrores(accion) {
  const original = console.error;
  const capturados = [];
  console.error = (...args) => {
    capturados.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  try {
    await accion();
  } finally {
    console.error = original;
  }
  return capturados;
}

async function runTests() {
  console.log("--- Starting Method Seed Tests ---");

  // 1. Lo que el arranque espera: una promesa
  console.log("[STEP 1/4] defaultMethods() returns a promise...");
  {
    const { telemetria, restaurar } = instrumentarUpsert();
    try {
      const devuelto = defaultMethods();
      assert.ok(
        devuelto !== null && typeof devuelto === "object" && typeof devuelto.then === "function",
        "defaultMethods() tiene que devolver una promesa: el arranque hace `await defaultMethods()` " +
          "y, al devolver `undefined`, ese await no espera nada (H38)",
      );
      await devuelto;
      assert.strictEqual(
        telemetria.settled,
        METODOS_ESPERADOS.length,
        `al resolver deben haber terminado las ${METODOS_ESPERADOS.length} escrituras, no ${telemetria.settled}: ` +
          "quedaban en vuelo cuando la funcion dijo que habia terminado",
      );
    } finally {
      restaurar();
    }
  }

  // 2. Una escritura en vuelo, no once a la vez
  console.log("[STEP 2/4] The seed runs one write at a time...");
  {
    const { telemetria, restaurar } = instrumentarUpsert();
    try {
      await defaultMethods();
      assert.strictEqual(
        telemetria.picoEnVuelo,
        1,
        `el pico de escrituras simultaneas sobre ofapi_method fue ${telemetria.picoEnVuelo}, y tiene que ser 1: ` +
          "en MSSQL son MERGE INTO con HOLDLOCK, que es lo que se bloquea entre si",
      );
      assert.strictEqual(telemetria.enVuelo, 0, "no puede quedar ninguna escritura en vuelo al terminar");
    } finally {
      restaurar();
    }
  }

  // 3. Se siembra exactamente la lista de metodos, con su etiqueta
  console.log("[STEP 3/4] The whole method list is seeded, in order...");
  {
    const { telemetria, restaurar } = instrumentarUpsert();
    try {
      await defaultMethods();
    } finally {
      restaurar();
    }
    const sembrados = telemetria.llamado.map((c) => c.payload);
    assert.strictEqual(sembrados.length, METODOS_ESPERADOS.length, "uno por metodo, sin duplicados");
    assert.deepStrictEqual(
      sembrados.map((p) => p.method),
      METODOS_ESPERADOS,
      "los metodos del seed, en el mismo orden de siempre",
    );
    for (const p of sembrados) {
      assert.strictEqual(p.label, p.method, `la etiqueta de ${p.method} es su propio nombre`);
    }
  }

  // 4. Un metodo que falla no se come a los demos, pero tampoco pasa desapercibido
  console.log("[STEP 4/4] One failing method does not stop the rest, and is reported...");
  {
    const { telemetria, restaurar } = instrumentarUpsert({ fallaPara: "PATCH" });
    let errores;
    try {
      errores = await capturandoErrores(() => defaultMethods());
    } finally {
      restaurar();
    }
    assert.strictEqual(
      telemetria.settled,
      METODOS_ESPERADOS.length,
      "los once metodos se intentan, tambien los que van despues del que falla",
    );
    assert.ok(
      errores.some((mensaje) => mensaje.includes("PATCH")),
      `el fallo de PATCH tiene que quedar en el log diciendo que metodo fallo; se registro: ${JSON.stringify(errores)}`,
    );
  }

  console.log("--- All Method Seed Tests Passed Successfully! ---");
}

runTests()
  .then(closeDb)
  .catch(async (err) => {
    console.error("\nMethod seed test suite failed with error:");
    console.error(err);
    await closeDb();
    process.exit(1);
  });
