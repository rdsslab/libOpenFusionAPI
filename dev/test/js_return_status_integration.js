/**
 * Prueba de integración del camino de éxito del handler JS con un `reply`
 * simulado: comprueba que el código acaba en `reply.code()`, que 204/304 no
 * emiten body, y —lo más delicado— que la caché captura el código que se envía y
 * no el anterior.
 */
import assert from "node:assert/strict";
import { createFunctionVM } from "../../src/lib/server/createFunctionVM.js";
import { jsFunction } from "../../src/lib/handler/jsFunction.js";
import { closeDb } from "./close_db.js";

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
// El endpoint que NO asigna `$_RETURN_STATUS_` no debe avisar. El warning se
// silenciaba entero aquí, y con él se tapaba justo el defecto: el sandbox declara
// la variable para poder documentarla, así que si su valor por defecto no fuera
// "sin asignar", TODO endpoint JS que no usara `$_RETURN_STATUS_` emitía un
// «$_RETURN_STATUS_ = [object Object] ... Falling back to 200» por petición.
let warnings = [];
console.warn = (...args) => warnings.push(args.join(" "));

// --- 200 implícito: regresión, el camino de siempre ------------------------
{
  const reply = await run(`${D} = { ok: true };`);
  assert.strictEqual(reply.statusCode, 200);
  sentIs(reply, { ok: true });
  assert.strictEqual(reply.openfusionapi.statusCodeAtSend, 200);
  assert.deepStrictEqual(warnings, [], "sin asignar $_RETURN_STATUS_ no debe avisar");
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
  warnings = [];
  const reply = await run(`${S} = 400; ${D} = { ok: 1 };`);
  assert.strictEqual(reply.statusCode, 200, "un 4xx en el camino de éxito degrada a 200");
  sentIs(reply, { ok: 1 }, "los datos no se pierden al degradar");
  // El aviso sigue siendo obligatorio cuando el endpoint SÍ se equivoca: sin él,
  // degradar a 200 en silencio dejaría al autor sin enterarse.
  assert.ok(
    warnings.some((w) => w.includes("$_RETURN_STATUS_") && w.includes("400")),
    `un status inválido debe avisar, se capturó: ${JSON.stringify(warnings)}`,
  );
}

// --- Un error de runtime sigue yendo por $_EXCEPTION_ ----------------------
{
  const reply = await run(`throw new Error("boom");`);
  assert.ok(reply.statusCode >= 400, `debe responder error, respondió ${reply.statusCode}`);
}

console.warn = originalWarn;
console.log("OK  js_return_status_integration: reply.code() + captura de caché coherentes");

// La suite pasa todas sus aserciones y aun asi el proceso no salia: `jsFunction`
// arrastra `db/sequelize.js`, y su pool mantiene el event loop vivo contra un
// motor de red. Con SQLite no se nota, porque ahi el pool esta en memoria.
await closeDb();
