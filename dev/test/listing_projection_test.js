/**
 * Dos holes en la proyección de los listados que se leen por MCP. Puros: no tocan servidor ni
 * base de datos, comprueban el código fuente y la forma de las funciones.
 *
 *   B3 — `list_bots` filtraba `token` y `code` en el catálogo, pero NO en el camino por
 *        `idbot`. Ese camino llamaba a `getBotById`, que hace `findByPk` sin restringir
 *        atributos: devuelve la fila entera. El mismo endpoint entregaba la credencial del
 *        bot en el detalle y la ocultaba en la lista, que es el orden natural de error — el
 *        detalle parece justo el sitio donde menos habría que mirar.
 *
 *   M6 — `search_code: true` añadía `code` a las condiciones del WHERE y no a la proyección.
 *        La búsqueda usaba la columna para decidir qué filas devolver y la respuesta no la
 *        daba: el agente recibía un idendpoint sin forma de saber qué casó, y tenía que abrir
 *        los resultados uno a uno para reconstruir su propia búsqueda.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

const read = (p) => readFileSync(join(repoRoot, p), "utf8");

const botDb = read("src/lib/db/bot.js");
const botsHandlers = read("src/lib/server/functions/system/prd/bots/index.js");
const endpointDb = read("src/lib/db/endpoint.js");

/**
 * Corta el cuerpo de una función a partir de su declaración hasta que se acaban las llaves.
 *
 * La llave del CUERPO es la primera `{` que aparece con paréntesis y corchetes ya cerrados.
 * Contar desde la primera llave sin más devuelve fragmentos de dos caracteres en cuanto hay
 * un valor por defecto `= {}` o una desestructuración en los parámetros, y entonces las
 * aserciones pasan o fallan por casualidad. Sirve igual para `function f() {}` que para
 * `const f = (a = {}) => {}`.
 */
function bodyOf(source, header) {
  const start = source.indexOf(header);
  assert.ok(start > -1, `no encuentro ${header}`);

  let parens = 0;
  let brackets = 0;
  let braceAt = -1;

  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "(") parens++;
    else if (c === ")") parens--;
    else if (c === "[") brackets++;
    else if (c === "]") brackets--;
    else if (c === "{" && parens === 0 && brackets === 0) {
      braceAt = i;
      break;
    }
  }
  assert.ok(braceAt > -1, `no encuentro la llave del cuerpo de ${header}`);

  let depth = 0;
  for (let i = braceAt; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`llaves sin cerrar en ${header}`);
}

/* ------------------------------------------------------------------ *
 * B3 — el token del bot se filtraba en la lista y no en el detalle
 * ------------------------------------------------------------------ */

test("B3: la proyección de listar bots no incluye token ni code por defecto", () => {
  const attrs = bodyOf(botDb, "export const botListingAttributes");
  // El gating tiene que estar en la función compartida, no en el catálogo: si viviera en
  // getBotCatalog, el camino por idbot volvería a salirse sin que nada lo indique.
  assert.match(
    attrs,
    /if \(include_token\) attributes\.push\("token"\);/,
    "token se añade solo cuando se pide",
  );
  assert.match(
    attrs,
    /if \(include_code\) attributes\.push\("code"\);/,
    "code se añade solo cuando se pide",
  );
  assert.ok(
    !/^\s*"token",/m.test(attrs),
    "token no puede estar en la lista base: se colaría en cualquier llamada que no lo pida",
  );
  assert.ok(
    !/^\s*"code",/m.test(attrs),
    "code tampoco",
  );
});

test("B3: catálogo y detalle por idbot usan la MISMA proyección", () => {
  // Es la mitad importante del arreglo. Con dos listas propias, el día que se añada una
  // columna sensible a una, la otra se quedará atrás y nobody se enterará: es exactamente el
  // defecto que se está corrigiendo.
  const catalog = bodyOf(botDb, "export const getBotCatalog");
  assert.match(
    catalog,
    /const attributes = botListingAttributes\(include_code, include_token\);/,
    "el catálogo debe delegar en la función compartida",
  );

  const byId = bodyOf(botDb, "export const getBotListingById");
  assert.match(
    byId,
    /Bot\.findByPk\(idbot,\s*\{\s*attributes: botListingAttributes\(include_code, include_token\),?\s*\}\)/,
    "el detalle por idbot debe delegar en la misma función",
  );
});

test("B3: fnListBots ya no usa el fetch sin restringir para el camino por idbot", () => {
  const fn = bodyOf(botsHandlers, "export async function fnListBots");
  const idBranch = fn.slice(fn.indexOf("if (query.idbot)"));

  assert.match(
    idBranch,
    /getBotListingById\(query\.idbot,\s*\{/,
    "el camino por idbot debe pasar por la función con gating",
  );
  assert.match(
    idBranch,
    /include_token: wants\(query\.include_token\)/,
    "y propagar include_token",
  );
  assert.match(
    idBranch,
    /include_code: wants\(query\.include_code\)/,
    "y include_code",
  );

  // La aserción que ata el defecto exacto: el findByPk sin `attributes` devuelve la fila
  // entera, token incluido. Si alguien reintroduce la llamada a getBotById aquí, cae.
  const beforeCatalog = fn.slice(0, fn.indexOf("const {"));
  assert.ok(
    !/getBotById\(/.test(beforeCatalog),
    "getBotById devuelve la fila completa: no puede volver a ser el camino de un listado",
  );
});

test("B3: getBotById sigue existiendo y sin restringir, para los usos internos", () => {
  // El arreglo NO toca el fetch interno: `upsertBot` lo usa para leer el token y el código
  // previos y preservarlos, y para eso necesita la fila entera. Un arreglo que hubiera
  // recortado también ese camino habría roto el upsert.
  const internal = bodyOf(botDb, "export const getBotById");
  assert.match(
    internal,
    /Bot\.findByPk\(idbot\)/,
    "getBotById se mantiene sin restringir a propósito, para uso interno",
  );
  assert.match(
    botsHandlers,
    /getBotById\(data\.idbot\)/,
    "el upsert sigue relying en él para leer la fila completa",
  );
});

/* ------------------------------------------------------------------ *
 * M6 — buscar por código sin devolver el código
 * ------------------------------------------------------------------ */

test("M6: search_code devuelve el código que usó para filtrar", () => {
  const fn = bodyOf(endpointDb, "export const searchEndpoints");

  assert.match(
    fn,
    /orConditions\.push\(\{\s*code:\s*\{\s*\[Op\.like\]: likePattern\s*\}\s*\}\);/,
    "search_code debe seguir filtrando por code (esa parte estaba bien)",
  );
  assert.match(
    fn,
    /if \(search_code === true\)\s*\{\s*attributes\.push\("code"\);\s*\}/,
    "y debe añadir code a la proyección: si no, la búsqueda no es reproducible",
  );
});

test("M6: el código sigue fuera de la respuesta cuando no se busca por él", () => {
  const fn = bodyOf(endpointDb, "export const searchEndpoints");
  const list = fn.slice(fn.indexOf("const attributes = ["));
  const listBody = list.slice(0, list.indexOf("];"));

  // `code` es la columna más pesada de la fila, y por eso está fuera por defecto — igual que
  // `mcp`. Añadirlo sin condiciones convertiría cada búsqueda de keywords en una descarga de
  // fuentes, que es lo contrario de lo que la herramienta promete.
  assert.ok(
    !/^\s*"code",/m.test(listBody),
    "code no debe entrar en la lista base",
  );
  assert.ok(
    !/^\s*"mcp",/m.test(listBody),
    "ni mcp, que es el otro excluido deliberado",
  );
});
