import { parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";
import * as grammyModule from "grammy";
import { functionsVars } from "../functionVars.js";
import crypto from "node:crypto";

// Telegram-specific worker. Other providers will use their own worker implementations.
let activeBot = null;

/** Códigos de red de Node: el fallo es del host o del DNS, no del bot. */
const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND",
  "EAI_AGAIN", "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT",
]);

/**
 * Traduce un error de arranque al `errorType` que consume la política de fallos.
 *
 * Antes solo se reconocían el 401 y el `HttpError` de grammY: todo lo demás —un 429, un
 * 502 de Telegram, un `ETIMEDOUT`— caía en `STARTUP_ERROR` y contaba para el auto-disable,
 * de modo que un problema pasajero terminaba apagando el bot.
 *
 * @param {Error} err
 * @returns {{errorType: string, status: number}}
 */
function classifyStartupError(err) {
  const name = err?.name || "";
  const status = Number(err?.status ?? err?.error_code);
  const code = err?.code || err?.cause?.code || "";

  // Código del usuario que ni siquiera compila o referencia algo inexistente.
  if (name === "SyntaxError" || name === "ReferenceError") {
    return { errorType: "CODE_ERROR", status: 500 };
  }
  if (/did not define a valid \$BOT/i.test(err?.message || "")) {
    return { errorType: "CODE_ERROR", status: 500 };
  }

  if (Number.isFinite(status)) {
    if (status === 401) return { errorType: "INVALID_TOKEN", status: 401 };
    // 403/404 desde Telegram: el bot fue bloqueado o borrado. Reintentar no lo revive.
    if (status === 403 || status === 404) return { errorType: "FORBIDDEN", status };
    if (status === 429) return { errorType: "RATE_LIMITED", status: 429 };
    if (status >= 500) return { errorType: "PROVIDER_ERROR", status };
  }

  if (name === "HttpError" || NETWORK_ERROR_CODES.has(String(code).toUpperCase())) {
    return { errorType: "CONNECTION_ERROR", status: 502 };
  }

  return { errorType: "STARTUP_ERROR", status: 500 };
}

parentPort.on("message", async (message) => {
  try {
    if (message.type === "START") {
      const { token, code, botId, environment, app_env_vars, traceId } = message.payload;
      console.log(`[Worker ${botId}] Starting...`);

      const defaults = {
        grammy: grammyModule,
        $BOT_TOKEN: token, // The bot code can access '$BOT_TOKEN' variable
      };

      const mockRequest = {
        // El trace lo asigna el ciclo de vida para que los logs del arranque y los
        // `ofapi.log` del código del bot queden en el mismo trace. Fallback local
        // solo si el worker se invoca sin traceId (p.ej. desde un test).
        headers: { "ofapi-trace-id": traceId || crypto.randomUUID() },
        openfusionapi: {
          handler: {
            params: {
              idapp: app_env_vars?.idapp || null,
              idendpoint: botId,
            }
          }
        },
        method: "BOT",
        url: `telegram://bot/${botId}`,
        ip: "localhost"
      };

      const mockReply = {
        openfusionapi: {
          server: {
            TasksInterval: {
              pushLog: (logData) => {
                parentPort.postMessage({ type: "BOT_LOG_PUSH", logData });
              }
            }
          }
        }
      };

      const sandbox = { ...defaults, ...functionsVars(mockRequest, mockReply, environment), ...app_env_vars };

      // 2. Create Context
      vm.createContext(sandbox);

      // 3. Wrap the user code.
      // We wrap their code to extract the 'bot' instance if they define it globally
      const wrappedCode = `
               
// Instantiate the bot.
    globalThis.$BOT = new grammy.Bot($BOT_TOKEN);
    const $BOT = globalThis.$BOT;

${code}



            `;

      // 4. Run Execution
      try {
        const script = new vm.Script(wrappedCode);
        // Execute code.
        script.runInContext(sandbox, { timeout: 10000 }); // 10s timeout
/*
Nota importante: Este tiempo límite aplica solo a la carga inicial del código (definir variables, crear la instancia del bot). No limita cuánto tiempo puede estar el bot encendido y funcionando (eso es indefinido).
*/
        // Recover the bot instance from the sandbox
        const potentialBot = sandbox.$BOT;

        if (potentialBot && typeof potentialBot.start === "function") {
          activeBot = potentialBot;

          // Handle bot errors to prevent crash
          activeBot.catch((err) => {
            console.error(`[Worker ${botId}] Bot Error (caught):`, err);
            
            // In grammY, the thrown error is wrapped in err.error
            const innerError = err.error || err;
            const errorInfo = {
              message: innerError.message || String(innerError),
              stack: innerError.stack || "",
              update: err.ctx?.update || null
            };

            parentPort.postMessage({
              type: "BOT_ERROR",
              botId,
              error: errorInfo
            });
          });

          // Validate token and connection before starting
          console.log(`[Worker ${botId}] Validating bot connection and token...`);
          const botInfo = await activeBot.api.getMe();
          console.log(`[Worker ${botId}] Authenticated successfully as @${botInfo.username}`);

          // Start the bot without handling signals (manager handles that)
          activeBot.start({
            onStart: () => {
              console.log(`[Worker ${botId}] Bot started!`);
            },
            allowed_updates: ["message", "callback_query"], // Optional: specific updates
            drop_pending_updates: true,
            handleSignals: false
          });

          parentPort.postMessage({ type: "STARTED", botId, botInfo });
        } else {
          throw new Error("Code did not define a valid $BOT instance.");
        }

      } catch (err) {
        console.error(`[Worker ${botId}] Execution/Startup Error:`, err);

        // El worker solo aporta señales; la decisión de reintentar o deshabilitar la toma
        // classifyBotFailure() en el manager. Distinguir aquí entre un token revocado (no
        // se arregla reintentando) y un 429 o un 502 del proveedor (sí) es lo que evita
        // que un corte de red termine deshabilitando el bot.
        const { errorType, status } = classifyStartupError(err);

        parentPort.postMessage({
          type: "ERROR",
          botId,
          error: err.message || String(err),
          errorInfo: {
            message: err.message || String(err),
            stack: err.stack || "",
            name: err.name || "Error",
            status: err.status || status,
            // Código de red de Node (ECONNRESET, EAI_AGAIN, ...) cuando el fallo es de
            // socket/DNS y no llega a producir una respuesta HTTP.
            code: err.code || err.cause?.code || null,
            // Código de error de la API de Telegram y su retry_after en el caso 429.
            error_code: err.error_code ?? null,
            retry_after: err.parameters?.retry_after ?? null,
            errorType
          }
        });

        // Gracefully exit the worker thread instead of waiting to be terminated abruptly
        process.exitCode = 1;
        parentPort.close();
      }
    } else if (message.type === "STOP") {
      if (activeBot) {
        console.log(`[Worker] Stopping bot instance...`);
        // grammY bots have stop()
        if (activeBot.stop) {
          try {
            await activeBot.stop();
          } catch (e) {
            console.error("Error stopping bot", e);
          }
        }
        activeBot = null;
      }
      parentPort.postMessage({ type: "STOPPED" });
      parentPort.close();
    }
  } catch (e) {
    console.error("Critical Work Error:", e);
  }
});
