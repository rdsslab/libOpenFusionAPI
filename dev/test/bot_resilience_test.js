/**
 * @file bot_resilience_test.js
 * @description Prueba de extremo a extremo de la política de resiliencia de bots contra
 * un servidor real. Requiere el servidor en http://localhost:3000 (lo arranca dev/test/index.js).
 *
 * Cubre las dos rutas que el diseño separa:
 *
 * 1. Fallo PERMANENTE (código que no compila): el bot se deshabilita tras 3 intentos con
 *    `disabled_by = 'system'`, y al corregir el código se re-habilita SOLO, sin que nadie
 *    llame a enable_disable_bot.
 * 2. Fallo RECUPERABLE (no se alcanza la API del proveedor): el bot NUNCA se deshabilita.
 *    Queda en BACKOFF/QUARANTINED con `next_retry_at` y sigue reintentando.
 *
 * El punto 2 es exactamente el escenario que motivó el cambio: antes, un corte de red
 * pasajero terminaba apagando el bot y exigía intervención manual.
 */

import assert from "node:assert/strict";

const BASE_URL = "http://localhost:3000";
const BASIC_AUTH = "Basic " + Buffer.from("admin:admin@admin").toString("base64");

let passed = 0;
let failed = 0;

/** idapp de la aplicación donde se crean los bots de prueba; se resuelve en el login. */
let targetIdApp = null;
/** Bearer token de la sesión admin. */
let bearer = null;

