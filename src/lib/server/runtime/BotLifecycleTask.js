import { BotManager } from "../bot-manager/manager.js";
import { getActiveBots, disableBot } from "../../db/bot.js";
import { getAppVarsObject } from "../utils.js";
import { createLog } from "../../db/log.js";
import crypto from "node:crypto";

export class BotLifecycleTask {
  constructor({ intervalMs = 10000, serverAPI } = {}) {
    this.intervalMs = intervalMs;
    this.serverAPI = serverAPI;
    this.timerId = null;
    this.manager = new BotManager();
    this.isRunning = false;

    // Auto-disable an endpoint that keeps crashing so it stops wasting resources
    this.manager.on("disable", async ({ botId, idapp, reason }) => {
      try {
        await disableBot(botId);
        await this.persistLog(this.buildLogData({
          botId,
          idapp,
          status_code: 200,
          message: {
            event: "bot_auto_disabled",
            reason: reason || "unknown",
            description: "Endpoint auto-disabled after repeated failures"
          }
        }));
      } catch (err) {
        await this.persistLog(this.buildLogData({
          botId,
          idapp,
          status_code: 500,
          message: {
            event: "bot_auto_disable_failed",
            error: err?.message || String(err),
            stack: err?.stack || null
          }
        }));
      }
    });

    // Listen to bot log events (startup success/error, runtime errors, crashes)
    this.manager.on("bot_log", async ({ botId, idapp, type, error, botInfo, message: infoMessage }) => {
      try {
        const botUsername = botInfo?.username || null;
        const botName = botInfo?.first_name || null;
        
        let status_code = 200;
        let messageData = { event: "started", type };
        let bodyData = null;

        if (type === "STARTED") {
          status_code = 200;
          messageData = {
            event: "bot_started",
            bot_username: botUsername,
            bot_name: botName
          };
        } else if (type === "ERROR") {
          status_code = error?.status || 500;
          messageData = {
            event: "bot_startup_error",
            error: error?.message || String(error),
            stack: error?.stack || null,
            error_type: error?.errorType || "STARTUP_ERROR",
            bot_username: botUsername
          };
        } else if (type === "BOT_ERROR") {
          status_code = 500;
          messageData = {
            event: "bot_runtime_error",
            error: error?.message || String(error),
            stack: error?.stack || null,
            bot_username: botUsername
          };
          bodyData = error?.update || null;
        } else if (type === "BOT_CRASH") {
          status_code = 500;
          messageData = {
            event: "bot_worker_crash",
            error: error?.message || String(error),
            stack: error?.stack || null,
            bot_username: botUsername
          };
        } else if (type === "INFO") {
          status_code = 200;
          messageData = infoMessage || { event: "info", type };
        }

        const logData = this.buildLogData({
          botId,
          idapp,
          botUsername,
          status_code,
          message: messageData,
          body: bodyData
        });

        await this.persistLog(logData);
      } catch (err) {
        // Last resort: the logging pipeline itself failed
        console.error("[BotLifecycleTask] Failed to save bot log:", err);
      }
    });

    // Listen to custom bot logs pushed from worker sandboxes
    this.manager.on("bot_log_push", async ({ botId, idapp, logData }) => {
      try {
        await this.persistLog(logData);
      } catch (err) {
        // Last resort: the logging pipeline itself failed
        console.error("[BotLifecycleTask] Failed to push custom bot log:", err);
      }
    });
  }

  buildLogData({ botId, idapp, botUsername = null, status_code, message, body = null }) {
    return {
      trace_id: crypto.randomUUID(),
      timestamp: new Date(),
      idapp: idapp || null,
      idendpoint: botId,
      url: botUsername ? `telegram://bot/${botUsername}` : `telegram://bot/${botId}`,
      method: "TELEGRAM_BOT",
      status_code,
      log_level: 3, // Full level
      price_by_request: 0,
      price_kb_request: 0,
      price_kb_response: 0,
      cost_total: 0,
      client: "telegram-api",
      message,
      body,
      response_time: 0
    };
  }

  async persistLog(logData) {
    if (this.serverAPI && this.serverAPI.TasksInterval) {
      this.serverAPI.TasksInterval.pushLog(logData);
    } else if (typeof createLog === "function") {
      await createLog(logData);
    } else {
      // Last resort: no logging backend available
      console.error("[URGENTE] [BotLifecycleTask] No hay backend de logs disponible. No se pudo guardar el log.");
    }
  }

  async runOnce() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const activeBots = await getActiveBots();

      // Only supported provider for live workers right now is telegram.
      // Other providers are stored but not started until their worker exists.
      const supportedBots = activeBots.filter((b) => b.provider === "telegram");

      // También detener bots que ya no deben estar corriendo.
      // El BotManager tiene la lista de bots activos en memoria.
      const runningBotIds = new Set(this.manager.listActiveBots());
      const expectedBotIds = new Set(supportedBots.map((b) => b.idbot));

      // Detener bots que ya no están en la lista activa
      for (const runningId of runningBotIds) {
        if (!expectedBotIds.has(runningId)) {
          try {
            await this.manager.stopBot(runningId);
          } catch (error) {
            console.error(`[BotLifecycleTask] Error stopping bot ${runningId}:`, error);
          }
        }
      }

      // Iniciar o mantener bots activos soportados
      for (const bot of supportedBots) {
        try {
          // Construir objeto de app vars para el ambiente del bot
          const appvars_obj = getAppVarsObject(bot.app?.vrs || []);
          const env_vars = appvars_obj[bot.environment] || {};

          await this.manager.startBot(
            bot.idbot,
            bot.token,
            bot.code,
            bot.environment,
            { ...env_vars, ...bot.params, idapp: bot.idapp },
            bot.idapp,
          );
        } catch (error) {
          await this.persistLog(
            this.buildLogData({
              botId: bot.idbot,
              idapp: bot.idapp,
              status_code: 500,
              message: {
                event: "bot_manage_error",
                error: error?.message || String(error),
                stack: error?.stack || null,
              },
            })
          ).catch((err) => {
            console.error(`[BotLifecycleTask] Error managing bot ${bot.idbot}:`, error, err);
          });
        }
      }
    } catch (error) {
      await this.persistLog(this.buildLogData({
        botId: null,
        idapp: null,
        status_code: 500,
        message: {
          event: "bot_management_loop_error",
          error: error?.message || String(error),
          stack: error?.stack || null
        }
      })).catch((logErr) => {
        // Last resort: logging pipeline failed
        console.error("[BotLifecycleTask] Error in bot management loop (logging also failed):", error, logErr);
      });
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    this.timerId = setInterval(async () => {
      await this.runOnce();
    }, this.intervalMs);
  }
}
