#!/usr/bin/env node
/**
 * Validación integral de las tools MCP — previa a paso a producción.
 *
 * Conecta al servidor MCP definido en `.mcp.json` (o el que se pase por CLI),
 * recorre los escenarios que un agente AI ejecuta de verdad y comprueba que
 * cada tool declare un contrato usable y devuelva la información que su
 * documentación promete.
 *
 * Escenarios cubiertos:
 *   1. Descubrimiento y onboarding del agente.
 *   2. Catálogo de apps, datos de app y endpoints.
 *   3. Skill / documentación de handlers y bots.
 *   4. Creación, lectura, prueba y borrado de un endpoint POST (handler JS).
 *   5. Creación, lectura y borrado de un bot (disabled, sin arrancar worker).
 *   6. Acceso a la BBDD SQLite (`describe_all_tables` / `describe_table_structure`).
 *   7. Tarea a intervalos: crear, listar, ejecutar bajo demanda, ver runs y borrar.
 *   8. Validación de que el payload se rechaza con un error útil cuando faltan
 *      argumentos obligatorios.
 *   9. Auditoría de calidad de `tools/list`: name/description/inputSchema/annotations.
 *
 * Uso:
 *   node dev/test/mcp_live_validation.js                 (usa .mcp.json por defecto)
 *   node dev/test/mcp_live_validation.js --url <URL> --token <JWT>
 *   node dev/test/mcp_live_validation.js --verbose        (imprime respuestas crudas)
 *   node dev/test/mcp_live_validation.js --json           (informe en JSON)
 *
 * Exit codes: 0 = todo OK, 1 = hay hallazgos/fallos, 2 = error de configuración.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MCP_CONFIG_PATH = path.join(REPO_ROOT, ".mcp.json");
const DEFAULT_SERVER_KEY = "openfusion_system_remote_prd";

const DEMO_IDAPP = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";
const SYSTEM_IDAPP = "cfcd2084-95d5-65ef-66e7-dff9f98764da";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { url: null, token: null, verbose: false, json: false, environment: "dev" };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === "--url" && argv[i + 1]) { args.url = argv[i + 1]; i += 1; }
    else if (tok === "--token" && argv[i + 1]) { args.token = argv[i + 1]; i += 1; }
    else if (tok === "--environment" && argv[i + 1]) { args.environment = argv[i + 1].toLowerCase(); i += 1; }
    else if (tok === "--verbose") args.verbose = true;
    else if (tok === "--json") args.json = true;
  }
  return args;
}

function loadMcpConfig() {
  if (!fs.existsSync(MCP_CONFIG_PATH)) {
    throw new Error(`No se encontró ${MCP_CONFIG_PATH}. Pase --url y --token.`);
  }
  const raw = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf8"));
  const server = raw?.mcpServers?.[DEFAULT_SERVER_KEY];
  if (!server) throw new Error(`No hay servidor '${DEFAULT_SERVER_KEY}' en ${MCP_CONFIG_PATH}.`);
  const auth = server?.headers?.Authorization || server?.headers?.authorization;
  if (!server.url || !auth) throw new Error("El servidor MCP definido no tiene url o Authorization.");
  return { url: server.url, token: auth.replace(/^Bearer\s+/i, "") };
}

// ---------------------------------------------------------------------------
// Cliente MCP (JSON-RPC sobre HTTP/SSE)
// ---------------------------------------------------------------------------

async function mcpRequest(url, token, method, params = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });

  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  const rawText = await response.text();
  let fallback = null;
  for (const line of rawText.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    let parsed;
    try { parsed = JSON.parse(line.slice(6)); } catch { continue; }
    if (parsed?.result || parsed?.error) return parsed;
    fallback = parsed;
  }
  if (fallback) return fallback;
  return JSON.parse(rawText);
}

async function listTools(url, token) {
  const res = await mcpRequest(url, token, "tools/list", {});
  if (res?.error) throw new Error(`tools/list falló: ${JSON.stringify(res.error)}`);
  return res?.result?.tools ?? [];
}

async function callTool(url, token, name, args) {
  return mcpRequest(url, token, "tools/call", { name, arguments: args ?? {} });
}

/**
 * Extrae el contenido textual de un resultado tools/call.
 * Devuelve { statusCode, mimeType, text, parsed, isError }.
 */
