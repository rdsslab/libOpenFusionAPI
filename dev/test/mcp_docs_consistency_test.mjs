/**
 * Tests de los hallazgos de la auditoría de la documentación MCP (13.11.1).
 *
 * Son tres cosas distintas y las tres se.dao documentaban mal:
 *
 *   1. A6 — `audit_log_search` documentaba el filtro `idclient`, pero getAuditLogs solo lo
 *      metía en la lista de `attributes` (la proyección). Nunca llegaba al `where`, así que
 *      filtrar por cliente API devolvía todas las filas — con la columna `idclient` visible,
 *      que es lo que hace que un filtro roto parezca funcionar. En una herramienta de
 *      auditoría eso no es un detalle cosmético: es "muéstrame lo que hizo el cliente X"
 *      devolviendo lo que hicieron todos.
 *
 *   2. A2 — `agent_onboarding` declaraba 18 claves en `links` y devolvía 13. Cinco no
 *      cuadraban: tres eran herramientas reales sin enlazar, dos no existían.
 *
 *   3. A4 — `user_create` decía "If omitted, login is disabled". El código genera una
 *      contraseña temporal, la guarda hasheada y la devuelve: la cuenta sí entra.
 *
 * Más los que aparecieron en la segunda ronda:
 *
 *   4. A1 — la tool `get_libopenfusionapi_latest_version` estaba montada sobre
 *      `/database/hooks`, cuyo código es `ofapi.server.checkwebHookDB(request)`: no devuelve
 *      ninguna versión, mete el body en la invalidación de caché. El endpoint que sí la
 *      devuelve estaba con `mcp.enabled: false`, así que ningún agente podía leerlo. El
 *      frontend sí lo veía actualizado porque consume ese resource por HTTP.
 *
 *   5. A5 + B1 — `apiclient_create` mandaba la contraseña en claro a un correo personal
 *      fijo, y el fallo del envío tumbaba la llamada después de crear la fila. El esquema
 *      además decía que `username` toma "the email prefix", cuando el hook asigna el email
 *      entero.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const auditSource = readFileSync(
  join(repoRoot, "src/lib/db/audit.js"),
  "utf8",
);

const seed = await import(
  /* @vite-ignore */ new URL(
    "../../src/lib/db/default/system.js",
    import.meta.url,
  ).href + "?t=" + Date.now()
);

const tool = (name) =>
  seed.system_app.endpoints.find((e) => e.mcp?.name === name);

/* ------------------------------------------------------------------ *
 * 1. A6 — el filtro idclient tiene que llegar al where
 * ------------------------------------------------------------------ */

test("A6: idclient se mete en el where, no solo en la proyección", () => {
  // El defecto original: `idclient` aparecía en el array de `attributes` (lo que se
  // proyecta) y en ningún `if (filters....) where....`. Sin esta línea, el filtro es
  // decorativo.
  assert.match(
    auditSource,
    /if \(filters\.idclient\)\s*where\.idclient\s*=\s*filters\.idclient;/,
    "getAuditLogs debe construir where.idclient a partir del filtro",
  );
});

test("A6: la proyección y el where toman idclient de fuentes distintas", () => {
  // La trampa que hace que esto pase desapercibido: `idclient` aparece DOS veces en el
  // archivo, y solo una es el filtro. Contar apariciones sin distinguir el papel da una
  // falsa sensación de cobertura, así que se comprueba cada papel por separado.
  const inAttributes = /attributes:\s*\[[\s\S]*?"idclient",[\s\S]*?\]/.test(
    auditSource,
  );
  const inWhere = /where\.idclient\s*=/.test(auditSource);

  assert.ok(inAttributes, "idclient debe seguir en la proyección: se devuelve en cada fila");
  assert.ok(inWhere, "y además debe estar en el where: sin esto el filtro no filtra");
});

