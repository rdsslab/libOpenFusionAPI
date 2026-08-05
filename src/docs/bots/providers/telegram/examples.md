# Telegram Bot Examples

Every snippet below goes in the `code` field of a bot row (`upsert_bot`). The runtime already created the client:

- `$BOT` — a `grammy.Bot` instance built from the resolved token
- `$BOT_TOKEN` — the resolved token
- `grammy` — the grammY module namespace

Never call `new grammy.Bot(...)` and never call `$BOT.start()`; the runtime starts and supervises the bot after evaluating your code.

## Minimal bot

```javascript
$BOT.command("start", async (ctx) => {
  await ctx.reply("Bot activo desde OpenFusionAPI");
});
```

## Echo

```javascript
$BOT.command("start", async (ctx) => {
  await ctx.reply("Envíame cualquier texto y te lo repito.");
});

$BOT.on("message:text", async (ctx) => {
  await ctx.reply(`Recibido: ${ctx.message.text}`);
});
```

Use it as a smoke test: it confirms the token resolved, the worker started, and updates are flowing.

## Inline buttons and callbacks

```javascript
$BOT.command("start", async (ctx) => {
  const keyboard = new grammy.InlineKeyboard()
    .text("Aceptar", "accept")
    .text("Cancelar", "cancel");

  await ctx.reply("¿Deseas continuar?", { reply_markup: keyboard });
});

$BOT.on("callback_query:data", async (ctx) => {
  const action = ctx.callbackQuery.data;

  if (action === "accept") {
    await ctx.answerCallbackQuery({ text: "Aceptado" });
    await ctx.editMessageText("Operación confirmada");
    return;
  }

  if (action === "cancel") {
    await ctx.answerCallbackQuery({ text: "Cancelado" });
    await ctx.editMessageText("Operación cancelada");
  }
});
```

`callback_query` is one of the two update types the runtime subscribes to, so these handlers do fire.

## Using application variables

```javascript
// Both forms work: direct name and via $_APP_VARS_.
const allowedChatId = $_APP_VARS_["$_VAR_ALLOWED_CHAT_ID"];

$BOT.on("message:text", async (ctx) => {
  if (String(ctx.chat.id) !== String(allowedChatId)) {
    await ctx.reply("No autorizado");
    return;
  }

  await ctx.reply("Acceso permitido");
});
```

Use application variables for environment-specific identifiers, feature flags, URLs, and secrets. Use `params` for non-sensitive per-bot configuration — remember `params` overrides AppVars with the same key.

## Calling internal OpenFusionAPI endpoints

```javascript
$BOT.command("status", async (ctx) => {
  // Replace the environment suffix of the path with `auto`; uFetchAutoEnv
  // substitutes the caller's environment at runtime.
  const uF = uFetchAutoEnv.auto("/api/system/api/apps-list/auto", true);
  const response = await uF.get();
  const data = await response.json();

  await ctx.reply(`Aplicaciones detectadas: ${Array.isArray(data) ? data.length : 0}`);
});
```

## Handling platform errors

```javascript
$BOT.on("message:text", async (ctx) => {
  try {
    await ctx.reply("ok");
  } catch (error) {
    if (error instanceof grammy.GrammyError) {
      ofapi.log({ message: `Telegram rejected the call: ${error.description}` });
    } else if (error instanceof grammy.HttpError) {
      ofapi.log({ message: `Could not reach Telegram: ${error.message}` });
    } else {
      throw error;
    }
  }
});
```

Uncaught handler errors are reported by the runtime as `bot_runtime_error`; the bot keeps running.

## Token storage

Recommended: keep the token in an application variable and reference it from the bot row.

```json
{
  "idapp": "<application uuid>",
  "name": "My Telegram Bot",
  "provider": "telegram",
  "environment": "dev",
  "token": "$_VAR_TELEGRAM_TOKEN",
  "code": "$BOT.command(\"start\", async (ctx) => { await ctx.reply(\"ok\"); });"
}
```

The runtime resolves `$_VAR_TELEGRAM_TOKEN` against the AppVars of the bot's `environment` before creating the client. A literal token (anything not starting with `$_`) is also accepted.

## Notes

- Only `message` and `callback_query` updates are delivered — the runtime fixes `allowed_updates`. Handlers for other update types never fire.
- `drop_pending_updates: true`: messages sent while the bot was down or restarting are discarded.
- Keep the top level of the script limited to registering handlers; it has a 10 s evaluation budget and no top-level `await`.
- `$_RETURN_DATA_` is not read for bots. There is no HTTP response.
- Verify a change in the logs (`get_system_logs` filtering `idendpoint = <idbot>`, event `bot_started`), not just in the tool response.
- Three failures inside 5 minutes auto-disable the bot row, so confirm `enabled` after testing.
