import { BotManager } from "../bot-manager/manager.js";
import { getApplicationsTreeByFilters } from "../../db/app.js";
import { disableEndpoint } from "../../db/endpoint.js";
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
    this.manager.on("disable", async ({ botId }) => {
      try {
        await disableEndpoint(botId);
        console.warn(
          `[BotManager] Endpoint ${botId} auto-disabled after repeated failures.`,
        );
      } catch (err) {
        console.error(`[BotManager] Failed to disable endpoint ${botId}:`, err);
      }
    });

    // Listen to bot log events (startup success/error, runtime errors, crashes)
    this.manager.on("bot_log", async ({ botId, idapp, type, error, botInfo }) => {
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
        }

        const logData = {
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
          message: messageData,
          body: bodyData,
          response_time: 0
        };

        if (this.serverAPI && this.serverAPI.TasksInterval) {
          this.serverAPI.TasksInterval.pushLog(logData);
        } else {
          console.warn("[BotLifecycleTask] serverAPI or TasksInterval not available, logging to DB directly");
          if (typeof createLog === "function") {
            await createLog(logData);
          } else {
            console.error("[URGENTE] [BotLifecycleTask] La función 'createLog' de base de datos no está disponible. No se pudo guardar el log.");
          }
        }
      } catch (err) {
        console.error("[BotLifecycleTask] Failed to save bot log:", err);
      }
    });

    // Listen to custom bot logs pushed from worker sandboxes
    this.manager.on("bot_log_push", async ({ botId, idapp, logData }) => {
      try {
        if (this.serverAPI && this.serverAPI.TasksInterval) {
          this.serverAPI.TasksInterval.pushLog(logData);
        } else {
          console.warn("[BotLifecycleTask] La cola de logs asíncrona no está disponible. Guardando directamente en BD.");
          if (typeof createLog === "function") {
            await createLog(logData);
          } else {
            console.error("[URGENTE] [BotLifecycleTask] La función 'createLog' de base de datos no está disponible. No se pudo guardar el log de push.");
          }
        }
      } catch (err) {
        console.error("[BotLifecycleTask] Failed to push custom bot log:", err);
      }
    });
  }

  async runOnce() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const apps = await getApplicationsTreeByFilters({
        endpoint: { handler: "TELEGRAM_BOT" },
      });

      for (let index = 0; index < apps.length; index++) {
        const app = apps[index];

        if (app.endpoints && app.endpoints.length > 0) {
          let appvars_obj = {};

          if (app.enabled) {
            appvars_obj = getAppVarsObject(app.vrs);
          }

          for (let index = 0; index < app.endpoints.length; index++) {
            const element = app.endpoints[index];
            try {
              if (element.enabled && app.enabled) {
                console.log("Starting Bot " + element.idendpoint);
                await this.manager.startBot(
                  element.idendpoint,
                  element.custom_data.token,
                  element.code,
                  element.environment,
                  appvars_obj[element.environment],
                  element.idapp,
                );
              } else {
                console.log("Stopping Bot " + element.idendpoint);
                await this.manager.stopBot(element.idendpoint);
              }
            } catch (error) {
              console.error("Error managing bot " + element.idendpoint, error);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error in bot management loop:", error);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    console.log("--- Starting System (grammY edition) ---");
    this.timerId = setInterval(async () => {
      await this.runOnce();
    }, this.intervalMs);
  }
}
