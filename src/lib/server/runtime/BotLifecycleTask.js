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
    this.manager.on("disable", async ({ botId, idapp }) => {
      try {
        await disableEndpoint(botId);
        await this.persistLog(this.buildLogData({
          botId,
          idapp,
          status_code: 200,
          message: {
            event: "bot_auto_disabled",
            reason: "Endpoint auto-disabled after repeated failures"
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
                await this.manager.startBot(
                  element.idendpoint,
                  element.custom_data.token,
                  element.code,
                  element.environment,
                  appvars_obj[element.environment],
                  element.idapp,
                );
              } else {
                await this.manager.stopBot(element.idendpoint);
              }
            } catch (error) {
              await this.persistLog(this.buildLogData({
                botId: element.idendpoint,
                idapp: element.idapp,
                status_code: 500,
                message: {
                  event: "bot_manage_error",
                  error: error?.message || String(error),
                  stack: error?.stack || null
                }
              })).catch((err) => {
                // Last resort: the logging pipeline itself failed
                console.error("Error managing bot " + element.idendpoint, error, err);
              });
            }
          }
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
