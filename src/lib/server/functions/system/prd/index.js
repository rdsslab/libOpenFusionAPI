import { listFunctionsVars } from "../../../functionVars.js";
import { version } from "../../../version.js";
import  dbsequelize  from "../../../../db/sequelize.js";

export * from "./user/index.js";
export * from "./logs/index.js";
export * from "./method/index.js";
export * from "./app/index.js";
export * from "./apiclient/index.js";
export * from "./appvars/index.js";
export * from "./endpoint/index.js";
export * from "./interval_tasks/index.js";
export * from "./bots/index.js";
export * from "./apikey/index.js";
export * from "./handler/index.js";

export async function fnListFnVarsHandlerJS(params) {
  let r = { code: 204, data: undefined };
  try {
    let fnVars = listFunctionsVars();
    let fnResult = {};
    let keys = Object.keys(fnVars).sort();

    for (let index = 0; index < keys.length; index++) {
      const k = keys[index];
      fnResult[k] = fnVars[k];
    }

    r.data = fnResult;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
    //res.code(500).json({ error: error.message });
  }
  return r;
}

export async function fnDemo(/** @type {any} */ params) {
  let r = { code: 204, data: undefined };
  try {
    r.data = { demo: "demo" };
    r.code = 200;
    //res.code(200).json({ demo: 'demo' });
  } catch (error) {
    r.data = error;
    r.code = 500;
    //res.code(500).json({ error: error.message });
  }
  return r;
}

export async function fnGetEnvironment(params) {
  let r = { code: 204, data: undefined };
  try {
    let env = [
      { id: "dev", text: `Development` },
      { id: "qa", text: `Quality` },
      { id: "prd", text: `Production` },
    ];

    r.code = 200;

    r.data = env;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetServerVersion(params) {
  let r = { code: 204, data: undefined };
  try {
    r.code = 200;
    r.data = { version: version, ddbb: dbsequelize.getDialect() };
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnFunctionNames(params) {
  let r = { data: undefined, code: 204 };
  try {
    r.data = [];
    r.code = 200;

    const environment = params?.request?.query?.environment;
    const appName = params?.request?.query?.appName;

    if (!environment || !appName) {
      r.code = 400;
    } else if (
      params &&
      params.server_data &&
      environment &&
      appName
    ) {
      const endpointClass = params.server_data.endpoint_class;
      const fnRegistry = endpointClass?.fnLocal || endpointClass?.getFnNames?.() || {};
      const envRegistry = fnRegistry?.[environment] || {};

      const publicFns = Object.keys(envRegistry.public || {});
      const appFns = Object.keys(envRegistry[appName] || {});

      r.data = [...new Set([...publicFns, ...appFns])];
    }
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnAgentOnboardingGuide(params) {
  let r = { code: 204, data: undefined };
  try {
    const trace_id = params?.request?.headers?.["ofapi-trace-id"] || "";

    r.code = 200;
    r.data = {
      summary:
        "1. Always inspect each tool description and input schema first; treat the system catalog as source of truth. 2. For endpoint creation/updates, choose handler first and match payload shape to that handler. 3. Read current endpoint data before updates and patch incrementally. 4. Validate JSON Schema with validate_json_schema_for_mcp before publishing. 5. Use trace_id in logs to follow one execution path end to end. 6. OpenFusionAPI supports recurring interval tasks for endpoint automation; use the interval_tasks tools to inspect tasks (read-only) and, only with explicit user authorization, create/update/delete schedules.",
      links: {
        handler_documentation: "/api/handler/documentation",
        handler_skill: "/api/handler/skill",
        endpoint_upsert: "/api/endpoint",
        get_system_logs: "/api/system/logs",
        interval_tasks_byidapp: "/interval_tasks/byidapp",
        interval_tasks_upsert: "/interval_tasks/upsert",
        interval_tasks_delete: "/interval_tasks/delete",
      },
      trace_id,
    };
  } catch (error) {
    r.data = {
      error: error?.message || String(error),
      trace_id: params?.request?.headers?.["ofapi-trace-id"] || "",
    };
    r.code = 500;
  }

  return r;
}


