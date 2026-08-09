/**
 * @file bot_failure_policy_test.js
 * @description Pruebas de la política de fallos de bots. No necesita servidor ni BBDD:
 * failurePolicy.js es un módulo puro, y esa es justamente la razón de que exista aparte.
 *
 * Lo que se protege aquí es la propiedad central del diseño: un fallo recuperable NUNCA
 * puede terminar deshabilitando un bot. Una regresión en la clasificación devolvería el
 * sistema al comportamiento viejo, donde un corte de red pasajero dejaba el bot apagado
 * hasta que alguien lo re-habilitara a mano.
 */

import assert from "node:assert/strict";
import {
  BACKOFF_TIER,
  FAILURE_CLASS,
  PERMANENT_DISABLE_ATTEMPTS,
  QUARANTINE_AFTER_ATTEMPTS,
  QUARANTINE_AFTER_ATTEMPTS_UNKNOWN,
  classifyBotFailure,
  isRecoverable,
  maxFastBackoffMs,
  nextBackoffMs,
  quarantineThresholdFor,
} from "../../src/lib/server/bot-manager/failurePolicy.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

console.log("=== bot_failure_policy_test ===");

console.log("\nclassifyBotFailure — fallos permanentes");

test("token revocado (401) es permanente", () => {
  assert.equal(
    classifyBotFailure({ errorType: "INVALID_TOKEN", status: 401, name: "GrammyError" }),
    FAILURE_CLASS.PERMANENT
  );
});

test("403/404 del proveedor es permanente aunque no venga errorType", () => {
  assert.equal(classifyBotFailure({ status: 403 }), FAILURE_CLASS.PERMANENT);
  assert.equal(classifyBotFailure({ status: 404 }), FAILURE_CLASS.PERMANENT);
});

test("código que no compila es permanente", () => {
  assert.equal(
    classifyBotFailure({ name: "SyntaxError", message: "Unexpected token" }),
    FAILURE_CLASS.PERMANENT
  );
  assert.equal(
    classifyBotFailure({ name: "ReferenceError", message: "foo is not defined" }),
    FAILURE_CLASS.PERMANENT
  );
});

test("código sin instancia $BOT es permanente", () => {
  assert.equal(
    classifyBotFailure({ message: "Code did not define a valid $BOT instance." }),
    FAILURE_CLASS.PERMANENT
  );
});

console.log("\nclassifyBotFailure — fallos recuperables");

test("HttpError de grammY es transitorio", () => {
  assert.equal(
    classifyBotFailure({ errorType: "CONNECTION_ERROR", name: "HttpError", status: 502 }),
    FAILURE_CLASS.TRANSIENT
  );
});

test("429 con rate limit es transitorio", () => {
  assert.equal(
    classifyBotFailure({ errorType: "RATE_LIMITED", status: 429, retry_after: 30 }),
    FAILURE_CLASS.TRANSIENT
  );
});

test("5xx del proveedor es transitorio", () => {
  assert.equal(classifyBotFailure({ status: 503 }), FAILURE_CLASS.TRANSIENT);
});

test("códigos de red de Node son transitorios", () => {
  for (const code of ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]) {
    assert.equal(
      classifyBotFailure({ code, message: "request failed" }),
      FAILURE_CLASS.TRANSIENT,
      `${code} debería ser transitorio`
    );
  }
});

test("un código de red en minúsculas también se reconoce", () => {
  assert.equal(classifyBotFailure({ code: "econnreset" }), FAILURE_CLASS.TRANSIENT);
});

console.log("\nclassifyBotFailure — sin clasificar");

test("un crash del worker queda como UNKNOWN", () => {
  assert.equal(
    classifyBotFailure({ errorType: "WORKER_CRASH", message: "worker died" }),
    FAILURE_CLASS.UNKNOWN
  );
});

test("un payload vacío no rompe la clasificación", () => {
  assert.equal(classifyBotFailure(undefined), FAILURE_CLASS.UNKNOWN);
  assert.equal(classifyBotFailure({}), FAILURE_CLASS.UNKNOWN);
});

console.log("\nInvariante: solo lo permanente deshabilita");

test("transitorio y desconocido son recuperables; permanente no", () => {
  assert.equal(isRecoverable(FAILURE_CLASS.TRANSIENT), true);
  assert.equal(isRecoverable(FAILURE_CLASS.UNKNOWN), true);
  assert.equal(isRecoverable(FAILURE_CLASS.PERMANENT), false);
});

