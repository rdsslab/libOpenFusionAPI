import assert from "node:assert/strict";
import {
  MAX_SCHEDULER_DELAY_MS,
  MIN_SCHEDULER_DELAY_MS,
  computeBackoffNextRun,
  computeNextRun,
  computeSchedulerDelay,
  describeTaskTimeoutMismatch,
  getIntervalSeconds,
  shouldDisableForFailures,
  validateCron,
} from "../../src/lib/timer/schedule.js";

const from = new Date("2026-08-15T12:00:00.000Z");

assert.strictEqual(getIntervalSeconds({ interval: 90 }), 90);
assert.strictEqual(
  computeNextRun({ schedule_mode: "interval", interval: 90 }, { from }).toISOString(),
  "2026-08-15T12:01:30.000Z",
);

assert.deepStrictEqual(validateCron("0 7 * * 1-5", "America/Guayaquil"), {
  valid: true,
});
assert.strictEqual(validateCron("not-a-cron", "America/Guayaquil").valid, false);
assert.deepStrictEqual(validateCron("0 7 * * 1-5", "Invalid/Zone"), {
  valid: false,
  error: "Invalid IANA timezone: Invalid/Zone",
});

assert.strictEqual(computeSchedulerDelay(null, from), MAX_SCHEDULER_DELAY_MS);
assert.strictEqual(
  computeSchedulerDelay(new Date(from.getTime() + 5000), from),
  5000,
);
assert.strictEqual(
  computeSchedulerDelay(new Date(from.getTime() - 1000), from),
  MIN_SCHEDULER_DELAY_MS,
);
assert.strictEqual(
  computeSchedulerDelay(new Date(from.getTime() + 120000), from),
  MAX_SCHEDULER_DELAY_MS,
);

// ---------------------------------------------------------------------------
// H7: política de fallos por tarea.
//
// El defecto era doble. `shouldDisableForFailures` resolvía el tope con
// `max > 0 ? max : 10`, así que un `max_failed_attempts: 0` — que un usuario
// escribe queriendo decir "nunca deshabilitar" — devolvía el comportamiento
// contrario, sin aviso. Y el backoff no tenía forma de desactivarse: una tarea de
// monitoreo de 2 min que fallaba 3 veces pasaba a 8, 16, 32… hasta 1 h, justo
// cuando más falta hacía.
// ---------------------------------------------------------------------------
{
  // El 0 significa "nunca deshabilitar", incluso con muchos fallos acumulados.
  assert.strictEqual(shouldDisableForFailures({ max_failed_attempts: 0 }, 0), false);
  assert.strictEqual(shouldDisableForFailures({ max_failed_attempts: 0 }, 1), false);
  assert.strictEqual(shouldDisableForFailures({ max_failed_attempts: 0 }, 9999), false);
  // Comportamiento previo conservado para los valores positivos y el default.
  assert.strictEqual(shouldDisableForFailures({ max_failed_attempts: 3 }, 2), false);
  assert.strictEqual(shouldDisableForFailures({ max_failed_attempts: 3 }, 3), true);
  assert.strictEqual(shouldDisableForFailures({ max_failed_attempts: 3 }, 4), true);
  assert.strictEqual(shouldDisableForFailures({}, 9), false);
  assert.strictEqual(shouldDisableForFailures({}, 10), true);
  assert.strictEqual(shouldDisableForFailures({}, 11), true);
  // null / indefinido siguen significando "sin configurar" -> 10.
  assert.strictEqual(shouldDisableForFailures({ max_failed_attempts: null }, 10), true);
  assert.strictEqual(shouldDisableForFailures({ max_failed_attempts: null }, 9), false);
}

// El backoff sigue duplicando con los valores por defecto.
{
  const task = { interval: 120, schedule_mode: "interval" };
  const delay = (attempts, t = task) =>
    (computeBackoffNextRun(t, attempts, { from }) - from) / 1000;

  assert.strictEqual(delay(1), 120);
  assert.strictEqual(delay(2), 240);
  assert.strictEqual(delay(3), 480);
  // El tope global de 1 h corta la serie.
  assert.strictEqual(delay(20), 3600);
}

// `backoff_enabled: false` conserva el intervalo aunque la tarea falle.
{
  const task = { interval: 120, schedule_mode: "interval", backoff_enabled: false };
  const delay = (attempts) =>
    (computeBackoffNextRun(task, attempts, { from }) - from) / 1000;

  assert.strictEqual(delay(1), 120);
  assert.strictEqual(delay(2), 120);
  assert.strictEqual(delay(9), 120);
  assert.strictEqual(delay(50), 120);

  // La ventana horaria se sigue respetando: con el backoff apagado, el candidate
  // es ahora+intervalo y si cae fuera de la ventana se ajusta a la apertura.
  const atNight = new Date("2026-08-15T03:00:00.000Z");
  const windowed = {
    interval: 120,
    schedule_mode: "interval",
    backoff_enabled: false,
    window_start: "09:00",
    window_end: "17:00",
    timezone: "UTC",
  };
  const w = computeBackoffNextRun(windowed, 5, { from: atNight });
  assert.strictEqual(w.toISOString(), "2026-08-15T09:00:00.000Z");
}

