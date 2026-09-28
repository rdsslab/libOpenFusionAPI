import assert from "node:assert/strict";
import { construirComandoHana } from "../../src/lib/handler/sqlHana.js";

/**
 * El handler SQL_NO_HANA no usa Sequelize: lleva su propio sustituidor en
 * `construirComandoHana`, que convierte `$nombre` y `:nombre` en `?` posicionales.
 * Ese bucle llevaba cuenta de comillas y nada más, y por eso un comentario era
 * indistinguible del código:
 *
 *  1. `/* $_VAR_CNX *\/` se leía como un marcador sin valor y la consulta moría con
 *     `Missing parameter value for $_VAR_CNX` → 500. Es el mismo defecto que arrastraba
 *     el handler SQL y que se corrigió allí en la 13.11.32; aquí seguía vivo porque
 *     aquel arreglo se hizo sobre Sequelize, que HANA no usa.
 *  2. Un apostrofe dentro de un comentario (`/* it's a note *\/`) alternaba el estado
 *     de comillas y lo dejaba pegado. A partir de ahí los marcadores REALES ya no se
 *     veían y `$a` viajaba literal a la base: un error de sintaxis del motor en lugar
 *     del fallo claro.
 *
 * Estos tests son puros: no tocan base de datos. Cubren el texto que sale hacia el
 * driver, que es la parte que se puede comprobar sin un HANA delante.
 */

const CASOS = [
  // --- Lo que ya funcionaba: no debe cambiar ---
  {
    name: "control, dos marcadores",
    command: "SELECT id FROM t WHERE a = $a AND b = $b",
    bind: { a: 1, b: 2 },
    comando: "SELECT id FROM t WHERE a = ? AND b = ?",
    params: [1, 2],
  },
  {
    name: "estilo replacements con dos puntos",
    command: "SELECT id FROM t WHERE a = :a",
    bind: { a: 7 },
    comando: "SELECT id FROM t WHERE a = ?",
    params: [7],
  },
  {
    name: "array se expande a N interrogantes",
    command: "SELECT id FROM t WHERE a IN ($a)",
    bind: { a: [1, 2, 3] },
    comando: "SELECT id FROM t WHERE a IN (?, ?, ?)",
    params: [1, 2, 3],
  },
  {
    name: "un $ sin nombre se copia tal cual",
    command: "SELECT '100%', price * $ FROM t",
    bind: { price: 2 },
    comando: "SELECT '100%', price * $ FROM t",
    params: [],
  },
  {
    name: "literal con $ dentro no se toca (HANA ya lo hacía bien)",
    command: "SELECT id FROM t WHERE a = 'x: $a'",
    bind: { a: 1 },
    comando: "SELECT id FROM t WHERE a = 'x: $a'",
    params: [],
  },
  {
    name: "identificador entrecomillado con $ dentro",
    command: 'SELECT "col $a" FROM t',
    bind: { a: 1 },
    comando: 'SELECT "col $a" FROM t',
    params: [],
  },
  {
    name: "comilla de comilla '' dentro de un literal",
    command: "SELECT id FROM t WHERE a = 'it''s $a'",
    bind: { a: 1 },
    comando: "SELECT id FROM t WHERE a = 'it''s $a'",
    params: [],
  },
  {
    name: "-- dentro de un literal no abre comentario",
    command: "SELECT id FROM t WHERE a = 'x -- y' AND b = $b",
    bind: { b: 2 },
    comando: "SELECT id FROM t WHERE a = 'x -- y' AND b = ?",
    params: [2],
  },
  {
    name: "/* dentro de un literal no abre comentario",
    command: "SELECT id FROM t WHERE a = 'x /* y' AND b = $b",
    bind: { b: 2 },
    comando: "SELECT id FROM t WHERE a = 'x /* y' AND b = ?",
    params: [2],
  },

  // --- Defecto 1: un marcador dentro de un comentario tumbaba la consulta ---
  {
    name: "$ de AppVar en comentario de bloque",
    command: "/* sale de $_VAR_CNX */\nSELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "/* sale de $_VAR_CNX */\nSELECT id FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "$ de AppVar en comentario de linea",
    command: "-- sale de $_VAR_CNX\nSELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "-- sale de $_VAR_CNX\nSELECT id FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: ": en comentario de bloque",
    command: "/* :hhdhd */\nSELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "/* :hhdhd */\nSELECT id FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "$ pegado al inicio y al final del comentario",
    command: "/*$_VAR_CNX*/\nSELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "/*$_VAR_CNX*/\nSELECT id FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "varios $ en el mismo comentario",
    command: "/* $x $_VAR_C $y $z */\nSELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "/* $x $_VAR_C $y $z */\nSELECT id FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "$ en comentario al final de la linea de codigo",
    command: "SELECT id FROM t WHERE a = $a -- ver $_VAR_C",
    bind: { a: 1 },
    comando: "SELECT id FROM t WHERE a = ? -- ver $_VAR_C",
    params: [1],
  },
  {
    name: "el comentario menciona un marcador que ademas es real",
    command: "/* $a se compara consigo mismo */\nSELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "/* $a se compara consigo mismo */\nSELECT id FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "comentario de bloque multilinea",
    command: "/* linea 1 $_VAR_A\n   linea 2 $b\n   linea 3 */\nSELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "/* linea 1 $_VAR_A\n   linea 2 $b\n   linea 3 */\nSELECT id FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "varias lineas de comentario seguidas",
    command: "-- $_VAR_A\n-- :b\n-- @c\nSELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "-- $_VAR_A\n-- :b\n-- @c\nSELECT id FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "sin ningun marcador real, solo comentario",
    command: "/* $_VAR_C */\nSELECT 1",
    bind: {},
    comando: "/* $_VAR_C */\nSELECT 1",
    params: [],
  },

  // --- Defecto 2: un apostrofe en un comentario descolocaba el estado de comillas ---
  {
    name: "apostrofe en comentario de bloque, marcador real despues",
    command: "SELECT id /* it's a note */ FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "SELECT id /* it's a note */ FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "apostrofe en comentario de linea, marcador real despues",
    command: "SELECT id FROM t -- don't filter\nWHERE a = $a",
    bind: { a: 1 },
    comando: "SELECT id FROM t -- don't filter\nWHERE a = ?",
    params: [1],
  },
  {
    name: "apostrofo sin comentario: control del defecto 2",
    command: "SELECT id /* it is a note */ FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "SELECT id /* it is a note */ FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "doble apostrofe en comentario, marcador real despues",
    command: "/* don't, really don't */ SELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "/* don't, really don't */ SELECT id FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "comillas dobles en comentario, marcador real despues",
    command: 'SELECT id /* "not a string" */ FROM t WHERE a = $a',
    bind: { a: 1 },
    comando: 'SELECT id /* "not a string" */ FROM t WHERE a = ?',
    params: [1],
  },
  {
    name: "comentario con comillas desbalanceadas, marcador real despues",
    command: "/* \" unmatched */ SELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    comando: "/* \" unmatched */ SELECT id FROM t WHERE a = ?",
    params: [1],
  },
  {
    name: "array se expande aunque el comentario tenga un $",
    command: "/* $_VAR_C */ SELECT id FROM t WHERE a IN ($a)",
    bind: { a: [1, 2] },
    comando: "/* $_VAR_C */ SELECT id FROM t WHERE a IN (?, ?)",
    params: [1, 2],
  },
];

