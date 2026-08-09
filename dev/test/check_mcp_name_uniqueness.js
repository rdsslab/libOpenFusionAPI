import fs from "node:fs";
import path from "node:path";
import { normalizeToolKey } from "../../src/lib/server/mcp/toolNames.js";

const DEFAULT_SERVER_KEY = "openfusion_system_remote_prd";
const DEFAULT_APP_NAME = "system";
const DEFAULT_ENV = "prd";
const DEFAULT_SYSTEM_IDAPP = "cfcd2084-95d5-65ef-66e7-dff9f98764da";

function parseArgs(argv) {
  const args = {
    serverKey: DEFAULT_SERVER_KEY,
    appName: DEFAULT_APP_NAME,
    environment: DEFAULT_ENV,
    idapp: DEFAULT_SYSTEM_IDAPP,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--server-key" && next) {
      args.serverKey = next;
      i += 1;
    } else if (token === "--app" && next) {
      args.appName = next;
      i += 1;
    } else if (token === "--environment" && next) {
      args.environment = next;
      i += 1;
    } else if (token === "--idapp" && next) {
      args.idapp = next;
      i += 1;
    }
  }

  return args;
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

  if (!url) {
    throw new Error(`Server '${serverKey}' does not have a URL in ${mcpPath}`);
  }

  if (!auth) {
    throw new Error(`Server '${serverKey}' does not have Authorization header in ${mcpPath}`);
  }

  return { url, auth, mcpPath };
}

function normalizeJsonc(source) {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
  return withoutLineComments.replace(/,\s*([}\]])/g, "$1");
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
    if (line.startsWith("data: ")) {
      return JSON.parse(line.slice(6));
    }
  }

  return JSON.parse(rawText);
}

function ensureMcpResult(result, label) {
  if (result?.error) {
    throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  }
  return result?.result;
}

function extractArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function extractArrayFromToolCall(result) {
  if (!result || typeof result !== "object") return [];

  const direct = extractArray(result);
  if (direct.length > 0) return direct;

  const content = Array.isArray(result.content) ? result.content : [];
  for (const part of content) {
    if (part && typeof part === "object") {
      const nested = extractArray(part);
      if (nested.length > 0) return nested;

      if (typeof part.text === "string") {
        const text = part.text.trim();
        if (text.startsWith("[") || text.startsWith("{")) {
          try {
            const parsed = JSON.parse(text);
            const fromParsed = extractArray(parsed);
            if (fromParsed.length > 0) return fromParsed;
          } catch (_error) {
            // Ignore non-JSON text payloads.
          }
        }
      }
    }
  }

  return [];
}

function listDuplicateToolNames(endpoints) {
  const nameToEndpoints = new Map();

  for (const ep of endpoints) {
    const mcp = ep?.mcp;
    if (!mcp || typeof mcp !== "object") continue;
    if (mcp.enabled !== true) continue;

    const name = String(mcp.name || "").trim();
    if (!name) continue;

    // Se agrupa por el nombre NORMALIZADO, no por el crudo: el registro de tools
    // saneia el nombre y lo pasa a minúsculas antes de comprobar duplicados, así
    // que `Foo-Bar` y `foo_bar` colisionan aunque como texto sean distintos. Con
    // la comparación literal esas colisiones se escapaban y solo se veían como un
    // console.warn del servidor descartando una de las dos tools.
    const key = normalizeToolKey(name);

    if (!nameToEndpoints.has(key)) {
      nameToEndpoints.set(key, []);
    }

    nameToEndpoints.get(key).push({
      idendpoint: ep.idendpoint,
      method: ep.method,
      resource: ep.resource,
      handler: ep.handler,
      access: ep.access,
      declaredName: name,
    });
  }

  return [...nameToEndpoints.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([name, entries]) => ({ name, entries }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = resolveMcpConfig(args.serverKey);

  console.log(`Using MCP server key: ${args.serverKey}`);
  console.log(`Using app: ${args.appName}, environment: ${args.environment}, idapp: ${args.idapp}`);
  console.log(`mcp.json: ${cfg.mcpPath}`);

  const endpointsCatalog = ensureMcpResult(
    await callMcp(cfg.url, cfg.auth, "tools/call", {
      name: "app_endpoints_catalog",
      arguments: {
        idapp: args.idapp,
        environment: args.environment,
        include_code: false,
        // Imprescindible: el catálogo excluye el campo `mcp` por defecto. Sin esto
        // llegaba siempre undefined, el filtro `mcp.enabled !== true` descartaba
        // todos los endpoints y el test daba OK sin haber comprobado nada.
        include_mcp: true,
        limit: 500,
        offset: 0,
      },
    }),
    "app_endpoints_catalog",
  );

  const endpoints = extractArrayFromToolCall(endpointsCatalog);
  if (endpoints.length === 0) {
    throw new Error("No endpoints were returned by app_endpoints_catalog. Verify idapp/environment and MCP credentials.");
  }
  const duplicates = listDuplicateToolNames(endpoints);

  console.log(`Checked endpoints: ${endpoints.length}`);

  if (duplicates.length === 0) {
    console.log("OK: no duplicate enabled mcp.name values were found.");
    process.exit(0);
  }

  console.error(`Found ${duplicates.length} duplicate mcp.name values (compared after sanitizing):`);
  for (const dup of duplicates) {
    console.error(`\n- ${dup.name}`);
    for (const e of dup.entries) {
      console.error(`  - declared as "${e.declaredName}" | ${e.method} ${e.resource} | idendpoint=${e.idendpoint} | handler=${e.handler} | access=${e.access}`);
    }
  }

  process.exit(1);
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(2);
});
