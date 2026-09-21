/**
 * @file bot_config_hash_test.js
 * @description Pruebas del hash de configuración de los bots (configHash.js). No necesita
 * servidor ni BBDD: el módulo es puro, como failurePolicy.js.
 *
 * Protege el comportamiento que arregla el reinicio en bucles por cursores: un cambio de
 * valor en una AppVar de estado/cursor (escritas fuera de banda por las tareas de
 * intervalo) NO debe cambiar el hash ni reiniciar un bot en RUNNING; un cambio de token,
 * de code o de una AppVar de configuración SÍ debe reiniciarlo.
 */

import assert from "node:assert/strict";
import {
  buildBotConfigHash,
  isRuntimeStateVar,
} from "../../src/lib/server/bot-manager/configHash.js";

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

const TOKEN = "111111:FAKE-TOKEN-FOR-TESTING-ONLY";
const CODE = "$BOT.command('start', (ctx) => ctx.reply('hi'));";

const ENV_VARS = {
  $_VAR_TELEGRAM_TOKEN: TOKEN,
  $_VAR_ADMIN_GROUP_CHAT_ID: -100123456789,
  $_VAR_ALERT_4XX_THRESHOLD: 20,
  // Estado interno: los escriben las tareas de intervalo en cada escaneo.
  $_VAR_ADMIN_ALERT_CURSOR: "2026-09-21T20:01:00.000Z",
  $_VAR_GROUP_APP_CURSORS: { "-100123456789": "2026-09-21T20:00:00.000Z" },
  $_VAR_GROUP_APP_CHANGES_CURSOR: {},
  idapp: "cfcd2084-95d5-65ef-66e7-dff9f98764da",
  $_APP_VARS_: {
    $_VAR_ADMIN_ALERT_CURSOR: "2026-09-21T20:01:00.000Z",
    $_VAR_TELEGRAM_TOKEN: TOKEN,
  },
};

console.log("=== bot_config_hash_test ===");

console.log("\nisRuntimeStateVar — clasificación");

test("reconoce los sufijos de cursor en mayúsculas/minúsculas", () => {
  assert.equal(isRuntimeStateVar("$_VAR_ADMIN_ALERT_CURSOR"), true);
  assert.equal(isRuntimeStateVar("$_VAR_GROUP_APP_CURSORS"), true);
  assert.equal(isRuntimeStateVar("$_VAR_GROUP_APP_CHANGES_CURSOR"), true);
  assert.equal(isRuntimeStateVar("$_var_admin_alert_cursor"), true);
});

test("config vars normales no se clasifican como estado", () => {
  assert.equal(isRuntimeStateVar("$_VAR_TELEGRAM_TOKEN"), false);
  assert.equal(isRuntimeStateVar("$_VAR_ADMIN_GROUP_CHAT_ID"), false);
  assert.equal(isRuntimeStateVar("$_VAR_ALERT_4XX_THRESHOLD"), false);
});

test("entradas no string son falsy", () => {
  assert.equal(isRuntimeStateVar(null), false);
  assert.equal(isRuntimeStateVar(undefined), false);
  assert.equal(isRuntimeStateVar(""), false);
});

console.log("\nbuildBotConfigHash — estabilidad ante estado en ejecución");

test("un bump del cursor NO cambia el hash", () => {
  const before = buildBotConfigHash({ token: TOKEN, code: CODE, app_env_vars: ENV_VARS });
  const after = buildBotConfigHash({
    token: TOKEN,
    code: CODE,
    app_env_vars: {
      ...ENV_VARS,
      $_VAR_ADMIN_ALERT_CURSOR: "2026-09-21T20:06:00.000Z",
      $_VAR_GROUP_APP_CURSORS: { "-100123456789": "2026-09-21T20:05:00.000Z" },
    },
  });
  assert.equal(after, before);
});

test("bump del cursor dentro de $_APP_VARS_ NO cambia el hash", () => {
  const before = buildBotConfigHash({ token: TOKEN, code: CODE, app_env_vars: ENV_VARS });
  const after = buildBotConfigHash({
    token: TOKEN,
    code: CODE,
    app_env_vars: {
      ...ENV_VARS,
      $_APP_VARS_: { ...ENV_VARS.$_APP_VARS_, $_VAR_ADMIN_ALERT_CURSOR: "2026-09-21T20:09:00.000Z" },
    },
  });
  assert.equal(after, before);
});

test("el orden de las claves no afecta al hash", () => {
  const before = buildBotConfigHash({ token: TOKEN, code: CODE, app_env_vars: ENV_VARS });
  const reversed = {};
  for (const key of Object.keys(ENV_VARS).reverse()) reversed[key] = ENV_VARS[key];
  const after = buildBotConfigHash({ token: TOKEN, code: CODE, app_env_vars: reversed });
  assert.equal(after, before);
});

console.log("\nbuildBotConfigHash — cambios de configuración SÍ reinician");

test("un cambio de token cambia el hash", () => {
  const before = buildBotConfigHash({ token: TOKEN, code: CODE, app_env_vars: ENV_VARS });
  const after = buildBotConfigHash({
    token: "222222:OTHER-TOKEN",
    code: CODE,
    app_env_vars: ENV_VARS,
  });
  assert.notEqual(after, before);
});

test("un cambio de code cambia el hash", () => {
  const before = buildBotConfigHash({ token: TOKEN, code: CODE, app_env_vars: ENV_VARS });
  const after = buildBotConfigHash({
    token: TOKEN,
    code: "$BOT.command('start', (ctx) => ctx.reply('hello again'));",
    app_env_vars: ENV_VARS,
  });
  assert.notEqual(after, before);
});

test("un cambio de una AppVar de configuración cambia el hash", () => {
  const before = buildBotConfigHash({ token: TOKEN, code: CODE, app_env_vars: ENV_VARS });
  const after = buildBotConfigHash({
    token: TOKEN,
    code: CODE,
    app_env_vars: { ...ENV_VARS, $_VAR_ALERT_4XX_THRESHOLD: 123 },
  });
  assert.notEqual(after, before);
});

test("la misma entrada dos veces produce el mismo hash", () => {
  const a = buildBotConfigHash({ token: TOKEN, code: CODE, app_env_vars: ENV_VARS });
  const b = buildBotConfigHash({ token: TOKEN, code: CODE, app_env_vars: ENV_VARS });
  assert.equal(a, b);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);