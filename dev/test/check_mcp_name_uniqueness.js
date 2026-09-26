// Comprueba que no haya nombres de tool MCP duplicados dentro de una app.
//
// Por qué NO se lee el mcp.json de VS Code: ese archivo solo existe en la
// máquina del desarrollador, vive en una ruta exclusiva de Windows
// (%APPDATA%/Code/User/mcp.json) y el token que guarda caduca. Depender de él
// hacía que este test no pudiera pasar en Linux, macOS, CI ni en ningún contenedor,
// y era justo lo que hacía que el validation packet entero terminara en exit 2
// fuera de Windows. Ahora el destino por defecto es el servidor local, con las
// mismas credenciales que el resto de dev/test, y el mcp.json queda como
// override opcional para quien sí quiera apuntar a un server remoto.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeToolKey } from "../../src/lib/server/mcp/toolNames.js";
import { TEST_BASE_URL, TEST_PASSWORD, TEST_USER, basicAuthHeader } from "./test_credentials.js";

const DEFAULT_MCP_APP = "system";
const DEFAULT_MCP_ENV = "prd";
const DEFAULT_ENV = "prd";
const DEFAULT_SYSTEM_IDAPP = "cfcd2084-95d5-65ef-66e7-dff9f98764da";
// El seed declara /system/login una sola vez y solo en prd, así que el login no
// puede seguir al entorno del servidor MCP.
const LOGIN_ENV = "prd";
const AUTH_APP = "system";

function parseArgs(argv) {
  const args = {
    baseUrl: TEST_BASE_URL,
    user: TEST_USER,
    password: TEST_PASSWORD,
    // Que servidor MCP se consulta...
    mcpApp: DEFAULT_MCP_APP,
    mcpEnvironment: DEFAULT_MCP_ENV,
    // ...y qué app/entorno se audita. Son ejes independientes: el servidor MCP de
    // `system` en prd es el que puede leer los endpoints de `demo` en dev, así que
    // atar los dos a un solo --environment rompía el caso multi-app (el MCP de
    // system no está publicado en dev, y el de demo devuelve un catálogo vacío
    // para su propia app).
    environment: DEFAULT_ENV,
    idapp: DEFAULT_SYSTEM_IDAPP,
    mcpUrl: null,
    authorization: null,
    mcpJson: null,
    serverKey: null,
  };

  const nextOf = (argv, i) => {
    const value = argv[i + 1];
    return value && !value.startsWith("--") ? value : null;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = nextOf(argv, i);
    const take = () => i + 1;

    if (token === "--base-url" && next) {
      args.baseUrl = next;
      i = take();
    } else if (token === "--user" && next) {
      args.user = next;
      i = take();
    } else if (token === "--password" && next) {
      args.password = next;
      i = take();
    } else if (token === "--mcp-app" && next) {
      args.mcpApp = next;
      i = take();
    } else if (token === "--mcp-environment" && next) {
      args.mcpEnvironment = next;
      i = take();
    } else if (token === "--environment" && next) {
      args.environment = next;
      i = take();
    } else if (token === "--idapp" && next) {
      args.idapp = next;
      i = take();
    } else if (token === "--mcp-url" && next) {
      args.mcpUrl = next;
      i = take();
    } else if (token === "--authorization" && next) {
      args.authorization = next;
      i = take();
    } else if (token === "--mcp-json" && next) {
      args.mcpJson = next;
      i = take();
    } else if (token === "--server-key" && next) {
      args.serverKey = next;
      i = take();
    }
  }

  return args;
}

function defaultMcpJsonPath() {
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Code", "User", "mcp.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdg, "Code", "User", "mcp.json");
}

function normalizeJsonc(source) {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
  return withoutLineComments.replace(/,\s*([}\]])/g, "$1");
}

function resolveMcpConfig(args) {
  const mcpPath = args.mcpJson || defaultMcpJsonPath();
  if (!fs.existsSync(mcpPath)) {
    throw new Error(
      `mcp.json not found at ${mcpPath}. Pasa --mcp-json <ruta>, o quita --server-key para usar el servidor local.`,
    );
  }

  const raw = fs.readFileSync(mcpPath, "utf8");
  const parsed = JSON.parse(normalizeJsonc(raw));
  const serverKey = args.serverKey || Object.keys(parsed?.servers || {})[0];
  const server = parsed?.servers?.[serverKey];

  if (!server) {
    throw new Error(`Server key '${serverKey}' not found in ${mcpPath}`);
  }
  if (!server.url) {
    throw new Error(`Server '${serverKey}' does not have a URL in ${mcpPath}`);
  }

  const auth = server?.headers?.Authorization || server?.headers?.authorization;
  if (!auth) {
    throw new Error(`Server '${serverKey}' does not have Authorization header in ${mcpPath}`);
  }

  return { url: server.url, auth, origin: `mcp.json (${serverKey})` };
}

