// Arranca el codigo del bot v225 en un contexto vm igual que el worker del
// runtime (grammy + $BOT_TOKEN + functionsVars + app vars) y comprueba que:
//   1. carga sin errores y sin pasarse del timeout de 10 s,
//   2. registra los handlers esperados (incluidos poll_answer y message:document),
//   3. en un servidor SIN agent kit (kit ausente) no truena: es el fallback.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BOT_PATH = process.env.BOT_CODE || "/tmp/ollama-bot-v225.js";
const code = fs.readFileSync(BOT_PATH, "utf8");

const grammyModule = require("/home/edwinspire/Desarrollo/OpenFusionAPI/node_modules/grammy");

const appVars = {
  '$_VAR_OLLAMA_URL': 'http://192.168.100.126:11434',
  '$_VAR_TTS_BASE_URL': 'http://192.168.100.126:8001',
  '$_VAR_WHISPER_API_URL': 'http://192.168.100.126:8080/v1/audio/transcriptions',
  '$_VAR_TTS_LANG': 'es',
  '$_VAR_DEFAULT_MODEL': 'qwen3.5:4b',
  '$_VAR_DEFAULT_VOICE': 'F3',
  '$_VAR_HISTORY_LIMIT': '12',
};

// Un $BOT falso que registra lo que el codigo pide, sin red.
// El worker envuelve el codigo y hace `globalThis.$BOT = new grammy.Bot(...)`,
// asi que hay que parchear el PROTOTIPO: sustituir solo la instancia del
// sandbox no serviria, porque el wrapper la reemplaza.
// grammY: `Bot extends Composer`; los filtros viven en Composer.prototype y
// `catch` esta en Bot.prototype.
const registered = { commands: [], on: [], callbackQuery: [], use: 0, catch: 0 };

const ComposerProto = grammyModule.Composer.prototype;
const BotProto = grammyModule.Bot.prototype;

function patchProto() {
  const original = {};
  for (const method of ['command', 'on', 'callbackQuery', 'hears', 'use']) {
    original[method] = ComposerProto[method];
  }
  original.catch = BotProto.catch;
  ComposerProto.command = function (name) { registered.commands.push(name); return this; };
  ComposerProto.on = function (filter) { registered.on.push(typeof filter === 'string' ? filter : '<regex>'); return this; };
  ComposerProto.callbackQuery = function (filter) { registered.callbackQuery.push(String(filter)); return this; };
  ComposerProto.hears = function (filter) { registered.on.push('hears:' + filter); return this; };
  ComposerProto.use = function () { registered.use++; return this; };
  BotProto.catch = function () { registered.catch++; return this; };
  return () => {
    for (const method of Object.keys(original)) {
      if (method === 'catch') BotProto.catch = original[method];
      else ComposerProto[method] = original[method];
    }
  };
}

async function runSandbox({ withKit }) {
  registered.commands.length = 0;
  registered.on.length = 0;
  registered.callbackQuery.length = 0;
  registered.use = 0;
  registered.catch = 0;

  const sandbox = {
    grammy: grammyModule,
    $BOT_TOKEN: '123456:ABC-DEF',
    $_APP_VARS_: appVars,
    ofapi: { log: () => {} },
    uFetch: class { async post() { return { ok: false, status: 500 }; } async get() { return { ok: false, status: 500 }; } },
    uFetchAutoEnv: { auto: () => ({ get: async () => ({ ok: false, status: 500 }) }) },
    Buffer,
    console,
    setTimeout,
    clearTimeout,
    fetch: globalThis.fetch,
    FormData: globalThis.FormData,
  };

  if (withKit) {
    const kit = await import("../../src/lib/server/agentKit/index.js");
    sandbox.agentKit = kit;
  }

  vm.createContext(sandbox);

  const wrapped = `
    globalThis.$BOT = new grammy.Bot($BOT_TOKEN);
    const $BOT = globalThis.$BOT;
${code}
  `;

  const started = Date.now();
  const restore = patchProto();
  try {
    const script = new vm.Script(wrapped);
    script.runInContext(sandbox, { timeout: 10000 });
  } finally {
    restore();
  }
  return { ms: Date.now() - started };
}

// ---- 1. Sin agent kit (servidor viejo): el fallback debe funcionar ----
{
  const { ms } = await runSandbox({ withKit: false });
  console.log('sin kit: cargo en ' + ms + ' ms');
  assert.ok(ms < 10000, 'carga dentro del timeout del worker');
  assert.ok(registered.commands.includes('encuesta'), '/encuesta registrado');
  assert.ok(registered.commands.includes('resultados'), '/resultados registrado');
  assert.ok(registered.commands.includes('proveedores'), '/proveedores registrado');
  assert.ok(registered.on.includes('message:document'), 'message:document registrado');
  assert.ok(registered.on.includes('message:poll'), 'message:poll registrado');
  assert.ok(registered.on.includes('poll_answer'), 'poll_answer registrado');
  assert.ok(registered.on.includes('message:text'), 'message:text registrado');
  assert.ok(registered.callbackQuery.some((c) => c.includes('poll:')), 'callbacks de poll registrados');
  assert.ok(registered.callbackQuery.includes('cfg:providers'), 'callback cfg:providers registrado');
  assert.equal(registered.use, 1, 'un middleware de autorizacion');
  assert.equal(registered.catch, 1, 'un manejador de errores global');
}

// ---- 2. Con agent kit (servidor nuevo): tambien debe cargar ----
{
  const { ms } = await runSandbox({ withKit: true });
  console.log('con kit: cargo en ' + ms + ' ms');
  assert.ok(ms < 10000, 'carga dentro del timeout del worker');
  assert.ok(registered.commands.includes('encuesta'));
  assert.ok(registered.on.includes('poll_answer'));
}

console.log(JSON.stringify({
  ok: true,
  checks: {
    loadsWithoutKit: true,
    loadsWithKit: true,
    commands: registered.commands,
    onEvents: registered.on,
    callbacks: registered.callbackQuery,
  },
}, null, 2));
