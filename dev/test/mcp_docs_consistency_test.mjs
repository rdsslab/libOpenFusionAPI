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