async function call(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: bearer ? `Bearer ${bearer}` : BASIC_AUTH,
      // Declarar JSON sin cuerpo hace que Fastify responda 400 al intentar parsearlo.
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function getBot(idbot) {
  const { data } = await call(`/api/system/bots/prd?idbot=${idbot}`);
  return data?.data?.toJSON ? data.data.toJSON() : data?.data;
}

/** Espera a que un bot cumpla una condición, sondeando hasta agotar el plazo. */
async function waitForBot(idbot, predicate, { timeoutMs, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await getBot(idbot);
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `Timeout esperando ${label}. Último estado: ` +
      JSON.stringify({
        enabled: last?.enabled,
        runtime_status: last?.runtime_status,
        failure_count: last?.failure_count,
        last_error_type: last?.last_error_type,
        disabled_by: last?.disabled_by,
        next_retry_at: last?.next_retry_at,
      })
  );
}

async function test(name, fn) {
  process.stdout.write(`  … ${name}\n`);
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

const createdBots = [];

async function createBot(name, code, token = "111111:FAKE-TOKEN-FOR-TESTING-ONLY") {
  const { status, data } = await call("/api/system/bots/prd", {
    method: "POST",
    body: JSON.stringify({
      idapp: targetIdApp,
      name,
      description: "temporary bot created by bot_resilience_test.js",
      provider: "telegram",
      environment: "prd",
      token,
      code,
    }),
  });
  assert.equal(status, 200, `create ${name} devolvió ${status}: ${JSON.stringify(data)}`);
  const idbot = data?.data?.idbot;
  assert.ok(idbot, `create ${name} no devolvió idbot`);
  createdBots.push(idbot);
  return idbot;
}

/** Inicia sesión como admin y resuelve la app donde se crearán los bots de prueba. */
async function authenticate() {
  const login = await call("/api/system/system/login/prd", { method: "POST" });
  assert.equal(login.status, 200, `login devolvió ${login.status}`);
  assert.ok(login.data?.token, "el login no devolvió token");
  bearer = login.data.token;

  const apps = await call("/api/system/api/apps/catalog/prd", {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(apps.status, 200, `catálogo de apps devolvió ${apps.status}`);
  const demo = (apps.data || []).find((a) => a.app === "demo") || (apps.data || [])[0];
  assert.ok(demo?.idapp, "no se encontró ninguna aplicación donde crear los bots");
  targetIdApp = demo.idapp;
}

async function main() {
  console.log("--- Bot resilience (backoff / quarantine / auto-recovery) ---");
  await authenticate();

  // ── 1. Fallo permanente: código que no compila ──────────────────────────────
  await test(
    "código inválido deshabilita el bot como 'system' tras varios intentos",
    async () => {
      const idbot = await createBot(
        `resilience_permanent_${Date.now()}`,
        "$BOT.command('start', (ctx) => { ctx.reply('hi') " // paréntesis sin cerrar
      );

      const bot = await waitForBot(
        idbot,
        (b) => b.runtime_status === "DISABLED_ERROR",
        { timeoutMs: 180000, label: "runtime_status = DISABLED_ERROR" }
      );

      assert.equal(bot.enabled, false, "un fallo permanente debe apagar el bot");
      assert.equal(bot.disabled_by, "system", "debe quedar marcado como apagado por el sistema");
      assert.ok(bot.disabled_reason, "debe registrarse el motivo del apagado");
      assert.equal(bot.last_error_type, "CODE_ERROR", `error_type inesperado: ${bot.last_error_type}`);
      assert.ok(bot.failure_count >= 3, `failure_count = ${bot.failure_count}, se esperaban >= 3`);
    }
  );

  // ── 2. Corregir la causa re-habilita el bot sin intervención ────────────────
  await test("corregir el código re-habilita el bot automáticamente", async () => {
    const idbot = createdBots[createdBots.length - 1];
    const before = await getBot(idbot);
    assert.equal(before.enabled, false, "precondición: el bot debe estar apagado");

    const { status, data } = await call("/api/system/bots/prd", {
      method: "POST",
      body: JSON.stringify({
        idbot,
        idapp: targetIdApp,
        name: before.name,
        provider: "telegram",
        environment: "prd",
        token: before.token || "111111:FAKE-TOKEN-FOR-TESTING-ONLY",
        code: "$BOT.command('start', (ctx) => { ctx.reply('hi'); });",
      }),
    });
    assert.equal(status, 200, `upsert devolvió ${status}: ${JSON.stringify(data)}`);

    const after = await getBot(idbot);
    assert.equal(after.enabled, true, "corregir el código debe re-habilitar el bot");
    assert.equal(after.disabled_by, null, "disabled_by debe limpiarse");
    assert.ok(data?.info, "la respuesta debe explicar la re-habilitación automática");
  });

  // ── 3. Fallo recuperable: nunca deshabilita ────────────────────────────────
  await test(
    "un fallo de red deja el bot habilitado, en BACKOFF y con próximo reintento",
    async () => {
      // El código es válido; el arranque falla al no poder validar el token contra la
      // API de Telegram (host bloqueado o token falso sin salida a Internet).
      const idbot = await createBot(
        `resilience_recoverable_${Date.now()}`,
        "$BOT.command('start', (ctx) => { ctx.reply('hi'); });"
      );

      const bot = await waitForBot(
        idbot,
        (b) => b.runtime_status === "BACKOFF" || b.runtime_status === "QUARANTINED",
        { timeoutMs: 120000, label: "runtime_status = BACKOFF/QUARANTINED" }
      );

      // La invariante que motivó todo el cambio.
      assert.equal(bot.enabled, true, "un fallo recuperable NUNCA debe deshabilitar el bot");
      assert.notEqual(bot.disabled_by, "system", "no debe marcarse como apagado por el sistema");
      assert.ok(bot.next_retry_at, "debe publicarse cuándo se reintenta");
      assert.ok(
        new Date(bot.next_retry_at).getTime() > Date.now() - 60000,
        "next_retry_at debe apuntar al futuro cercano"
      );
      assert.ok(bot.last_error_type, "debe registrarse el tipo de error");
      console.log(
        `    (estado observado: ${bot.runtime_status}, error ${bot.last_error_type}, ` +
          `intento ${bot.failure_count}, próximo reintento ${bot.next_retry_at})`
      );
    }
  );

  // ── 4. El estado observado se expone en el catálogo ────────────────────────
  await test("list_bots expone las columnas de salud", async () => {
    const { data } = await call(`/api/system/bots/prd?idapp=${targetIdApp}`);
    const rows = data?.data || [];
    assert.ok(rows.length > 0, "debería haber bots en el catálogo");
    const sample = rows[0];
    for (const field of [
      "runtime_status",
      "failure_count",
      "last_error_type",
      "next_retry_at",
      "disabled_by",
    ]) {
      assert.ok(field in sample, `falta el campo ${field} en list_bots`);
    }
  });

  // Limpieza: los bots de prueba no deben quedar reintentando para siempre.
  for (const idbot of createdBots) {
    await call(`/api/system/bots/prd?idbot=${idbot}`, { method: "DELETE" }).catch(() => {});
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fallo no controlado:", error);
  process.exit(1);
});
