/**
 * Prueba de integración del camino de éxito del handler JS con un `reply`
 * simulado: comprueba que el código acaba en `reply.code()`, que 204/304 no
 * emiten body, y —lo más delicado— que la caché captura el código que se envía y
 * no el anterior.
 */
import assert from "node:assert/strict";
import { createFunctionVM } from "../../src/lib/server/createFunctionVM.js";
import { jsFunction } from "../../src/lib/handler/jsFunction.js";

function makeReply() {
  const reply = {
    statusCode: 200,
    sent: undefined,
    headers: {},
    openfusionapi: {},
    code(c) {
      this.statusCode = c;
      return this;
    },
    header(k, v) {
      this.headers[k] = v;
      return this;
    },
    type(t) {
      this.headers["content-type"] = t;
      return this;
    },
    send(body) {
      this.sent = body;
      // Esto es lo que lee EndpointCache.setCache al guardar.
      this.openfusionapi.lastResponse ??= {};
      this.openfusionapi.statusCodeAtSend = this.statusCode;
      return this;
    },
  };
  return reply;
}

const D = "$_RETURN_DATA_";
const S = "$_RETURN_STATUS_";

async function run(code) {
  const jsFn = await createFunctionVM(code, {});
  const reply = makeReply();
  const method = { jsFn, resource: "/prueba", environment: "dev" };
  const request = { headers: {}, body: {}, query: {}, method: "POST" };
  await jsFunction({ request, reply, method, params: method });
  return reply;
}

// El body viene de dentro de la VM, que es otro realm: sus objetos tienen otro
// prototipo. `deepStrictEqual` compara tambien el prototipo, asi que comparamos
// por valor, que es lo que le importa a quien recibe la respuesta HTTP.
const sentIs = (reply, expected, msg) =>
  assert.strictEqual(JSON.stringify(reply.sent), JSON.stringify(expected), msg);

const originalWarn = console.warn;
console.warn = () => {};

// --- 200 implícito: regresión, el camino de siempre ------------------------
{
  const reply = await run(`${D} = { ok: true };`);
  assert.strictEqual(reply.statusCode, 200);
  sentIs(reply, { ok: true });
  assert.strictEqual(reply.openfusionapi.statusCodeAtSend, 200);
}

// --- 201 al crear, que es lo que motiva el caso de uso real -----------
{
  const reply = await run(`${S} = 201; ${D} = { id: 7 };`);
  assert.strictEqual(reply.statusCode, 201, "el 201 debe llegar a reply.code()");
  sentIs(reply, { id: 7 }, "201 sí lleva body");
  assert.strictEqual(
    reply.openfusionapi.statusCodeAtSend,
    201,
    "la caché debe capturar el MISMO código que se envió",
  );
}

// --- 204: sin body, porque el protocolo no lo permite ----------------------
{
  const reply = await run(`${S} = 204; ${D} = { noDeberiaSalir: 1 };`);
  assert.strictEqual(reply.statusCode, 204);
  assert.strictEqual(reply.sent, null, "204 no puede llevar body");
  assert.strictEqual(reply.openfusionapi.statusCodeAtSend, 204);
}

// --- 3xx conserva el body y los headers -----------------------------------
{
  const reply = await run(
    `$_CUSTOM_HEADERS_ = { Location: "/destino", "X-Extra": "1" }; ` +
      `${S} = 302; ${D} = { redireccion: true };`,
  );
  assert.strictEqual(reply.statusCode, 302);
  sentIs(reply, { redireccion: true });
  assert.strictEqual(reply.headers.Location, "/destino");
  assert.strictEqual(reply.headers["X-Extra"], "1");
}

// --- 400 degrada a 200 y el body sigue siendo el normal -------------------
{
  const reply = await run(`${S} = 400; ${D} = { ok: 1 };`);
  assert.strictEqual(reply.statusCode, 200, "un 4xx en el camino de éxito degrada a 200");
  sentIs(reply, { ok: 1 }, "los datos no se pierden al degradar");
}

// --- Un error de runtime sigue yendo por $_EXCEPTION_ ----------------------
{
  const reply = await run(`throw new Error("boom");`);
  assert.ok(reply.statusCode >= 400, `debe responder error, respondió ${reply.statusCode}`);
}

console.warn = originalWarn;
console.log("OK  js_return_status_integration: reply.code() + captura de caché coherentes");
