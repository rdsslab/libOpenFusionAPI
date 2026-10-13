// Test puro de LogBuffer (sin servidor ni base de datos).
//
// Cubre el defecto de 13.12.9: cuando una fila hacía fallar su lote, el `catch`
// de `flush()` reencolaba TODO el buffer, incluidos los lotes ya confirmados, así
// que cada reintento reinsertaba copias con un `id` nuevo. Además, una fila que
// la base rechazaba siempre (p. ej. un `trace_id` que no es UUID) bloqueaba su
// lote y todos los posteriores para siempre.
import assert from "node:assert/strict";
import { LogBuffer } from "../../src/lib/timer/logBuffer.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FALLO - ${name}`);
    console.error(`         ${err?.stack || err}`);
  }
}

/**
 * Doble de `createLogEntriesBulk`: cada lote es una "transacción" que inserta
 * todas o ninguna fila. Rechaza el lote entero si contiene un `trace_id` no UUID,
 * igual que PostgreSQL con una columna UUID.
 */
function makeTable() {
  const table = [];
  return {
    table,
    flushFn: async (chunk) => {
      const bad = chunk.find((row) => !UUID_RE.test(row.trace_id));
      if (bad) {
        const err = new Error(
          `invalid input syntax for type uuid: "${bad.trace_id}"`
        );
        err.code = "22P02";
        throw err;
      }
      for (const row of chunk) table.push(row);
      return { success: true, inserted: chunk.length };
    },
  };
}

/** Silencia console.warn/error durante fn y devuelve los mensajes capturados. */
async function captureConsole(fn) {
  const messages = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (...args) => messages.push(args.map(String).join(" "));
  console.error = (...args) => messages.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
  return messages;
}

