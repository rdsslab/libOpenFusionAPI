import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import {
  BACKOFF_TIER,
  BOT_HEALTHY_AFTER_MS,
  FAILURE_CLASS,
  PERMANENT_DISABLE_ATTEMPTS,
  RUNTIME_STATUS,
  classifyBotFailure,
  isRecoverable,
  maxFastBackoffMs,
  nextBackoffMs,
  quarantineThresholdFor,
} from "./failurePolicy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Orquestador de workers de bots.
 *
 * Política de resiliencia (ver failurePolicy.js para las constantes y la taxonomía):
 *
 * - `enabled` es la intención del usuario y el manager NO la pisa por un fallo
 *   recuperable. Un corte de red, un DNS caído, un 429 o un 5xx del proveedor generan
 *   backoff exponencial con jitter y, si la racha se alarga, cuarentena: sondeo cada
 *   15/30/60 minutos de forma indefinida. El bot vuelve solo cuando el entorno se
 *   recupera, sin que nadie tenga que re-habilitarlo.
 * - Solo un fallo permanente (token revocado, código que no compila) emite `disable`,
 *   y aun así se marca `disabled_by = 'system'` para que corregir el token o el código
 *   vuelva a habilitarlo automáticamente.
 *
 * El manager no toca la BBDD: publica su estado con el evento `bot_health` y el
 * BotLifecycleTask lo persiste. Eventos emitidos:
 *   - `bot_log`      → una fila de log (STARTED | ERROR | BOT_ERROR | BOT_CRASH | INFO)
 *   - `bot_log_push` → log emitido por el propio código del bot
 *   - `bot_health`   → `{ botId, idapp, patch }` con columnas de estado de `ofapi_bot`
 *   - `disable`      → solo para fallos permanentes
 */
export class BotManager extends EventEmitter {
  constructor() {
    super();
    this.activeBots = new Map(); // Map<botId, { worker, configHash, idapp, botInfo, startedAt, healthySealed }>
    this.botErrorHistory = new Map(); // Map<botId, ReturnType<newErrorHistory>>

    /**
     * Modo incidente de plataforma: lo activa el BotLifecycleTask cuando la mayoría de
     * los bots fallan a la vez por causas recuperables. Mientras está activo no se
     * escala a cuarentena (el problema es del host, no de los bots) y no se emite un log
     * de reintento por bot. Ver BotLifecycleTask.evaluatePlatformOutage().
     */
    this.outageMode = false;
  }

  /** Estado inicial del historial de fallos de un bot. */
  newErrorHistory() {
    return {
      failureCount: 0,
      cooldownUntil: 0,
      firstFailureAt: null,
      cooldownReported: false,
      quarantined: false,
      lastFailureType: null,
      lastFailureClass: null,
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

  /** Publica un parche de estado observado para que el ciclo de vida lo persista. */
  emitHealth(botId, idapp, patch) {
    this.emit("bot_health", { botId, idapp, patch });
  }

  /**
   * Reconstruye el backoff de un bot a partir de lo persistido en BBDD.
   *
   * Sin esto, un reinicio del proceso borra el historial en memoria y todos los bots en
   * cuarentena vuelven a golpear al proveedor en el primer ciclo — exactamente cuando el
   * proveedor puede seguir caído. Solo se aplica si no hay historial vivo y el
   * `next_retry_at` guardado todavía está en el futuro.
   *
   * @param {Object} bot fila de ofapi_bot tal como la devuelve getActiveBots()
   */
  hydrateFailureState(bot) {
    if (!bot?.idbot || this.botErrorHistory.has(bot.idbot)) return;

    const nextRetryAt = bot.next_retry_at ? new Date(bot.next_retry_at).getTime() : 0;
    if (!Number.isFinite(nextRetryAt) || nextRetryAt <= Date.now()) return;

    const history = this.errorHistoryFor(bot.idbot);
    history.failureCount = Number(bot.failure_count) || 0;
    history.cooldownUntil = nextRetryAt;
    // Ya se reportó antes de reiniciar; no volver a llenar el log con el mismo aviso.
    history.cooldownReported = true;
    history.quarantined = bot.runtime_status === RUNTIME_STATUS.QUARANTINED;
    history.lastFailureType = bot.last_error_type || null;
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

    this.emitHealth(botId, idapp, { runtime_status: RUNTIME_STATUS.STARTING });

    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "worker.js"));

      worker.on("message", (msg) => {
        if (msg.type === "STARTED") {
          const entry = this.activeBots.get(botId);
          if (entry) {
            entry.botInfo = msg.botInfo;
            // El arranque aún no se considera consolidado: la racha de fallos se limpia
            // solo cuando el bot supere la ventana de estabilidad. Ver sealStableBots().
            entry.startedAt = Date.now();
            entry.healthySealed = false;
          }
          this.emit("bot_log", {
            botId,
            idapp,
            type: "STARTED",
            botInfo: msg.botInfo
          });
          this.emitHealth(botId, idapp, {
            runtime_status: RUNTIME_STATUS.RUNNING,
            last_started_at: new Date(),
            next_retry_at: null,
          });
          // Un arranque exitoso prueba que la red del host funciona: si había un
          // incidente de plataforma en curso, se da por superado.
          this.emit("bot_started", { botId, idapp });
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
          // Un fallo de arranque entra en la política de reintentos. El worker sale
          // limpiamente tras reportarlo, así que el handler de `exit` no lo ve.
          this.registerFailure(botId, idapp, entry?.botInfo || null, errorInfo);
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
        // Antes se borraba la entrada sin contabilizar nada, y como el `exit` posterior
        // ya no encontraba entrada, una excepción dura del worker no contaba para
        // ninguna política: el bot reintentaba cada 10 s indefinidamente.
        this.registerFailure(botId, idapp, entry?.botInfo || null, {
          message: err.message,
          name: err.name,
          code: err.code,
          errorType: "WORKER_CRASH",
        });
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

            this.registerFailure(botId, idapp, entry.botInfo, {
              message: `Worker exited with non-zero exit code: ${code}`,
              errorType: "WORKER_EXIT",
            });
          } else {
            // Una salida limpia no es un fallo, pero tampoco confirma salud: la racha se
            // limpia únicamente al superar la ventana de estabilidad.
            this.emitHealth(botId, idapp, { runtime_status: RUNTIME_STATUS.STOPPED });
          }
          this.activeBots.delete(botId);
        }
      });

