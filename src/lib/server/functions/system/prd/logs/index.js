import {
  getSystemInfoDynamic,
  getSystemInfoStatic,
} from "../../../../systeminformation.js";
import {
  createLog,
  getAppEndpointUsageSummary,
  getLogs,
  getLogsRecordsPerMinute,
  getLogSummaryByAppStatusCode,
  getTraceErrorsOnly,
  getTraceSlowestHops,
  getTraceSummary,
} from "../../../../../db/log.js";
import { getAllEndpoints } from "../../../../../db/endpoint.js";
import { Application as App } from "../../../../../db/models.js";

export async function fnGetLogSummaryByAppStatusCode(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await getLogSummaryByAppStatusCode(params?.request?.query);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetLogs(params) {
  let r = { data: undefined, code: 204 };

  try {
    // Merge query params + body so MCP agents can use body payload (includes lightweight flag)
    const queryParams = params?.request?.query || {};
    const bodyParams = params?.request?.body || {};
    const merged = { ...queryParams, ...bodyParams };

    let data = await getLogs(merged);

    r.data = data;
    r.code = 200;
  } catch (error) {
    const statusCode = Number(error?.statusCode);
    const isClientValidationError =
      error?.name === "ValidationError" &&
      Number.isInteger(statusCode) &&
      statusCode >= 400 &&
      statusCode < 500;

    r.data = {
      error: error?.message || "Unexpected error while retrieving logs.",
      ...(error?.details ? { details: error.details } : {}),
    };
    r.code = isClientValidationError ? statusCode : 500;
  }
  return r;
}

export async function fnGetAppEndpointUsageSummary(params) {
  let r = { data: undefined, code: 204 };

  try {
    const queryParams = params?.request?.query || {};
    const bodyParams = params?.request?.body || {};
    const merged = { ...queryParams, ...bodyParams };

    const data = await getAppEndpointUsageSummary(merged);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = {
      error:
        error?.message ||
        "Unexpected error while retrieving app endpoint usage summary.",
    };
    r.code = 500;
  }
  return r;
}

export async function fnGetTraceErrorsOnly(params) {
  let r = { data: undefined, code: 204 };

  try {
    const queryParams = params?.request?.query || {};
    const bodyParams = params?.request?.body || {};
    const merged = { ...queryParams, ...bodyParams };

    const data = await getTraceErrorsOnly(merged);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = { error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

export async function fnGetTraceSlowestHops(params) {
  let r = { data: undefined, code: 204 };

  try {
    const queryParams = params?.request?.query || {};
    const bodyParams = params?.request?.body || {};
    const merged = { ...queryParams, ...bodyParams };

    const data = await getTraceSlowestHops(merged);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = { error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

export async function fnGetTraceSummary(params) {
  let r = { data: undefined, code: 204 };

  try {
    const queryParams = params?.request?.query || {};
    const bodyParams = params?.request?.body || {};
    const merged = { ...queryParams, ...bodyParams };

    const data = await getTraceSummary(merged);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = { error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

export async function fnInsertLog(params) {
  let r = { data: undefined, code: 204 };
  try {
    let data = await createLog(params.request.body);
    r.data = data;
    r.code = 200;
  } catch (error) {
    //console.log(error);

    r.data = error;
    r.code = 500;
    //res.code(500).json({ error: error.message })
  }
  return r;
}

export const fnGetSystemInfoDynamic = async () => {
  let r = { code: 204, data: undefined };
  try {
    r.data = await getSystemInfoDynamic();
    r.code = 200;
  } catch (error) {
    //res.code(500).json({ error: error.message });
    r.data = error;
    r.code = 500;
  }
  return r;
};

export async function fnGetLogsRecordsPerMinute(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await getLogsRecordsPerMinute(params?.request?.query);

    r.data = data;
    r.code = 200;
  } catch (error) {
    //console.log(error);

    r.data = error;
    r.code = 500;
    //res.code(500).json({ error: error.message });
  }
  return r;
}

export const fnGetSystemInfoStatic = async () => {
  let r = { code: 204, data: undefined };
  try {
    r.data = await getSystemInfoStatic();
    r.code = 200;
  } catch (error) {
    //res.code(500).json({ error: error.message });
    r.data = error;
    r.code = 500;
  }
  return r;
};

/**
 * Devuelve estadísticas compactas del sistema: total de apps, endpoints, y métricas de logs recientes.
 * Diseñado para agentes: payload pequeño y alto valor de contexto.
 * MCP tool: system_health_stats
 */
export async function fnGetSystemHealthStats(params) {
  let r = { code: 200, data: undefined };
  try {
    const last_hours = Number(params?.request?.query?.last_hours) || 1;

    // Conteo total de apps
    const totalApps = await App.count();

    // Conteo total de endpoints
    const allEndpoints = await getAllEndpoints();
    const totalEndpoints = allEndpoints.length;
    const enabledEndpoints = allEndpoints.filter(e => {
      const d = e.toJSON ? e.toJSON() : e;
      return d.enabled;
    }).length;
    const mcpEndpoints = allEndpoints.filter(e => {
      const d = e.toJSON ? e.toJSON() : e;
      return d.mcp && d.mcp.enabled;
    }).length;

    // Logs recientes agrupados por status_code (lightweight)
    const recentLogs = await getLogs({
      last_hours,
      lightweight: true,
      limit: 5000,
    });

    const logsByStatus = {};
    let errorCount = 0;
    for (const log of recentLogs) {
      const sc = log.status_code;
      logsByStatus[sc] = (logsByStatus[sc] || 0) + 1;
      if (sc >= 400) errorCount++;
    }

    r.data = {
      timestamp: new Date().toISOString(),
      window_hours: last_hours,
      apps: { total: totalApps },
      endpoints: {
        total: totalEndpoints,
        enabled: enabledEndpoints,
        mcp_enabled: mcpEndpoints,
      },
      logs: {
        total_in_window: recentLogs.length,
        errors_in_window: errorCount,
        by_status_code: logsByStatus,
      },
    };
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}
