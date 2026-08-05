import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_FAILURE_WINDOW_MS = 5 * 60 * 1000;      // 5 minutes
const BOT_FAILURE_THRESHOLD = 3;                   // failures before auto-disable
const BOT_FAILURE_DURATION_MS = 5 * 60 * 1000;     // continuous failure duration before auto-disable

/**
 * Fallos que NO se arreglan solos (token revocado, script inválido, crash del worker)
 * cuentan para el auto-disable: reintentar es desperdicio. Un fallo de red sí se
 * arregla solo cuando la red vuelve, así que se reintenta con backoff creciente y
 * nunca deshabilita la fila: si no, un corte de red o un proxy corporativo que
 * bloquea la API del proveedor deja el bot apagado y exige intervención manual.
 */
const BOT_TRANSIENT_ERROR_TYPES = new Set(["CONNECTION_ERROR"]);

/** Backoff por intento transitorio consecutivo; se queda en el último valor. */
const BOT_TRANSIENT_BACKOFF_MS = [
  10 * 1000,
  30 * 1000,
  60 * 1000,
  2 * 60 * 1000,
  5 * 60 * 1000,
];

export class BotManager extends EventEmitter {
  constructor() {
    super();
    this.activeBots = new Map(); // Map<botId, Worker>
    // Map<botId, { timestamps: [], cooldownUntil: 0, firstFailureAt: null,
    //              transientCount: 0, cooldownReported: false, lastFailureType: null }>
    this.botErrorHistory = new Map();
  }

  /** Estado inicial del historial de fallos de un bot. */
  newErrorHistory() {
    return {
      timestamps: [],
      cooldownUntil: 0,
      firstFailureAt: null,
      transientCount: 0,
      cooldownReported: false,
      lastFailureType: null,
    };
  }

  errorHistoryFor(botId) {
    let history = this.botErrorHistory.get(botId);
    if (!history) {
      history = this.newErrorHistory();
      this.botErrorHistory.set(botId, history);
    }
    return history;
  }

