import assert from "node:assert/strict";
import {
  MAX_SCHEDULER_DELAY_MS,
  MIN_SCHEDULER_DELAY_MS,
  computeNextRun,
  computeSchedulerDelay,
  getIntervalSeconds,
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

console.log("Interval task schedule tests passed");