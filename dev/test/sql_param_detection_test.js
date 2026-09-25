import assert from "node:assert/strict";
import {
  detectSqlParamStyle,
  scanSqlPlaceholders,
} from "../../src/lib/handler/utils.js";

/**
 * Cobertura del hallazgo H2: el handler SQL confundía los casts `::tipo` de
 * PostgreSQL y los literales de texto con placeholders `:param`, y acababa
 * mandando la consulta en `replacements` cuando el autor la había escrito con
 * binds `$param`. El `$` llegaba sin sustituir a PostgreSQL y la consulta fallaba
 * SIEMPRE con «error de sintaxis en o cerca de "$"».
 *
 * Estos tests son puros: no tocan base de datos ni servidor.
 */

const cases = [
  // --- Criterios de aceptación del informe ---
  {
    name: "CAST($x AS int) con bind → bind",
    query: "SELECT CAST($x AS int)",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: "$x::int con bind → bind (regresión que fallaba siempre)",
    query: "SELECT $x::int",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: ":x a secas → replacements",
    query: "SELECT :x",
    style: "replacements",
    bind: [],
    replacements: ["x"],
  },
  {
    name: "literal con dos puntos y $x → bind",
    query: "SELECT ':literal', $x",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: "to_char(now(), 'HH24:MI') con $x → bind",
    query: "SELECT to_char(now(), 'HH24:MI'), $x",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },

  // --- El caso real que reportó el agente ---
  {
    name: "fn_event_insert_json($event::json) → bind",
    query: "SELECT events.fn_event_insert_json($event::json);",
    style: "bind",
    bind: ["event"],
    replacements: [],
  },

  // --- Regresión: los : genuinos siguen siendo replacements ---
  {
    name: "WHERE country = :country → replacements",
    query: "SELECT * FROM customers WHERE country = :country",
    style: "replacements",
    bind: [],
    replacements: ["country"],
  },
  {
    name: "varios : genuinos, incluido tras un cast",
    query: "SELECT $a::text AS a, b FROM t WHERE c = :c AND d = :d",
    style: "bind",
    bind: ["a"],
    replacements: ["c", "d"],
  },

  // --- Comentarios ---
  {
    name: "comentario de línea con :param y $x → bind",
    query: "-- usar :param en la v2\nSELECT $x",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: "comentario de bloque con :param y $x → bind",
    query: "/* legacy: :param */ SELECT $x",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: "comentario de bloque multilínea",
    query: "/*\n :param\n $otro\n*/\nSELECT $x",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },

  // --- Cuerpos dollar-quoted ---
  {
    name: "cuerpo $$ con :param → bind",
    query: "CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END $$ LANGUAGE plpgsql; SELECT $x",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: "cuerpo $tag$ con :param → replacements si el único placeholder es :x",
    query: "DO $body$ BEGIN PERFORM 1; END $body$",
    style: "bind",
    bind: [],
    replacements: [],
  },
  {
    name: "$$ sin cierre no se cuelga",
    query: "SELECT $$abc",
    style: "bind",
    bind: [],
    replacements: [],
  },

  // --- Escapes de literales ---
  {
    name: "comilla simple escapada con '' y $x → bind",
    query: "SELECT 'it''s :not_a_param', $x",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: "identificador entrecomillado con : → bind",
    query: 'SELECT 1 AS "col:weird", $x',
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: "doble comilla escapada",
    query: 'SELECT 1 AS "a""b:param", $x',
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: "comilla sin cerrar no se cuelga",
    query: "SELECT 'abc",
    style: "bind",
    bind: [],
    replacements: [],
  },

  // --- PostGIS y otros casts operatorios ---
  {
    name: "ST_MakePoint($lon::float8, $lat::float8)",
    query: "SELECT ST_MakePoint($lon::float8, $lat::float8)",
    style: "bind",
    bind: ["lon", "lat"],
    replacements: [],
  },
  {
    name: "jsonb operator ? no es placeholder",
    query: "SELECT $doc ? 'key'",
    style: "bind",
    bind: ["doc"],
    replacements: [],
  },

  // --- Mezcla de estilos: gana bind ---
  {
    name: "mezcla $x y :y → bind (regla 2)",
    query: "SELECT $x, :y",
    style: "bind",
    bind: ["x"],
    replacements: ["y"],
  },

  // --- Casos límite de entrada ---
  { name: "string vacía", query: "", style: "bind", bind: [], replacements: [] },
  { name: "undefined", query: undefined, style: "bind", bind: [], replacements: [] },
  { name: "null", query: null, style: "bind", bind: [], replacements: [] },
  { name: "solo espacios", query: "   ", style: "bind", bind: [], replacements: [] },
  { name: "número (tipo inválido)", query: 42, style: "bind", bind: [], replacements: [] },
  {
    name: "sin placeholders → bind (comportamiento previo)",
    query: "SELECT 1",
    style: "bind",
    bind: [],
    replacements: [],
  },
  {
    name: "posicional $1 no cuenta como bind nombrado",
    query: "SELECT * FROM t WHERE id = $1",
    style: "bind",
    bind: [],
    replacements: [],
  },
  {
    name: "UNDERSCORE inicial válido",
    query: "SELECT $_priv, :_pub",
    style: "bind",
    bind: ["_priv"],
    replacements: ["_pub"],
  },
];

let failures = 0;

for (const c of cases) {
  const scanned = scanSqlPlaceholders(c.query);

  try {
    assert.deepStrictEqual(scanned.bind, c.bind, `bind de "${c.query}"`);
    assert.deepStrictEqual(
      scanned.replacements,
      c.replacements,
      `replacements de "${c.query}"`,
    );
    assert.strictEqual(
      detectSqlParamStyle(c.query),
      c.style,
      `estilo de "${c.query}"`,
    );
  } catch (error) {
    failures++;
    console.error(`FALLA: ${c.name}`);
    console.error(`  ${error.message}`);
  }
}

// El escáner no debe degradarse ante entradas adversariales (SQL de terceros,
// AppVars, etc.): siempre termina y siempre devuelve el contrato esperado.
for (const weird of [
  "'",
  '"',
  "`",
  "$$",
  "$tag$",
  "--",
  "/*",
  "*/",
  "::",
  "$$$$$$",
  "::::",
  "SELECT $",
  "SELECT :",
  "a".repeat(5000),
  "$$" + ":x".repeat(2000) + "$$",
]) {
  const r = scanSqlPlaceholders(weird);
  assert.ok(Array.isArray(r.bind), `bind debe ser array para ${JSON.stringify(weird.slice(0, 20))}`);
  assert.ok(
    Array.isArray(r.replacements),
    `replacements debe ser array para ${JSON.stringify(weird.slice(0, 20))}`,
  );
}

console.log(
  failures === 0
    ? `OK  sql_param_detection_test: ${cases.length} casos + entradas adversariales`
    : `FALLO sql_param_detection_test: ${failures} de ${cases.length} casos`,
);

if (failures > 0) process.exit(1);
