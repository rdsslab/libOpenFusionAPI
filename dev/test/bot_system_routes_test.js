/**
 * @file bot_system_routes_test.js
 * @description Verificación estática de las rutas internas que el bot de Telegram
 * invoca contra la app `system`. No necesita servidor ni BBDD: lee el código fuente
 * del bot directamente.
 *
 * Protege la regresión de /listapps y /myapps: el bot llamaba a `/api/app/list`
 * (ruta inexistente → 404 → catálogo vacío → "There are no applications in this
 * server yet."). La ruta real y ligera es `/api/apps/catalog` (POST).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const BOT_SOURCE = readFileSync(
  new URL(
    "../../src/lib/server/functions/system/prd/user/systemBot.telegram.js",
    import.meta.url,
  ),
  "utf8",
);

test("bot no llama a la ruta inexistente /api/app/list", () => {
  assert.ok(
    !BOT_SOURCE.includes('"/api/app/list"'),
    'systemBot.telegram.js todavía referencia "/api/app/list"',
  );
});

test("getAppsIndex usa la ruta real de catálogo /api/apps/catalog", () => {
  assert.ok(
    BOT_SOURCE.includes('api("/api/apps/catalog", "post"'),
    'getAppsIndex no usa el endpoint /api/apps/catalog',
  );
});

console.log(
  `\nbot_system_routes_test: ${passed} passed, ${failed} failed${failed ? "" : " ✅"}\n`,
);
process.exit(failed ? 1 : 0);