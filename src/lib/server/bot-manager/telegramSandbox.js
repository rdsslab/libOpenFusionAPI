// Telegram surface exposed to bot code by the worker.
//
// Bot API excludes `chat_member`, `message_reaction` and `message_reaction_count`
// from its default update list, so the full @grammyjs/types 5.2.0 Update shape
// (grammY 1.48.0) is listed explicitly. Keep in sync with
// src/docs/bots/providers/telegram/AI_SKILL.md.
export const TELEGRAM_ALLOWED_UPDATES = Object.freeze([
  "message", "edited_message", "channel_post", "edited_channel_post",
  "business_connection", "business_message", "edited_business_message",
  "deleted_business_messages", "guest_message", "message_reaction",
  "message_reaction_count", "inline_query", "chosen_inline_result",
  "callback_query", "widget_query", "shared_widget_query", "shipping_query",
  "pre_checkout_query", "purchased_paid_media", "poll", "poll_answer",
  "my_chat_member", "chat_member", "chat_join_request", "chat_boost",
  "removed_chat_boost", "managed_bot", "subscription",
  "stopped_message_generation"
]);

// Official plugins are separate npm packages and the bot sandbox has no
// require(), so the worker injects one explicit namespace. Deliberately
// excludes @grammyjs/runner (the worker owns polling) and webhookCallback
// (incompatible with getUpdates).
import * as autoRetryPlugin from "@grammyjs/auto-retry";
import * as conversationsPlugin from "@grammyjs/conversations";
import * as emojiPlugin from "@grammyjs/emoji";
import * as filesPlugin from "@grammyjs/files";
import * as hydratePlugin from "@grammyjs/hydrate";
import * as i18nPlugin from "@grammyjs/i18n";
import * as menuPlugin from "@grammyjs/menu";
import * as parseModePlugin from "@grammyjs/parse-mode";
import * as routerPlugin from "@grammyjs/router";

export const grammyPlugins = Object.freeze({
  autoRetry: autoRetryPlugin.autoRetry,
  conversations: conversationsPlugin.conversations,
  createConversation: conversationsPlugin.createConversation,
  Menu: menuPlugin.Menu,
  I18n: i18nPlugin.I18n,
  fmt: parseModePlugin.fmt,
  hydrate: hydratePlugin.hydrate,
  hydrateFiles: filesPlugin.hydrateFiles,
  Router: routerPlugin.Router,
  emoji: emojiPlugin.emoji
});

/**
 * Installs a runtime error handler that runs the bot's own handler first (when
 * it registered one) and always reports the failure as BOT_ERROR afterwards.
 * grammY's default handler stops the polling loop and rethrows, so it must
 * never be chained when the bot did not set a custom one.
 */
export function chainErrorHandler(bot, userErrorHandler, runtimeErrorHandler) {
  if (typeof userErrorHandler !== "function") {
    bot.catch(runtimeErrorHandler);
    return;
  }
  bot.catch(async (err) => {
    try {
      await userErrorHandler(err);
    } catch (userErr) {
      console.error("User error handler failed:", userErr);
    }
    await runtimeErrorHandler(err);
  });
}
