import { Buffer } from "node:buffer";
import { getIPFromRequest } from "../utils.js";
import { getLogLevelForStatus } from "./utils.js";
import { getCorrectedNow } from "../timeSync.js";

const DEFAULT_ID_APP = "62a03367-e2d5-459c-b236-b6878f546142";

/**
 * Manages log generation, data truncation, and log persistence.
 * Decoupled from EventEmitter via an injected emit callback.
 */
export class EndpointLogger {
  /**
   * @param {(event: string, data: any) => void} emitFn - Bound emit from the parent EventEmitter.
   */
  constructor(emitFn, dependencies = {}) {
    this._emit = emitFn;
    this._createLog = dependencies.createLog;
  }

  async pushLog(log) {
    try {
      const data = await this._createLog(log);
      return { data, error: undefined };
    } catch (err) {
      return { data: undefined, error: err };
    }
  }

  getDataLog(log_level, request, reply) {
    let handler_param = request?.openfusionapi?.handler?.params || {};

    let iduser = undefined;
    let idclient = undefined;
    if (request.openfusionapi?.user?.admin?.iduser) {
      iduser = request.openfusionapi.user.admin.iduser;
    } else if (request.openfusionapi?.user?.apikey?.idclient) {
      idclient = request.openfusionapi.user.apikey.idclient;
    }

    let data_log = {
      trace_id: request.headers["ofapi-trace-id"],
      // getCorrectedNow() en vez de new Date(): este timestamp se persiste y alimenta
      // las gráficas de logs del dashboard (Requests per minute, Response Time per
      // Request, Requests by Status, Top error endpoints); si el reloj del
      // host/contenedor está desincronizado, esas gráficas quedarían corridas respecto
      // a la hora real aunque el valor se serialice con un sufijo UTC ('Z') válido.
      timestamp: new Date(getCorrectedNow()),
      idapp: handler_param?.idapp ?? DEFAULT_ID_APP,
      idendpoint: handler_param?.idendpoint ?? DEFAULT_ID_APP,
      environment: handler_param?.environment ?? "prd",
      method: request.method,
      price_by_request: handler_param?.price_by_request ?? 0,
      price_kb_request: handler_param?.price_kb_request ?? 0,
      price_kb_response: handler_param?.price_kb_response ?? 0,
      status_code: reply.statusCode,
      user_agent: undefined,
      client: undefined,
      req_headers: undefined,
      res_headers: undefined,
      query: undefined,
      body: undefined,
      params: undefined,
      iduser,
      idclient,
      response_time: reply?.openfusionapi?.lastResponse?.responseTime,
      response_data: undefined,
      message: reply?.openfusionapi?.lastResponse?.exception,
      url: new URL(request.url, "http://localhost").pathname,
      log_level,
    };

    data_log.client = getIPFromRequest(request);

    if (log_level > 0) {
      if (log_level >= 2) {
        data_log.query = request.query;
        data_log.user_agent = request.headers["user-agent"];

        // eslint-disable-next-line no-unused-vars
        const { data_test, headers_test, description, rowkey, ctrl, ...safeParams } =
          handler_param;
        data_log.params = safeParams;
        data_log.body = this.truncateData(request.body);
      }

      if (log_level >= 3) {
        data_log.req_headers = request.headers;
        data_log.res_headers = reply.getHeaders();
        data_log.response_data = this.truncateData(
          reply?.openfusionapi?.lastResponse?.data
        );
      }
    } else {
      // Level 0: Disabled
      return undefined;
    }

    return data_log;
  }

  truncateData(data, maxLength = 10240) {
    if (!data) return undefined;

    try {
      if (typeof data === "string") {
        if (data.length > maxLength) {
          return data.substring(0, maxLength) + "...[TRUNCATED]";
        }
        return data;
      }

      if (Buffer.isBuffer(data)) {
        if (data.length > maxLength) {
          return "[BUFFER TOO LARGE...TRUNCATED]";
        }
        return "[BUFFER]";
      }

      if (typeof data === "object") {
        const str = JSON.stringify(data);
        if (str.length > maxLength) {
          return { _truncated: true, message: "Data too large to log" };
        }
        return data;
      }
    } catch (e) {
      return "[ERROR TRUNCATING DATA]";
    }

    return data;
  }

  saveLog(request, reply) {
    try {
      let param_log =
        request?.openfusionapi?.handler?.params?.ctrl?.log ?? {};
      const category = getLogLevelForStatus(reply.statusCode);
      const level = param_log[`status_${category}`] ?? 1;

      const save_log = this.getDataLog(level, request, reply);

      if (save_log) {
        this._emit("log", save_log);
      }
    } catch (error) {
      console.error(error);
    }
  }
}
