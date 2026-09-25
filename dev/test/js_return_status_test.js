import assert from "node:assert/strict";
import {
  resolveSuccessStatus,
  warnIfRedirectWithoutLocation,
} from "../../src/lib/handler/utils.js";

/**
 * H1: el handler JS solo podía responder 200 en el camino de éxito. Un receptor de
 * eventos necesita 201 cuando crea y 200 cuando todo eran duplicados, y no había
 * forma de expresarlo: los errores ya permitían cualquier código, solo el éxito
 * estaba fijo.
 *
 * Estos tests son puros: no levantan servidor ni VM.
 */

// --- El caso base: sin asignar la variable, 200 (regresión) ----------------
{
  for (const vacio of [undefined, null]) {
    const r = resolveSuccessStatus(vacio);
    assert.strictEqual(r.statusCode, 200, "sin $_RETURN_STATUS_ se responde 200");
    assert.strictEqual(r.sendsBody, true);
  }
  // Un 200 explícito es tan válido como no asignarlo.
  assert.strictEqual(resolveSuccessStatus(200).statusCode, 200);
}

// --- Los códigos que el caso de uso real necesita ---------------------------
{
  assert.strictEqual(resolveSuccessStatus(201).statusCode, 201, "201 al crear");
  assert.strictEqual(resolveSuccessStatus(202).statusCode, 202, "202 al encolar");
  assert.strictEqual(resolveSuccessStatus(203).statusCode, 203, "203 debe poder cachearse");
  assert.strictEqual(resolveSuccessStatus(206).statusCode, 206);
  assert.strictEqual(resolveSuccessStatus(301).statusCode, 301);
  assert.strictEqual(resolveSuccessStatus(302).statusCode, 302);
  assert.strictEqual(resolveSuccessStatus(399).statusCode, 399, "límite superior del rango");

  // Todos los de éxito llevan body.
  for (const code of [200, 201, 202, 203, 206, 301, 302, 399]) {
    assert.strictEqual(
      resolveSuccessStatus(code).sendsBody,
      true,
      `${code} debería llevar body`,
    );
  }
}

// --- 204 y 304 no admiten body: es el protocolo, no una preferencia ---------
{
  for (const code of [204, 304]) {
    const r = resolveSuccessStatus(code);
    assert.strictEqual(r.statusCode, code);
    assert.strictEqual(r.sendsBody, false, `${code} no puede llevar body`);
  }
}

// --- 4xx y 5xx se rechazan a propósito --------------------------------------
{
  // Deben salir por $_EXCEPTION_, que es el camino que arma buildErrorPayload con su
  // trace_id. Aceptarlos aquí daría dos formas de producir un error, y el cliente
  // no podría saber con cuál de las dos está lidiando.
  for (const code of [400, 401, 403, 404, 409, 422, 429]) {
    const r = resolveSuccessStatus(code);
    assert.strictEqual(r.statusCode, 200, `${code} debe degradar a 200`);
    assert.strictEqual(r.valid, false, `${code} no es un código de éxito válido`);
  }
  for (const code of [500, 502, 503, 599, 0, 100, 199, 400, 999, -1, 1000]) {
    const r = resolveSuccessStatus(code);
    assert.strictEqual(r.statusCode, 200, `${code} debe degradar a 200`);
    assert.strictEqual(r.valid, false);
  }
}

// --- Un valor mal escrito degrada a 200, no a 500 ---------------------------
{
  // Convertir un descuido en un 500 castiga al cliente por algo que no es suyo: el
  // endpoint hizo su trabajo y devolvió datos válidos, solo está mal escrito un
  // número. El warning es lo que permite enterarse del descuido.
  const invalidos = [
    "201",       // string: Number("201") daría 201, pero el contrato pide entero
    "abc",
    2.5,         // decimal
    NaN,
    Infinity,
    -Infinity,
    true,
    false,
    [],
    [201],
    {},
    () => 201,
  ];
  for (const v of invalidos) {
    const r = resolveSuccessStatus(v);
    assert.strictEqual(r.statusCode, 200, `${String(v)} debe degradar a 200`);
    assert.strictEqual(r.sendsBody, true);
  }
}

// --- Un 201 como string NO se acepta, a diferencia de un 201 numérico ------
{
  // La diferencia es deliberada: aceptar el string taparía el error de programación
  // detrás de un `Number()` que parece funcionar.
  assert.strictEqual(resolveSuccessStatus(201).statusCode, 201);
  assert.strictEqual(resolveSuccessStatus("201").statusCode, 200);
  assert.notStrictEqual(
    resolveSuccessStatus(201).statusCode,
    resolveSuccessStatus("201").statusCode,
  );
}

// --- Aviso de 3xx sin Location ----------------------------------------------
{
  const capturados = [];
  const originalWarn = console.warn;
  console.warn = (...args) => capturados.push(args.join(" "));

  try {
    // 3xx con Location: no se dice nada.
    warnIfRedirectWithoutLocation(302, new Map([["Location", "/x"]]), { endpoint: "e" });
    warnIfRedirectWithoutLocation(302, { Location: "/x" }, { endpoint: "e" });
    warnIfRedirectWithoutLocation(302, { location: "/x" }, { endpoint: "e" });
    assert.strictEqual(capturados.length, 0, "con Location no debe haber warning");

    // 3xx sin Location: sí, porque el cliente no tiene adónde ir.
    warnIfRedirectWithoutLocation(302, {}, { endpoint: "e" });
    warnIfRedirectWithoutLocation(302, new Map(), { endpoint: "e" });
    warnIfRedirectWithoutLocation(302, undefined, { endpoint: "e" });
    assert.strictEqual(capturados.length, 3, "sin Location debe haber warning");
    assert.ok(capturados.every((m) => m.includes("Location")));

    // 304 se salta: es un 3xx de caché, no una redirección.
    warnIfRedirectWithoutLocation(304, {}, { endpoint: "e" });
    assert.strictEqual(capturados.length, 3, "304 no es una redirección");

    // Los 2xx no se miran.
    warnIfRedirectWithoutLocation(201, {}, { endpoint: "e" });
    assert.strictEqual(capturados.length, 3);
  } finally {
    console.warn = originalWarn;
  }
}

// --- Un objeto con getters hostiles no debe tumbar la respuesta ------------
{
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const hostil = {
      get location() {
        throw new Error("getter hostil");
      },
    };
    assert.doesNotThrow(
      () => warnIfRedirectWithoutLocation(302, hostil, { endpoint: "e" }),
      "un getter que lanza no puede tumbar la respuesta",
    );
  } finally {
    console.warn = originalWarn;
  }
}

console.log("OK  js_return_status_test: rango 200-399, 204/304 sin body, fallback a 200");
