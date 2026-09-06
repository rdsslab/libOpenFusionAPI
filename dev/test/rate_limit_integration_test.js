/**
 * @file rate_limit_integration_test.js
 * @description Prueba de integración del rate limiting con el servicio de runtime:
 * compone EndpointRuntimeService con mocks ligeros y verifica el contrato end-to-end.
 *
 * El contrato que se protege aquí es el del cableado real:
 *   1. Los 401 de un endpoint se cuentan por IP (y IP+usuario) en onResponse.
 *   2. Al cruzar el umbral, la IP entra en lockout y se emite un log de "posible ataque".
 *   3. Antes de validar credenciales de nuevo, el preValidation responde 429 con
 *      Retry-After sin ejecutar check_auth.
 *   4. Superado el lockout, el tráfico vuelve a fluir.
 *
 * Sin ello, un atacante podría golpear /apiclient/login indefinidamente.
 */

import assert from "node:assert/strict";
import { EndpointRuntimeService } from "../../src/lib/server/runtime/EndpointRuntimeService.js";
import { RateLimitService } from "../../src/lib/server/runtime/RateLimitService.js";
import { getBasicUsernameFromRequest } from "../../src/lib/server/runtime/rateLimitPolicy.js";

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

function makeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

function makeRequest() {
  return {
    method: "GET",
    url: "/api/login",
    headers: {
      "ofapi-trace-id": "trace-1",
      authorization: `Basic ${Buffer.from("admin:secreto").toString("base64")}`,
      "user-agent": "test",
    },
    query: {},
  };
}

function makeReply() {
  return {
    statusCode: 200,
    sent: false,
    headers: {},
    openfusionapi: {},
    _payload: null,
    header(name, value) {
      this.headers[name] = value;
      return this;
    },
    code(status) {
      this.statusCode = status;
      return this;
    },
    send(payload) {
      this.sent = true;
      this._payload = payload;
      return this;
    },
    getHeaders() {
      return this.headers;
    },
  };
}

/**
 * Construye un EndpointRuntimeService con mocks. `authFailures` es el nº de
 * ejecuciones de `check_auth` antes de conceder acceso (simula los 401 de un login
 * con credenciales inválidas) o Infinity para fallar siempre.
 */
function buildRuntime({ clock, maxFailures = 3, authFailures = Infinity }) {
  let authCalls = 0;
  let possibleAttackLogs = [];
  let saveLogCalls = 0;

  const endpoints = {
    logPossibleAttack(_request, _reply, details) {
      possibleAttackLogs.push(details);
    },
    saveLog() {
      saveLogCalls += 1;
    },
    setCache() {},
    getEndpoint: async () => ({
      handler: {
        params: {
          enabled: true,
          access: 1,
          idapp: "app-test",
          idendpoint: "endpoint-login",
          environment: "prd",
          resource: "/api/login",
          method: "GET",
          price_by_request: 0,
          price_kb_request: 0,
          price_kb_response: 0,
        },
      },
    }),
  };

  const authService = {
    check_auth: async (handler, request, reply) => {
      authCalls += 1;
      if (authCalls <= authFailures) {
        reply.code(401).send({ error: "Invalid credentials" });
        return;
      }
      request.openfusionapi.user = { username: "admin" };
    },
  };

  const getIPFromRequest = () => "203.0.113.9";

  const rateLimitService = new RateLimitService({
    maxFailures,
    windowMs: 60_000,
    lockoutBaseMs: 1_000,
    lockoutMaxMs: 10_000,
    now: clock.now,
  });

  const runtime = new EndpointRuntimeService({
    serverApi: {},
    endpoints,
    getUUID: () => "trace-1",
    getURLParams: (_url) => ({ url_key: "app-test:/api/login/GET", app: "app-test" }),
    authService,
    runHandler: () => {},
    getIPFromRequest,
    emitEndpointEvent: () => {},
    authPolicy: () => true,
    rateLimitService,
    getBasicUsernameFromRequest,
  });

  return {
    runtime,
    endpoints,
    rateLimitService,
    countAuthCalls: () => authCalls,
    possibleAttackLogs: () => possibleAttackLogs,
    countSaveLogCalls: () => saveLogCalls,
  };
}

console.log("=== rate_limit_integration_test ===");

test("3 fallos seguidos de login bloquean la IP y loguean el ataque", async () => {
  const clock = makeClock(0);
  const { runtime, countAuthCalls, possibleAttackLogs, rateLimitService } =
    buildRuntime({ clock, maxFailures: 3 });

  // 3 requests fallidos → 401, contados
  for (let i = 0; i < 3; i++) {
    const req = makeRequest();
    const reply = makeReply();
    await runtime.preValidationService.preValidation(req, reply);
    assert.equal(reply.statusCode, 401, `request ${i + 1} debe ser 401`);
    runtime.requestFlowService.onResponse(req, reply);
  }

  // el 3º cruza el umbral → lockout + log de ataque
  assert.equal(rateLimitService.isBlocked("203.0.113.9", "admin").blocked, true);
  assert.equal(possibleAttackLogs().length, 1, "debe emittirse el log del umbral");
  assert.equal(possibleAttackLogs()[0].reason, "auth_failure_threshold");
  assert.equal(countAuthCalls(), 3);
});

test("el siguiente request recibe 429 con Retry-After sin ejecutar check_auth", async () => {
  const clock = makeClock(0);
  const { runtime, countAuthCalls, possibleAttackLogs } = buildRuntime({
    clock,
    maxFailures: 2,
  });

  for (let i = 0; i < 2; i++) {
    const req = makeRequest();
    const reply = makeReply();
    await runtime.preValidationService.preValidation(req, reply);
    runtime.requestFlowService.onResponse(req, reply);
  }
  assert.equal(countAuthCalls(), 2);

  // tercer request: bloqueado en preValidation antes de check_auth
  const req = makeRequest();
  const reply = makeReply();
  await runtime.preValidationService.preValidation(req, reply);

  assert.equal(reply.statusCode, 429);
  assert.equal(reply.headers["Retry-After"], 1, "Retry-After al menos 1s");
  assert.equal(countAuthCalls(), 2, "check_auth no debe ejecutarse en bloqueo");

  const lastLog = possibleAttackLogs().pop();
  assert.equal(lastLog.reason, "auth_rate_limit");
  assert.equal(lastLog.ip, "203.0.113.9");
  assert.equal(lastLog.username, "admin");
});

test("tras el lockout el tráfico vuelve a fluir automáticamente", async () => {
  const clock = makeClock(0);
  const { runtime, countAuthCalls } = buildRuntime({
    clock,
    maxFailures: 2,
    authFailures: 2, // los dos primeros fallan, el 3º concede acceso
  });

  for (let i = 0; i < 2; i++) {
    const req = makeRequest();
    const reply = makeReply();
    await runtime.preValidationService.preValidation(req, reply);
    runtime.requestFlowService.onResponse(req, reply);
  }

  // esperar más que la duración máxima del lockout (lockoutMaxMs = 10_000)
  clock.advance(11_000);

  const req = makeRequest();
  const reply = makeReply();
  await runtime.preValidationService.preValidation(req, reply);
  assert.equal(reply.statusCode, 200, "superado el lockout debe conceder acceso");
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);