import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const BOT_FAILURE_THRESHOLD = 3;              // failures before auto-disable

export class BotManager extends EventEmitter {
  constructor() {
    super();
    this.activeBots = new Map(); // Map<botId, Worker>
    this.botErrorHistory = new Map(); // Map<botId, { timestamps: [], cooldownUntil: 0 }>
  }

  /**
   * Start a bot in a separate thread
   * @param {string} botId - Unique ID for the bot
   * @param {string} token - Telegram Bot Token
   * @param {string} code - The Javascript code string to execute
   * @param {string} environment - The environment to run the bot in (e.g. 'dev', 'prd')
   * @param {Object} app_env_vars - The appvars object to run the bot in (e.g. 'dev', 'prd')
   * @param {string} [idapp] - The UUID of the application
   */
  startBot(botId, token, code, environment, app_env_vars, idapp) {
    return new Promise(async (resolve, reject) => {

      if (!(botId && token && code && token.length > 0 && code.length > 0)) {
        reject(new Error("Bot data is invalid"));
      }

      // Check for cooldown
      const history = this.botErrorHistory.get(botId);
      if (history && history.cooldownUntil > Date.now()) {
        const remaining = Math.ceil((history.cooldownUntil - Date.now()) / 1000);
        console.warn(`[Manager] Bot ${botId} is in cooldown. Try again in ${remaining} seconds.`);
        reject(new Error(`Bot ${botId} is in cooldown`));
        return;
      }

      const existingEntry = this.activeBots.get(botId);

      // Calculate hash of the new code
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');

      if (existingEntry) {
        if (existingEntry.codeHash !== codeHash) {
          console.log(`[Manager] Bot ${botId} code has changed. Restarting...`);
          try {
            await this.stopBot(botId);
          } catch (err) {
            console.error(`[Manager] Error stopping bot ${botId} for restart:`, err);
          }
          // Proceed to start the new worker
        } else {
          console.log(`[Manager] Bot ${botId} is already running with the same code.`);
          resolve();
          return;
        }
      }

      const worker = new Worker(path.join(__dirname, "worker.js"));

      worker.on("message", (msg) => {
        if (msg.type === "STARTED") {
          console.log(`[Manager] Bot ${botId} started successfully.`);
          const entry = this.activeBots.get(botId);
          if (entry) {
            entry.botInfo = msg.botInfo;
          }
          this.emit("bot_log", {
            botId,
            idapp,
            type: "STARTED",
            botInfo: msg.botInfo
          });
          resolve();
        } else if (msg.type === "ERROR") {
          console.error(`[Manager] Bot ${botId} reported error: ${msg.error}`);
          this.emit("bot_log", {
            botId,
            idapp,
            type: "ERROR",
            error: msg.errorInfo || { message: msg.error }
          });
          this.activeBots.delete(botId);
          worker.terminate();
          reject(new Error(msg.error));
        } else if (msg.type === "BOT_ERROR") {
          console.error(`[Manager] Bot ${botId} runtime error:`, msg.error);
          const entry = this.activeBots.get(botId);
          this.emit("bot_log", {
            botId,
            idapp,
            type: "BOT_ERROR",
            error: msg.error,
            botInfo: entry ? entry.botInfo : null
          });
        } else if (msg.type === "STOPPED") {
          console.log(`[Manager] Bot ${botId} stopped.`);
        }
      });

      worker.on("error", (err) => {
        console.error(`[Manager] Worker for bot ${botId} error:`, err);
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
        this.activeBots.delete(botId);
        reject(err);
      });

      worker.on("exit", (code) => {
        const entry = this.activeBots.get(botId);
        if (entry && entry.worker === worker) {
          if (code !== 0) {
            console.error(
              `[Manager] Worker for bot ${botId} stopped with exit code ${code}`,
            );

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
              history = { timestamps: [], cooldownUntil: 0 };
              this.botErrorHistory.set(botId, history);
            }

            const now = Date.now();
            history.timestamps.push(now);

            // Keep only errors within the failure window
            history.timestamps = history.timestamps.filter(
              (t) => now - t < BOT_FAILURE_WINDOW_MS,
            );

            if (history.timestamps.length >= BOT_FAILURE_THRESHOLD) {
              console.error(
                `[Manager] Bot ${botId} reached ${BOT_FAILURE_THRESHOLD} failures in 5 minutes. Disabling endpoint.`,
              );
              history.cooldownUntil = now + BOT_FAILURE_WINDOW_MS;
              history.timestamps = [];
              // Notify callers so they can persist enabled=false in the DB
              this.emit("disable", { botId });
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

      this.activeBots.set(botId, { worker, codeHash, idapp, botInfo: null });
    });
  }

  /**
   * Stop a running bot
   * @param {string} botId
   */
  async stopBot(botId) {
    if (!this.activeBots.has(botId)) {
      console.log(`[Manager] Bot ${botId} not running.`);
      return;
    }

    const { worker } = this.activeBots.get(botId);

    // Try graceful stop first
    worker.postMessage({ type: "STOP" });

    // Force termination after short timeout if it doesn't exit
    return new Promise((resolve) => {
      const timeout = setTimeout(async () => {
        console.log(`[Manager] Forcing termination of bot ${botId}`);
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
