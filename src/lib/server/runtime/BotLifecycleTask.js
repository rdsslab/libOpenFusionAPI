import { BotManager } from "../bot-manager/manager.js";
import { RUNTIME_SUPPORTED_PROVIDERS } from "../bot-manager/providers.js";
import { getActiveBots, disableBot, updateBotRuntimeState } from "../../db/bot.js";
import { getAppVarsObject } from "../utils.js";
import { resolveAppVarPlaceholder } from "../../handler/utils.js";
import { createBotLog } from "../../db/bot_log.js";
import crypto from "node:crypto";

/** Mínimo de bots para que un fallo simultáneo sea estadísticamente un incidente de plataforma. */
const OUTAGE_MIN_BOTS = 3;

/** Proporción de bots fallando a la vez a partir de la cual se asume incidente de plataforma. */
const OUTAGE_FAILING_RATIO = 0.5;

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

    // Metadata del bot (provider, environment, username) para incluir en cada log.
    // Se actualiza cuando el bot arranca exitosamente (username resuelto por getMe).
    this.botMeta = new Map();

    // Timestamp de inicio de cada intento de arranque, para calcular duration_ms.
    this.startAttemptTimestamps = new Map();

    // Bots cuyo fallo de arranque ya se registró con detalle vía el evento `bot_log`
    // (evento `bot_startup_error`, con error_type y bot_username). El manager además
    // rechaza la promesa de startBot, así que sin esta marca el catch de runOnce
    // duplicaba cada fallo con un `bot_manage_error` genérico y menos informativo.
    this.reportedStartupFailures = new Set();

    // Incidente de plataforma en curso (ver evaluatePlatformOutage).
    this.outageActive = false;

    // El manager publica su estado observado y aquí se persiste en `ofapi_bot`. La
    // separación es deliberada: el manager no conoce la BBDD.
    this.manager.on("bot_health", async ({ botId, idapp, patch }) => {
      try {
        await updateBotRuntimeState(botId, patch);
      } catch (err) {
        // El estado observado es diagnóstico: si no se puede escribir, el bot debe
        // seguir operando igual.
        console.error(`[BotLifecycleTask] Failed to persist runtime state for ${botId}:`, err);
      }
      // Push real-time status to the frontend via WebSocket.
      try {
        if (this.serverAPI && typeof this.serverAPI._emitEndpointEvent === "function") {
          this.serverAPI._emitEndpointEvent("bot_status_changed", {
            idbot: botId,
            idapp,
            ...patch,
          });
        }
      } catch (_) {
        // WebSocket push is best-effort; never block the lifecycle.
      }
    });

    // Un arranque exitoso prueba que la red del host funciona: cierra cualquier
    // incidente de plataforma y libera el backoff del resto de bots.
    this.manager.on("bot_started", ({ botId, idapp }) => {
      this.clearPlatformOutage(idapp).catch((err) => {
        console.error(`[BotLifecycleTask] Failed to clear outage after ${botId} started:`, err);
      });
    });

    // Solo se llega aquí por fallos PERMANENTES (token revocado, código inválido), donde
    // reintentar es desperdicio. Un fallo recuperable nunca emite `disable`: se reintenta
    // con backoff y cuarentena indefinidamente. Se marca `disabled_by: "system"` para que
    // corregir el token o el código vuelva a habilitar el bot automáticamente.
    this.manager.on("disable", async ({ botId, idapp, reason, errorType }) => {
      try {
        await disableBot(botId, {
          by: "system",
          reason: reason || `permanent_failure:${errorType || "unknown"}`,
        });
        await this.persistLog(this.buildLogData({
          botId,
          idapp,
          status_code: 200,
          event: "bot_auto_disabled",
          message: {
            event: "bot_auto_disabled",
            reason: reason || "unknown",
            error_type: errorType || null,
            description:
              "Bot auto-disabled after repeated permanent failures. Fix the token or the " +
              "code with upsert_bot and it will be re-enabled automatically."
          }
        }));
      } catch (err) {
        await this.persistLog(this.buildLogData({
          botId,
          idapp,
          status_code: 500,
          event: "bot_auto_disable_failed",
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

        // Actualizar metadata del bot cuando arranca exitosamente
        if (type === "STARTED" && botUsername) {
          const meta = this.botMeta.get(botId) || {};
          this.botMeta.set(botId, { ...meta, username: botUsername });
        }
        
        // Capturar inicio del intento para duration_ms
        let duration_ms = null;
        const attemptStart = this.startAttemptTimestamps.get(botId);
        if (attemptStart) {
          duration_ms = Date.now() - attemptStart;
          this.startAttemptTimestamps.delete(botId);
        }

        // Obtener estado runtime actual del bot para el snapshot
        const failureState = this.manager.errorHistoryFor(botId);

        let status_code = 200;
        let event = "info";
        let log_level = 2; // INFO
        let error_type = null;
        let messageData = { event: "info", type };

        if (type === "STARTED") {
          status_code = 200;
          event = "bot_started";
          messageData = {
            event: "bot_started",
            bot_username: botUsername,
            bot_name: botName
          };
        } else if (type === "ERROR") {
          status_code = error?.status || 500;
          event = "bot_startup_error";
          error_type = error?.errorType || "STARTUP_ERROR";
          log_level = 4; // ERROR
          messageData = {
            event: "bot_startup_error",
            error: error?.message || String(error),
            stack: error?.stack || null,
            error_type,
            bot_username: botUsername
          };
        } else if (type === "BOT_ERROR") {
          status_code = 500;
          event = "bot_runtime_error";
          log_level = 4; // ERROR
          messageData = {
            event: "bot_runtime_error",
            error: error?.message || String(error),
            stack: error?.stack || null,
            bot_username: botUsername
          };
        } else if (type === "BOT_CRASH") {
          status_code = 500;
          event = "bot_worker_crash";
          error_type = error?.errorType || "WORKER_CRASH";
          log_level = 5; // FATAL
          messageData = {
            event: "bot_worker_crash",
            error: error?.message || String(error),
            stack: error?.stack || null,
            bot_username: botUsername
          };
        } else if (type === "INFO") {
          status_code = 200;
          const infoEvent = infoMessage?.event || "info";
          event = infoEvent;
          log_level = 2; // INFO
          messageData = infoMessage || { event: "info", type };
        }

        await this.persistLog(this.buildLogData({
          botId,
          idapp,
          status_code,
          event,
          log_level,
          error_type,
          message: messageData,
          duration_ms,
          failure_count_snapshot: failureState?.failureCount || 0,
        }));

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

    // Listen to custom bot logs pushed from worker sandboxes (ofapi.log)
    this.manager.on("bot_log_push", async ({ botId, idapp, logData }) => {
      try {
        const meta = this.botMeta.get(botId) || {};
        // Convertir formato LogEntry (del worker) a formato BotLog
        await this.persistLog({
          idbot: botId,
          idapp: idapp || logData?.idapp || null,
          trace_id: logData?.trace_id || this.traceForBot(botId),
          provider: meta.provider || null,
          environment: meta.environment || null,
          event: "bot_custom_log",
          log_level: logData?.log_level ?? 2,
          status_code: logData?.status_code ?? null,
          message: logData?.message || { log: logData?.body },
          user_agent: "worker",
        });
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
    if (botId) {
      this.botTraces.delete(botId);
      this.startAttemptTimestamps.delete(botId);
    }
  }

  buildLogData({ botId, idapp, status_code, event, log_level, error_type, message, duration_ms, failure_count_snapshot, traceId = null }) {
    const meta = this.botMeta.get(botId) || {};
    return {
      idbot: botId || null,
      idapp: idapp || null,
      trace_id: traceId || this.traceForBot(botId),
      provider: meta.provider || null,
      environment: meta.environment || null,
      event: event || "info",
      log_level: log_level ?? 2,
      status_code,
      error_type: error_type || null,
      message,
      duration_ms: duration_ms ?? null,
      failure_count_snapshot: failure_count_snapshot ?? null,
      user_agent: "system",
    };
  }

  async persistLog(logData) {
    try {
      await createBotLog(logData);
    } catch (err) {
      console.error("[BotLifecycleTask] Failed to persist bot log:", err);
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

  /**
   * Decide si lo que está ocurriendo es un incidente de plataforma en lugar de N bots
   * rotos por separado.
   *
   * Cuando la mayoría de los bots falla a la vez por causas recuperables, la causa casi
   * siempre está en el host: red caída, DNS, proxy corporativo, la API del proveedor de
   * capa. Es la misma idea que `max_ejection_percent` de Envoy, que se niega a expulsar
   * más de un porcentaje del cluster porque a esa escala el problema ya no son los hosts.
   *
   * Mientras dura el incidente: no se escala a cuarentena, el backoff se fija en su tope
   * y se emite un único log agregado en vez de uno por bot.
   *
   * @param {number} total bots soportados que deberían estar corriendo
   */
  async evaluatePlatformOutage(total) {
    const failing = this.manager.countRecoverableFailing();
    // Con uno o dos bots no hay muestra suficiente para hablar de incidente de plataforma.
    const isOutage = total >= OUTAGE_MIN_BOTS && failing / total >= OUTAGE_FAILING_RATIO;

    if (!isOutage || this.outageActive) return;

    this.outageActive = true;
    this.manager.setOutageMode(true);
    await this.persistLog(this.buildLogData({
      botId: null,
      idapp: null,
      status_code: 503,
      event: "bot_platform_outage_suspected",
      message: {
        event: "bot_platform_outage_suspected",
        affected_bots: failing,
        total_bots: total,
        description:
          "Most bots are failing with recoverable errors at the same time; assuming a host " +
          "or network incident. Per-bot retry logs are suppressed, quarantine escalation is " +
          "frozen and no bot will be disabled. Retries continue until one starts."
      }
    })).catch(() => {});
  }

  /**
   * Cierra el incidente de plataforma y libera el backoff de todos los bots, para que la
   * recuperación sea inmediata y no escalonada por los cooldowns acumulados.
   */
  async clearPlatformOutage(idapp = null) {
    if (!this.outageActive) return;

    this.outageActive = false;
    this.manager.setOutageMode(false);
    this.manager.resetAllFailureStates("outage_cleared");
    await this.persistLog(this.buildLogData({
      botId: null,
      idapp,
      status_code: 200,
      event: "bot_platform_outage_cleared",
      message: {
        event: "bot_platform_outage_cleared",
        description:
          "A bot started successfully: the host network is back. Backoff cleared for every bot."
      }
    })).catch(() => {});
  }

  async runOnce() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // Consolida los bots que ya superaron la ventana de estabilidad. Se hace aquí, en el
      // ciclo que ya existe, para no sostener un timer por bot.
      this.manager.sealStableBots();

      const activeBots = await getActiveBots();

      // Solo los proveedores con worker implementado se arrancan. Los demás se
      // guardan y se listan, pero nunca se ejecutan.
      const supportedBots = activeBots.filter((b) =>
        RUNTIME_SUPPORTED_PROVIDERS.includes(b.provider)
      );

      // Actualizar metadata de cada bot activo (provider, environment)
      for (const bot of supportedBots) {
        const existing = this.botMeta.get(bot.idbot) || {};
        this.botMeta.set(bot.idbot, {
          ...existing,
          provider: bot.provider,
          environment: bot.environment,
        });
      }

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
            // Registrar evento de parada
            const meta = this.botMeta.get(runningId) || {};
            await this.persistLog({
              idbot: runningId,
              idapp: null,
              trace_id: this.traceForBot(runningId),
              provider: meta.provider || null,
              environment: meta.environment || null,
              event: "bot_stopped",
              log_level: 2,
              status_code: 200,
              message: {
                event: "bot_stopped",
                description: "Bot removed from active list or disabled.",
              },
              user_agent: "system",
            }).catch(() => {});

            // La corrida terminó: si el bot vuelve, abre un trace nuevo.
            this.endBotTrace(runningId);
            this.botMeta.delete(runningId);
            this.startAttemptTimestamps.delete(runningId);
            this.reportedStartupFailures.delete(runningId);
            // Detenerlo es una decisión deliberada (se deshabilitó o se borró), no un
            // fallo: el estado observado debe reflejar eso y no un backoff pendiente.
            // Si la fila ya no existe, el update no afecta ninguna fila.
            await updateBotRuntimeState(runningId, {
              runtime_status: "STOPPED",
              next_retry_at: null,
            }).catch(() => {});
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
              // Dentro del dedup: el bot se salta en cada ciclo de 10 s y no tiene
              // sentido reescribir el mismo estado indefinidamente.
              await updateBotRuntimeState(bot.idbot, {
                runtime_status: "STOPPED",
                last_error_type: "TOKEN_ERROR",
                last_error_message: tokenError?.message || String(tokenError),
                last_failure_at: new Date(),
                next_retry_at: null,
              }).catch(() => {});
              await this.persistLog(
                this.buildLogData({
                  botId: bot.idbot,
                  idapp: bot.idapp,
                  status_code: 400,
                  event: "bot_token_error",
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

          // Tras un reinicio del proceso el backoff en memoria se pierde; se reconstruye
          // desde `next_retry_at` para no golpear al proveedor justo cuando puede seguir
          // caído. No hace nada si ya hay historial vivo o si el plazo ya venció.
          this.manager.hydrateFailureState(bot);

          // Registrar inicio del intento para calcular duration_ms
          this.startAttemptTimestamps.set(bot.idbot, Date.now());

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
                event: "bot_manage_error",
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

      // Se evalúa al final del ciclo, con las rachas de fallo de esta pasada ya
      // registradas por el manager.
      await this.evaluatePlatformOutage(supportedBots.length);
    } catch (error) {
      await this.persistLog(this.buildLogData({
        botId: null,
        idapp: null,
        status_code: 500,
        event: "bot_management_loop_error",
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