async function main() {
  console.log("=== LogBuffer test ===");

  await test("flush normal inserta cada log una sola vez", async () => {
    const { table, flushFn } = makeTable();
    const buf = new LogBuffer({ flushFn, flushIntervalMs: 1e9 });
    for (let n = 1; n <= 250; n++) buf.push({ n, trace_id: uuid(n) });
    const r = await buf.flush();
    assert.equal(r.success, true);
    assert.equal(r.inserted, 250);
    assert.equal(table.length, 250);
    assert.equal(new Set(table.map((row) => row.n)).size, 250);
  });

  await test(
    "una fila inválida no duplica lo ya insertado ni bloquea el resto",
    async () => {
      // Escenario del informe: 150 válidos + 1 venenoso, 10 ciclos con 5 nuevos.
      const { table, flushFn } = makeTable();
      const buf = new LogBuffer({
        flushFn,
        flushIntervalMs: 1e9,
        maxBatchSize: 100,
        maxBufferSize: 1e9,
      });

      const pushed = new Set();
      const push = (n, trace_id) => {
        pushed.add(n);
        buf.push({ n, trace_id });
      };

      for (let n = 1; n <= 150; n++) push(n, uuid(n));
      push(151, "mi-trace-123"); // fila venenosa

      let seq = 151;
      const messages = await captureConsole(async () => {
        for (let cycle = 0; cycle < 10; cycle++) {
          await buf.flush();
          for (let k = 0; k < 5; k++) {
            seq++;
            push(seq, uuid(seq));
          }
        }
        await buf.flush();
      });

      const counts = new Map();
      for (const row of table) counts.set(row.n, (counts.get(row.n) || 0) + 1);

      // Regresión central: NINGÚN log se inserta más de una vez.
      const duplicados = [...counts.values()].filter((c) => c > 1);
      assert.equal(duplicados.length, 0, "no debe haber filas duplicadas");
      assert.equal(Math.max(0, ...counts.values()), 1, "máximo 1 copia por log");

      // La fila venenosa no entra y se avisa de su descarte.
      assert.equal(counts.has(151), false, "la fila venenosa no debe insertarse");
      assert.ok(
        messages.some((m) => m.includes("rechazada por la base")),
        "debe avisarse de la fila descartada"
      );

      // Ningún log válido se pierde por detrás de la fila venenosa.
      const perdidos = [...pushed].filter((n) => n !== 151 && !counts.has(n));
      assert.deepEqual(perdidos, [], "no debe perderse ningún log válido");
      assert.equal(table.length, pushed.size - 1);
    }
  );

  await test(
    "un error transitorio reintenta sin reinsertar lo ya confirmado",
    async () => {
      const table = [];
      let caido = true;
      const flushFn = async (chunk) => {
        if (caido) {
          const err = new Error("connection refused");
          err.name = "SequelizeConnectionRefusedError";
          err.code = "ECONNREFUSED";
          throw err;
        }
        for (const row of chunk) table.push(row);
        return { success: true, inserted: chunk.length };
      };

      const buf = new LogBuffer({
        flushFn,
        flushIntervalMs: 1e9,
        maxBatchSize: 100,
        maxBufferSize: 1e9,
        onErrorRetryDelayMs: 1e9,
      });

      for (let n = 1; n <= 150; n++) buf.push({ n, trace_id: uuid(n) });

      await captureConsole(async () => {
        const r1 = await buf.flush();
        assert.equal(r1.success, false, "el flush debe reportar fallo transitorio");
        assert.equal(r1.buffered, 150, "no debe perderse nada al reintentar");
      });

      caido = false;
      for (let n = 151; n <= 155; n++) buf.push({ n, trace_id: uuid(n) });
      const r2 = await buf.flush();

      assert.equal(r2.success, true);
      const counts = new Map();
      for (const row of table) counts.set(row.n, (counts.get(row.n) || 0) + 1);
      assert.equal(table.length, 155, "deben insertarse los 155 logs");
      assert.equal(
        Math.max(0, ...counts.values()),
        1,
        "un reintento transitorio no debe duplicar"
      );
    }
  );

  await test("stop({ flush: true }) inserta lo pendiente", async () => {
    const { table, flushFn } = makeTable();
    const buf = new LogBuffer({ flushFn, flushIntervalMs: 1e9 });
    for (let n = 1; n <= 3; n++) buf.push({ n, trace_id: uuid(n) });
    await buf.stop({ flush: true });
    assert.equal(table.length, 3, "el flush final debe insertar los 3 logs");
  });

  await test("stop({ flush: false }) descarta lo pendiente", async () => {
    const { table, flushFn } = makeTable();
    const buf = new LogBuffer({ flushFn, flushIntervalMs: 1e9 });
    for (let n = 1; n <= 3; n++) buf.push({ n, trace_id: uuid(n) });
    await buf.stop({ flush: false });
    assert.equal(table.length, 0, "no debe insertarse nada");
  });

  await test(
    "el buffer no crece sin límite cuando los flush fallan siempre",
    async () => {
      const maxBufferSize = 50;
      const flushFn = async () => {
        const err = new Error("connection refused");
        err.name = "SequelizeConnectionRefusedError";
        throw err;
      };
      const buf = new LogBuffer({
        flushFn,
        flushIntervalMs: 1e9,
        maxBatchSize: 10,
        maxBufferSize,
        onErrorRetryDelayMs: 1e9,
      });

      const messages = await captureConsole(async () => {
        for (let n = 1; n <= 500; n++) {
          buf.push({ n, trace_id: uuid(n) });
          if (n % 5 === 0) await tick();
        }
        await tick();
        await buf.flush();
      });

      assert.ok(
        buf._buffer.length <= maxBufferSize,
        `el buffer debe acotarse a ${maxBufferSize}, quedó en ${buf._buffer.length}`
      );
      assert.ok(
        messages.some((m) => m.includes("se descartan los logs más antiguos")),
        "debe avisarse del recorte por límite de memoria"
      );
    }
  );

  console.log(failures === 0 ? "\nTODO OK" : `\n${failures} FALLO(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
