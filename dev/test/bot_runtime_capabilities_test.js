// v14.4.0: verifies the widened Telegram runtime surface without starting a
// worker or hitting the network. The update list and plugin namespace live in
// telegramSandbox.js so the worker and this test read the same source of truth.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  TELEGRAM_ALLOWED_UPDATES,
  grammyPlugins,
  chainErrorHandler,
} from "../../src/lib/server/bot-manager/telegramSandbox.js";

const ROOT = new URL("../../", import.meta.url);
const read = (relativePath) => fs.readFileSync(new URL(relativePath, ROOT), "utf8");

const EXPECTED_UPDATES = [
  "message", "edited_message", "channel_post", "edited_channel_post",
  "business_connection", "business_message", "edited_business_message",
  "deleted_business_messages", "guest_message", "message_reaction",
  "message_reaction_count", "inline_query", "chosen_inline_result",
  "callback_query", "widget_query", "shared_widget_query", "shipping_query",
  "pre_checkout_query", "purchased_paid_media", "poll", "poll_answer",
  "my_chat_member", "chat_member", "chat_join_request", "chat_boost",
  "removed_chat_boost", "managed_bot", "subscription",
  "stopped_message_generation",
];

const EXPECTED_PLUGINS = [
  "autoRetry", "conversations", "createConversation", "Menu", "I18n",
  "fmt", "hydrate", "hydrateFiles", "Router", "emoji",
];

const EXPECTED_DEPS = [
  "@grammyjs/auto-retry", "@grammyjs/conversations", "@grammyjs/emoji",
  "@grammyjs/files", "@grammyjs/hydrate", "@grammyjs/i18n",
  "@grammyjs/menu", "@grammyjs/parse-mode", "@grammyjs/router",
];

async function runTests() {
  // ---------------------------------------------------------------- STEP 1
  console.log("[STEP 1/5] all 29 Update types are exposed and frozen...");

  assert.equal(TELEGRAM_ALLOWED_UPDATES.length, 29);
  assert.equal(Object.isFrozen(TELEGRAM_ALLOWED_UPDATES), true);
  assert.deepEqual([...TELEGRAM_ALLOWED_UPDATES], EXPECTED_UPDATES);
  for (const required of ["chat_member", "message_reaction", "message_reaction_count"]) {
    assert.ok(TELEGRAM_ALLOWED_UPDATES.includes(required), `${required} is excluded by Telegram by default`);
  }

  // ---------------------------------------------------------------- STEP 2
  console.log("[STEP 2/5] the official plugin namespace is complete...");

  assert.deepEqual(Object.keys(grammyPlugins), EXPECTED_PLUGINS);
  assert.equal(Object.isFrozen(grammyPlugins), true);
  for (const key of EXPECTED_PLUGINS) {
    assert.equal(typeof grammyPlugins[key], "function", `grammyPlugins.${key} is not callable`);
  }

  // ---------------------------------------------------------------- STEP 3
  console.log("[STEP 3/5] a user error handler runs before the runtime logger...");

  const calls = [];
  const makeBot = () => ({ catch(handler) { this.handler = handler; } });

  const withUser = makeBot();
  chainErrorHandler(withUser, async () => calls.push("user"), async () => calls.push("runtime"));
  await withUser.handler({});
  assert.equal(calls.join(","), "user,runtime");

  calls.length = 0;
  const failingUser = makeBot();
  const originalError = console.error;
  console.error = () => {};
  try {
    chainErrorHandler(
      failingUser,
      async () => { calls.push("user"); throw new Error("handler broke"); },
      async () => calls.push("runtime"),
    );
    await failingUser.handler({});
  } finally {
    console.error = originalError;
  }
  assert.equal(calls.join(","), "user,runtime", "a broken user handler must not hide the runtime report");

  calls.length = 0;
  const withoutUser = makeBot();
  chainErrorHandler(withoutUser, null, async () => calls.push("runtime"));
  await withoutUser.handler({});
  assert.equal(calls.join(","), "runtime", "grammY's default handler must never be chained");

  // ---------------------------------------------------------------- STEP 4
  console.log("[STEP 4/5] bot code can read botInfo and plugins in a vm sandbox...");

  const grammy = await import("grammy");
  const sandbox = {
    grammy,
    grammyPlugins,
    $BOT_TOKEN: "123456:ABC-DEF",
  };
  const instance = new grammy.Bot(sandbox.$BOT_TOKEN);
  instance.botInfo = {
    id: 1, is_bot: true, first_name: "Test", username: "runtime_test_bot",
  };
  sandbox.$BOT = instance;
  vm.createContext(sandbox);

  const probe = vm.runInContext(
    `({
      username: $BOT.botInfo.username,
      pluginKinds: Object.keys(grammyPlugins).map((key) => typeof grammyPlugins[key]),
      builtins: [typeof grammy.session, typeof grammy.InlineKeyboard, typeof grammy.MemorySessionStorage],
      canStart: typeof $BOT.start
    })`,
    sandbox,
    { timeout: 10000 },
  );

  // Arrays created inside vm belong to another realm: normalise before comparing.
  assert.equal(probe.username, "runtime_test_bot");
  assert.deepEqual(Array.from(probe.pluginKinds), EXPECTED_PLUGINS.map(() => "function"));
  assert.deepEqual(Array.from(probe.builtins), ["function", "function", "function"]);
  assert.equal(probe.canStart, "function");

  // ---------------------------------------------------------------- STEP 5
  console.log("[STEP 5/5] worker, package and docs agree with the surface...");

  const worker = read("src/lib/server/bot-manager/worker.js");
  assert.match(worker, /import \{ TELEGRAM_ALLOWED_UPDATES, grammyPlugins, chainErrorHandler \}/);
  assert.match(worker, /await bot\.init\(\)/);
  assert.match(worker, /allowed_updates: \[\.\.\.TELEGRAM_ALLOWED_UPDATES\]/);
  assert.match(worker, /chainErrorHandler\(/);
  assert.ok(!worker.includes("new grammy.Bot($BOT_TOKEN)"), "the worker must own the bot instance");

  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.version, "14.4.0");
  for (const dep of EXPECTED_DEPS) {
    assert.ok(pkg.dependencies[dep], `${dep} must be a runtime dependency`);
  }

  const manifest = JSON.parse(read("src/docs/bots/providers/telegram/manifest.json"));
  assert.deepEqual(manifest.runtime.allowed_updates, EXPECTED_UPDATES);

  const skill = read("src/docs/bots/providers/telegram/AI_SKILL.md");
  for (const update of EXPECTED_UPDATES) {
    assert.ok(skill.includes(`"${update}"`), `AI_SKILL.md is missing ${update}`);
  }
  for (const key of EXPECTED_PLUGINS) {
    assert.ok(skill.includes(key), `AI_SKILL.md is missing grammyPlugins.${key}`);
  }
  assert.ok(!skill.includes("can never fire"), "the stale 'never fire' warning must be gone");

  for (const doc of [
    "src/docs/bots/providers/telegram/README.md",
    "src/docs/bots/providers/telegram/examples.md",
    "src/docs/bots/README.md",
  ]) {
    assert.ok(read(doc).includes("grammyPlugins"), `${doc} must mention grammyPlugins`);
  }
  assert.match(read("src/docs/flows/BACKGROUND.md"), /all 29 Update types/);
  assert.match(read("CHANGELOG.md"), /^## \[14\.4\.0\]/m);
}

try {
  await runTests();
  console.log("bot_runtime_capabilities_test: 5/5 OK ✅");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
