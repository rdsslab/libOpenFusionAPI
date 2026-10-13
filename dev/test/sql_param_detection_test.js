import assert from "node:assert/strict";
import {
  detectSqlParamStyle,
  prepararSqlParaBinds,
  scanSqlPlaceholders,
  describirBindsRechazados,
  avisoSqlBindEnLiteral,
  sugerirLiteralSinBind,
  reglasDeEscaneo,
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

// ---------------------------------------------------------------------------
// `avisoSqlBindEnLiteral`: el aviso que `endpoint_upsert` devuelve al guardar.
//
// Es la pata que faltaba del arreglo: el runtime ya rechaza con 400, pero el autor
// solo se enteraba llamando al endpoint ya publicado. El aviso no bloquea, así que
// lo único que hay que garantizar es que exista cuando toca y que no aparezca
// cuando no.
//
// La corrección concreta depende del motor (el proyecto habilita cinco dialectos de
// Sequelize), así que cada caso fija el dialecto y la sintaxis que debe salir. Con el
// dialecto desconocido el aviso no impone la de SQL Server.
// ---------------------------------------------------------------------------

/** @type {{name: string, query: string, dialect: string|null, contiene: string[]|null}[]} */
const avisoCasos = [
  {
    name: "literal en el SQL del informe (mssql): parámetro, diagnóstico y `+`",
    query: "IF @estado_in IS NULL OR @estado_in = '' OR @estado_in = '$estado'",
    dialect: "mssql",
    contiene: ["$estado (literal)", "SQL_BIND_INSIDE_LITERAL", "N'$' + N'estado'"],
  },
  {
    name: "literal (postgres): propone `||`, no `+`",
    query: "SELECT 'coste: $p' AS l, $p AS v",
    dialect: "postgres",
    contiene: ["$p (literal)", "'$' || 'p'"],
  },
  {
    name: "literal (sqlite): propone `||`",
    query: "SELECT 'coste: $p'",
    dialect: "sqlite",
    contiene: ["'$' || 'p'"],
  },
  {
    name: "literal (mysql): propone `CONCAT()`, porque `+` ahí es suma",
    query: "SELECT 'coste: $p'",
    dialect: "mysql",
    contiene: ["CONCAT('$', 'p')"],
  },
  {
    name: "literal (mariadb): propone `CONCAT()`",
    query: "SELECT 'coste: $p'",
    dialect: "mariadb",
    contiene: ["CONCAT('$', 'p')"],
  },
  {
    name: "dialecto desconocido (AppVar sin resolver): no impone T-SQL",
    query: "SELECT 'coste: $p'",
    dialect: null,
    contiene: ["your engine's operator", "`||`", "`CONCAT()`"],
  },
  {
    name: "identificador entrecomillado: aviso",
    query: 'SELECT "$x" FROM t WHERE a = $x',
    dialect: "mssql",
    contiene: ["$x (identificador)"],
  },
  {
    name: "cuerpo dollar-quoted: aviso",
    query: "SELECT $$ f $p $$, $p",
    dialect: "postgres",
    contiene: ["$p (dollar quoted)"],
  },
  {
    name: "el mismo nombre repetido no duplica la corrección",
    query: "SELECT '$p', '$p', $p",
    dialect: "sqlite",
    contiene: ["'$' || 'p'"],
  },
  {
    name: "comentario con $nombre: se neutraliza, no hay aviso",
    query: "/* sale de $_VAR_X */\nSELECT id FROM t WHERE n <> $name",
    dialect: "mssql",
    contiene: null,
  },
  {
    name: "SQL limpio con un bind real: no hay aviso",
    query: "SELECT id FROM t WHERE n <> $name",
    dialect: "mssql",
    contiene: null,
  },
  {
    name: "SQL sin un solo $: no hay aviso",
    query: "SELECT 1",
    dialect: "sqlite",
    contiene: null,
  },
];

for (const c of avisoCasos) {
  const aviso = avisoSqlBindEnLiteral(c.query, c.dialect);
  try {
    if (c.contiene === null) {
      assert.strictEqual(aviso, null, `"${c.query}" no debía producir aviso`);
    } else {
      assert.ok(
        typeof aviso === "string" && aviso.length > 0,
        `"${c.query}" debía producir un aviso`,
      );
      for (const trozo of c.contiene) {
        assert.ok(aviso.includes(trozo), `el aviso no menciona ${trozo}: ${aviso}`);
      }
    }
  } catch (error) {
    failures++;
    console.error(`FALLA: ${c.name}`);
    console.error(`  ${error.message}`);
  }
}

// El mismo caso dos veces con el mismo `$nombre` no debe repetir la corrección.
{
  const aviso = avisoSqlBindEnLiteral("SELECT '$p', '$p'", "mysql");
  const apariciones = aviso.split("CONCAT('$', 'p')").length - 1;
  assert.strictEqual(apariciones, 1, `la corrección debe salir una vez, salió ${apariciones}: ${aviso}`);
}

assert.strictEqual(
  describirBindsRechazados([
    { name: "a", contenedor: "literal" },
    { name: "b", contenedor: "dollar_quoted" },
  ]),
  "$a (literal), $b (dollar quoted)",
  "describirBindsRechazados debe juntar nombre y contenedor legible",
);

// `sugerirLiteralSinBind` cubre los cinco dialectos habilitados y falla en cerrado.
assert.strictEqual(sugerirLiteralSinBind("n", "mssql"), "N'$' + N'n'");
assert.strictEqual(sugerirLiteralSinBind("n", "postgres"), "'$' || 'n'");
assert.strictEqual(sugerirLiteralSinBind("n", "sqlite"), "'$' || 'n'");
assert.strictEqual(sugerirLiteralSinBind("n", "mysql"), "CONCAT('$', 'n')");
assert.strictEqual(sugerirLiteralSinBind("n", "mariadb"), "CONCAT('$', 'n')");
assert.strictEqual(sugerirLiteralSinBind("n", "MSSQL"), "N'$' + N'n'", "el dialecto no debe importar mayúsculas");
assert.strictEqual(sugerirLiteralSinBind("n", "hana"), null, "HANA no es Sequelize: sin sintaxis propia");
assert.strictEqual(sugerirLiteralSinBind("n", null), null, "sin dialecto, sin propuesta de sintaxis");

// ---------------------------------------------------------------------------
// Delimitadores de identificador por dialecto. `"…"` siempre; backtick siempre
// (fuera de MySQL/MariaDB es SQL inválido, así que tratarlo como identificador no
// puede marcar mal una consulta válida, y así la auditoría —que no conoce el
// motor— los ve); `[…]` solo en MSSQL, porque en PostgreSQL/SQLite es un
// subíndice de array y ahí el `$` sí es un bind real.
// ---------------------------------------------------------------------------

/** @type {{name: string, query: string, dialect: string|null, rechaza: boolean}[]} */
const identCasos = [
  {
    name: "identificador ANSI (postgres)",
    query: 'SELECT "col $p" FROM t WHERE a = $p',
    dialect: "postgres",
    rechaza: true,
  },
  {
    name: "identificador ANSI sin dialecto",
    query: 'SELECT "col $p"',
    dialect: null,
    rechaza: true,
  },
  {
    name: "identificador con backtick (mysql)",
    query: "SELECT `col $p` FROM t WHERE a = $p",
    dialect: "mysql",
    rechaza: true,
  },
  {
    name: "identificador con backtick sin dialecto: la auditoría lo ve",
    query: "SELECT `col $p`",
    dialect: null,
    rechaza: true,
  },
  {
    name: "identificador con corchete (mssql)",
    query: "SELECT [col $p] FROM t WHERE a = $p",
    dialect: "mssql",
    rechaza: true,
  },
  {
    name: "corchete en postgres es subíndice de array, no identificador",
    query: "SELECT arr[$p] FROM t WHERE a = $p",
    dialect: "postgres",
    rechaza: false,
  },
  {
    name: "corchete sin dialecto: no se toca (podría ser un array)",
    query: "SELECT [col $p]",
    dialect: null,
    rechaza: false,
  },
  {
    name: "corchete en postgres con $ dentro: sigue siendo bind, no identificador",
    query: "SELECT t.arr[$p] FROM t",
    dialect: "postgres",
    rechaza: false,
  },
];

for (const c of identCasos) {
  const { rechazados } = prepararSqlParaBinds(c.query, c.dialect);
  try {
    if (c.rechaza) {
      assert.ok(rechazados.length > 0, `"${c.query}" (${c.dialect}) debía rechazarse`);
      assert.strictEqual(
        rechazados[0].contenedor,
        "identificador",
        `contenedor inesperado: ${JSON.stringify(rechazados)}`,
      );
    } else {
      assert.strictEqual(
        rechazados.length,
        0,
        `"${c.query}" (${c.dialect}) no debía rechazar: ${JSON.stringify(rechazados)}`,
      );
    }
  } catch (error) {
    failures++;
    console.error(`FALLA: ${c.name}`);
    console.error(`  ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Escapado dentro de los literales: no es el mismo en los cinco motores.
//
// La sustitución de Sequelize (`\B\$(\$|\w+)`) no mira el contexto, así que lo que
// hay que acertar es *dónde cierra* el literal. En MySQL/MariaDB `'l\'avion'` es una
// sola cadena —`\` escapa la comilla— y el `$nombre` de dentro es justo el caso que
// el guard tiene que rechazar; en PostgreSQL o SQL Server ese `\'` cierra el literal
// y `\` es un carácter normal. Son las mismas reglas que aplica el lexer
// `injectReplacements` de Sequelize (`dialect.canBackslashEscape()`,
// `supports.escapeStringConstants`), replicadas aquí a propósito: el detector tiene
// que leer el SQL como lo lee el motor.
//
// Los casos con backslash van en String.raw para que el SQL lleve exactamente lo que
// se ve: `\'` es un backslash y una comilla, no un escape de JavaScript.
// ---------------------------------------------------------------------------

/** @type {{name: string, query: string, contexto: unknown, rechaza: boolean}[]} */
const escapeCasos = [
  {
    name: "MySQL: la comilla escapada deja el $nombre dentro del literal",
    query: String.raw`SELECT 'l\'avion $p' FROM t`,
    contexto: "mysql",
    rechaza: true,
  },
  {
    name: "MariaDB: igual que MySQL",
    query: String.raw`SELECT 'l\'avion $p' FROM t`,
    contexto: "mariadb",
    rechaza: true,
  },
  {
    name: "MySQL: con un bind real detrás, el literal no se cierra a medias",
    query: String.raw`SELECT 'l\'avion $p' AS l, $p AS v`,
    contexto: "mysql",
    rechaza: true,
  },
  {
    name: "PostgreSQL: `\\` no escapa, el literal cierra ahí (esa consulta ya es inválida)",
    query: String.raw`SELECT 'l\'avion $p' FROM t`,
    contexto: "postgres",
    rechaza: false,
  },
  {
    name: "PostgreSQL con standardConformingStrings=false: ahí sí escapa",
    query: String.raw`SELECT 'l\'avion $p' FROM t`,
    contexto: { dialect: "postgres", backslashEscape: true },
    rechaza: true,
  },
  {
    name: "PostgreSQL: el literal E'…' siempre admite `\\`",
    query: String.raw`SELECT E'l\'avion $p' FROM t`,
    contexto: "postgres",
    rechaza: true,
  },
  {
    name: "PostgreSQL: una `E` pegada a un identificador no abre literal escapable",
    query: String.raw`SELECT xE'l\'avion $p' FROM t`,
    contexto: "postgres",
    rechaza: false,
  },
  {
    name: "MySQL: dos backslashes son un backslash escapado, la comilla cierra",
    query: String.raw`SELECT 'l\\', $p`,
    contexto: "mysql",
    rechaza: false,
  },
  {
    name: "MySQL: tres backslashes dejan la comilla escapada, el literal sigue abierto",
    query: String.raw`SELECT 'l\\\'s $p' FROM t`,
    contexto: "mysql",
    rechaza: true,
  },
  {
    name: "SQL Server: `\\` es un carácter normal, no escapa la comilla",
    query: String.raw`SELECT 'l\'avion $p' FROM t`,
    contexto: "mssql",
    rechaza: false,
  },
  {
    name: "SQLite: tampoco escapa con backslash",
    query: String.raw`SELECT 'l\'avion $p' FROM t`,
    contexto: "sqlite",
    rechaza: false,
  },
];

for (const c of escapeCasos) {
  const { rechazados } = prepararSqlParaBinds(c.query, c.contexto);
  try {
    if (c.rechaza) {
      assert.ok(
        rechazados.length > 0,
        `"${c.query}" (${JSON.stringify(c.contexto)}) debía rechazarse`,
      );
      assert.strictEqual(
        rechazados[0].contenedor,
        "literal",
        `contenedor inesperado: ${JSON.stringify(rechazados)}`,
      );
    } else {
      assert.strictEqual(
        rechazados.length,
        0,
        `"${c.query}" (${JSON.stringify(c.contexto)}) no debía rechazar: ${JSON.stringify(rechazados)}`,
      );
    }
  } catch (error) {
    failures++;
    console.error(`FALLA: ${c.name}`);
    console.error(`  ${error.message}`);
  }
}

// `reglasDeEscaneo` traduce dialecto + options a las reglas del escáner. Solo
// PostgreSQL depende de una option (`standardConformingStrings`, que Sequelize deja en
// `true` por defecto —`sequelize.js:111`— y además fija con
// `SET standard_conforming_strings=on` al conectar).
assert.deepStrictEqual(reglasDeEscaneo("mysql"), {
  dialect: "mysql",
  backslashEscape: true,
  escapeStringConstants: false,
});
assert.deepStrictEqual(reglasDeEscaneo("MARIADB"), {
  dialect: "mariadb",
  backslashEscape: true,
  escapeStringConstants: false,
});
assert.deepStrictEqual(reglasDeEscaneo("postgres"), {
  dialect: "postgres",
  backslashEscape: false,
  escapeStringConstants: true,
});
assert.deepStrictEqual(reglasDeEscaneo("postgres", { standardConformingStrings: false }), {
  dialect: "postgres",
  backslashEscape: true,
  escapeStringConstants: true,
});
assert.deepStrictEqual(reglasDeEscaneo("mssql"), {
  dialect: "mssql",
  backslashEscape: false,
  escapeStringConstants: false,
});
assert.deepStrictEqual(reglasDeEscaneo("sqlite"), {
  dialect: "sqlite",
  backslashEscape: false,
  escapeStringConstants: false,
});
assert.deepStrictEqual(reglasDeEscaneo(null), {
  dialect: null,
  backslashEscape: false,
  escapeStringConstants: false,
});
assert.deepStrictEqual(
  reglasDeEscaneo({ name: "mysql" }),
  { dialect: "mysql", backslashEscape: true, escapeStringConstants: false },
  "acepta el objeto dialecto de Sequelize, no solo la cadena",
);

// Tampoco debe degradarse: siempre termina, y siempre con el contrato.
for (const weird of [
  "'", '"', "$$", "$tag$", "/*", "*/", "--", "SELECT $",
  "/* $_VAR_X", "-- $_VAR_X", "'$_VAR_X", '"$_VAR_X', "$$$_VAR_X$$",
  "/*".repeat(400) + " $_VAR_X " + "*/".repeat(400),
  "$".repeat(2000),
  "`", "` $_VAR_X", "`".repeat(400) + " $_VAR_X " + "`".repeat(400),
  "\\", String.raw`'$_VAR_X\'`, String.raw`E'$_VAR_X\'`,
  "\\".repeat(1000) + "' $_VAR_X",
]) {
  const r = prepararSqlParaBinds(weird);
  assert.strictEqual(typeof r.sql, "string", `sql debe ser string para ${JSON.stringify(weird.slice(0, 20))}`);
  assert.ok(Array.isArray(r.rechazados), `rechazados debe ser array para ${JSON.stringify(weird.slice(0, 20))}`);
  assert.ok(Number.isInteger(r.comentados), `comentados debe ser entero para ${JSON.stringify(weird.slice(0, 20))}`);
}

// Los corchetes solo se recorren en MSSQL; con y sin cierre, siempre termina.
for (const weird of ["[", "[ $_VAR_X", "[]", "[".repeat(400) + " $_VAR_X " + "]".repeat(400)]) {
  const r = prepararSqlParaBinds(weird, "mssql");
  assert.strictEqual(typeof r.sql, "string", `sql debe ser string para ${JSON.stringify(weird.slice(0, 20))}`);
  assert.ok(Array.isArray(r.rechazados), `rechazados debe ser array para ${JSON.stringify(weird.slice(0, 20))}`);
}

// Y el camino del escapado (MySQL/MariaDB, `E'…'` de PostgreSQL) tampoco se cuelga con
// backslashes sin cerrar, ni con muchos seguidos.
for (const contexto of [
  "mysql",
  "mariadb",
  { dialect: "postgres", backslashEscape: true, escapeStringConstants: true },
  { dialect: "postgres" },
]) {
  for (const weird of [
    "\\",
    "\\\\",
    String.raw`'$_VAR_X\'`,
    String.raw`E'$_VAR_X\'`,
    String.raw`'` + "\\".repeat(1000) + " $_VAR_X",
    String.raw`E'` + "\\".repeat(1000) + " $_VAR_X",
  ]) {
    const r = prepararSqlParaBinds(weird, contexto);
    assert.strictEqual(typeof r.sql, "string", `sql debe ser string para ${JSON.stringify(weird.slice(0, 20))}`);
    assert.ok(Array.isArray(r.rechazados), `rechazados debe ser array para ${JSON.stringify(weird.slice(0, 20))}`);
    assert.ok(Number.isInteger(r.comentados), `comentados debe ser entero para ${JSON.stringify(weird.slice(0, 20))}`);
  }
}

const total =
  cases.length + prepararCasos.length + avisoCasos.length + identCasos.length + escapeCasos.length;

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