// `undefined` y `null` significan "no configurado" y mantienen el backoff: una// tarea existente no debe cambiar de comportamiento al leerse sin la columna.
{
  const task = { interval: 120, schedule_mode: "interval" };
  assert.strictEqual(
    (computeBackoffNextRun({ ...task, backoff_enabled: undefined }, 3, { from }) - from) / 1000,
    480,
  );
  assert.strictEqual(
    (computeBackoffNextRun({ ...task, backoff_enabled: null }, 3, { from }) - from) / 1000,
    480,
  );
  // Las formas textuales que llegan desde un formulario o un query string.
  for (const falsey of ["false", "FALSE", "0", "no", "off", false]) {
    assert.strictEqual(
      (computeBackoffNextRun({ ...task, backoff_enabled: falsey }, 3, { from }) - from) / 1000,
      120,
      `backoff_enabled=${falsey} debería desactivar el backoff`,
    );
  }
  for (const truthy of ["true", "1", "yes", "on", true]) {
    assert.strictEqual(
      (computeBackoffNextRun({ ...task, backoff_enabled: truthy }, 3, { from }) - from) / 1000,
      480,
      `backoff_enabled=${truthy} debería mantener el backoff`,
    );
  }
}

// `max_backoff_seconds` sustituye al tope global, y se acota para atrapar erratas.
{
  const base = { interval: 120, schedule_mode: "interval" };
  const delay = (attempts, t) =>
    (computeBackoffNextRun(t, attempts, { from }) - from) / 1000;

  assert.strictEqual(delay(20, { ...base, max_backoff_seconds: 7200 }), 7200);
  assert.strictEqual(delay(2, { ...base, max_backoff_seconds: 7200 }), 240);
  // 30 días es el tope duro; un 10^9 no produce un next_run absurdo.
  assert.strictEqual(delay(20, { ...base, max_backoff_seconds: 1e9 }), 2592000);
  // Valores sin sentido caen al tope global en vez de romper el cálculo.
  for (const bad of [0, -1, null, "abc"]) {
    assert.strictEqual(
      delay(20, { ...base, max_backoff_seconds: bad }),
      3600,
      `max_backoff_seconds=${bad} debería caer al tope global`,
    );
  }
}

// ---------------------------------------------------------------------------
// H9: coherencia entre `exec_time_limit` y el timeout del endpoint.
//
// El detalle que se pierde de vista: hay DOS relojes. `exec_time_limit` lo impone
// el worker a la llamada HTTP y es lo que usa el reaper; el `timeout` del endpoint
// lo impone el endpoint por dentro. Si el segundo es menor, el primero nunca es el
// que corta nada, pero la tarea sigue pareciendo protegida.
//
// ---------------------------------------------------------------------------
{
  // La situación sana: el presupuesto de la tarea supera al timeout del endpoint,
  // así que hay margen real para los dos relojes y `exec_time_limit` funciona como
  // la red de seguridad que aparenta. Sin aviso.
  assert.equal(
    describeTaskTimeoutMismatch({ exec_time_limit: 60 }, 120),
    null,
    "exec_time_limit por debajo del timeout del endpoint: correcto",
  );
  assert.equal(
    describeTaskTimeoutMismatch({ exec_time_limit: 30 }, 120),
    null,
    "con margen amplio tampoco hay nada que decir",
  );

  // La incoherencia que sí importa: el endpoint siempre corta antes.
  const tooBig = describeTaskTimeoutMismatch({ exec_time_limit: 300 }, 30);
  assert.ok(tooBig, "exec_time_limit por encima del timeout del endpoint debe avisar");
  assert.match(tooBig, /300s/);
  assert.match(tooBig, /30s/);
  assert.match(tooBig, /can never be the one that stops a run/i);

  const equal = describeTaskTimeoutMismatch({ exec_time_limit: 30 }, 30);
  assert.ok(equal, "empate también debe avisar: los dos relojes disparan a la vez");
  assert.match(equal, /equals the endpoint timeout/);

  // Datos que no permiten comparar: no se inventa un aviso.
  assert.equal(describeTaskTimeoutMismatch({ exec_time_limit: 30 }, undefined), null);
  assert.equal(describeTaskTimeoutMismatch({ exec_time_limit: 30 }, null), null);
  assert.equal(describeTaskTimeoutMismatch({ exec_time_limit: 30 }, 0), null);
  assert.equal(describeTaskTimeoutMismatch({ exec_time_limit: 30 }, -5), null);
  assert.equal(describeTaskTimeoutMismatch({ exec_time_limit: 30 }, "abc"), null);
  assert.equal(describeTaskTimeoutMismatch({}, 30), null);
  assert.equal(describeTaskTimeoutMismatch({ exec_time_limit: null }, 30), null);
  assert.equal(describeTaskTimeoutMismatch({ exec_time_limit: 0 }, 30), null);
}

console.log("Interval task schedule tests passed");