test("A6: los filtros declarados en el esquema tienen contraparte en el where", () => {
  // El fallo fue de una clave suelta. El test lo generaliza, peroSIN asumir una unica
  // forma: `from`/`to` no van a `where.from`, se acumulan en `dateFilter` y se aplican
  // sobre `where.timestamp`. Un test que supusiera `where.<nombre>` para todo daria
  // falsos positivos y acabaria ignorandose.
  const schema = tool("audit_log_search").json_schema.in.schema;
  const stringFilters = Object.entries(schema.properties)
    .filter(([, def]) => def.type === "string")
    .map(([k]) => k);

  // `id` no es un filtro: selecciona una entrada concreta por clave primaria.
  // `from`/`to` se combinan en un rango sobre `timestamp`.
  const viaOtherKey = new Set(["id", "from", "to"]);

  for (const name of stringFilters) {
    if (viaOtherKey.has(name)) continue;
    assert.ok(
      new RegExp(`where\\.${name}\\b`).test(auditSource),
      `el esquema declara el filtro "${name}" pero getAuditLogs no lo pone en el where`,
    );
  }

  // Y la ventana temporal se comprueba por su propio camino, para que el conjunto de
  // filtros couvert sea completo y no solo el subconjunto de los obvios. El código parsea
  // cada fecha a `Date` antes de compararla, y descarta la que no parsea, así que el test
  // busca ese recorrido y no una asignación directa.
  assert.match(auditSource, /const from = new Date\(filters\.from\)/);
  assert.match(auditSource, /const to = new Date\(filters\.to\)/);
  assert.match(auditSource, /dateFilter\[Op\.gte\]\s*=\s*from/);
  assert.match(auditSource, /dateFilter\[Op\.lte\]\s*=\s*to/);
  assert.match(auditSource, /where\.timestamp\s*=\s*dateFilter/);
});

/* ------------------------------------------------------------------ *
 * 2. A2 — links declarados == links devueltos
 * ------------------------------------------------------------------ */

test("A2: agent_onboarding no declara en links ninguna clave que no devuelva", () => {
  const ob = tool("agent_onboarding");
  const declared = Object.keys(ob.json_schema.out.schema.properties.links.properties);
  const code = ob.code;

  const declaredButMissing = declared.filter((k) => !code.includes(`${k}:`));
  assert.deepEqual(
    declaredButMissing,
    [],
    `el outputSchema declara estas claves de links que el código nunca devuelve: ${declaredButMissing.join(", ")}`,
  );
});

test("A2: agent_onboarding no devuelve ninguna clave de links sin declarar", () => {
  const ob = tool("agent_onboarding");
  const declared = new Set(
    Object.keys(ob.json_schema.out.schema.properties.links.properties),
  );
  const code = ob.code;

  // El bloque `links: { ... }` del código, tal cual se escribe. El corte empieza DESPUÉS
  // de la cabecera: si no, el propio `links:` cuenta como clave y el test siempre falla.
  const start = code.indexOf("links: {");
  assert.ok(start > -1, "el código debe construir el objeto links");
  const block = code.slice(start + "links: {".length, code.indexOf("}", start));
  const assigned = [...block.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);

  const undeclared = assigned.filter((k) => !declared.has(k));
  assert.deepEqual(
    undeclared,
    [],
    `el código devuelve estas claves de links que el outputSchema no declara: ${undeclared.join(", ")}`,
  );
});

test("A2: las claves inventadas ya no están, y las reales sí", () => {
  const declared = Object.keys(
    tool("agent_onboarding").json_schema.out.schema.properties.links.properties,
  );

  // No existen como herramienta MCP: declararlas era prometer un enlace imposible.
  assert.ok(!declared.includes("mcp_readme"), "mcp_readme no es una herramienta");
  assert.ok(!declared.includes("mcp_skill"), "mcp_skill no es una herramienta");

  // Estas sí son herramientas publicadas; el onboarding las omiteía.
  const published = new Set(
    seed.system_app.endpoints.filter((e) => e.mcp?.enabled).map((e) => e.mcp.name),
  );
  for (const real of ["endpoint_migrate", "appvar_migrate", "audit_log_search"]) {
    assert.ok(published.has(real), `${real} debería estar publicada en el seed`);
    assert.ok(declared.includes(real), `${real} debería aparecer en los links del onboarding`);
  }
});

