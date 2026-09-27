// ESTE FICHERO NO LO EJECUTA NADIE.
//
// No convierte esquemas: llama en vivo a la tool MCP
// `validate_json_schema_for_mcp` y comprueba que la respuesta no venga con
// banderas de incompatibilidad. No es suite del packet ni tiene npm script, asi
// que solo arranca escribiendolo:
//
//   node dev/test/mcp_schema_conversion.js
//
// No muta nada, solo consulta, asi que PODRIA entrar en el packet tal cual. Que
// no lo este no es una limitacion tecnica: nadie lo registro, que es distinto de
// que no se pueda.
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SERVER_KEY = "openfusion_system_remote_prd";

function normalizeJsonc(source) {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
  return withoutLineComments.replace(/,\s*([}\]])/g, "$1");
}

function resolveMcpConfig(serverKey) {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error("APPDATA is not defined. Unable to resolve VS Code mcp.json.");
  }

  const mcpPath = path.join(appData, "Code", "User", "mcp.json");
  if (!fs.existsSync(mcpPath)) {
    throw new Error(`mcp.json not found at ${mcpPath}`);
  }

  const raw = fs.readFileSync(mcpPath, "utf8");
  const parsed = JSON.parse(normalizeJsonc(raw));
  const server = parsed?.servers?.[serverKey];

  if (!server) {
    throw new Error(`Server key '${serverKey}' not found in ${mcpPath}`);
  }

  const url = server.url;
  const auth = server?.headers?.Authorization || server?.headers?.authorization;

  if (!url) throw new Error(`Server '${serverKey}' does not have a URL.`);
  if (!auth) throw new Error(`Server '${serverKey}' does not have Authorization header.`);

  return { url, auth, mcpPath };
}

async function callMcp(mcpUrl, authorization, method, params = {}) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: authorization,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${rawText.slice(0, 500)}`);
  }

  for (const line of rawText.split("\n")) {
    if (line.startsWith("data: ")) return JSON.parse(line.slice(6));
  }

  return JSON.parse(rawText);
}

function parseToolCallContent(resultObj) {
  const content = Array.isArray(resultObj?.content) ? resultObj.content : [];
  for (const part of content) {
    if (part && typeof part === "object" && typeof part.text === "string") {
      const text = part.text.trim();
      if (!text) continue;
      if (text.startsWith("{") || text.startsWith("[")) {
        try {
          return JSON.parse(text);
        } catch (_err) {
          // ignore parse error and continue
        }
      }
    }
  }
  return resultObj;
}

async function main() {
  const cfg = resolveMcpConfig(DEFAULT_SERVER_KEY);
  console.log(`Using MCP server: ${DEFAULT_SERVER_KEY}`);
  console.log(`mcp.json: ${cfg.mcpPath}`);

  const list = await callMcp(cfg.url, cfg.auth, "tools/list");
  if (list?.error) {
    throw new Error(`tools/list failed: ${JSON.stringify(list.error)}`);
  }

  const tools = Array.isArray(list?.result?.tools) ? list.result.tools : [];
  const hasValidator = tools.some((t) => t?.name === "validate_json_schema_for_mcp");
  if (!hasValidator) {
    throw new Error("validate_json_schema_for_mcp tool not exposed by MCP server.");
  }

  const sampleSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: { type: "string", minLength: 1 },
      enabled: { type: "boolean" },
    },
  };

  const call = await callMcp(cfg.url, cfg.auth, "tools/call", {
    name: "validate_json_schema_for_mcp",
    arguments: {
      schema: sampleSchema,
      include_normalized_schema: false,
      include_serialized_schema: false,
    },
  });

  if (call?.error) {
    throw new Error(`tools/call validate_json_schema_for_mcp failed: ${JSON.stringify(call.error)}`);
  }

  const parsed = parseToolCallContent(call?.result);
  const asText = JSON.stringify(parsed).toLowerCase();

  // We accept any successful structured response, but fail if it clearly reports incompatibility/errors.
  const looksLikeFailure = asText.includes('"compatible":false') || asText.includes('"is_compatible":false') || asText.includes('"errors":[{');

  if (looksLikeFailure) {
    console.error("Validator response indicates incompatibility/errors:");
    console.error(JSON.stringify(parsed, null, 2));
    process.exit(1);
  }

  console.log("OK: schema conversion validator tool is available and responded without incompatibility flags.");
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(2);
});