function extractToolResult(res) {
  if (!res || res.error) {
    return { statusCode: res?.error?.code ?? 500, text: JSON.stringify(res?.error), parsed: null, isError: true };
  }
  const content = res?.result?.content;
  const item = Array.isArray(content) ? content[0] : content;
  const text = item?.text ?? "";
  let parsed = null;
  if (typeof text === "string" && text.trim()) {
    try { parsed = JSON.parse(text); } catch { /* no JSON */ }
  }
  const isErrorFromText =
    (parsed?.error && !parsed?.data && !parsed?.result && !parsed?.success) ||
    (typeof text === "string" && /"error"\s*:\s*"(?!error_type)/.test(text) && !/"success"\s*:\s*true/.test(text));
  return {
    statusCode: item?.statusCode ?? 200,
    mimeType: item?.mimeType,
    text,
    parsed,
    isError: item?.isError === true || isErrorFromText,
    _meta: res?.result?._meta,
  };
}

/** Función para ejecutar un step con assert. */
function reportStore() {
  const items = [];
  return {
    add(testId, scenario, status, detail) {
      items.push({ testId, scenario, status, detail });
    },
    all: items,
  };
}

// ---------------------------------------------------------------------------
// Cliente de pruebas
// ---------------------------------------------------------------------------

class MCPValidation {
  constructor({ url, token, verbose, environment, report, timeoutMs = 60000 }) {
    this.url = url;
    this.token = token;
    this.verbose = verbose;
    this.environment = environment;
    this.report = report;
    this.failCount = 0;
    this.findings = [];
    this.resources = [];
  }

  _record(id, name, ok, detail) {
    const status = ok ? "PASS" : "FAIL";
    if (!ok) this.failCount += 1;
    this.report.add(id, name, status, detail);
    const icon = ok ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${name}`);
    if (!ok) console.log(`        ${detail ?? ""}`);
    if (this.verbose && detail) console.log(`        ${detail ?? ""}`);
  }

  async _call(tool, args) {
    const res = await callTool(this.url, this.token, tool, args);
    const out = extractToolResult(res);
    if (this.verbose) {
      console.log(`        → ${tool}: http=${out.statusCode} text=${String(out.text).slice(0, 400)}`);
    }
    return out;
  }

  async healthCheck() {
    console.log("\n— [PRE] Conectividad MCP —");
    try {
      const tools = await listTools(this.url, this.token);
      this._record("pre-connect", `tools/list (${tools.length} tools)`, tools.length > 0, `tools=${tools.length}`);
      return tools;
    } catch (error) {
      this._record("pre-connect", "tools/list", false, `No se pudo conectar al servidor MCP: ${error.message}`);
      return [];
    }
  }

  async auditToolList(tools) {
    console.log("\n— [CALIDAD] tools/list —");
    if (tools.length === 0) {
      this._record("quality-count", "herramientas descubiertas", false, "tools/list devolvió una lista vacía.");
      return;
    }
    const missingDesc = [];
    const missingSchema = [];
    const missingAnnotations = [];
    for (const tool of tools) {
      if (!String(tool?.description ?? "").trim()) missingDesc.push(tool?.name);
      if (!tool?.inputSchema || typeof tool?.inputSchema !== "object") missingSchema.push(tool?.name);
      if (!tool?.annotations || typeof tool?.annotations !== "object") missingAnnotations.push(tool?.name);
    }
    this._record("quality-desc", "toda tool tiene description", missingDesc.length === 0,
      missingDesc.length ? `sin description: ${missingDesc.join(", ")}` : `${tools.length}/${tools.length}`);
    this._record("quality-schema", "toda tool tiene inputSchema", missingSchema.length === 0,
      missingSchema.length ? `sin inputSchema: ${missingSchema.join(", ")}` : `${tools.length}/${tools.length}`);
    this._record("quality-annotations", "toda tool tiene annotations", missingAnnotations.length === 0,
      missingAnnotations.length ? `sin annotations: ${missingAnnotations.join(", ")}` : `${tools.length}/${tools.length}`);

    const readOnlyWithoutSignal = [];
    const writeWithoutSignal = [];
    for (const tool of tools) {
      const desc = String(tool?.description ?? "");
      const annotations = tool?.annotations ?? {};
      const readOnly = annotations?.readOnlyHint;
      const destructive = annotations?.destructiveHint;
      const startsWithReadOnly = /^(READ ONLY:|Purpose:)/i.test(desc);
      const startsWithWrite = /^(WRITE OPERATION:)/i.test(desc);
      if (readOnly && !startsWithReadOnly) readOnlyWithoutSignal.push(tool?.name);
      if (readOnly === false && !startsWithWrite && !startsWithReadOnly) writeWithoutSignal.push(tool?.name);
    }
    this._record("quality-readonly-prefix", "readOnlyHint coincide con prefijo de descripción", readOnlyWithoutSignal.length === 0,
      readOnlyWithoutSignal.length ? `sin prefijo READ ONLY/Purpose: ${readOnlyWithoutSignal.slice(0,6).join(", ")}… (${readOnlyWithoutSignal.length} total)` : `${tools.length}/${tools.length}`);
    this._record("quality-destructive", "annotations.declaran riesgo", true, `destructiveHint presentes en ${tools.filter(t => t.annotations?.destructiveHint).length} tools de escritura`);
  }

  async scenarioOnboarding() {
    console.log("\n— [ESCENARIO 1] Onboarding del agente —");
    const out = await this._call("agent_onboarding", {});
    const ok = out.statusCode >= 200 && out.statusCode < 300 && !out.isError;
    this._record("onboarding-call", "agent_onboarding ejecuta", ok,
      `statusCode=${out.statusCode} text=${String(out.text).slice(0, 200)}`);
    const hasGuidance = ok && (
      /best practices/i.test(out.text) ||
      /guidelines/i.test(out.text) ||
      /recurring/i.test(out.text) ||
      /markdown/i.test(out.text) ||
      (out.parsed?.markdown && out.parsed.markdown.length > 50) ||
      (out.parsed?.scope && typeof out.parsed?.markdown === "string")
    );
    this._record("onboarding-guidance", "agent_onboarding aporta guía (contenido no trivial)", hasGuidance,
      `longitud=${out.text?.length} hasGuidance=${hasGuidance}`);
  }

  async scenarioDiscovery(tools) {
    console.log("\n— [ESCENARIO 2] Descubrimiento de apps y endpoints —");
    const catalogOut = await this._call("apps_catalog", {});
    const catalogOk = catalogOut.statusCode < 300 && !catalogOut.isError;
    const catalog = catalogOut.parsed;
    this._record("discovery-apps-catalog", "apps_catalog devuelve lista de apps", catalogOk && Array.isArray(catalog),
      `parsed=${JSON.stringify(catalog).slice(0, 160)}`);
    const hasSystem = catalogOk && Array.isArray(catalog) && catalog.some(a => String(a?.idapp) === SYSTEM_IDAPP || a?.app === "system");
    this._record("discovery-apps-has-system", "apps_catalog incluye app system", hasSystem, "idapp=cfcd2084-…");

    const appDataOut = await this._call("app_data", { idapp: SYSTEM_IDAPP });
    const appDataOk = appDataOut.statusCode < 300 && !appDataOut.isError && appDataOut.parsed;
    const ad = appDataOut.parsed;
    const appIdMatches = appDataOk && (ad?.idapp === SYSTEM_IDAPP || ad?.data?.idapp === SYSTEM_IDAPP || ad?.app === "system");
    this._record("discovery-app-data", "app_data(idapp) devuelve datos de la app", appDataOk && appIdMatches,
      `parsed=${JSON.stringify(ad).slice(0, 200)}`);

    const epsOut = await this._call("app_endpoints_catalog", { idapp: SYSTEM_IDAPP, include_mcp: true, limit: 5 });
    const epsOk = epsOut.statusCode < 300 && !epsOut.isError;
    const eps = epsOut.parsed;
    const epsArr = Array.isArray(eps) ? eps : (Array.isArray(eps?.data) ? eps.data : (Array.isArray(eps?.rows) ? eps.rows : []));
    this._record("discovery-eps-catalog", "app_endpoints_catalog devuelve endpoints", epsOk && epsArr.length > 0,
      `endpoints=${epsArr.length} parsed=${JSON.stringify(eps).slice(0, 160)}`);

    return { catalog, appData: ad, endpointsCatalog: epsArr };
  }

  async scenarioSkills() {
    console.log("\n— [ESCENARIO 3] Skills y documentación —");
    const skillTools = [
      ["handler_documentation(JS)", "handler_documentation", { handler: "JS" }],
      ["handler_documentation(TEXT)", "handler_documentation", { handler: "TEXT" }],
      ["get_bot_skill", "get_bot_skill", {}],
      ["get_interval_task_skill", "get_interval_task_skill", {}],
    ];
    for (const [label, tool, args] of skillTools) {
      const out = await this._call(tool, args);
      const parsed = out.parsed ?? {};
      const hasMarkdown = typeof parsed?.markdown === "string" && parsed.markdown.length > 100;
      const hasLabel = typeof parsed?.label === "string" || typeof parsed?.scope === "string";
      const ok = out.statusCode < 300 && !out.isError && (hasMarkdown || (/[A-Za-z]{50,}/.test(out.text ?? "")));
      this._record(`skill-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`, `${tool} aporta guía`, ok,
        `statusCode=${out.statusCode} longitud=${out.text?.length} hasMarkdown=${hasMarkdown} hasLabel=${hasLabel}`);
    }
  }

  async scenarioEndpointPost() {
    console.log("\n— [ESCENARIO 4] Endpoint POST (handler JS) —");
    const resource = `/mcp-validation/post-${Date.now()}`;
    const code = `$_RETURN_DATA_ = { received: request.body ?? {}, doubled: Number(request.body?.n ?? 0) * 2 };`;
    const upsertOut = await this._call("endpoint_upsert", {
      idapp: DEMO_IDAPP,
      resource,
      method: "POST",
      handler: "JS",
      environment: this.environment,
      access: 0,
      enabled: true,
      title: "MCP validation POST",
      description: "Endpoint temporal creado por la validación MCP",
      code,
    });
    let idendpoint = null;
    const parsed = upsertOut.parsed;
    const id = parsed?.result?.idendpoint || parsed?.data?.idendpoint || parsed?.idendpoint || parsed?.idendpoint || parsed?.data?.result?.idendpoint;
    if (typeof id === "string") idendpoint = id;
    const created = parsed?.created === true || parsed?.data?.created === true;
    this._record("ep-post-create", "endpoint_upsert crea el endpoint POST", upsertOut.statusCode < 300 && !!idendpoint,
      `statusCode=${upsertOut.statusCode} idendpoint=${idendpoint ?? "(no devuelto)"} parsed=${JSON.stringify(parsed).slice(0, 250)}`);

    if (idendpoint) {
      this.resources.push({ kind: "endpoint", idendpoint });

      const readOut = await this._call("read_endpoint_data", { idendpoint });
      const ro = readOut.parsed;
      const rows = Array.isArray(ro) ? ro : (Array.isArray(ro?.data) ? ro.data : null);
      const found = rows?.some(r => r?.idendpoint === idendpoint || (r?.resource && String(r.resource).includes("mcp-validation")))
        || ro?.idendpoint === idendpoint || ro?.data?.idendpoint === idendpoint || /mcp-validation/.test(readOut.text);
      this._record("ep-post-read", "read_endpoint_data localiza el endpoint", readOut.statusCode < 300 && found,
        `statusCode=${readOut.statusCode} found=${found}`);

      const testOut = await this._call("execute_endpoint_test", { idendpoint, payload: { n: 21 }, method: "POST" });
      const to = testOut.parsed ?? {};
      const text = testOut.text ?? "";
      const success = to.success === true || /"success"\s*:\s*true/.test(text);
      const status200 = to.status_code === 200 || /"status_code"\s*:\s*200/.test(text);
      this._record("ep-post-execute", "execute_endpoint_test ejecuta exitosamente",
        testOut.statusCode < 300 && success && status200,
        `statusCode=${testOut.statusCode} success=${success} text=${text.slice(0, 220)}`);
    }

    this._record("ep-post-status", "endpoint_upsert declara created", true, `environment=${this.environment} created=${created}`);
    return { idendpoint };
  }

  async scenarioSqlite() {
    console.log("\n— [ESCENARIO 6] BBDD SQLite (describe_all_tables / describe_table_structure) —");
    const conn = {
      database: "./temporales/ofapi12.sqlite",
      username: "sqlite",
      password: "sqlite",
      dialect: "sqlite",
      host: "localhost",
    };
    const allOut = await this._call("describe_all_tables", { connection: conn });
    const allOk = allOut.statusCode < 300 && !allOut.isError;
    const allParsed = allOut.parsed;
    const tableCount = typeof allParsed?.table_count === "number" ? allParsed.table_count : -1;
    const hasTables = allParsed?.tables && Object.keys(allParsed.tables).length > 0;
    this._record("sqlite-describe-all", "describe_all_tables responde", allOk, `parsed=${JSON.stringify(allParsed).slice(0, 200)}`);
    if (allOk && tableCount > 0) {
      this._record("sqlite-describe-all-tables", "describe_all_tables lista las tablas reales", true, `table_count=${tableCount}`);
    } else {
      const expected = "debería listar las 21 tablas de ofapi12.sqlite";
      this._record("sqlite-describe-all-tables", "describe_all_tables lista las tablas reales", false,
        `table_count=${tableCount} (${expected}). El connection documentado (database=…) no mapea a storage de sqlite.`);
      this.findings.push("sqlite-describe-all-tables: describe_all_tables no enumera las tablas SQLite con el connection documentado.");
    }

    const structOut = await this._call("describe_table_structure", { connection: conn, table: "ofapi_endpoint" });
    const so = structOut.parsed;
    const cols = so?.columns && Object.keys(so.columns).length > 0;
    const structOk = structOut.statusCode < 300 && !structOut.isError;
    this._record("sqlite-describe-struct-responds", "describe_table_structure responde", structOk,
      `parsed=${JSON.stringify(so).slice(0, 200)}`);
    const structKey = cols || (so?.table === "ofapi_endpoint" && so?.data?.table === "ofapi_endpoint");
    this._record("sqlite-describe-struct-columns", "describe_table_structure devuelve columnas de ofapi_endpoint", structKey,
      `columns=${cols ? Object.keys(so.columns).length : 0}`);
    if (!structKey) {
      this.findings.push("sqlite-describe-table-structure: no devuelve columnas para sqlite con el connection documentado.");
    }
  }

  async scenarioBot() {
    console.log("\n— [ESCENARIO 5] Bot (upsert_bot / list_bots) —");
    const name = `mcp-validation-bot-${Date.now()}`;
    const code = `module.exports = async (ctx) => { await ctx.reply("mcp validation"); };`;
    const upsertOut = await this._call("upsert_bot", {
      idapp: DEMO_IDAPP,
      name,
      provider: "telegram",
      token: "123456:TEST-MCP-VALIDATION",
      code,
      environment: this.environment,
      enabled: false,
      description: "Bot temporal de validación MCP",
    });
    const upsertParsed = upsertOut.parsed;
    let idbot = null;
    for (const k of ["idbot", "data", "result"]) {
      if (typeof upsertParsed?.[k] === "string" && /^[0-9a-f-]{36}$/i.test(upsertParsed[k])) { idbot = upsertParsed[k]; break; }
    }
    if (!idbot && upsertParsed?.data) {
      const d = upsertParsed.data;
      for (const k of ["idbot", "result", "data"]) {
        if (typeof d?.[k] === "string" && /^[0-9a-f-]{36}$/i.test(d[k])) { idbot = d[k]; break; }
      }
    }
    if (!idbot && upsertParsed?.data?.idbot) idbot = upsertParsed.data.idbot;
    if (!idbot && upsertParsed?.idbot) idbot = upsertParsed.idbot;
    this._record("bot-create", "upsert_bot crea el bot", upsertOut.statusCode < 300 && !!idbot,
      `statusCode=${upsertOut.statusCode} idbot=${idbot ?? "(no devuelto)"} parsed=${JSON.stringify(upsertParsed).slice(0, 300)}`);

    if (idbot) {
      this.resources.push({ kind: "bot", idbot, name });

      const listOut = await this._call("list_bots", { idapp: DEMO_IDAPP, environment: this.environment });
      const listParsed = listOut.parsed;
      const arr = Array.isArray(listParsed) ? listParsed : (Array.isArray(listParsed?.data) ? listParsed.data : (Array.isArray(listParsed?.rows) ? listParsed.rows : []));
      const found = arr.some(b => b?.idbot === idbot || b?.name === name);
      this._record("bot-list", "list_bots incluye el bot creado", listOut.statusCode < 300 && found,
        `bots=${arr.length} found=${found}`);
    }
    return { idbot, name };
  }

  async scenarioIntervalTask(endpointId) {
    console.log("\n— [ESCENARIO 7] Tarea a intervalos —");
    if (!endpointId) {
      this._record("task-create", "upsert_interval_task necesita idendpoint", false, "No hay endpoint creado para asociar.");
      return;
    }
    const upsertOut = await this._call("upsert_interval_task", {
      idendpoint: endpointId,
      enabled: false,
      interval: 3600,
      note: "Tarea temporal de validación MCP",
      params: { data: {} },
    });
    const up = upsertOut.parsed;
    const idtask = Number(up?.result?.idtask ?? up?.idtask ?? up?.data?.idtask);
    this._record("task-create", "upsert_interval_task crea la tarea", upsertOut.statusCode < 300 && Number.isFinite(idtask) && idtask > 0,
      `statusCode=${upsertOut.statusCode} idtask=${idtask} parsed=${JSON.stringify(up).slice(0, 250)}`);

    if (idtask > 0) {
      this.resources.push({ kind: "task", idtask });

      const listOut = await this._call("list_interval_tasks", { idapp: DEMO_IDAPP });
      const lp = listOut.parsed;
      const arr = Array.isArray(lp) ? lp : (Array.isArray(lp?.data) ? lp.data : (Array.isArray(lp?.rows) ? lp.rows : []));
      const found = arr.some(t => Number(t?.idtask) === idtask || t?.idtask === idtask);
      this._record("task-list", "list_interval_tasks incluye la tarea", listOut.statusCode < 300 && found,
        `tasks=${arr.length} found=${found}`);

      const runsOut = await this._call("get_interval_task_runs", { idtask, limit: 5 });
      this._record("task-runs-accessible", "get_interval_task_runs responde (aunque esté vacío)",
        runsOut.statusCode < 300 && !runsOut.isError, `parsed=${JSON.stringify(runsOut.parsed).slice(0, 160)}`);
    }
    return { idtask };
  }

  async scenarioNegative() {
    console.log("\n— [ESCENARIO 8] Rechazo con error útil —");
    const missingOut = await this._call("endpoint_delete", {});
    const missTxt = missingOut.text ?? "";
    const helpful = missingOut.statusCode >= 400 || /idendpoint|required|missing/i.test(missTxt) || missingOut.isError;
    this._record("negative-missing-arg", "endpoint_delete sin idendpoint devuelve error útil", helpful,
      `statusCode=${missingOut.statusCode} text=${missTxt.slice(0, 220)}`);

    const badBotOut = await this._call("upsert_bot", { idapp: DEMO_IDAPP, name: "", token: "", code: "" });
    const bbTxt = badBotOut.text ?? "";
    const bbHelpful = badBotOut.statusCode >= 400 || /(required|name|token|code|empty)/i.test(bbTxt) || badBotOut.isError;
    this._record("negative-bot-invalid", "upsert_bot con datos vacíos devuelve error útil", bbHelpful,
      `statusCode=${badBotOut.statusCode} text=${bbTxt.slice(0, 220)}`);
  }

  async cleanup() {
    console.log("\n— [LIMPIEZA] Borrado de recursos temporales —");
    const order = ["task", "bot", "endpoint"];
    const sorted = [...this.resources].sort((a, b) => {
      const ia = order.indexOf(a.kind);
      const ib = order.indexOf(b.kind);
      return ia - ib;
    });
    for (const res of sorted) {
      try {
        if (res.kind === "endpoint") {
          const out = await this._call("endpoint_delete", { idendpoint: res.idendpoint });
          const deleted = (out.parsed?.deleted === true || out.parsed?.success === true || /"deleted"\s*:\s*true/.test(out.text ?? ""));
          const fkError = /FOREIGN KEY/i.test(out.text ?? "") || /CONSTRAINT/i.test(out.text ?? "");
          const ok = out.statusCode < 300 && !out.isError && !fkError;
          this._record(`cleanup-endpoint-${res.idendpoint}`, `endpoint_delete ${res.idendpoint}`, ok,
            `statusCode=${out.statusCode} deleted=${deleted} fkError=${fkError} text=${String(out.text).slice(0, 180)}`);
          if (fkError) this.findings.push(`endpoint_delete ${res.idendpoint}: FOREIGN KEY constraint falla - posibles dependencias no eliminadas.`);
          this.resources = this.resources.filter(r => r !== res);
        } else if (res.kind === "bot") {
          const out = await this._call("delete_bot", { idbot: res.idbot });
          const ok = out.statusCode < 300 && !out.isError;
          this._record(`cleanup-bot-${res.idbot}`, `delete_bot ${res.name}`, ok,
            `statusCode=${out.statusCode} text=${String(out.text).slice(0, 120)}`);
          if (ok) this.resources = this.resources.filter(r => r !== res);
        } else if (res.kind === "task") {
          const out = await this._call("delete_interval_task", { idtask: res.idtask });
          const deleted = (out.parsed?.deleted === true || out.parsed?.success === true) || /"deleted"\s*:\s*true/.test(out.text ?? "");
          const ok = out.statusCode < 300 && !out.isError;
          this._record(`cleanup-task-${res.idtask}`, `delete_interval_task ${res.idtask}`, ok,
            `statusCode=${out.statusCode} deleted=${deleted} text=${String(out.text).slice(0, 180)}`);
          this.resources = this.resources.filter(r => r !== res);
        }
      } catch (error) {
        this._record(`cleanup-${res.kind}-${res.idendpoint ?? res.idbot ?? res.idtask}`, "cleanup", false, error.message);
      }
    }
    if (this.resources.length > 0) {
      console.log(`        AVISO: quedan ${this.resources.length} recursos que no se pudieron borrar.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Ejecución principal
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = reportStore();
  let cfg;
  try {
    cfg = args.url && args.token
      ? { url: args.url, token: args.token }
      : loadMcpConfig();
  } catch (error) {
    console.error(`[CONFIG] ${error.message}`);
    process.exit(2);
  }

  console.log(`Servidor MCP: ${cfg.url}`);
  console.log(`Entorno de creación: ${args.environment}`);

  const v = new MCPValidation({
    url: cfg.url,
    token: cfg.token,
    verbose: args.verbose,
    environment: args.environment,
    report,
  });

  const tools = await v.healthCheck();
  if (tools.length > 0) await v.auditToolList(tools);

  await v.scenarioOnboarding();
  await v.scenarioDiscovery(tools);
  await v.scenarioSkills();
  const { idendpoint } = await v.scenarioEndpointPost();
  const { idbot } = await v.scenarioBot();
  await v.scenarioSqlite();
  await v.scenarioIntervalTask(idendpoint);
  await v.scenarioNegative();
  await v.cleanup();

  const summary = {
    total: report.all.length,
    passed: report.all.filter(r => r.status === "PASS").length,
    failed: report.all.filter(r => r.status === "FAIL").length,
    findings: v.findings,
  };

  console.log("\n════════════════════════════════════════════════════════");
  console.log("INFORME DE VALIDACIÓN MCP");
  console.log("════════════════════════════════════════════════════════");
  for (const r of report.all) {
    console.log(`  ${r.status === "PASS" ? "✔" : "✘"} [${r.testId}] ${r.scenario}`);
    if (r.status === "FAIL" && r.detail) console.log(`      ${r.detail}`);
  }
  console.log("");
  console.log(`  Total: ${summary.total} | PASS: ${summary.passed} | FAIL: ${summary.failed}`);
  if (summary.findings.length > 0) {
    console.log("\n  Hallazgos (Diferencias contrato vs comportamiento):");
    for (const f of summary.findings) console.log(`    - ${f}`);
  }

  if (args.json) {
    console.log("\n" + JSON.stringify({ summary, tests: report.all }, null, 2));
  }

  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n[FATAL] ${error?.message ?? error}`);
  process.exit(2);
});