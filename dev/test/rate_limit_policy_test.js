/**
 * @file rate_limit_policy_test.js
 * @description Pruebas del rate limiting de autenticación. No necesita servidor ni
 * BBDD: rateLimitPolicy.js y RateLimitService.js son módulos puros.
 *
 * Lo que se protege aquí es la propiedad central del diseño: un atacante que falla
 * credenciales repetidamente termina en lockout con backoff exponencial, y el bloqueo
 * se decide ANTES de volver a comparar las credenciales. Una regresión que devolviera
 * el sistema al comportamiento de "intenta mil veces sin consecuencias" dejaría el
 * login abierto a fuerza bruta.
 */

import assert from "node:assert/strict";
import {
  AUTH_MAX_FAILURES_DEFAULT,
  AUTH_LOCKOUT_BASE_MS_DEFAULT,
  AUTH_LOCKOUT_MAX_MS_DEFAULT,
  lockoutDurationMs,
  isEntryExpired,
  getBasicUsernameFromRequest,
} from "../../src/lib/server/runtime/rateLimitPolicy.js";
import { RateLimitService } from "../../src/lib/server/runtime/RateLimitService.js";

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

// ────────────────────────────────────────────────────────────
// Harness: reloj inyectado para no depender de Date.now()
// ────────────────────────────────────────────────────────────
function makeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

// ────────────────────────────────────────────────────────────
// policy pura
// ────────────────────────────────────────────────────────────

test("lockoutDurationMs crece exponencialmente desde la base", () => {
  assert.equal(lockoutDurationMs(0), AUTH_LOCKOUT_BASE_MS_DEFAULT);
  assert.equal(lockoutDurationMs(1), AUTH_LOCKOUT_BASE_MS_DEFAULT);
  assert.equal(
    lockoutDurationMs(2),
    AUTH_LOCKOUT_BASE_MS_DEFAULT * 2
  );
  assert.equal(
    lockoutDurationMs(3),
    AUTH_LOCKOUT_BASE_MS_DEFAULT * 4
  );
});

test("lockoutDurationMs respeta el techo configurado", () => {
  const big = lockoutDurationMs(100, {
    baseMs: 1000,
    maxMs: 3000,
  });
  assert.equal(big, 3000);
});

test("lockoutDurationMs es siempre finito incluso con rachas enormes", () => {
  for (const n of [1000, 1000000, 2 ** 40]) {
    const d = lockoutDurationMs(n);
    assert.ok(Number.isFinite(d) && d > 0, `n=${n} produjo ${d}`);
    assert.ok(d <= AUTH_LOCKOUT_MAX_MS_DEFAULT, `n=${n} superó el techo`);
  }
});

test("isEntryExpired compara contra lastAt", () => {
  const entry = { lastAt: 1000 };
  assert.equal(isEntryExpired(entry, 1000 + 59999, 60000), false);
  assert.equal(isEntryExpired(entry, 1000 + 60001, 60000), true);
});

test("getBasicUsernameFromRequest extrae el usuario de Basic auth", () => {
  assert.equal(
    getBasicUsernameFromRequest({
      headers: {
        authorization: `Basic ${Buffer.from("admin:secreto").toString("base64")}`,
      },
    }),
    "admin"
  );
});

test("getBasicUsernameFromRequest ignora Bearer y credenciales ausentes", () => {
  assert.equal(getBasicUsernameFromRequest({ headers: { authorization: "Bearer abc" } }), undefined);
  assert.equal(getBasicUsernameFromRequest({ headers: {} }), undefined);
  assert.equal(getBasicUsernameFromRequest({}), undefined);
});

// ────────────────────────────────────────────────────────────
// RateLimitService
// ────────────────────────────────────────────────────────────