/* ------------------------------------------------------------------ *
 * 3. A4 — la password omitida no deja la cuenta sin acceso
 * ------------------------------------------------------------------ */

test("A4: el schema ya no promete que omitir la password deshabilita el login", () => {
  const desc = tool("user_create").json_schema.in.schema.properties.password.description;

  assert.ok(
    !/If omitted, login is disabled/i.test(desc),
    "la afirmación era falsa: el código genera una temporal y la devuelve",
  );
  assert.match(
    desc,
    /temporaryPassword/,
    "la descripción debe nombrar el campo por el que vuelve la temporal",
  );
});

test("A4: la promesa sigue siendo cierta en el código", () => {
  // Si algún día el handler deja de generar la temporal, esta descripción vuelve a mentir
  // en la dirección peligrosa. Mejor que lo detecte el test.
  const userSource = readFileSync(join(repoRoot, "src/lib/db/user.js"), "utf8");
  assert.match(
    userSource,
    /CreateRandomPassword\(\)/,
    "el handler debe seguir generando una password cuando no se provee",
  );
  assert.match(
    userSource,
    /temporaryPassword\s*\?\s*\{\s*temporaryPassword\s*\}/,
    "y debe devolverla en la respuesta",
  );
});

/* ------------------------------------------------------------------ *
 * 4. A3 — el default de timeout_ms no vuelve a confundirse con el máximo
 * ------------------------------------------------------------------ */

test("A3: la prosa de execute_endpoint_test da el default real, no el máximo", () => {
  const t = tool("execute_endpoint_test").json_schema.in.schema.properties.timeout_ms;
  const prose = tool("execute_endpoint_test").mcp.description;

  assert.equal(t.default, 300000, "el default real son 5 minutos");
  assert.equal(t.maximum, 600000, "el máximo son 10 minutos");

  assert.match(
    prose,
    /default 300000 ms \/ 5 minutes/,
    "la prosa debe decir 5 minutos por defecto",
  );
  assert.ok(
    !/default 600000 ms \/ 10 minutes/.test(prose),
    "no debe volver a presentar el máximo como si fuera el default",
  );
});

/* ------------------------------------------------------------------ *
 * 5. A1 — la tool de versión tiene que estar donde está la versión
 * ------------------------------------------------------------------ */

test("A1: la tool de versión no está montada sobre un endpoint que no la devuelve", () => {
  const tool_ = tool("get_libopenfusionapi_latest_version");
  assert.ok(tool_, "la tool debe existir");

  // El defecto era que el ÚNICO endpoint en /database/hooks llevaba los metadatos de esta
  // tool, con un `code` que no devuelve ninguna versión. Dos comprobaciones lo cierran: que
  // el resource de la tool no sea el del receptor de hooks, y que el recurso servea código
  // que realmente asigna la respuesta.
  assert.notEqual(
    tool_.resource,
    "/database/hooks",
    "la tool no debe apuntar al receptor de hooks de la base de datos",
  );
  assert.match(
    tool_.code,
    /\$_RETURN_DATA_|\$_RETURN_/,
    "el endpoint de la tool debe construir una respuesta de verdad",
  );
  assert.match(
    tool_.code,
    /GITHUB_URL|raw\.githubusercontent\.com/,
    "y debe ser el que consulta la versión publicada en GitHub",
  );
});

test("A1: /database/hooks ya no publica ninguna tool", () => {
  const hooks = seed.system_app.endpoints.filter((e) => e.resource === "/database/hooks");
  assert.ok(hooks.length > 0, "el receptor de hooks debe seguir existiendo como endpoint");
  for (const h of hooks) {
    assert.ok(!h.mcp?.enabled, `/database/hooks (${h.method}) no debe publicar una tool`);
  }
});