      // Send payload to worker
      worker.postMessage({
        type: "START",
        payload: { botId, token, code, environment, app_env_vars, traceId },
      });

      this.activeBots.set(botId, {
        worker,
        configHash,
        idapp,
        botInfo: null,
        startedAt: null,
        healthySealed: false,
      });
    });
  }

  /**
   * Consolida los bots que llevan arriba más que la ventana de estabilidad: limpia su
   * racha de fallos y sella `last_healthy_at`.
   *
   * Antes la racha se borraba en cuanto llegaba `STARTED`, así que un bot que arrancaba y
   * moría a los 2 segundos en bucle reseteaba su historial en cada intento y nunca cruzaba
   * ningún umbral: el caso que más merece atención era el único invisible. Es el mismo
   * criterio con el que Kubernetes resetea el backoff de un CrashLoopBackOff.
   *
   * Lo invoca BotLifecycleTask en su ciclo de 10 s, para no sostener timers adicionales.
   */
  sealStableBots() {
    const now = Date.now();
    for (const [botId, entry] of this.activeBots) {
      if (entry.healthySealed || !entry.startedAt) continue;
      if (now - entry.startedAt < BOT_HEALTHY_AFTER_MS) continue;

      entry.healthySealed = true;
      this.botErrorHistory.delete(botId);
      this.emitHealth(botId, entry.idapp, {
        runtime_status: RUNTIME_STATUS.RUNNING,
        failure_count: 0,
        next_retry_at: null,
        last_healthy_at: new Date(now),
      });
    }
  }

  /**
   * Registra un fallo del bot y programa el siguiente intento.
   *
   * Se invoca desde el fallo de arranque, el crash del worker y la salida con código
   * distinto de cero. La clase del fallo decide todo:
   *
   * - PERMANENT (token revocado, código inválido): tras PERMANENT_DISABLE_ATTEMPTS emite
   *   `disable`. Reintentar no lo arregla y hace falta corregir la causa.
   * - TRANSIENT / UNKNOWN: nunca emite `disable`. Backoff exponencial con jitter y, si la
   *   racha se alarga, cuarentena con sondeo de 15/30/60 minutos indefinidamente.
   *
   * @param {string} botId
   * @param {string} [idapp]
   * @param {object} [botInfo]
   * @param {object} [errorInfo] payload de error del worker
   */
  registerFailure(botId, idapp, botInfo = null, errorInfo = {}) {
    const history = this.errorHistoryFor(botId);
    const now = Date.now();
    const failureClass = classifyBotFailure(errorInfo);
    const errorType = errorInfo?.errorType || "STARTUP_ERROR";

    if (history.firstFailureAt === null) history.firstFailureAt = now;
    history.failureCount += 1;
    history.lastFailureType = errorType;
    history.lastFailureClass = failureClass;

    const failurePatch = {
      failure_count: history.failureCount,
      last_error_type: errorType,
      last_error_message: errorInfo?.message ? String(errorInfo.message) : null,
      last_failure_at: new Date(now),
    };

    // ── Fallo permanente: se agota la paciencia y se deshabilita ──────────────
    if (
      failureClass === FAILURE_CLASS.PERMANENT &&
      history.failureCount >= PERMANENT_DISABLE_ATTEMPTS
    ) {
      const reason = `permanent_failure:${errorType}`;
      this.emit("bot_log", {
        botId,
        idapp,
        type: "BOT_CRASH",
        error: {
          message:
            `Bot disabled after ${history.failureCount} permanent failures (${errorType}). ` +
            `Retrying cannot fix this; correct the token or the code and the bot will be ` +
            `re-enabled automatically.`
        },
        botInfo
      });
      // El bot queda apagado: sin cooldown que estorbe un reintento manual posterior.
      history.cooldownUntil = 0;
      history.cooldownReported = false;
      this.emitHealth(botId, idapp, {
        ...failurePatch,
        runtime_status: RUNTIME_STATUS.DISABLED_ERROR,
        next_retry_at: null,
      });
      this.emit("disable", { botId, idapp, reason, errorType });
      return;
    }

    // ── Fallo recuperable (o permanente que aún no agota los intentos) ────────
    // En un incidente de plataforma no se escala a cuarentena: el problema es del host y
    // penalizar a cada bot solo retrasaría la recuperación cuando la red vuelva.
    const threshold = quarantineThresholdFor(failureClass);
    const quarantined =
      !this.outageMode &&
      isRecoverable(failureClass) &&
      history.failureCount >= threshold;

    history.quarantined = quarantined;

    let backoffMs;
    if (this.outageMode && isRecoverable(failureClass)) {
      backoffMs = maxFastBackoffMs();
    } else if (quarantined) {
      backoffMs = nextBackoffMs(history.failureCount - threshold + 1, BACKOFF_TIER.QUARANTINE);
    } else {
      backoffMs = nextBackoffMs(history.failureCount, BACKOFF_TIER.FAST);
    }

    // Un 429 de Telegram trae su propio `retry_after`: respetarlo es lo correcto y evita
    // profundizar el rate limit reintentando antes de tiempo.
    const retryAfterMs = Number(errorInfo?.retry_after) * 1000;
    if (Number.isFinite(retryAfterMs) && retryAfterMs > backoffMs) {
      backoffMs = retryAfterMs;
    }

    history.cooldownUntil = now + backoffMs;
    // El log del reintento ya se emite aquí abajo; no repetirlo en el próximo ciclo.
    history.cooldownReported = true;

    const nextRetryAt = new Date(history.cooldownUntil);
    this.emitHealth(botId, idapp, {
      ...failurePatch,
      runtime_status: quarantined ? RUNTIME_STATUS.QUARANTINED : RUNTIME_STATUS.BACKOFF,
      next_retry_at: nextRetryAt,
    });

    // Durante un incidente de plataforma el ciclo de vida emite un único log agregado en
    // lugar de uno por bot.
    if (this.outageMode) return;

    this.emit("bot_log", {
      botId,
      idapp,
      type: "INFO",
      error: null,
      botInfo,
      message: {
        event: quarantined ? "bot_quarantined" : "bot_start_retry_scheduled",
        error_type: errorType,
        failure_class: failureClass,
        attempt: history.failureCount,
        retry_in_seconds: Math.round(backoffMs / 1000),
        next_retry_at: nextRetryAt.toISOString(),
        description: quarantined
          ? "Recoverable failures persist: the bot stays enabled and moves to slow probing. " +
            "It will recover on its own once the cause clears; no manual action is required."
          : "Recoverable failure: the bot stays enabled and will be retried with backoff."
      }
    });
  }

  /**
   * Descarta el estado de fallo de un bot para que el próximo ciclo lo reintente ya.
   *
   * Lo llaman las acciones explícitas del operador (habilitar el bot, editar su fila).
   * Sin esto, tras un auto-disable el `cooldownUntil` seguía vivo en memoria y una
   * re-habilitación manual se topaba con un rechazo `BOT_COOLDOWN`: ni el remedio
   * automático ni el manual funcionaban.
   *
   * @param {string} botId
   * @param {string} [reason] solo informativo, para trazas
   */
  resetFailureState(botId, reason = "manual_reset") {
    if (!botId || !this.botErrorHistory.has(botId)) return false;
    this.botErrorHistory.delete(botId);
    this.emitHealth(botId, this.activeBots.get(botId)?.idapp, {
      runtime_status: this.activeBots.has(botId)
        ? RUNTIME_STATUS.RUNNING
        : RUNTIME_STATUS.STOPPED,
      failure_count: 0,
      next_retry_at: null,
    });
    return true;
  }

  /** Descarta el backoff de todos los bots (fin de un incidente de plataforma). */
  resetAllFailureStates(reason = "outage_cleared") {
    for (const botId of Array.from(this.botErrorHistory.keys())) {
      this.resetFailureState(botId, reason);
    }
  }

  /**
   * Activa o desactiva el modo incidente de plataforma.
   * @returns {boolean} true si el modo cambió
   */
  setOutageMode(active) {
    const next = Boolean(active);
    if (this.outageMode === next) return false;
    this.outageMode = next;
    return true;
  }

  /** Bots con una racha de fallos recuperables en curso, para detectar un incidente global. */
  countRecoverableFailing() {
    let count = 0;
    for (const history of this.botErrorHistory.values()) {
      if (history.failureCount > 0 && isRecoverable(history.lastFailureClass)) count += 1;
    }
    return count;
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
