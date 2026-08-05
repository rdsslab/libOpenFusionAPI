/**
 * @deprecated TELEGRAM_BOT handler — DEPRECADO desde Agosto 2026.
 *
 * Este handler existía como puente para bots de Telegram almacenados como endpoints.
 * El sistema de bots ahora usa la tabla dedicada `ofapi_bot` (modelo Bot en models.js)
 * y soporta múltiples providers de mensajería (telegram, whatsapp, ms_teams, etc.).
 *
 * NO crear nuevos bots usando este handler.
 * Para crear, editar o gestionar bots, usar:
 *   - API REST: POST/GET/DELETE/PATCH /system/bots
 *   - MCP Tools: list_bots, get_bot_data, upsert_bot, delete_bot, enable_disable_bot
 *   - Capa DB: src/lib/db/bot.js (funciones: upsertBot, getBotById, getBotCatalog, etc.)
 *
 * Los endpoints existentes con handler='TELEGRAM_BOT' han sido deshabilitados automáticamente
 * al arrancar el servidor con BUILD_DB=TRUE.
 */

import {
  getHandlerExecutionContext,
  replyException,
  sendHandlerResponse,
} from "./utils.js";

export const botTelegramFunction = async (context) => {
  const { request, reply } = getHandlerExecutionContext(context);
  try {
    let result_fn = { bot: 'ok', data: null, headers: null };

    const headers =
      result_fn.headers && result_fn.headers.size > 0
        ? Object.fromEntries(result_fn.headers)
        : undefined;

    sendHandlerResponse(reply, {
      statusCode: 200,
      data: result_fn.data,
      headers,
    });
  } catch (error) {
    replyException(request, reply, error);
  }
};
