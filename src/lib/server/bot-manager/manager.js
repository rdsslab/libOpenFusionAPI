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

export class BotManager extends EventEmitter {
  constructor() {
    super();
    this.activeBots = new Map(); // Map<botId, Worker>
    this.botErrorHistory = new Map(); // Map<botId, { timestamps: [], cooldownUntil: 0, firstFailureAt: null }>
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
   */
  async startBot(botId, token, code, environment, app_env_vars, idapp) {
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
      this.emit("bot_log", {
        botId,
        idapp,
        type: "ERROR",
        error: {
          message: `Bot ${botId} is in cooldown. Try again in ${remaining} seconds.`,
          errorType: "COOLDOWN"
        }
      });
      throw new Error(`Bot ${botId} is in cooldown`);
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
          this.emit("bot_log", {
            botId,
            idapp,
            type: "ERROR",
            error: msg.errorInfo || { message: msg.error }
          });
          const entry = this.activeBots.get(botId);
          if (entry && entry.worker === worker) {
            this.activeBots.delete(botId);
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

            // Handle error history and cooldown
            let history = this.botErrorHistory.get(botId);
            if (!history) {
              history = { timestamps: [], cooldownUntil: 0, firstFailureAt: null };
              this.botErrorHistory.set(botId, history);
            }

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
              disableReason = "crash_count_threshold";
            } else if (now - history.firstFailureAt >= BOT_FAILURE_DURATION_MS) {
              disableReason = "duration_threshold";
            }

            if (disableReason) {
              this.emit("bot_log", {
                botId,
                idapp,
                type: "BOT_CRASH",
                error: {
                  message: `Bot reached auto-disable threshold (${disableReason}). Disabling endpoint.`
                },
                botInfo: entry.botInfo
              });
              history.cooldownUntil = now + BOT_FAILURE_WINDOW_MS;
              history.timestamps = [];
              history.firstFailureAt = null;
              // Notify callers so they can persist enabled=false in the DB
              this.emit("disable", { botId, idapp, reason: disableReason });
            }
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
        payload: { botId, token, code, environment, app_env_vars },
      });

      this.activeBots.set(botId, { worker, configHash, idapp, botInfo: null });
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
