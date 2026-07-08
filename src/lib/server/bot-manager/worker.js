import { parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";
import * as grammyModule from "grammy";
import { functionsVars } from "../functionVars.js";

let activeBot = null;

parentPort.on("message", async (message) => {
  try {
    if (message.type === "START") {
      const { token, code, botId, environment, app_env_vars } = message.payload;
      console.log(`[Worker ${botId}] Starting...`);

      const defaults = {
        grammy: grammyModule,
        $BOT_TOKEN: token, // The bot code can access '$BOT_TOKEN' variable
      };

      const sandbox = { ...defaults, ...functionsVars(true, true, environment), ...app_env_vars };

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
        
        let errorType = "STARTUP_ERROR";
        let status = 500;
        
        if (err.name === "GrammyError" && err.status === 401) {
          errorType = "INVALID_TOKEN";
          status = 401;
        } else if (err.name === "HttpError") {
          errorType = "CONNECTION_ERROR";
          status = 502;
        }

        parentPort.postMessage({
          type: "ERROR",
          botId,
          error: err.message || String(err),
          errorInfo: {
            message: err.message || String(err),
            stack: err.stack || "",
            name: err.name || "Error",
            status: err.status || status,
            errorType
          }
        });
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
      process.exit(0);
    }
  } catch (e) {
    console.error("Critical Work Error:", e);
  }
});
