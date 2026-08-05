/**
 * Proveedores de mensajería que el runtime puede arrancar realmente.
 *
 * Fuente única de verdad compartida por:
 *  - `BotLifecycleTask.runOnce()`, que filtra qué filas de `ofapi_bot` levantan worker.
 *  - `botDocs.listBotProviders()`, que expone `runtime_supported` a los agentes de IA.
 *
 * Otros valores de `ofapi_bot.provider` (whatsapp, ms_teams, ...) se guardan y se
 * listan, pero nunca se ejecutan mientras no exista su worker.
 */
export const RUNTIME_SUPPORTED_PROVIDERS = Object.freeze(["telegram"]);
