import { BotManager } from "../bot-manager/manager.js";
import { RUNTIME_SUPPORTED_PROVIDERS } from "../bot-manager/providers.js";
import { getActiveBots, disableBot } from "../../db/bot.js";
import { getAppVarsObject } from "../utils.js";
import { resolveAppVarPlaceholder } from "../../handler/utils.js";
import { createLog } from "../../db/log.js";
import crypto from "node:crypto";

export class BotLifecycleTask {
  constructor({ intervalMs = 10000, serverAPI } = {}) {
    this.intervalMs = intervalMs;
    this.serverAPI = serverAPI;
    this.timerId = null;
    this.manager = new BotManager();
    this.isRunning = false;
    // Errores de token ya reportados, para no repetir el mismo log cada ciclo de
    // 10 s. La clave incluye el token crudo, así que corregirlo vuelve a habilitar
    // el reporte. Ver resolveBotToken().
    this.reportedTokenErrors = new Set();

    // trace_id por bot, estable durante todo un intento de arranque y toda la vida
    // del worker que resulte de él. Se propaga al worker para que los `ofapi.log`
    // del código del bot caigan en el mismo trace. Se renueva cuando el intento
    // falla o el bot se detiene, de modo que cada corrida sea un trace distinto.
    this.botTraces = new Map();

    // Bots cuyo fallo de arranque ya se registró con detalle vía el evento `bot_log`
    // (evento `bot_startup_error`, con error_type y bot_username). El manager además
    // rechaza la promesa de startBot, así que sin esta marca el catch de runOnce
    // duplicaba cada fallo con un `bot_manage_error` genérico y menos informativo.
    this.reportedStartupFailures = new Set();

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

        // Este fallo ya quedó registrado con detalle (`bot_startup_error`), así que el
        // catch de runOnce no debe duplicarlo como `bot_manage_error`. El trace NO se
        // cierra aquí: se cierra en ese catch, para que el fallo y los eventos que
        // dispara (bot_worker_crash / bot_auto_disabled) queden en el mismo trace.
        if (type === "ERROR") {
          this.reportedStartupFailures.add(botId);
        }
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

  /**
   * trace_id estable de la corrida actual del bot. Todos los logs de un mismo
   * intento de arranque (y de la vida del worker que arranque) comparten este id.
   */
  traceForBot(botId) {
    if (!botId) return crypto.randomUUID();
    let traceId = this.botTraces.get(botId);
    if (!traceId) {
      traceId = crypto.randomUUID();
      this.botTraces.set(botId, traceId);
    }
    return traceId;
  }

  /** Cierra la corrida actual: el siguiente intento usará un trace nuevo. */
  endBotTrace(botId) {
    if (botId) this.botTraces.delete(botId);
  }

  buildLogData({ botId, idapp, botUsername = null, status_code, message, body = null, traceId = null }) {
    return {
      trace_id: traceId || this.traceForBot(botId),
      timestamp: new Date(),
      idapp: idapp || null,
      idendpoint: botId,
      url: botUsername ? `telegram://bot/${botUsername}` : `telegram://bot/${botId}`,
      method: "BOT",
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

  /**
   * Resuelve el token de un bot antes de arrancarlo.
   *
   * - Un token que empieza con `$_` es una referencia a una variable de aplicación y
   *   se reemplaza por su valor para el ambiente del bot. Si la variable no existe,
   *   `resolveAppVarPlaceholder` lanza y el bot no arranca.
   * - Cualquier otro valor se usa literal.
   * - Un token vacío es error.
   *
   * @param {object} bot fila de ofapi_bot
   * @param {object} env_vars appvars del ambiente del bot, planas por nombre
   * @returns {string} token listo para el proveedor
   */
  resolveBotToken(bot, env_vars) {
    const raw = String(bot.token ?? "").trim();

    if (!raw) {
      throw new Error(
        `Bot '${bot.name || bot.idbot}' has an empty token. Set a literal token or an ` +
        `application variable reference such as $_VAR_TELEGRAM_TOKEN.`
      );
    }

    if (!raw.startsWith("$_")) return raw;

    return resolveAppVarPlaceholder(raw, env_vars, bot.environment);
  }

  async runOnce() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const activeBots = await getActiveBots();

      // Solo los proveedores con worker implementado se arrancan. Los demás se
      // guardan y se listan, pero nunca se ejecutan.
      const supportedBots = activeBots.filter((b) =>
        RUNTIME_SUPPORTED_PROVIDERS.includes(b.provider)
      );

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
          } finally {
            // La corrida terminó: si el bot vuelve, abre un trace nuevo.
            this.endBotTrace(runningId);
            this.reportedStartupFailures.delete(runningId);
          }
        }
      }

      // Iniciar o mantener bots activos soportados
      for (const bot of supportedBots) {
        try {
          // Construir objeto de app vars para el ambiente del bot
          const appvars_obj = getAppVarsObject(bot.app?.vrs || []);
          const env_vars = appvars_obj[bot.environment] || {};

          const tokenErrorKey = `${bot.idbot}|${String(bot.token ?? "")}`;
          let token;
          try {
            token = this.resolveBotToken(bot, env_vars);
            this.reportedTokenErrors.delete(tokenErrorKey);
          } catch (tokenError) {
            // Un token mal configurado no se arregla reintentando: se reporta una
            // sola vez y el bot se salta hasta que cambie el token o la appvar.
            if (!this.reportedTokenErrors.has(tokenErrorKey)) {
              this.reportedTokenErrors.add(tokenErrorKey);
              await this.persistLog(
                this.buildLogData({
                  botId: bot.idbot,
                  idapp: bot.idapp,
                  status_code: 400,
                  message: {
                    event: "bot_token_error",
                    error: tokenError?.message || String(tokenError),
                    description:
                      "Bot not started because its token could not be resolved.",
                  },
                })
              ).catch((err) => {
                console.error(
                  `[BotLifecycleTask] Token error on bot ${bot.idbot} (logging also failed):`,
                  tokenError,
                  err
                );
              });
            }
            continue;
          }

          await this.manager.startBot(
            bot.idbot,
            token,
            bot.code,
            bot.environment,
            // Precedencia: appvars del ambiente < params del bot < idapp.
            // `$_APP_VARS_` se agrega al final para dar la misma doble exposición
            // (nombre directo + objeto agrupado) que el sandbox de endpoints JS.
            {
              ...env_vars,
              ...bot.params,
              idapp: bot.idapp,
              $_APP_VARS_: env_vars,
            },
            bot.idapp,
            // Se propaga para que los `ofapi.log` del bot compartan el trace de la corrida.
            // No entra en el hash de configuración, así que no provoca reinicios.
            this.traceForBot(bot.idbot),
          );
        } catch (error) {
          // `startBot` rechaza la promesa por el mismo fallo que el manager ya emitió
          // como `bot_startup_error` (con error_type y bot_username). Registrar aquí
          // otra vez duplicaba cada fallo con un log genérico y menos útil, así que
          // solo se registra `bot_manage_error` cuando el fallo NO llegó por `bot_log`.
          const alreadyReported = this.reportedStartupFailures.delete(bot.idbot);

          // Un cooldown no es un fallo nuevo: es la espera que el manager pidió tras
          // un fallo ya registrado. El lifecycle reintenta cada 10 s, así que sin este
          // filtro cada ciclo en cooldown escribía un `bot_manage_error` redundante.
          const isExpectedCooldown = error?.code === "BOT_COOLDOWN";

          if (!alreadyReported && !isExpectedCooldown) {
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

          // El intento terminó: el siguiente arranque abre un trace nuevo.
          this.endBotTrace(bot.idbot);
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
