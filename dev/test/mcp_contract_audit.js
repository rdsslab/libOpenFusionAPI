#!/usr/bin/env node
/**
 * Auditor de contrato MCP — offline, sin servidor ni base de datos.
 *
 * Lee el seed canónico (src/lib/db/default/system.js) y comprueba que, para cada
 * tool publicada, la prosa (`mcp.description`), los metadatos (`operation_mode`,
 * `side_effects`, …) y el `json_schema.in` digan lo mismo. El test de CI que ya
 * existe (mcp_tool_descriptions.js) solo verifica que la description no esté
 * vacía y que el inputSchema sea un objeto, así que deja pasar contradicciones
 * como un `inputSchema` vacío en una tool que documenta parámetros.
 *
 * Uso:
 *   node dev/test/mcp_contract_audit.js            (falla con exit 1 si hay hallazgos)
 *   node dev/test/mcp_contract_audit.js --json     (informe en JSON)
 *
 * Exit codes: 0 sin hallazgos, 1 con hallazgos, 2 error de ejecución.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeToolKey } from "../../src/lib/server/mcp/toolNames.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SEED_PATH = path.join(REPO_ROOT, "src", "lib", "db", "default", "system.js");

// Tools registradas en código (handlerBuild/mcp.js) en lugar de derivarse del
// seed. Se listan para que la regla de referencias cruzadas no las dé por
// inexistentes.
const STATIC_TOOL_NAMES = [
  "get_handler_skill",
  "validate_json_schema_for_mcp",
  "list_api_endpoints_catalog_system",
  "list_api_endpoints_system",
];

// Props que el agente no necesita ver documentadas en la prosa porque su nombre
// y su description dentro del schema ya son suficientes, o porque son de uso
// interno. Se mantiene deliberadamente corta: cada entrada es una excepción que
// alguien tuvo que justificar.
const UNDOCUMENTED_PROP_ALLOWLIST = new Set([
  "idapp",
  "idendpoint",
  "idbot",
  "idvar",
  "idappvar",
  "idtask",
  "attributes",
  "raw",
]);

// Identificadores del dominio que se citan en backticks igual que las tools
// —columnas del modelo, proveedores de bots— y que no son referencias cruzadas.
const DOMAIN_IDENTIFIERS = new Set([
  // Columnas del modelo de endpoint y de aplicación.
  "json_schema",
  "custom_data",
  "data_test",
  "headers_test",
  "cache_time",
  "jwt_key",
  // Proveedores de bots.
  "ms_teams",
  // Estado observado del runtime de bots (columnas de ofapi_bot que devuelve list_bots).
  "runtime_status",
  "failure_count",
  "last_error_type",
  "last_error_message",
  "last_failure_at",
  "next_retry_at",
  "last_started_at",
  "last_healthy_at",
  "disabled_by",
  "disabled_reason",
  // Telemetría de las interval tasks, que se cita al describir la respuesta.
  "task_enabled",
  "last_run",
  "next_run",
  "failed_attempts",
  "last_exec_time",
  "last_response",
  // Configuración de las interval tasks. Las tools de lectura las citan al explicar la
  // respuesta o el diagnóstico aunque no las declaren en su propio esquema de entrada.
  "endpoint_enabled",
  "app_enabled",
  "schedule_mode",
  "exec_time_limit",
  "allow_concurrent",
  "max_failed_attempts",
  "history_limit",
  // Columnas del historial de ejecuciones (ofapi_intervaltask_run).
  "started_at",
  "finished_at",
  "duration_ms",
  "http_status",
]);

// Número de tools a partir del cual un mismo texto de `side_effects` deja de
// informar y pasa a ser boilerplate ignorable.
const MAX_TOOLS_PER_SIDE_EFFECTS_TEXT = 4;

const findings = [];

const report = (rule, tool, message) => {
  findings.push({ rule, tool, message });
};

function loadSeed() {
  const source = fs.readFileSync(SEED_PATH, "utf8");
  const prefix = source.indexOf("{");
  if (prefix < 0) throw new Error("No se encontró el objeto raíz en system.js");
  return JSON.parse(source.slice(prefix));
}

/** Endpoints que el servidor MCP publica realmente (mismo filtro que mcp.js). */
function collectPublishedTools(app) {
  return app.endpoints.filter(
    (endpoint) =>
      endpoint.method !== "WS" &&
      endpoint.handler !== "MCP" &&
      endpoint?.mcp?.enabled === true
  );
}

