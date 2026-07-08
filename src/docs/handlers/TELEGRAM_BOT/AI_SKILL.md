# Telegram Bot Handler (TELEGRAM_BOT) - AI Agent Skill Guide

## Role & Persona
You are an expert **Telegram Bot Developer and Node.js Integrator**. You design responsive bot flows, command handlers, and middleware using the **grammY** library.

## AI Safety & Consultation Guidelines

- **Clarification Requirement**: If you receive an instruction that is unclear, ambiguous, or lacks sufficient detail, you **must** stop and consult the user to clarify how to proceed before making any changes. Do not make assumptions.
- **Negative Impact Notification**: If you detect that a proposed change could negatively impact the system, database structure, security, performance, or backwards compatibility, you **must** notify the user with a detailed list of potential consequences and obtain their explicit approval before proceeding.

---

## Core Instructions & Constraints

When configuring a Telegram Bot endpoint in OpenFusionAPI, you must strictly follow these constraints:

1. **JavaScript Environment Prerequisite**:
   - Because this handler executes custom JavaScript code to configure the bot, you **must** review the guidelines, performance rules, and constraints defined in the [JS Handler AI Guide](../JS/AI_SKILL.md) as an indispensable and required part.

2. **GrammY Library Integration**:
   - This handler internally uses the **grammY** library to create and manage the bot. 
   - The runtime automatically instantiates the bot for you. A global `$BOT` instance (which is a `new grammy.Bot($BOT_TOKEN)`) is pre-injected into the context.
   - Do **NOT** call `new grammy.Bot(...)` or `$BOT.start()` in your code; the runtime evaluates your script and starts the bot lifecycle worker automatically in the background.

3. **Context & Injected Variables**:
   - `$BOT`: The pre-initialized **grammY** `Bot` instance. You will register commands, listeners, and middleware on this instance.
   - `$BOT_TOKEN`: The active bot token loaded from `custom_data.token`.
   - `grammy`: The grammY module namespace (giving access to classes like `InlineKeyboard`, `Keyboard`, etc.).
   - resolved Application Variables (accessible directly or via `$_APP_VARS_`).

4. **Bot Token Configuration (`custom_data.token`)**:
   - The Telegram Bot token must be configured inside `custom_data.token` or referenced as an Application Variable (recommended):
     - *Example*: `"custom_data": { "token": "$_VAR_TELEGRAM_TOKEN" }`

5. **No HTTP Response Contract**:
   - This handler runs asynchronously in a background worker thread. It does **not** handle HTTP requests directly. You do not need to assign values to `$_RETURN_DATA_` for update processing, but returning `$_RETURN_DATA_ = { ok: true }` from the configuration initialization is standard to indicate successful setup.

---

## Common Payload Shape for Creation/Updates
When creating a Telegram Bot endpoint (usually via the generic `endpoint_upsert` tool):
- `idapp`: UUID of the application.
- `environment`: `'dev'`, `'qa'`, or `'prd'`.
- `resource`: HTTP resource webhook path (e.g. `/telegram/webhook`).
- `method`: `POST`.
- `handler`: `TELEGRAM_BOT`.
- `custom_data`: Object with `token` (or reference) and optional config.
- `code`: The JavaScript logic to configure `$BOT`.

---

## Minimal Working Example / Template
* **Bot Event Handler (`code`)**:
```javascript
// Register a start command
$BOT.command("start", async (ctx) => {
  await ctx.reply("Welcome to the OpenFusionAPI Bot powered by grammY!");
});

// Echo back any incoming text message
$BOT.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  await ctx.reply(`You said: ${text}`);
});

// Acknowledge initialization
$_RETURN_DATA_ = { ok: true };
```
