import assert from "node:assert/strict";
import {
  detectSqlParamStyle,
  prepararSqlParaBinds,
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
  // El nombre de una AppVar en un comentario: `$_VAR_X` tiene la forma de un
  // bind nombrado ($ seguido de un identificador), asi que el escaner TIENE que
  // descartarlo. El escaner lo hace; el defecto que queda abierto esta en otra
  // parte — Sequelize sustituye con una regex que no ve comentarios
  // (abstract/query.js:78) — y por eso estos casos son una guarda de regresión
  // del escaner, no la prueba de que el handler entero funciona. La prueba de
  // extremo a extremo, contra MSSQL, está en sql_comments_test.js.
  {
    name: "nombre de AppVar en comentario de bloque no cuenta como bind",
    query: "/* sale de $_VAR_MSSQL_TEST */\nSELECT $x",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: "nombre de AppVar en comentario de línea no cuenta como bind",
    query: "-- sale de $_VAR_MAIN_DB\nSELECT $x",
    style: "bind",
    bind: ["x"],
    replacements: [],
  },
  {
    name: "AppVar en comentario y consulta sin placeholders reales",
    query: "-- $_VAR_MAIN_DB\nSELECT 1 AS uno",
    style: "bind",
    bind: [],
    replacements: [],
  },
  {
    name: "AppVar entre $ reales no los arrastra",
    query: "/* $_VAR_A */ SELECT $x /* $_VAR_B */ WHERE y = $z",
    style: "bind",
    bind: ["x", "z"],
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

// ---------------------------------------------------------------------------
// `prepararSqlParaBinds`: lo que se le hace al SQL justo antes de que lo
// sustituya Sequelize.
//
// El escaner de arriba ya descartaba los `$name` de los comentarios, y aun así la
// consulta llegaba a MSSQL y moría con «Named bind parameter has no value»:
// `scanSqlPlaceholders` decide QUÉ se manda, y la sustitución la hace Sequelize con
// su propia regex (`\B\$(\$|\w+)`, en `dialects/abstract/query.js`), que es ciega a
// los comentarios. Estos casos cubren el texto que se le pasa a esa regex.
// ---------------------------------------------------------------------------

/** @type {{name: string, query: string, sql: string, comentados: number, rechazados: string[]}[]} */
const prepararCasos = [
  {
    name: "sin comentarios: el SQL no se toca",
    query: "SELECT id FROM t WHERE n <> $name",
    sql: "SELECT id FROM t WHERE n <> $name",
    comentados: 0,
    rechazados: [],
  },
  {
    name: "comentario de bloque: espacio entre el $ y el nombre",
    query: "/* sale de $_VAR_X */\nSELECT id FROM t",
    sql: "/* sale de $ _VAR_X */\nSELECT id FROM t",
    comentados: 1,
    rechazados: [],
  },
  {
    name: "comentario de línea: igual que el de bloque",
    query: "-- sale de $_VAR_X\nSELECT id FROM t",
    sql: "-- sale de $ _VAR_X\nSELECT id FROM t",
    comentados: 1,
    rechazados: [],
  },
  {
    name: "el espacio va detrás del $, no delante (si fuera delante, la regex casaría igual)",
    query: "/*$_VAR_X*/SELECT 1",
    sql: "/*$ _VAR_X*/SELECT 1",
    comentados: 1,
    rechazados: [],
  },
  {
    name: "varios $ en un comentario multilínea",
    query: "/* l1 $_VAR_A\n l2 $b */\nSELECT 1",
    sql: "/* l1 $ _VAR_A\n l2 $ b */\nSELECT 1",
    comentados: 2,
    rechazados: [],
  },
  {
    name: "dos comentarios de línea en la misma línea",
    query: "-- a $x -- b $y\nSELECT 1",
    sql: "-- a $ x -- b $ y\nSELECT 1",
    comentados: 2,
    rechazados: [],
  },
  {
    name: "comentario con $ que coincide con un bind real: el de código no se toca",
    query: "/* filtro $name */\nSELECT id FROM t WHERE n <> $name",
    sql: "/* filtro $ name */\nSELECT id FROM t WHERE n <> $name",
    comentados: 1,
    rechazados: [],
  },
  {
    name: "comentario con : no hace nada: replacements ya era ciego a comentarios",
    query: "/* legacy :name */\nSELECT id FROM t WHERE n <> $name",
    sql: "/* legacy :name */\nSELECT id FROM t WHERE n <> $name",
    comentados: 0,
    rechazados: [],
  },
  {
    name: "sin comentarios ni nada que hacer: devuelve la misma referencia",
    query: "SELECT 1",
    sql: "SELECT 1",
    comentados: 0,
    rechazados: [],
  },

  // --- Los literales no se neutralizan: se rechazan -------------------------
  {
    name: "literal con $name → rechazado, el SQL intacto",
    query: "SELECT 'coste: $name' AS txt",
    sql: "SELECT 'coste: $name' AS txt",
    comentados: 0,
    rechazados: ["name:literal"],
  },
  {
    name: "comilla simple escapada: el $name sigue dentro del literal",
    query: "SELECT 'it''s $name'",
    sql: "SELECT 'it''s $name'",
    comentados: 0,
    rechazados: ["name:literal"],
  },
  {
    name: "identificador entrecomillado con $name → rechazado",
    query: 'SELECT 1 AS "col $name"',
    sql: 'SELECT 1 AS "col $name"',
    comentados: 0,
    rechazados: ["name:identificador"],
  },
  {
    name: "cuerpo dollar-quoted con $name → rechazado",
    query: "SELECT $$ f $name $$",
    sql: "SELECT $$ f $name $$",
    comentados: 0,
    rechazados: ["name:dollar_quoted"],
  },
  {
    name: "un comentario y un literal a la vez: el comentario se neutraliza y el literal se rechaza",
    query: "/* $_VAR_A */ SELECT 'x $name'",
    sql: "/* $ _VAR_A */ SELECT 'x $name'",
    comentados: 1,
    rechazados: ["name:literal"],
  },
  {
    name: "el $$ de un literal no se confunde con un nombre",
    query: "SELECT '$$ $name'",
    sql: "SELECT '$$ $name'",
    comentados: 0,
    rechazados: ["name:literal"],
  },
];

for (const c of prepararCasos) {
  const r = prepararSqlParaBinds(c.query);
  const rechazo = r.rechazados.map((x) => `${x.name}:${x.contenedor}`);

  try {
    assert.strictEqual(r.sql, c.sql, `sql de "${c.query}"`);
    assert.strictEqual(r.comentados, c.comentados, `comentados de "${c.query}"`);
    assert.deepStrictEqual(rechazo, c.rechazados, `rechazados de "${c.query}"`);
  } catch (error) {
    failures++;
    console.error(`FALLA: ${c.name}`);
    console.error(`  ${error.message}`);
  }
}

// Tampoco debe degradarse: siempre termina, y siempre con el contrato.
for (const weird of [
  "'", '"', "$$", "$tag$", "/*", "*/", "--", "SELECT $",
  "/* $_VAR_X", "-- $_VAR_X", "'$_VAR_X", '"$_VAR_X', "$$$_VAR_X$$",
  "/*".repeat(400) + " $_VAR_X " + "*/".repeat(400),
  "$".repeat(2000),
]) {
  const r = prepararSqlParaBinds(weird);
  assert.strictEqual(typeof r.sql, "string", `sql debe ser string para ${JSON.stringify(weird.slice(0, 20))}`);
  assert.ok(Array.isArray(r.rechazados), `rechazados debe ser array para ${JSON.stringify(weird.slice(0, 20))}`);
  assert.ok(Number.isInteger(r.comentados), `comentados debe ser entero para ${JSON.stringify(weird.slice(0, 20))}`);
}

const total = cases.length + prepararCasos.length;

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
  // Un nombre de AppVar es `$` + identificador, o sea la forma exacta de un
  // bind. Truncado a media palabra sigue siendo texto que no debe colgarse.
  "$_VAR_",
  "$_",
  "/* $_VAR_MSSQL_TEST",
  "-- $_VAR_MSSQL_TEST",
  "'$_VAR_MSSQL_TEST",
  '"$_VAR_MSSQL_TEST',
  "$$$_VAR_MSSQL_TEST$$",
  "a".repeat(5000),
  "$$" + ":x".repeat(2000) + "$$",
  "/* ".repeat(500) + " $_VAR_X " + "*/ ".repeat(500),
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
    ? `OK  sql_param_detection_test: ${total} casos + entradas adversariales`
    : `FALLO sql_param_detection_test: ${failures} de ${total} casos`,
);

if (failures > 0) process.exit(1);