const getMcpField = (endpoint, field) =>
  endpoint?.mcp?.[field] ?? endpoint?.mcp?.meta?.[field];

const inSchema = (endpoint) => endpoint?.json_schema?.in;
const schemaOf = (endpoint) => inSchema(endpoint)?.schema;
const propsOf = (endpoint) => schemaOf(endpoint)?.properties ?? {};
const requiredOf = (endpoint) => schemaOf(endpoint)?.required ?? [];

/** Todo el texto que el agente llega a leer sobre una tool. */
const proseOf = (endpoint) => {
  const mcp = endpoint?.mcp ?? {};
  return [
    mcp.description ?? "",
    mcp.title ?? "",
    Array.isArray(mcp.notes) ? mcp.notes.join(" ") : String(mcp.notes ?? ""),
  ].join(" ");
};

// --- Reglas -----------------------------------------------------------------

/**
 * 1. Toda tool publicada debe declarar su contrato de entrada.
 *
 * Sin `json_schema.in.enabled`, mcp.js registra `z.object({})` y el agente
 * concluye que la tool no lleva argumentos. Una tool que de verdad no recibe
 * nada debe declararlo explícitamente con un schema vacío, no por omisión.
 */
function ruleSchemaEnabled(tool, name) {
  const schemaIn = inSchema(tool);
  if (schemaIn?.enabled === true && schemaIn?.schema) return;

  report(
    "schema-enabled",
    name,
    `json_schema.in.enabled no es true (es ${JSON.stringify(schemaIn?.enabled)}), ` +
      "así que MCP publica un inputSchema vacío y el agente no puede enviar parámetros."
  );
}

/** 2. Un campo no puede ser `required` y tener `default` a la vez. */
function ruleRequiredVsDefault(tool, name) {
  const props = propsOf(tool);
  const conflicting = requiredOf(tool).filter(
    (field) => props?.[field] && props[field].default !== undefined
  );
  if (conflicting.length > 0) {
    report(
      "required-with-default",
      name,
      `campos requeridos que además declaran default (el default nunca se aplica y ` +
        `el agente se ve forzado a inventar un valor): ${conflicting.join(", ")}.`
    );
  }
}

/**
 * 3. Todo campo requerido debe estar documentado en algún sitio.
 *
 * Vale la prosa o la `description` de la propiedad en el schema, igual que en la
 * regla 4 — obligar a repetirlo en ambos sitios solo produce la duplicación que
 * satura la descripción. La diferencia con la regla 4 es que aquí no aplica
 * ninguna allowlist: si un campo es obligatorio, el agente tiene que saber qué
 * poner en él, por evidente que parezca el nombre.
 */
function ruleRequiredDocumented(tool, name) {
  const prose = proseOf(tool);
  const props = propsOf(tool);
  const missing = requiredOf(tool).filter((field) => {
    if (prose.includes(field)) return false;
    const described = String(props?.[field]?.description ?? "").trim();
    return described.length === 0;
  });
  if (missing.length > 0) {
    report(
      "required-undocumented",
      name,
      "campos requeridos sin documentar ni en la descripción ni en el schema: " +
        `${missing.join(", ")}.`
    );
  }
}

/**
 * 4. Toda prop del schema debe estar documentada en algún sitio que el agente lea.
 *
 * Vale con la prosa de la tool o con la `description` de la propia propiedad en
 * el schema: ambas llegan al agente. Lo que no vale es un parámetro que solo
 * existe como nombre suelto, porque su semántica y su default quedan a la
 * adivinanza.
 */
function ruleParamsDocumented(tool, name) {
  const prose = proseOf(tool);
  const props = propsOf(tool);
  const missing = Object.keys(props).filter((prop) => {
    if (UNDOCUMENTED_PROP_ALLOWLIST.has(prop)) return false;
    if (prose.includes(prop)) return false;
    const described = String(props[prop]?.description ?? "").trim();
    return described.length === 0;
  });
  if (missing.length > 0) {
    report(
      "param-undocumented",
      name,
      "parámetros sin documentar ni en la descripción ni en el schema: " +
        `${missing.join(", ")}.`
    );
  }
}

