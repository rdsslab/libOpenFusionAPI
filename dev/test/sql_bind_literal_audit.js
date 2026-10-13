// Auditoría de endpoints SQL ya publicados que responderán 400
// `SQL_BIND_INSIDE_LITERAL` al actualizar la librería.
//
// Por qué existe
// -------------
// Desde dd275db (13.11.32) el handler `SQL` rechaza un `$nombre` escrito dentro de un
// literal de texto, un identificador entrecomillado o un cuerpo `$$…$$`. El guard es
// correcto —sin él Sequelize sustituye ese `$nombre` y el endpoint responde 200 con el
// dato cambiado—, pero el rechazo solo se manifiesta en runtime: un endpoint que llevaba
// meses respondiendo 200 empieza a responder 400 en todas las llamadas en cuanto se
// actualiza la librería, y no hay aviso al desplegar.
//
// Este script recorre los endpoints `SQL` de una instancia, les pasa el MISMO detector
// que usa el runtime (`prepararSqlParaBinds`, `src/lib/handler/utils.js`) y lista los que
// ya tienen el patrón. Se puede ejecutar desde un checkout nuevo contra el servidor viejo
// todavía en marcha, que es justo lo que hace falta ANTES de actualizar.
//
// Alcance
// -------
//   - Solo handler `SQL` (el que ejecuta por Sequelize). `HANA` NO se audita: su
//     sustituto (`construirComandoHana`, `src/lib/handler/sqlHana.js`) ya ignora los `$`
//     dentro de literales y comentarios, así que ahí no hay nada roto y escanearlo daría
//     falsos positivos. `SQL_BULK_I` tampoco: en ese handler `code` es un nombre de tabla,
//     no una consulta.
//   - El catálogo ligero (`app_endpoints_catalog`) no trae `custom_data`, así que el script
//     no conoce el motor de cada endpoint. Como el motor decide **dónde cierra** un literal
//     o un identificador, no se escanea con una sola suposición: se escanean las tres que
//     cambian el resultado —las comunes, las de SQL Server (`[…]`) y las del escapado con
//     `\` de MySQL/MariaDB y `E'…'` de PostgreSQL— y cada hallazgo queda anotado con el caso
//     en el que aplica. Así la auditoría cubre los mismos patrones que el aviso de guardado
//     y el guard de runtime, que sí tienen las reglas exactas de cada conexión.
//
// Uso
// ---
//   node dev/test/sql_bind_literal_audit.js                       # local, todas las apps
//   node dev/test/sql_bind_literal_audit.js --base-url https://host:3033
//   node dev/test/sql_bind_literal_audit.js --app portalclientescorporativos
//   node dev/test/sql_bind_literal_audit.js --idapp <uuid> --environment prd
//   node dev/test/sql_bind_literal_audit.js --json
//
// Credenciales: `--user`/`--password` o `OFAPI_TEST_USER`/`OFAPI_TEST_PASS`
// (los mismos que el resto de dev/test). `--mcp-url` + `--authorization` saltan el login.
//
// Salida: código 0 si no hay hallazgos, 1 si hay alguno, 2 si la auditoría no pudo
// completarse. Pensado para encadenarlo en un despliegue.

import { prepararSqlParaBinds, sugerirLiteralSinBind } from "../../src/lib/handler/utils.js";
import { TEST_BASE_URL, TEST_PASSWORD, TEST_USER, basicAuthHeader } from "./test_credentials.js";

const DEFAULT_MCP_APP = "system";
const DEFAULT_MCP_ENV = "prd";
const PAGE_SIZE = 500;
const MAX_PAGES = 200; // tope de seguridad: 100k endpoints por app