test("registra fallos y no bloquea por debajo del umbral", () => {
  const clock = makeClock(0);
  const svc = new RateLimitService({
    maxFailures: 5,
    windowMs: 60000,
    lockoutBaseMs: 1000,
    lockoutMaxMs: 10000,
    now: clock.now,
  });

  let last = null;
  for (let i = 0; i < 4; i++) {
    last = svc.recordFailure("10.0.0.1");
  }

  assert.equal(last.blocked, false);
  assert.equal(svc.isBlocked("10.0.0.1").blocked, false);
});

test("cruzar el umbral activa el lockout y devuelve retryAfterMs positivo", () => {
  const clock = makeClock(0);
  const svc = new RateLimitService({
    maxFailures: 3,
    windowMs: 60000,
    lockoutBaseMs: 1000,
    lockoutMaxMs: 10000,
    now: clock.now,
  });

  svc.recordFailure("10.0.0.1");
  const second = svc.recordFailure("10.0.0.1");
  assert.equal(second.blocked, false);

  const third = svc.recordFailure("10.0.0.1");
  assert.equal(third.blocked, true);
  assert.ok(third.retryAfterMs > 0, "retryAfterMs debe ser positivo tras el lockout");
  assert.equal(third.failures, 3);
});

test("una IP no bloquea a otra IP", () => {
  const clock = makeClock(0);
  const svc = new RateLimitService({
    maxFailures: 2,
    now: clock.now,
  });

  svc.recordFailure("10.0.0.1");
  svc.recordFailure("10.0.0.1");

  assert.equal(svc.isBlocked("10.0.0.1").blocked, true);
  assert.equal(svc.isBlocked("10.0.0.2").blocked, false);
});

test("el lockout caduca y deja de bloquear", () => {
  const clock = makeClock(0);
  const svc = new RateLimitService({
    maxFailures: 2,
    windowMs: 60000,
    lockoutBaseMs: 1000,
    lockoutMaxMs: 10000,
    now: clock.now,
  });

  svc.recordFailure("10.0.0.1");
  svc.recordFailure("10.0.0.1");
  assert.equal(svc.isBlocked("10.0.0.1").blocked, true);

  clock.advance(10 * 1000 + 1);
  assert.equal(svc.isBlocked("10.0.0.1").blocked, false);
});

test("los fallos antiguos fuera de la ventana no cuentan", () => {
  const clock = makeClock(0);
  const svc = new RateLimitService({
    maxFailures: 3,
    windowMs: 10000,
    now: clock.now,
  });

  svc.recordFailure("10.0.0.1");
  clock.advance(11 * 1000);
  svc.recordFailure("10.0.0.1");
  svc.recordFailure("10.0.0.1");

  // el primero ya salió de la ventana: quedan 2, no 3 → sin lockout
  assert.equal(svc.isBlocked("10.0.0.1").blocked, false);
});

test("el backoff se alarga con rachas repetidas después de cada caducidad", () => {
  const clock = makeClock(0);
  const svc = new RateLimitService({
    maxFailures: 2,
    windowMs: 60000,
    lockoutBaseMs: 1000,
    lockoutMaxMs: 600000,
    now: clock.now,
  });

  const first = svc.recordFailure("10.0.0.1", "lazo");
  svc.recordFailure("10.0.0.1", "lazo");
  const firstLock = svc.recordFailure("10.0.0.1", "lazo");

  clock.advance(firstLock.retryAfterMs + 1);
  svc.recordFailure("10.0.0.1", "lazo");
  svc.recordFailure("10.0.0.1", "lazo");
  const secondLock = svc.recordFailure("10.0.0.1", "lazo");

  assert.ok(secondLock.retryAfterMs > firstLock.retryAfterMs, "el 2º lockout debe durar más");
  assert.equal(first.blocked, false);
});

test("el prune elimina entradas sin actividad", () => {
  const clock = makeClock(0);
  const svc = new RateLimitService({
    maxFailures: 5,
    windowMs: 10000,
    pruneAgeMs: 5000,
    now: clock.now,
  });

  svc.recordFailure("10.0.0.1");
  clock.advance(6000);
  svc.prune();
  assert.equal(svc.size, 0);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);