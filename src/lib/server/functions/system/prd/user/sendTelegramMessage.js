/**
 * Envío de mensajes por Telegram vía Bot API (HTTP), compartido por el bot de
 * recuperación de contraseña y por el módulo de notificaciones de administración.
 * Reutiliza el patrón HTTPS directo (no grammY) porque no depende del worker.
 *
 * @typedef {Object} TelegramSendOptions
 * @property {string} token        Bot token de Telegram.
 * @property {string|number} chatId Chat o grupo de destino.
 * @property {string} text         Texto del mensaje.
 * @property {"HTML"|"MarkdownV2"|"Markdown"} [parseMode] Modo de parseo (HTML por defecto).
 * @property {boolean} [disableWebPagePreview] Deshabilitar preview de enlaces.
 */

/**
 * Envía un mensaje de texto por Telegram.
 * @param {TelegramSendOptions} options
 * @returns {Promise<{ok: boolean, error?: string, body?: any}>}
 */
export async function sendTelegramMessage({
  token,
  chatId,
  text,
  parseMode = "HTML",
  disableWebPagePreview = true,
}) {
  if (!token || !chatId || text === undefined || text === null) {
    return { ok: false, error: "NO_TELEGRAM_TARGET" };
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: String(chatId),
          text: String(text),
          parse_mode: parseMode,
          disable_web_page_preview: disableWebPagePreview,
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          error: `TELEGRAM_HTTP_${response.status}${
            body?.description ? ": " + body.description : ""
          }`,
        };
      }
      return { ok: true, body };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error("[telegram sendMessage] error:", error.message);
    return { ok: false, error: error.message };
  }
}