function parseArgs(argv) {
  const args = {
    baseUrl: TEST_BASE_URL,
    user: TEST_USER,
    password: TEST_PASSWORD,
    app: null,
    idapp: null,
    environment: null,
    mcpUrl: null,
    authorization: null,
    json: false,
    help: false,
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
    } else if (token === "--app" && next) {
      args.app = next;
      i = take();
    } else if (token === "--idapp" && next) {
      args.idapp = next;
      i = take();
    } else if (token === "--environment" && next) {
      args.environment = next;
      i = take();
    } else if (token === "--mcp-url" && next) {
      args.mcpUrl = next;
      i = take();
    } else if (token === "--authorization" && next) {
      args.authorization = next;
      i = take();
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(
    [
      "Audita endpoints SQL publicados que responderán 400 SQL_BIND_INSIDE_LITERAL.",
      "",
      "Opciones:",
      "  --base-url <url>       Base del servidor (default OFAPI_BASE_URL o http://localhost:3000).",
      "  --user <usuario>       Usuario para el login (default OFAPI_TEST_USER o admin).",
      "  --password <clave>     Clave para el login (default OFAPI_TEST_PASS).",
      "  --app <nombre>         Auditar solo esa aplicación.",
      "  --idapp <uuid>         Auditar solo esa aplicación (idapp).",
      "  --environment <env>    Auditar solo dev, qa o prd.",
      "  --mcp-url <url>        Servidor MCP ya resuelto (salta el login).",
      "  --authorization <hdr>  Header Authorization para --mcp-url.",
      "  --json                 Salida legible por máquina.",
      "  -h, --help             Esta ayuda.",
    ].join("\n"),
  );
}

async function loginToServer(args) {
  const url = `${args.baseUrl}/api/${DEFAULT_MCP_APP}/system/login/${DEFAULT_MCP_ENV}`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: basicAuthHeader(args.user, args.password) },
    });
  } catch (error) {
    throw new Error(
      `No se pudo contactar ${url} (${error.message}). ¿Está el servidor en marcha?`,
    );
  }

  const raw = await response.text();
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch (_error) {
    // Respuesta no JSON: se reporta abajo.
  }

  if (!response.ok) {
    const detail = body?.message || raw.slice(0, 200) || "(cuerpo vacío)";
    const hint =
      response.status === 429
        ? " Login bloqueado temporalmente por intentos fallidos: espera ~2 min."
        : response.status === 401
          ? " Comprueba --user/--password (o OFAPI_TEST_USER/OFAPI_TEST_PASS)."
          : "";
    throw new Error(`Login falló con HTTP ${response.status}: ${detail}.${hint}`);
  }
  if (!body?.token) {
    throw new Error("El login respondió 200 sin token.");
  }

  return {
    url: `${args.baseUrl}/api/${DEFAULT_MCP_APP}/mcp/server/${DEFAULT_MCP_ENV}`,
    auth: `Bearer ${body.token}`,
    origin: `login local (${args.user}@${args.baseUrl})`,
  };
}

async function resolveTarget(args) {
  if (args.mcpUrl && args.authorization) {
    return { url: args.mcpUrl, auth: args.authorization, origin: "--mcp-url + --authorization" };
  }
  const local = await loginToServer(args);
  return args.mcpUrl ? { ...local, url: args.mcpUrl, origin: `--mcp-url + ${local.origin}` } : local;
}

async function callMcp(target, method, params = {}) {
  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: target.auth,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
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

/** El resultado de una tool MCP puede traer los datos anidados en `content[].text`. */
function extractArrayFromToolCall(result) {
  const direct = Array.isArray(result)
    ? result
    : Array.isArray(result?.rows)
      ? result.rows
      : Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result?.data)
          ? result.data
          : [];
  if (direct.length > 0) return direct;

  const content = Array.isArray(result?.content) ? result.content : [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const nested = extractArrayFromToolCall(part);
    if (nested.length > 0) return nested;
    if (typeof part.text === "string") {
      const text = part.text.trim();
      if (text.startsWith("[") || text.startsWith("{")) {
        try {
          const parsed = JSON.parse(text);
          const fromParsed = extractArrayFromToolCall(parsed);
          if (fromParsed.length > 0) return fromParsed;
        } catch (_error) {
          // Texto que no es JSON: se ignora.
        }
      }
    }
  }
  return [];
}