let failures = 0;
let count = 0;

/**
 * El texto del comentario tiene que llegar al driver TAL CUAL. Aquí no hace falta la
 * neutralización que sí hace el handler SQL: Sequelize sustituye `$nombre` con una
 * regex que no sabe de comentarios, mientras que HANA recibe ya los `?` puestos, así
 * que el comentario puede viajar intacto.
 */
for (const c of CASOS) {
  count++;
  try {
    const r = construirComandoHana(c.command, c.bind);
    assert.deepStrictEqual(r.params, c.params, `params de "${c.command}"`);
    assert.strictEqual(r.comando, c.comando, `comando de "${c.command}"`);
  } catch (error) {
    failures++;
    console.log(`  FALLA  ${c.name}\n        ${error.message.split("\n")[0]}`);
  }
}

// Los errores que el sustituidor debe seguir lanzando.
const ERRORES = [
  {
    name: "marcador real sin valor -> Missing parameter value",
    command: "SELECT id FROM t WHERE a = $a",
    bind: {},
    mensaje: "Missing parameter value for $a",
  },
  {
    name: "array vacío -> Empty array provided",
    command: "SELECT id FROM t WHERE a IN ($a)",
    bind: { a: [] },
    mensaje: "Empty array provided for parameter $a",
  },
  {
    name: "un $ en comentario NO debe lanzar (el defecto era este)",
    command: "/* $_VAR_C */ SELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    mensaje: null,
  },
  {
    name: "un : en comentario NO debe lanzar",
    command: "-- :hhdhd\nSELECT id FROM t WHERE a = $a",
    bind: { a: 1 },
    mensaje: null,
  },
];

for (const c of ERRORES) {
  count++;
  try {
    construirComandoHana(c.command, c.bind);
    if (c.mensaje) {
      failures++;
      console.log(`  FALLA  ${c.name}\n        debía lanzar "${c.mensaje}" y no lanzó`);
    }
  } catch (error) {
    if (c.mensaje && !error.message.includes(c.mensaje)) {
      failures++;
      console.log(`  FALLA  ${c.name}\n        mensaje distinto: ${error.message}`);
    }
  }
}

if (failures > 0) {
  console.log(
    `\nFALLO  sql_hana_comments_test: ${failures} de ${count} casos`,
  );
  process.exit(1);
}

console.log(
  `OK    sql_hana_comments_test: ${count} casos (comentarios, apostrofes y literales)`,
);