test("ningún error de red o de proveedor se clasifica como permanente", () => {
  const recoverableSamples = [
    { errorType: "CONNECTION_ERROR" },
    { errorType: "RATE_LIMITED", status: 429 },
    { errorType: "PROVIDER_ERROR", status: 500 },
    { code: "EAI_AGAIN" },
    { name: "HttpError" },
    { name: "AbortError" },
    { message: "socket hang up" },
    { message: "getaddrinfo failed" },
  ];
  for (const sample of recoverableSamples) {
    assert.equal(
      isRecoverable(classifyBotFailure(sample)),
      true,
      `${JSON.stringify(sample)} nunca debe deshabilitar el bot`
    );
  }
});

test("un fallo sin clasificar escala a cuarentena antes que uno transitorio", () => {
  assert.equal(quarantineThresholdFor(FAILURE_CLASS.UNKNOWN), QUARANTINE_AFTER_ATTEMPTS_UNKNOWN);
  assert.equal(quarantineThresholdFor(FAILURE_CLASS.TRANSIENT), QUARANTINE_AFTER_ATTEMPTS);
  assert.ok(QUARANTINE_AFTER_ATTEMPTS_UNKNOWN < QUARANTINE_AFTER_ATTEMPTS);
});

test("el umbral de deshabilitado permanente da margen a un fallo aislado", () => {
  assert.ok(PERMANENT_DISABLE_ATTEMPTS >= 2);
});

console.log("\nnextBackoffMs");

test("crece de forma monótona hasta el techo", () => {
  // random = 0 aísla la parte fija y elimina el jitter de la comparación.
  const zero = () => 0;
  let previous = 0;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const delay = nextBackoffMs(attempt, BACKOFF_TIER.FAST, zero);
    assert.ok(delay >= previous, `intento ${attempt}: ${delay} < ${previous}`);
    previous = delay;
  }
});

test("nunca supera el techo del nivel rápido", () => {
  const one = () => 1;
  for (const attempt of [10, 50, 500, 1000]) {
    const delay = nextBackoffMs(attempt, BACKOFF_TIER.FAST, one);
    assert.ok(Number.isFinite(delay), `intento ${attempt} produjo ${delay}`);
    assert.ok(delay <= maxFastBackoffMs(), `intento ${attempt}: ${delay} > tope`);
  }
});

test("el jitter mantiene la espera entre la mitad y el total", () => {
  // Equal jitter: la mitad fija garantiza un espaciado mínimo, a diferencia del full
  // jitter, que puede devolver casi cero y volver a sincronizar a todos los bots.
  const base = nextBackoffMs(3, BACKOFF_TIER.FAST, () => 0);
  const max = nextBackoffMs(3, BACKOFF_TIER.FAST, () => 1);
  assert.ok(max > base, "el jitter debe producir variación");
  assert.equal(max, base * 2, "la mitad fija y la mitad aleatoria deben ser iguales");

  for (let i = 0; i < 200; i += 1) {
    const delay = nextBackoffMs(3, BACKOFF_TIER.FAST);
    assert.ok(delay >= base && delay <= max, `${delay} fuera de [${base}, ${max}]`);
  }
});

test("dos bots que fallan a la vez no reintentan en el mismo instante", () => {
  const samples = new Set();
  for (let i = 0; i < 100; i += 1) samples.add(nextBackoffMs(4, BACKOFF_TIER.FAST));
  assert.ok(samples.size > 50, `jitter insuficiente: solo ${samples.size} valores distintos`);
});

test("la cuarentena espera mucho más que el nivel rápido", () => {
  const zero = () => 0;
  assert.ok(
    nextBackoffMs(1, BACKOFF_TIER.QUARANTINE, zero) >
      nextBackoffMs(99, BACKOFF_TIER.FAST, zero),
    "el primer sondeo en cuarentena debe superar el techo del nivel rápido"
  );
});

test("la cuarentena sigue produciendo esperas finitas para siempre", () => {
  // Es la propiedad que permite la recuperación autónoma: el sondeo nunca se detiene.
  for (const attempt of [1, 10, 100, 10000]) {
    const delay = nextBackoffMs(attempt, BACKOFF_TIER.QUARANTINE);
    assert.ok(Number.isFinite(delay) && delay > 0, `intento ${attempt} produjo ${delay}`);
  }
});

test("un intento inválido no rompe el cálculo", () => {
  for (const attempt of [0, -5, undefined, NaN]) {
    const delay = nextBackoffMs(attempt, BACKOFF_TIER.FAST);
    assert.ok(Number.isFinite(delay) && delay > 0, `intento ${attempt} produjo ${delay}`);
  }
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