/** Todas las apps de la instancia. `apps_catalog` es ligero y no expande endpoints. */
async function fetchApps(target, args) {
  const result = ensureMcpResult(
    await callMcp(target, "tools/call", {
      name: "apps_catalog",
      arguments: { limit: PAGE_SIZE, offset: 0 },
    }),
    "apps_catalog",
  );

  const rows = extractArrayFromToolCall(result);
  return rows.map((row) => ({
    app: row?.app ?? row?.name ?? null,
    idapp: row?.idapp ?? null,
  })).filter((row) => row.idapp);
}

async function fetchSqlEndpoints(target, args, idapp) {
  const all = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const filtros = {
      idapp,
      handler: "SQL",
      include_code: true,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    };
    if (args.environment) filtros.environment = args.environment;

    const result = ensureMcpResult(
      await callMcp(target, "tools/call", {
        name: "app_endpoints_catalog",
        arguments: filtros,
      }),
      "app_endpoints_catalog",
    );

    const batch = extractArrayFromToolCall(result);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) return all;
  }

  throw new Error(
    `app_endpoints_catalog siguió devolviendo páginas completas tras ${MAX_PAGES} ` +
      `páginas (${all.length} endpoints). Se aborta para no informar sobre un catálogo parcial.`,
  );
}

/**
 * Los tres juegos de reglas con los que se escanea cada endpoint. El motor decide dónde
 * cierran los literales y los identificadores, y desde `app_endpoints_catalog` no se sabe
 * cuál es, así que se prueban los tres y se informa por hallazgo de cuál aplica:
 *
 *   - `siempre`: literales `'…'` con comilla doblada, identificadores `"…"` y backticks.
 *     Los ve cualquier motor, así que el hallazgo no depende de cuál sea.
 *   - `\` como escape del literal: en MySQL/MariaDB `'l\'avion'` es una sola cadena, y en
 *     PostgreSQL solo con literales `E'…'` o con `standardConformingStrings=false`. Son
 *     las reglas de `dialect.canBackslashEscape()` / `supports.escapeStringConstants`.
 *   - `[…]`: identificadores entre corchetes de SQL Server. En PostgreSQL/SQLite `[…]` es
 *     un subíndice de array, así que este pase solo cuenta para MSSQL.
 */
const PASES = [
  { motivo: "siempre", contexto: null },
  {
    motivo: "solo con `\\` como escape del literal (MySQL/MariaDB, o `E'…'` de PostgreSQL)",
    contexto: { dialect: "mysql", backslashEscape: true, escapeStringConstants: true },
  },
  {
    motivo: "solo en SQL Server (identificador entre corchetes)",
    contexto: { dialect: "mssql" },
  },
];

/** Aplica el detector del runtime a cada endpoint y devuelve solo los que fallan. */
function auditEndpoints(endpoints, appName) {
  const findings = [];

  for (const ep of endpoints) {
    if (ep?.handler !== undefined && String(ep.handler).toUpperCase() !== "SQL") continue;
    if (typeof ep?.code !== "string" || ep.code.indexOf("$") === -1) continue;

    // Clave `nombre@contenedor` para no repetir un `$nombre` que aparece varias veces, con
    // los motivos (pases) por los que se rechaza.
    const porToken = new Map();
    for (const pase of PASES) {
      const { rechazados } = prepararSqlParaBinds(ep.code, pase.contexto);
      for (const r of rechazados || []) {
        const clave = `${r.name}@${r.contenedor}`;
        if (!porToken.has(clave)) {
          porToken.set(clave, { name: r.name, contenedor: r.contenedor, motivos: [] });
        }
        porToken.get(clave).motivos.push(pase.motivo);
      }
    }
    if (porToken.size === 0) continue;

    findings.push({
      app: appName ?? null,
      idapp: ep.idapp ?? null,
      idendpoint: ep.idendpoint ?? null,
      method: ep.method ?? null,
      resource: ep.resource ?? null,
      environment: ep.environment ?? null,
      enabled: ep.enabled !== false,
      rechazados: [...porToken.values()].map((r) => ({
        name: r.name,
        contenedor: r.contenedor,
        // Si lo rechaza el pase común, vale para cualquier motor; si no, se dice en cuál
        // aplica para que nadie toque un endpoint de PostgreSQL por un corchete de MSSQL.
        cuando: r.motivos.includes("siempre") ? "siempre" : r.motivos.join(" o "),
        // Lo que el endpoint devolvía (200 con el dato cambiado) y lo que responderá
        // tras actualizar (400). El script no puede saber el motor desde
        // `app_endpoints_catalog` (el catálogo ligero no trae `custom_data`), así que da
        // la sintaxis de los tres en vez de asumir T-SQL. Va aquí para que el informe se
        // pueda pegar en un ticket.
        correccion: {
          mssql: sugerirLiteralSinBind(r.name, "mssql"),
          postgres_sqlite: sugerirLiteralSinBind(r.name, "postgres"),
          mysql_mariadb: sugerirLiteralSinBind(r.name, "mysql"),
        },
      })),
    });
  }

  return findings;
}