  /**
   * Start a Telegram bot in a separate thread.
   * This manager is currently Telegram-specific; future providers will delegate to their own workers.
   * @param {string} botId - Unique ID for the bot
   * @param {string} token - Telegram Bot Token
   * @param {string} code - The Javascript code string to execute (grammY-based)
   * @param {string} environment - The environment to run the bot in (e.g. 'dev', 'prd')
   * @param {Object} app_env_vars - The appvars object to run the bot in (e.g. 'dev', 'prd')
   * @param {string} [idapp] - The UUID of the application
   * @param {string} [traceId] - trace_id de la corrida, compartido por todos los logs
   *   del intento de arranque y por los `ofapi.log` del código del bot. Deliberadamente
   *   fuera del hash de configuración: cambiarlo no debe reiniciar el worker.
   */
  async startBot(botId, token, code, environment, app_env_vars, idapp, traceId) {
    if (!(botId && token && code && token.length > 0 && code.length > 0)) {
      this.emit("bot_log", {
        botId,
        idapp,
        type: "ERROR",
        error: { message: "Bot data is invalid", errorType: "INVALID_DATA" }
      });
      throw new Error("Bot data is invalid");
    }

    // Check for cooldown
    const history = this.botErrorHistory.get(botId);
    if (history && history.cooldownUntil > Date.now()) {
      const remaining = Math.ceil((history.cooldownUntil - Date.now()) / 1000);
      // Un bot en cooldown que sigue `enabled` se reintenta cada ciclo de 10 s. Sin
      // esta marca, cada intento escribía un log y una espera de 5 min producía ~30
      // filas idénticas. Se reporta una sola vez por ventana de cooldown.
      if (!history.cooldownReported) {
        history.cooldownReported = true;
        this.emit("bot_log", {
          botId,
          idapp,
          type: "INFO",
          error: null,
          message: {
            event: "bot_start_deferred",
            error_type: history.lastFailureType || "COOLDOWN",
            retry_in_seconds: remaining,
            description: `Bot in cooldown; next start attempt in ~${remaining}s.`
          }
        });
      }
      // `code` permite al lifecycle distinguir un cooldown esperado de un fallo real
      // y no registrarlo como `bot_manage_error` en cada ciclo.
      const cooldownError = new Error(`Bot ${botId} is in cooldown`);
      cooldownError.code = "BOT_COOLDOWN";
      throw cooldownError;
    }

    const existingEntry = this.activeBots.get(botId);

    // Incluir token y app_env_vars en el hash para detectar cualquier cambio de configuración.
    // Si token, code o app_env_vars cambian, el worker se reinicia con la nueva config.
    const configPayload = JSON.stringify({ token, code, app_env_vars });
    const configHash = crypto.createHash('sha256').update(configPayload).digest('hex');

    if (existingEntry) {
      if (existingEntry.configHash !== configHash) {
        this.emit("bot_log", {
          botId,
          idapp,
          type: "INFO",
          error: null,
          botInfo: existingEntry.botInfo,
          message: { event: "bot_restarting", reason: "code_changed" }
        });
        try {
          await this.stopBot(botId);
        } catch (err) {
          this.emit("bot_log", {
            botId,
            idapp,
            type: "BOT_ERROR",
            error: {
              message: `Error stopping bot for restart: ${err.message}`,
              stack: err.stack
            },
            botInfo: existingEntry.botInfo
          });
        }
        // Proceed to start the new worker
      } else {
        return;
      }
    }

    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "worker.js"));

      worker.on("message", (msg) => {
        if (msg.type === "STARTED") {
          const entry = this.activeBots.get(botId);
          if (entry) {
            entry.botInfo = msg.botInfo;
          }
          this.botErrorHistory.delete(botId);
          this.emit("bot_log", {
            botId,
            idapp,
            type: "STARTED",
            botInfo: msg.botInfo
          });
          resolve();
        } else if (msg.type === "ERROR") {
          const errorInfo = msg.errorInfo || { message: msg.error };
          this.emit("bot_log", {
            botId,
            idapp,
            type: "ERROR",
            error: errorInfo
          });
          const entry = this.activeBots.get(botId);
          if (entry && entry.worker === worker) {
            this.activeBots.delete(botId);
          }
          // Un fallo de arranque cuenta para la política de auto-disable. El worker
          // sale limpiamente tras reportarlo, así que el handler de `exit` no lo ve.
          // Excepción: un fallo de red es transitorio y solo programa un reintento.
          if (BOT_TRANSIENT_ERROR_TYPES.has(errorInfo.errorType)) {
            this.registerTransientFailure(
              botId,
              idapp,
              entry?.botInfo || null,
              errorInfo.errorType
            );
          } else {
            this.registerFailure(
              botId,
              idapp,
              entry?.botInfo || null,
              "startup_failure_threshold"
            );
          }
          // Safe fallback cleanup: terminate only if the worker didn't exit on its own after 1 second
          setTimeout(() => {
            if (worker.threadId !== -1) {
              worker.terminate().catch(() => {});
            }
          }, 1000);
          reject(new Error(msg.error));
        } else if (msg.type === "BOT_ERROR") {
          const entry = this.activeBots.get(botId);
          this.emit("bot_log", {
            botId,
            idapp,
            type: "BOT_ERROR",
            error: msg.error,
            botInfo: entry ? entry.botInfo : null
          });
        } else if (msg.type === "BOT_LOG_PUSH") {
          this.emit("bot_log_push", {
            botId,
            idapp,
            logData: msg.logData
          });
        }
      });

      worker.on("error", (err) => {
        const entry = this.activeBots.get(botId);
        this.emit("bot_log", {
          botId,
          idapp,
          type: "BOT_CRASH",
          error: {
            message: `Worker crash: ${err.message}`,
            stack: err.stack
          },
          botInfo: entry ? entry.botInfo : null
        });
        if (entry && entry.worker === worker) {
          this.activeBots.delete(botId);
        }
        reject(err);
      });

      worker.on("exit", (code) => {
        const entry = this.activeBots.get(botId);
        if (entry && entry.worker === worker) {
          if (code !== 0) {
            this.emit("bot_log", {
              botId,
              idapp,
              type: "BOT_CRASH",
              error: {
                message: `Worker exited with non-zero exit code: ${code}`
              },
              botInfo: entry.botInfo
            });

            this.registerFailure(botId, idapp, entry.botInfo, "crash_count_threshold");
          } else {
            // Clean exit resets any failure streak
            const history = this.botErrorHistory.get(botId);
            if (history) {
              history.firstFailureAt = null;
              history.timestamps = [];
            }
          }
          this.activeBots.delete(botId);
        }
      });

      // Send payload to worker
      worker.postMessage({
        type: "START",
        payload: { botId, token, code, environment, app_env_vars, traceId },
      });

      this.activeBots.set(botId, { worker, configHash, idapp, botInfo: null });
    });
  }

  /**
   * Registra un fallo del bot y aplica la política de auto-disable.
   *
   * Se invoca tanto cuando el worker muere con código distinto de cero como cuando el
   * arranque falla (token inválido, red inalcanzable, script inválido). Este segundo
   * caso antes no se contabilizaba: el worker reportaba el error y salía limpiamente,
   * así que la racha se reseteaba y un bot mal configurado reintentaba indefinidamente
   * cada 10 s, inundando la tabla de logs sin llegar nunca a deshabilitarse.
   *
   * @param {string} botId
   * @param {string} [idapp]
   * @param {object} [botInfo]
   * @param {string} countReason - motivo a reportar si se cruza el umbral por conteo
   */
  registerFailure(botId, idapp, botInfo = null, countReason = "crash_count_threshold") {
    const history = this.errorHistoryFor(botId);
    history.lastFailureType = countReason;

    const now = Date.now();

    // Mark the start of the current failure streak
    if (history.firstFailureAt === null) {
      history.firstFailureAt = now;
    }

    history.timestamps.push(now);

    // Keep only errors within the failure window
    history.timestamps = history.timestamps.filter(
      (t) => now - t < BOT_FAILURE_WINDOW_MS,
    );

    let disableReason = null;

    if (history.timestamps.length >= BOT_FAILURE_THRESHOLD) {
      disableReason = countReason;
    } else if (now - history.firstFailureAt >= BOT_FAILURE_DURATION_MS) {
      disableReason = "duration_threshold";
    }

    if (!disableReason) return;

    this.emit("bot_log", {
      botId,
      idapp,
      type: "BOT_CRASH",
      error: {
        message: `Bot reached auto-disable threshold (${disableReason}). Disabling bot.`
      },
      botInfo
    });
    history.cooldownUntil = now + BOT_FAILURE_WINDOW_MS;
    history.cooldownReported = false;
    history.timestamps = [];
    history.firstFailureAt = null;
    // Notify callers so they can persist enabled=false in the DB
    this.emit("disable", { botId, idapp, reason: disableReason });
  }

  /**
   * Registra un fallo transitorio (hoy solo `CONNECTION_ERROR`) y programa un reintento.
   *
   * A diferencia de `registerFailure`, NO cuenta para el umbral de auto-disable y nunca
   * emite `disable`: la fila queda `enabled` y el lifecycle la reintenta cuando venza el
   * cooldown. El backoff crece con los intentos consecutivos para no golpear una API
   * inalcanzable cada 10 s. Un arranque exitoso borra el historial y resetea el backoff.
   *
   * @param {string} botId
   * @param {string} [idapp]
   * @param {object} [botInfo]
   * @param {string} errorType tipo transitorio reportado por el worker
   */
  registerTransientFailure(botId, idapp, botInfo = null, errorType = "CONNECTION_ERROR") {
    const history = this.errorHistoryFor(botId);
    const now = Date.now();

    history.transientCount += 1;
    history.lastFailureType = errorType;

    const backoffMs = BOT_TRANSIENT_BACKOFF_MS[
      Math.min(history.transientCount - 1, BOT_TRANSIENT_BACKOFF_MS.length - 1)
    ];
    history.cooldownUntil = now + backoffMs;
    // El log del cooldown ya lo emite este evento; no repetirlo en el próximo ciclo.
    history.cooldownReported = true;

    // Un fallo transitorio no debe acercar al bot al auto-disable.
    history.timestamps = [];
    history.firstFailureAt = null;

    this.emit("bot_log", {
      botId,
      idapp,
      type: "INFO",
      error: null,
      botInfo,
      message: {
        event: "bot_start_retry_scheduled",
        error_type: errorType,
        attempt: history.transientCount,
        retry_in_seconds: Math.round(backoffMs / 1000),
        description:
          "Transient failure: the bot stays enabled and will be retried with backoff. " +
          "It is not counted toward the auto-disable threshold."
      }
    });
  }

  /**
   * Stop a running bot
   * @param {string} botId
   */
  async stopBot(botId) {
    if (!this.activeBots.has(botId)) {
      return;
    }

    const { worker } = this.activeBots.get(botId);

    // Try graceful stop first
    worker.postMessage({ type: "STOP" });

    // Force termination after short timeout if it doesn't exit
    return new Promise((resolve) => {
      const timeout = setTimeout(async () => {
        await worker.terminate();
        this.activeBots.delete(botId);
        resolve();
      }, 2000);

      worker.once("exit", () => {
        clearTimeout(timeout);
        this.activeBots.delete(botId);
        resolve();
      });
    });
  }

  listActiveBots() {
    return Array.from(this.activeBots.keys());
  }
}