test("A1: la tool declara que escribe, porque cachea la versión en una AppVar", () => {
  // La implementación real mintea un token de sistema y hace upsert de una AppVar para
  // cachear el valor. Declararla de solo lectura sería la misma mentira que se acaba de
  // corregir en otras herramientas, y además el prefijo WRITE OPERATION: es lo que la
  // convención del proyecto exige para operation_mode write.
  const m = tool("get_libopenfusionapi_latest_version").mcp;
  assert.equal(m.operation_mode, "write");
  assert.match(
    m.description,
    /^WRITE OPERATION:/,
    "la descripción debe abrir con el prefijo que exige operation_mode write",
  );
  assert.match(
    m.side_effects,
    /LIBOFAPI_ULTIMA_VERSION/,
    "side_effects debe nombrar la AppVar que la llamada modifica",
  );
});

/* ------------------------------------------------------------------ *
 * 6. A5 + B1 — apiclient_create
 * ------------------------------------------------------------------ */

const apiclientSource = readFileSync(
  join(repoRoot, "src/lib/server/functions/system/prd/apiclient/index.js"),
  "utf8",
);

test("A5: la contraseña ya no se manda a un correo personal fijo", () => {
  assert.ok(
    !/to:\s*"[^"]*@gmail\.com"/.test(apiclientSource),
    "no debe haber ningún destinatario literal; el correo va al email del cliente",
  );
  assert.match(
    apiclientSource,
    /to:\s*data\.client\.email/,
    "el destinatario debe ser el email del propio cliente, el mismo del alta",
  );
});

test("A5: un fallo del correo no puede tumbar una llamada que ya creó la fila", () => {
  // La fila se crea antes del envío, y la contraseña ya vuelve en la respuesta. Si el envío
  // fallara con un error, quien reintentara crearía un segundo cliente con otra contraseña
  // sin saber que el primero existe. El bloque catch no debe tocar r.code ni relanzar.
  const sendTry = apiclientSource.indexOf("const mail = {");
  assert.ok(sendTry > -1, "debe seguir enviando el correo de bienvenida");

  const catchAt = apiclientSource.indexOf("} catch (mailError)", sendTry);
  assert.ok(catchAt > sendTry, "el envío debe estar protegido por su propio try/catch");

  const catchBody = apiclientSource.slice(
    catchAt,
    apiclientSource.indexOf("r.data = {", catchAt),
  );
  assert.ok(
    !/r\.code\s*=/.test(catchBody),
    "el catch del envío no debe cambiar el código de respuesta: la fila ya existe",
  );
  assert.ok(
    !/\bthrow\b/.test(catchBody),
    "ni relanzar, que es lo que convertía un correo caído en un error 500",
  );
  assert.match(
    catchBody,
    /emailWarning\s*=/,
    "debe dejar constancia en la respuesta de que el correo no salió",
  );
});

test("A5: la documentación de la tool cuenta el correo y su aviso", () => {
  const m = tool("apiclient_create").mcp;
  assert.match(m.description, /only to that address|and only to that address/);
  assert.match(m.description, /warning/, "el agente debe saber que puede haber un warning");
  assert.match(m.description, /Do not retry/, "y que reintentar duplica el cliente");
  assert.match(m.side_effects, /warning/);
});

test("B1: username toma el email entero, no el prefijo", () => {
  const desc = tool("apiclient_create").json_schema.in.schema.properties.username.description;
  assert.ok(
    !/email prefix/i.test(desc),
    "la afirmación anterior era falsa: el hook asigna username = email sin truncar",
  );

  // La promesa se ata al código que la cumple.
  const models = readFileSync(join(repoRoot, "src/lib/db/models.js"), "utf8");
  assert.match(
    models,
    /if \(!instance\.username\)\s*\{\s*instance\.username\s*=\s*instance\.email;/,
    "el hook beforeValidate debe seguir asignando el email completo",
  );
});