function printTextReport(target, appsCount, checked, findings) {
  console.log(`Servidor MCP: ${target.url}`);
  console.log(`Credenciales: ${target.origin}`);
  console.log(`Aplicaciones auditadas: ${appsCount}`);
  console.log(`Endpoints SQL revisados: ${checked}`);
  console.log("");

  if (findings.length === 0) {
    console.log("OK: ningún endpoint SQL tiene un `$nombre` dentro de un literal, identificador o cuerpo dollar-quoted.");
    return;
  }

  console.log(`HALLAZGOS: ${findings.length} endpoint(s) responderán 400 SQL_BIND_INSIDE_LITERAL tras actualizar.`);
  for (const [i, f] of findings.entries()) {
    const habilitado = f.enabled ? "enabled" : "disabled";
    console.log("");
    console.log(`${i + 1}. ${f.app || "?"} | ${f.method || "?"} ${f.resource || "?"} | ${f.environment || "?"} | ${habilitado}`);
    console.log(`   idendpoint: ${f.idendpoint}`);
    for (const r of f.rechazados) {
      const cuando = r.cuando === "siempre" ? "" : ` — ${r.cuando}`;
      console.log(`   - $${r.name} dentro de ${r.contenedor.replace(/_/g, " ")}${cuando}`);
      console.log(`       SQL Server:         ${r.correccion.mssql}`);
      console.log(`       PostgreSQL/SQLite:  ${r.correccion.postgres_sqlite}`);
      console.log(`       MySQL/MariaDB:      ${r.correccion.mysql_mariadb}`);
    }
  }
  console.log("");
  console.log("Corrige cada `code` (renombra el parámetro, saca el texto del SQL, o usa la concatenación indicada) y vuelve a pasarlo por `endpoint_upsert`.");
  console.log("Si un hallazgo dice «solo …», el endpoint solo falla si su motor es ese: el catálogo ligero no trae `custom_data`, así que no se puede saber desde aquí.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const target = await resolveTarget(args);

  let apps = [];
  if (args.idapp) {
    apps = [{ app: args.app, idapp: args.idapp }];
  } else {
    apps = await fetchApps(target, args);
    if (args.app) {
      apps = apps.filter((a) => a.app === args.app);
    }
    if (args.idapp) {
      apps = apps.filter((a) => a.idapp === args.idapp);
    }
  }

  if (apps.length === 0) {
    throw new Error(
      args.app || args.idapp
        ? "La aplicación indicada no existe o no es visible con estas credenciales."
        : "apps_catalog no devolvió ninguna aplicación; comprueba las credenciales.",
    );
  }

  const findings = [];
  let checked = 0;

  for (const app of apps) {
    const endpoints = await fetchSqlEndpoints(target, args, app.idapp);
    checked += endpoints.length;
    findings.push(...auditEndpoints(endpoints, app.app));
  }

  if (args.json) {
    console.log(JSON.stringify({
      server: target.url,
      credentials_origin: target.origin,
      apps_audited: apps.length,
      sql_endpoints_checked: checked,
      findings_count: findings.length,
      findings,
    }, null, 2));
  } else {
    printTextReport(target, apps.length, checked, findings);
  }

  process.exit(findings.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(2);
});