async function loginToServer(args) {
  const url = `${args.baseUrl}/api/${AUTH_APP}/system/login/${LOGIN_ENV}`;
  const basic = basicAuthHeader(args.user, args.password);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: basic },
    });
  } catch (error) {
    throw new Error(
      `No se pudo contactar ${url} (${error.message}). Levanta el servidor con "PORT=3000 BUILD_DB=true node ./src/server.js" o pasa --mcp-url/--server-key.`,
    );
  }

  const raw = await response.text();
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch (_error) {
    // Respuesta no JSON: se reporta tal cual en el mensaje de abajo.
  }

  if (!response.ok) {
    const detail = body?.message || raw.slice(0, 200) || "(cuerpo vacío)";
    const hint =
      response.status === 429
        ? " Login bloqueado temporalmente por intentos fallidos: espera ~2 min."
        : response.status === 401
          ? ` Comprueba las credenciales (--user/--password u OFAPI_TEST_USER/OFAPI_TEST_PASS; el seed usa "${TEST_USER}":"${TEST_PASSWORD}").`
          : "";
    throw new Error(`Login fallo con HTTP ${response.status}: ${detail}.${hint}`);
  }

  if (!body?.token) {
    throw new Error("Login respondio 200 sin token.");
  }

  return {
    url: `${args.baseUrl}/api/${args.mcpApp}/mcp/server/${args.mcpEnvironment}`,
    auth: `Bearer ${body.token}`,
    origin: `login local (${args.user}@${args.baseUrl})`,
  };
}

async function resolveTarget(args) {
  if (args.mcpUrl && args.authorization) {
    return { url: args.mcpUrl, auth: args.authorization, origin: "--mcp-url + --authorization" };
  }
  // --mcp-url sin header: en ambos casos hace falta un token, y el login local es
  // la única vía que no depende de mcp.json.
  if (args.mcpJson || args.serverKey) {
    return resolveMcpConfig(args);
  }
  const local = await loginToServer(args);
  return args.mcpUrl ? { ...local, url: args.mcpUrl, origin: `--mcp-url + ${local.origin}` } : local;
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

  try {
    return JSON.parse(rawText);
  } catch (_error) {
    throw new Error(`Respuesta MCP no es JSON: ${rawText.slice(0, 300)}`);
  }
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

// La propia documentación de `limit` avisa de que la respuesta se trunca en
// silencio ("page with `offset` before concluding an endpoint does not exist").
// Un catálogo truncado daría un OK falso —que es exactamente el fallo que este
// test tenía antes—, así que se recorre entero, página a página.
const PAGE_SIZE = 500;
const MAX_PAGES = 200; // tope de seguridad: 100k endpoints

async function fetchAllEndpoints(target, args) {
  const all = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = ensureMcpResult(
      await callMcp(target.url, target.auth, "tools/call", {
        name: "app_endpoints_catalog",
        arguments: {
          idapp: args.idapp,
          environment: args.environment,
          include_code: false,
          // Imprescindible: el catálogo excluye el campo `mcp` por defecto. Sin esto
          // llegaba siempre undefined, el filtro `mcp.enabled !== true` descartaba
          // todos los endpoints y el test daba OK sin haber comprobado nada.
          include_mcp: true,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      }),
      "app_endpoints_catalog",
    );

    const batch = extractArrayFromToolCall(result);
    all.push(...batch);

    if (batch.length < PAGE_SIZE) return all;
  }

  throw new Error(
    `app_endpoints_catalog still returned full pages after ${MAX_PAGES} pages (${all.length} endpoints). ` +
      "Refusing to report on a partial catalog.",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = await resolveTarget(args);

  console.log(`MCP target: ${target.url}`);
  console.log(`Origen de las credenciales: ${target.origin}`);
  console.log(`Auditando: idapp=${args.idapp}, environment=${args.environment}`);

  const endpoints = await fetchAllEndpoints(target, args);
  if (endpoints.length === 0) {
    throw new Error(
      "No endpoints were returned by app_endpoints_catalog. Verify idapp/environment and that the token can read that app.",
    );
  }

  const enabled = endpoints.filter((ep) => ep?.mcp?.enabled === true);
  if (enabled.length === 0) {
    throw new Error(
      "0 endpoints with mcp.enabled=true. The check would be vacuous: fix idapp/environment or enable MCP on at least one endpoint.",
    );
  }

  const duplicates = listDuplicateToolNames(endpoints);

  console.log(`Checked endpoints: ${endpoints.length} (${enabled.length} exposed as MCP tools)`);

  if (duplicates.length === 0) {
    console.log(`OK: no duplicate enabled mcp.name values were found across ${enabled.length} tools.`);
    process.exit(0);
  }

  console.error(
    `Found ${duplicates.length} duplicate mcp.name values (compared after sanitizing):`,
  );
  for (const dup of duplicates) {
    console.error(`\n- ${dup.name}`);
    for (const e of dup.entries) {
      console.error(
        `  - declared as "${e.declaredName}" | ${e.method} ${e.resource} | idendpoint=${e.idendpoint} | handler=${e.handler} | access=${e.access}`,
      );
    }
  }

  process.exit(1);
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(2);
});