/**
 * 5. Las tools citadas en una descripción deben existir y estar publicadas.
 *
 * El ruido aquí son los nombres de campo y los valores de enum, que se citan en
 * backticks igual que las tools. Se descartan recogiendo todos los
 * identificadores que aparecen en cualquier punto del schema de la tool
 * (nombres de propiedad a cualquier profundidad y valores de enum).
 */
function collectSchemaIdentifiers(node, acc = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaIdentifiers(item, acc);
    return acc;
  }
  if (!node || typeof node !== "object") {
    if (typeof node === "string") acc.add(node);
    return acc;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && value && typeof value === "object") {
      for (const prop of Object.keys(value)) acc.add(prop);
    }
    if (key === "required" && Array.isArray(value)) {
      for (const prop of value) acc.add(prop);
    }
    if (key === "enum" && Array.isArray(value)) {
      for (const option of value) if (typeof option === "string") acc.add(option);
    }
    collectSchemaIdentifiers(value, acc);
  }
  return acc;
}

function ruleCrossReferences(tool, name, publishedNames) {
  const prose = proseOf(tool);
  const schemaIdentifiers = collectSchemaIdentifiers(schemaOf(tool));
  const referenced = new Set();

  for (const match of prose.matchAll(/[`'"]([a-z][a-z0-9_]{4,})[`'"]/g)) {
    referenced.add(match[1]);
  }

  const dangling = [...referenced].filter(
    (candidate) =>
      // Solo parece nombre de tool si lleva guion bajo y no es un identificador
      // que ya viva en el schema (campo, requerido o valor de enum).
      /_/.test(candidate) &&
      !schemaIdentifiers.has(candidate) &&
      !publishedNames.has(candidate) &&
      !DOMAIN_IDENTIFIERS.has(candidate) &&
      // Nombres de tabla, eventos de log y constantes del runtime de bots.
      !candidate.startsWith("ofapi_") &&
      !candidate.startsWith("bot_") &&
      !candidate.startsWith("allowed_")
  );

  if (dangling.length > 0) {
    report(
      "dangling-reference",
      name,
      `referencias a tools que no existen o no están publicadas: ${dangling.join(", ")}.`
    );
  }
}

/** 6. Un endpoint deshabilitado no debe seguir marcado como tool MCP. */
function ruleDisabledEndpoint(endpoint) {
  if (endpoint?.mcp?.enabled === true && endpoint.enabled === false) {
    report(
      "disabled-endpoint-enabled-tool",
      endpoint?.mcp?.name ?? endpoint.resource,
      "el endpoint está deshabilitado pero mcp.enabled sigue en true: " +
        "reactivarlo resucitaría la tool sin que nadie lo revise."
    );
  }
}

/** 7. Prefijo textual, operation_mode y metadatos de riesgo coherentes y completos. */
function ruleMetadataContract(tool, name) {
  const mcp = tool.mcp ?? {};
  const description = String(mcp.description ?? "");
  const mode = String(getMcpField(tool, "operation_mode") ?? "").trim();

  if (!mode) {
    report("metadata-incomplete", name, "falta `operation_mode`.");
  }

  if (getMcpField(tool, "requires_explicit_confirmation") === undefined) {
    report("metadata-incomplete", name, "falta `requires_explicit_confirmation`.");
  }

  if (!String(getMcpField(tool, "side_effects") ?? "").trim()) {
    report("metadata-incomplete", name, "falta `side_effects`.");
  }

  if (!String(getMcpField(tool, "safe_alternative") ?? "").trim()) {
    report("metadata-incomplete", name, "falta `safe_alternative`.");
  }

  const declaresRead = description.startsWith("READ ONLY:");
  const declaresWrite = description.startsWith("WRITE OPERATION:");

  if (mode === "read" && !declaresRead) {
    report(
      "prefix-mismatch",
      name,
      "operation_mode es `read` pero la descripción no abre con `READ ONLY:`."
    );
  }
  if (mode === "write" && !declaresWrite) {
    report(
      "prefix-mismatch",
      name,
      "operation_mode es `write` pero la descripción no abre con `WRITE OPERATION:`."
    );
  }
  if (declaresRead && mode !== "read") {
    report(
      "prefix-mismatch",
      name,
      `la descripción dice READ ONLY pero operation_mode es \`${mode || "(vacío)"}\`.`
    );
  }
  if (declaresWrite && mode !== "write") {
    report(
      "prefix-mismatch",
      name,
      `la descripción dice WRITE OPERATION pero operation_mode es \`${mode || "(vacío)"}\`.`
    );
  }
}

/**
 * 8. `side_effects` no puede ser el mismo boilerplate en media docena de tools.
 *
 * Solo se exige a las tools de escritura: en las de lectura el riesgo es el
 * mismo para todas y compartir el texto es honesto. En las de escritura, en
 * cambio, un texto común hace que `cache_invalidate` y `endpoint_delete` se lean
 * igual de peligrosas, y el agente acaba ignorando el campo.
 */
function ruleSideEffectsAreSpecific(tools) {
  const byText = new Map();
  for (const tool of tools) {
    if (String(getMcpField(tool, "operation_mode") ?? "").trim() !== "write") continue;
    const text = String(getMcpField(tool, "side_effects") ?? "").trim();
    if (!text) continue;
    if (!byText.has(text)) byText.set(text, []);
    byText.get(text).push(tool.mcp.name);
  }

  for (const [text, names] of byText) {
    if (names.length > MAX_TOOLS_PER_SIDE_EFFECTS_TEXT) {
      report(
        "side-effects-boilerplate",
        `${names.length} tools`,
        `comparten el mismo texto de side_effects (${names.length} > ${MAX_TOOLS_PER_SIDE_EFFECTS_TEXT}), ` +
          `así que no discrimina el riesgo real: "${text.slice(0, 80)}…". ` +
          `Afecta a: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ", …" : ""}.`
      );
    }
  }
}

/** 9. Unicidad de nombre tras sanear y pasar a minúsculas. */
function ruleNameUniqueness(tools) {
  const byKey = new Map();
  for (const name of [...tools.map((t) => t.mcp.name), ...STATIC_TOOL_NAMES]) {
    const key = normalizeToolKey(name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(name);
  }

  for (const [key, names] of byKey) {
    if (names.length > 1) {
      report(
        "duplicate-tool-name",
        key,
        `varios nombres colapsan al mismo identificador tras sanear: ${names.join(", ")}. ` +
          "El registro descarta los duplicados con un console.warn."
      );
    }
  }
}

// --- Ejecución --------------------------------------------------------------

function main() {
  const asJson = process.argv.includes("--json");
  const app = loadSeed();
  const tools = collectPublishedTools(app);
  const publishedNames = new Set([
    ...tools.map((tool) => tool.mcp.name),
    ...STATIC_TOOL_NAMES,
  ]);

  for (const endpoint of app.endpoints) {
    ruleDisabledEndpoint(endpoint);
  }

  for (const tool of tools) {
    const name = tool.mcp.name ?? `${tool.method} ${tool.resource}`;
    ruleSchemaEnabled(tool, name);
    ruleRequiredVsDefault(tool, name);
    ruleRequiredDocumented(tool, name);
    ruleParamsDocumented(tool, name);
    ruleCrossReferences(tool, name, publishedNames);
    ruleMetadataContract(tool, name);
  }

  ruleSideEffectsAreSpecific(tools);
  ruleNameUniqueness(tools);

  if (asJson) {
    console.log(JSON.stringify({ tools: tools.length, findings }, null, 2));
  } else {
    console.log(`Auditoría de contrato MCP — ${tools.length} tools publicadas en el seed.\n`);

    if (findings.length === 0) {
      console.log("Sin hallazgos: prosa, metadatos y schema son coherentes.");
    } else {
      const byRule = new Map();
      for (const finding of findings) {
        if (!byRule.has(finding.rule)) byRule.set(finding.rule, []);
        byRule.get(finding.rule).push(finding);
      }
      for (const [rule, items] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`## ${rule} (${items.length})`);
        for (const item of items) {
          console.log(`  - ${item.tool}: ${item.message}`);
        }
        console.log("");
      }
      console.log(`Total: ${findings.length} hallazgos.`);
    }
  }

  process.exit(findings.length > 0 ? 1 : 0);
}

try {
  main();
} catch (error) {
  console.error("Error ejecutando la auditoría:", error?.message || error);
  process.exit(2);
}
