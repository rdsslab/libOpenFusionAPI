import assert from "node:assert/strict";
import { getResponseOutcome } from "../../src/lib/timer/responseOutcome.js";

assert.deepStrictEqual(getResponseOutcome({ data: [1, 2] }), {
  success: true,
  error: null,
});
assert.deepStrictEqual(getResponseOutcome("plain response"), {
  success: true,
  error: null,
});
assert.deepStrictEqual(getResponseOutcome({ success: true, data: {} }), {
  success: true,
  error: null,
});
assert.deepStrictEqual(
  getResponseOutcome({ success: false, error: "Business validation failed" }),
  { success: false, error: "Business validation failed" },
);
assert.deepStrictEqual(getResponseOutcome({ success: false }), {
  success: false,
  error: "Endpoint returned success: false",
});

console.log("Interval task response outcome tests passed");