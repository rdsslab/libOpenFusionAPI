import { AsyncJob } from "../db/async_job.js";
import { runHandler } from "../handler/handler.js";
import { EventEmitter } from "node:events";

export class AsyncTaskService extends EventEmitter {
  constructor() {
    super();
    this.endpointLoader = null;
    this.websocketManager = null;
  }

  setDependencies({ endpointLoader, websocketManager }) {
    this.endpointLoader = endpointLoader;
    this.websocketManager = websocketManager;
  }

  async execute({ requestId, endpointBase, endpointAsync, originalRequest, notifyWs }) {
    const job = await AsyncJob.findByPk(requestId);
    if (!job) return;
    await job.update({ status: "RUNNING" });

    try {
      const captured = await this.captureExecution({
        endpointBase,
        originalRequest,
      });

      const contentType =
        captured.headers?.["content-type"] ||
        captured.headers?.["Content-Type"] ||
        "application/json";
      const isBinary =
        contentType &&
        !contentType.includes("application/json") &&
        !contentType.includes("text/") &&
        !contentType.includes("application/javascript") &&
        !contentType.includes("application/xml");

      let result = captured.body;
      let resultIsBinary = false;
      if (Buffer.isBuffer(result)) {
        if (isBinary) {
          result = result.toString("base64");
          resultIsBinary = true;
        } else {
          result = result.toString("utf8");
          resultIsBinary = false;
        }
      } else if (typeof result === "object" && result !== null) {
        result = JSON.stringify(result);
        resultIsBinary = false;
      } else if (result === undefined || result === null) {
        result = result;
        resultIsBinary = false;
      } else {
        result = String(result);
        resultIsBinary = false;
      }

      const ttl_ms = endpointAsync?.custom_data?.async?.ttl_ms ?? 3600000;
      await job.update({
        status: "COMPLETED",
        content_type: contentType,
        response_headers: captured.headers || {},
        result,
        result_is_binary: resultIsBinary,
        completed_at: new Date(),
        expires_at: new Date(Date.now() + ttl_ms),
      });

      if (notifyWs && this.websocketManager) {
        try {
          this.websocketManager.emit("async_done", { requestId, status: "COMPLETED" });
        } catch (e) {
          console.error("[AsyncTaskService] WS emit error:", e);
        }
      }
    } catch (err) {
      await job.update({
        status: "FAILED",
        error_message: err?.message || String(err),
        completed_at: new Date(),
      });
      if (notifyWs && this.websocketManager) {
        try {
          this.websocketManager.emit("async_error", { requestId, status: "FAILED", error: err?.message });
        } catch (e) {
          console.error("[AsyncTaskService] WS emit error:", e);
        }
      }
    }
  }

  async captureExecution({ endpointBase, originalRequest }) {
    const headers = {};
    const captured = {
      statusCode: 200,
      headers,
      body: null,
    };

    const reply = {
      sent: false,
      code(statusCode) {
        captured.statusCode = statusCode;
        return this;
      },
      status(statusCode) {
        captured.statusCode = statusCode;
        return this;
      },
      header(key, value) {
        headers[key.toLowerCase()] = value;
        return this;
      },
      headers(obj) {
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            headers[k.toLowerCase()] = v;
          }
        }
        return this;
      },
      type(contentType) {
        headers["content-type"] = contentType;
        return this;
      },
      send(data) {
        if (this.sent) return;
        this.sent = true;
        if (Buffer.isBuffer(data)) {
          captured.body = data;
        } else if (typeof data === "string") {
          captured.body = data;
        } else if (data === undefined || data === null) {
          captured.body = data;
        } else {
          try {
            const ct = headers["content-type"] || "";
            if (ct.includes("json")) {
              captured.body = JSON.stringify(data);
            } else {
              captured.body = data;
            }
          } catch {
            captured.body = data;
          }
        }
        return this;
      },
    };

    const request = originalRequest || {};
    await runHandler(request, reply, endpointBase, {});
    return captured;
  }
}

export const asyncTaskService = new AsyncTaskService();
export default asyncTaskService;
