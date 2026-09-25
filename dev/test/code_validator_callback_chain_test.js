// Test for the grammy-callback-chain-halt validator rule.
// Run: node dev/test/code_validator_callback_chain_test.js
import * as acorn from "acorn";
import assert from "node:assert/strict";
import { collectCallbackChainHaltFindings } from "../../src/lib/validation/matchers/matchCallbackChainHalt.js";

const parse = (code) =>
  acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", locations: true });

const BUGGY = `
$BOT.on("callback_query:data", async (ctx) => {
  const data = String(ctx.callbackQuery?.data || "");
  if (!data.startsWith("appsel:")) return;
  await ctx.answerCallbackQuery();
});
`;

const FIXED = `
$BOT.on("callback_query:data", async (ctx, next) => {
  const data = String(ctx.callbackQuery?.data || "");
  if (!data.startsWith("appsel:")) {
    await next();
    return;
  }
  await ctx.answerCallbackQuery();
});
`;

const PATTERN_FILTERS = `
$BOT.callbackQuery(/^appsel:/, async (ctx) => {
  const data = String(ctx.callbackQuery?.data || "");
  await ctx.answerCallbackQuery();
});
$BOT.callbackQuery("linkapp-cancel", async (ctx) => {});
`;

const CONSUMPTION_RETURN = `
$BOT.on("callback_query:data", async (ctx) => {
  const data = String(ctx.callbackQuery?.data || "");
  const chat = ctx.chat;
  if (!chat) return;
  await ctx.answerCallbackQuery();
});
`;

const NESTED_FUNCTION_RETURN = `
$BOT.on("callback_query:data", async (ctx) => {
  const data = String(ctx.callbackQuery?.data || "");
  ["a"].forEach(() => { if (!data.startsWith("x")) return; });
  await ctx.answerCallbackQuery();
});
`;

const main = () => {
  const buggy = collectCallbackChainHaltFindings(parse(BUGGY));
  assert.ok(buggy.length >= 1, "buggy guard-and-return must be flagged");
  assert.equal(buggy[0].ruleId, "grammy-callback-chain-halt");
  assert.equal(buggy[0].severity, "warning");

  assert.equal(
    collectCallbackChainHaltFindings(parse(FIXED)).length,
    0,
    "next() propagation must not be flagged"
  );
  assert.equal(
    collectCallbackChainHaltFindings(parse(PATTERN_FILTERS)).length,
    0,
    "pattern filters must not be flagged"
  );
  assert.equal(
    collectCallbackChainHaltFindings(parse(CONSUMPTION_RETURN)).length,
    0,
    "consumption return with a non-data guard must not be flagged"
  );
  assert.equal(
    collectCallbackChainHaltFindings(parse(NESTED_FUNCTION_RETURN)).length,
    0,
    "return inside a nested callback must not be flagged"
  );

  console.log("code_validator_callback_chain_test: OK (5 assertions)");
};

main();