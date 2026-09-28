/**
 * Contrato de los tipos de AppVar.
 *
 * Existe porque `type` era un `STRING(25)` sin validador, y porque cuatro listas
 * distintas de tipos se separaron sin que nada lo notara:
 *
 *   - los seeds (`demo.js`, `system.js`)
 *   - el `switch` de `parseAppVar` (src/lib/db/app.js)
 *   - el desplegable "Lang" de la GUI (EditorCode.svelte, `listLangs`)
 *   - el modelo, que no imponia nada
 *
 * Las tres pruebas de aqui atacan ese desajuste por los tres lados:
 *
 *   1. `validateAppVarType` cierra el conjunto y sugere el arreglo.
 *   2. Los seeds y el `switch` de `parseAppVar` no pueden usar un tipo fuera del
 *      conjunto canonico. Es la que habria atrapado el `object` y el `boolean`.
 *   3. `parseAppVar` entrega el valor SIN entrecomillar, y un `boolean` como
 *      boolean de verdad. La 3 es la que fija el arreglo de 13.12.1: sin ella,
 *      volver a poner `JSON.stringify` en la rama `default` pasaria inadvertido.
 *
 * Y una cuarta, sobre el valor YA escrito: ningun AppVar de los seeds debe
 * conservar capas de comillas acumuladas.
 *
 * Puro: no toca la base de datos ni necesita el servidor.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  APPVAR_TYPES,
  APPVAR_TYPES_ACCEPTED,
  APPVAR_TYPE_ALIASES,
  APPVAR_TYPE_MAX_LENGTH,
  APPVAR_BOOLEAN_TRUE_VALUES,
  validateAppVarType,
  suggestAppVarType,
  parseAppVarBoolean,
} from "../../src/lib/db/appvarType.js";

import { system_app } from "../../src/lib/db/default/system.js";
import { default_apps } from "../../src/lib/db/default/index.js";

import { parseAppVar } from "../../src/lib/db/app.js";
import { closeDb } from "./close_db.js";

let passed = 0;
let failed = 0;
const failures = [];

const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  }
};

// Los tipos que el desplegable "Lang" de la GUI ofrece. Vive en otro repositorio
// (svelte-components, EditorCode.svelte, `listLangs`), asi que se replica aqui como
// constante. Si algun dia la lista de la GUI cambia, esta constante esta llamada a
// quedarse atras: es el recordatorio de que hay que actualizarla.
const GUI_LANGS = ["none", "html", "js", "json", "sql", "xml", "string", "number"];

console.log("\n=== AppVar types: el conjunto canonico ===");

test("el conjunto canonico esta cerrado y ordenado", () => {
  assert.ok(Array.isArray(APPVAR_TYPES));
  for (const type of APPVAR_TYPES) {
    assert.equal(typeof type, "string");
    assert.ok(type.length > 0);
    assert.ok(type.length <= APPVAR_TYPE_MAX_LENGTH, `${type} excede el limite de la columna`);
  }
  // Orden alfabetico: el mensaje de error los lista y tiene que leerse igual que
  // la documentacion.
  assert.deepEqual(APPVAR_TYPES, [...APPVAR_TYPES].sort());
  assert.equal(new Set(APPVAR_TYPES).size, APPVAR_TYPES.length, "hay tipos repetidos");
});

test("todos los tipos canonicos se validan y devuelven su propia forma canonica", () => {
  for (const type of APPVAR_TYPES) {
    const check = validateAppVarType(type);
    assert.ok(check.valid, `${type} deberia ser valido: ${check.message}`);
    assert.equal(check.canonical, type, `${type} deberia canonizarse a si mismo`);
  }
});

test("el alias `object` se acepta y se normaliza a `json`", () => {
  // `object` es un duplicado exacto de la rama `json` en `parseAppVar`. No lo
  // rechaza nadie: una fila que lo traiga en un backup debe poder restaurarse. Pero
  // se reescribe, para que la columna deje de acumular la grafia.
  const check = validateAppVarType("object");
  assert.ok(check.valid);
  assert.equal(check.canonical, APPVAR_TYPE_ALIASES.object);
  assert.equal(check.canonical, "json");
  assert.ok(!APPVAR_TYPES.includes("object"), "`object` no debe canonizarse a si mismo");
});

test("el prefijo que se acepta es exactamente canonicos + alias", () => {
  assert.deepEqual(
    [...APPVAR_TYPES_ACCEPTED].sort(),
    [...new Set([...APPVAR_TYPES, ...Object.keys(APPVAR_TYPE_ALIASES)])].sort(),
  );
  // Ningun alias puede apuntar a un tipo que no sea canonico, o el modelo
  // normalizaria a algo que su propio validador rechazaria.
  for (const [alias, target] of Object.entries(APPVAR_TYPE_ALIASES)) {
    assert.ok(APPVAR_TYPES.includes(target), `el alias ${alias} apunta a ${target}, que no es canonico`);
    assert.notEqual(alias, target);
  }
});

console.log("\n=== AppVar types: lo que se rechaza ===");

test("un tipo desconocido se rechaza con sugerencia", () => {
  const check = validateAppVarType("strin");
  assert.equal(check.valid, false);
  assert.ok(check.message.includes("strin"));
  assert.equal(check.suggestion, "string");
});

test("la mayuscula se normaliza a la forma buena", () => {
  // `JSON` no es un error de escritura, es la misma etiqueta escrita con otra caja.
  // A diferencia del `name` —donde renombrar en silencio dejaria endpoints apuntando
  // a un nombre que ya no existe, y por eso se rechaza— aqui corregir la caja es
  // exactamente lo que se quiere: la caja no forma parte de la identidad.
  // El propio message lo dice: "The stored name is matched byte for byte..."
  const check = validateAppVarType("JSON");
  assert.equal(check.valid, true);
  assert.equal(check.canonical, "json");

  // Y un tipo que NO existe, ni en mayusculas ni en ninguna caja, si se rechaza.
  const bad = validateAppVarType("HTML5");
  assert.equal(bad.valid, false);
  assert.ok(bad.message.includes("HTML5"));
});

test("los tipos no-string se rechazan nombrando lo que se recibio", () => {
  for (const [value, expected] of [
    [null, "null"],
    [undefined, "undefined"],
    [42, "number"],
    [{}, "object"],
    [true, "boolean"],
  ]) {
    const check = validateAppVarType(value);
    assert.equal(check.valid, false, `${String(value)} deberia rechazarse`);
    assert.ok(check.message.includes(expected), `esperaba que el mensaje nombrara ${expected}: ${check.message}`);
  }
});

test("el tipo vacio y el que exceden la columna se rechazan", () => {
  for (const bad of ["", "   ", "x".repeat(APPVAR_TYPE_MAX_LENGTH + 1)]) {
    const check = validateAppVarType(bad);
    assert.equal(check.valid, false, `${JSON.stringify(bad)} deberia rechazarse`);
    assert.ok(check.message.length > 0);
  }
  // Justo en el limite se acepta: el limite es de la columna, no una regla extra.
  const exact = "x".repeat(APPVAR_TYPE_MAX_LENGTH);
  const check = validateAppVarType(exact);
  if (check.valid) {
    // Si un tipo de 25 caracteres se acepta, es porque `suggestAppVarType` encontro
    // algo a distancia <= 2, lo cual seria absurdo para una cadena tan larga. Falla
    // aqui para que un cambio en el umbral de sugerencia se note.
    assert.fail(`un tipo de ${exact.length} caracteres deberia rechazarse`);
  }
});

test("el sugeridor no inventa una respuesta cuando no hay una cercana", () => {
  assert.equal(suggestAppVarType("zzzzzzzzzz"), "");
  assert.equal(suggestAppVarType(""), "");
  assert.equal(suggestAppVarType(null), "");
  assert.equal(suggestAppVarType(42), "");
  // Y cuando la hay, es una de verdad.
  for (const typo of ["strin", "bolean", "jso", "numer", "htm"]) {
    const suggestion = suggestAppVarType(typo);
    assert.ok(suggestion, `${typo} deberia tener sugerencia`);
    assert.ok(APPVAR_TYPES.includes(suggestion), `${typo} sugiere "${suggestion}", que no es canonico`);
  }
});

console.log("\n=== AppVar types: los tres desajustes que ya ocurrieron ===");

// Los tres casos que reviennent en la base de un despliegue real, extraidos de los
// seeds y de la columna `type`.
test("el seed `system` siembra `boolean`, un tipo que antes no conocia nadie", () => {
  const booleans = system_app.vrs.filter((v) => v.type === "boolean");
  assert.ok(
    booleans.length >= 2,
    `se esperaban al menos 2 AppVars boolean en el seed, hay ${booleans.length}`,
  );
  for (const v of booleans) {
    assert.ok(APPVAR_TYPES.includes("boolean"), "`boolean` debe estar en el conjunto canonico");
    assert.ok(v.name.startsWith("$_VAR_"), `${v.name} no parece un nombre de AppVar`);
  }
  // Los dos flags de recuperacion de contrasena, que son los queadcimportan.
  const names = booleans.map((v) => v.name);
  assert.ok(names.includes("$_VAR_RESET_EMAIL_ENABLED"), `falta el flag de email: ${names.join(", ")}`);
  assert.ok(names.includes("$_VAR_RESET_TELEGRAM_ENABLED"), `falta el flag de telegram: ${names.join(", ")}`);
});

test("un `boolean` del seed es un boolean de verdad, no el string \"true\"", () => {
  // Este es el defecto de fondo. `json_typeof(value)` daba `string`, asi que el
  // runtime recibia la cadena, y en JavaScript "false" es truthy: un flag apagado se
  // leia como encendido.
  for (const v of system_app.vrs.filter((v) => v.type === "boolean")) {
    assert.equal(
      typeof v.value,
      "boolean",
      `${v.name} declara type=boolean pero su value es ${JSON.stringify(v.value)} (${typeof v.value})`,
    );
  }
});

test("ningun tipo de los seeds queda fuera del conjunto canonico", () => {
  const seeds = [["system", system_app], ...default_apps.map((a, i) => [`default_${i}`, a])];
  const offenses = [];
  for (const [label, app] of seeds) {
    for (const v of app.vrs || []) {
      const check = validateAppVarType(v.type);
      if (!check.valid) {
        offenses.push(`${label}/${v.name}: type=${JSON.stringify(v.type)}`);
      }
    }
  }
  assert.deepEqual(offenses, [], `tipos fuera del conjunto canonico: ${offenses.join("; ")}`);
});

test("el `switch` de `parseAppVar` no tiene ramas para tipos que el canon no acepta", () => {
  // El `switch` y el conjunto canonico tienen que contar la misma historia. Una rama
  // `case "algo"` sin `algo` en el canon ni en los alias es un tipo que se puede
  // persistir y que el runtime maneja de una forma que el validador no puede razonar.
  //
  // Excepcion deliberada: una rama para un alias si se permite. `object` sigue
  // teniendo su rama porque puede haber filas con ese tipo en una base desplegada, y
  // leerlas no puede fallar. Lo que no puede pasar es volver a escribirlas, y de eso
  // se encarga el validador del modelo.
  const source = readFileSync(new URL("../../src/lib/db/app.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function parseAppVar"));
  const cases = [...body.matchAll(/case\s+"([a-z0-9_]+)":/g)].map((m) => m[1]);

  assert.ok(cases.length >= 5, `no se encontraron las ramas del switch, hay ${cases.length}`);

  const accepted = [...APPVAR_TYPES, ...Object.keys(APPVAR_TYPE_ALIASES)];
  const offenders = cases.filter((c) => !accepted.includes(c));
  assert.deepEqual(
    offenders,
    [],
    `parseAppVar tiene ramas para tipos fuera del conjunto canonico: ${offenders.join(", ")}`,
  );

  // Y al reves, con una salvedad que hay que decir en voz alta: hay tipos canonicos
  // que NO tienen rama y caen en `default` a proposito. `string`, `none`, `html`,
  // `sql` y `xml` guardan texto, y la rama `default` devuelve el valor intacto, que
  // es justo lo que necesitan. Anadirles una rama `case "string": v = appvar.value;`
  // seria reescribir la misma linea en otro sitio, y el defecto de 13.12.1 vivio
  // precisamente en una de esas ramas redundantes.
  //
  // Lo que si no se admite es un tipo canonico que caiga en `default` y necesite
  // otra cosa: es decir, uno cuyo valor no sea texto. La lista se escribe a mano
  // porque es una decision de diseno, no un hecho que se pueda derivar.
  const TIPOS_QUE_CAEN_EN_DEFAULT = ["string", "none", "html", "sql", "xml"];

  // Ningun tipo de la lista puede tener rama propia: si latiene, la lista esta
  // desfasada y el `default` ya no es quien lo resuelve.
  const conRamaYEnDefault = TIPOS_QUE_CAEN_EN_DEFAULT.filter((t) => cases.includes(t));
  assert.deepEqual(
    conRamaYEnDefault,
    [],
    `estos tipos se declaran en default pero tienen rama propia: ${conRamaYEnDefault.join(", ")}`,
  );

  // Y cada tipo que SI tiene rama debe ser uno que de verdad la necesite: number,
  // json, boolean y los alias que se leen por compatibilidad.
  const NECESITAN_RAMA = ["number", "json", "boolean"];
  const sinRama = NECESITAN_RAMA.filter((t) => !cases.includes(t));
  assert.deepEqual(
    sinRama,
    [],
    `tipos que necesitan rama propia en parseAppVar y no la tienen (caerian en default): ${sinRama.join(", ")}`,
  );
});

console.log("\n=== AppVar types: lo que recibe el runtime ===");

test("un string NO llega al runtime entrecomillado", () => {
  // El defecto de 13.12.1. La rama `default` hacia `JSON.stringify(appvar.value)` y
  // un `$_VAR_CNX` de tipo string con valor `caracol` llegaba como `"caracol"`, con
  // las comillas como caracteres de la cadena.
  const cases = [
    ["caracol", "caracol"],
    ["ok amigo", "ok amigo"],
    ["https://fakestoreapi.com/carts", "https://fakestoreapi.com/carts"],
    ["", ""],
    ["con \"comillas\" internas", "con \"comillas\" internas"],
  ];
  for (const [stored, expected] of cases) {
    const out = parseAppVar({ type: "string", value: stored });
    assert.equal(out, expected, `string ${JSON.stringify(stored)} devolvio ${JSON.stringify(out)}`);
    // La asercion que de verdad importa: que no aparezcan comillas de envoltura.
    assert.ok(!/^".*"$/.test(String(out)) || stored.startsWith("\""),
      `string ${JSON.stringify(stored)} volvio envuelto en comillas: ${JSON.stringify(out)}`);
  }
});

test("un number llega como number, venga como venga almacenado", () => {
  assert.equal(parseAppVar({ type: "number", value: 7 }), 7);
  assert.equal(parseAppVar({ type: "number", value: "7" }), 7);
  assert.equal(parseAppVar({ type: "number", value: "7.5" }), 7.5);
});

test("un json llega como objeto, y no como su texto", () => {
  assert.deepEqual(parseAppVar({ type: "json", value: { a: 1 } }), { a: 1 });
  assert.deepEqual(parseAppVar({ type: "json", value: '{"a":1}' }), { a: 1 });
});

test("`object` y `js` se comportan como `json`", () => {
  for (const type of ["object", "js"]) {
    assert.deepEqual(parseAppVar({ type, value: { a: 1 } }), { a: 1 });
    assert.deepEqual(parseAppVar({ type, value: '{"a":1}' }), { a: 1 });
  }
});

test("un boolean llega como boolean, NUNCA como el string \"false\"", () => {
  // El segundo caso es el que importa: "false" es truthy en JavaScript.
  assert.equal(parseAppVar({ type: "boolean", value: true }), true);
  assert.equal(parseAppVar({ type: "boolean", value: false }), false);
  assert.equal(parseAppVar({ type: "boolean", value: "false" }), false);
  assert.equal(parseAppVar({ type: "boolean", value: "true" }), true);
  assert.equal(typeof parseAppVar({ type: "boolean", value: "false" }), "boolean");
  assert.equal(typeof parseAppVar({ type: "boolean", value: "true" }), "boolean");
});

test("`parseAppVarBoolean` entiende el mismo vocabulario que el flag de user.js", () => {
  for (const truthy of APPVAR_BOOLEAN_TRUE_VALUES) {
    assert.equal(parseAppVarBoolean(truthy), true, `${truthy} deberia ser true`);
    assert.equal(parseAppVarBoolean(truthy.toUpperCase()), true, `${truthy} en mayusculas deberia ser true`);
  }
  for (const falsy of ["false", "0", "no", "off", "", "  ", "quizá", null, undefined, {}, "2"]) {
    assert.equal(parseAppVarBoolean(falsy), false, `${JSON.stringify(falsy)} deberia ser false`);
  }
  assert.equal(parseAppVarBoolean(true), true);
  assert.equal(parseAppVarBoolean(false), false);
  assert.equal(parseAppVarBoolean(1), true);
  assert.equal(parseAppVarBoolean(0), false);
  // Siempre un boolean, para que `typeof` no surprise a nadie.
  for (const value of ["true", "false", 1, 0, null, {}, []]) {
    assert.equal(typeof parseAppVarBoolean(value), "boolean", `${JSON.stringify(value)} no devolvio boolean`);
  }
});

test("un tipo html/sql/xml/none entrega el valor intacto", () => {
  // Estos tipos no tienen rama propia: existen para el resaltado de sintaxis del
  // editor. Su valor debe salir exactamente como se escribio.
  for (const type of ["html", "sql", "xml", "none"]) {
    assert.equal(parseAppVar({ type, value: "SELECT 1" }), "SELECT 1");
    assert.equal(parseAppVar({ type, value: "<b>x</b>" }), "<b>x</b>");
  }
});

test("parseAppVar nunca lanza, pase lo que pase", () => {
  // El catch devuelve el valor original. Es lo que evita que un backup con una
  // variable rara tumbe un restore entero.
  const hostile = [
    { type: "json", value: "{no es json" },
    { type: "number", value: "no es un numero" },
    { type: "string", value: "ok" },
    { type: "boolean", value: "quiza" },
    { type: "inventado", value: "lo que sea" },
  ];
  for (const appvar of hostile) {
    const out = parseAppVar(appvar);
    assert.notEqual(out, undefined, `${appvar.type} devolvio undefined`);
  }
  // Un json roto devuelve el texto, que es lo unico que hay.
  assert.equal(parseAppVar({ type: "json", value: "{no es json" }), "{no es json");
});

console.log("\n=== AppVar types: los seeds no arrastran el defecto ===");

test("ningun AppVar de los seeds conserva capas de comillas acumuladas", () => {
  // Esto estaba en el repo: tres variables de tipo `string` con 2 y 3 capas de
  // comillas, que es la huella del defecto de 13.12.1 escrita en un fichero fuente.
  // Un despliegue nuevo las sembraba ya danoadas.
  const seeds = [["system", system_app], ...default_apps.map((a, i) => [`default_${i}`, a])];
  const corrupted = [];

  for (const [label, app] of seeds) {
    for (const v of app.vrs || []) {
      if (typeof v.value !== "string") continue;

      let current = v.value;
      let layers = 0;
      while (typeof current === "string" && current.length >= 2 && current[0] === '"') {
        let next;
        try {
          next = JSON.parse(current);
        } catch {
          break;
        }
        if (typeof next !== "string" || next === current) break;
        current = next;
        layers += 1;
        if (layers > 12) break;
      }

      if (layers > 0) {
        corrupted.push(
          `${label}/${v.name} (type=${v.type}) tiene ${layers} capa(s): ${JSON.stringify(v.value)} -> ${JSON.stringify(current)}`,
        );
      }
    }
  }

  assert.deepEqual(corrupted, [], `seeds con comillas acumuladas:\n    ${corrupted.join("\n    ")}`);
});

test("el desplegable de la GUI cubre todo lo que el seed usa", () => {
  // La GUI esta en otro repositorio, asi que esto no puede detectarlo solo: fija la
  // lista que el editor ofrece y obliga a que el seed no use un tipo fuera de ella,
  // que era exactamente el caso de `boolean` (seleccion en blanco en pantalla).
  //
  // `boolean` NO esta en `GUI_LANGS` todavia, porque el desplegable vive en
  // svelte-components y se arregla alli (commit aparte). Se declara como
  // pendiente explicito en vez de ampliar la constante en silencio: si esta
  // asercion se relaja sin que el desplegable ofrezca el tipo, se pierde el aviso de
  // que la GUI sigue sin representarlo.
  const PENDING_IN_GUI = ["boolean"];

  const usedInSeeds = new Set();
  const seeds = [["system", system_app], ...default_apps.map((a, i) => [`default_${i}`, a])];
  for (const [, app] of seeds) {
    for (const v of app.vrs || []) {
      if (APPVAR_TYPES.includes(v.type)) usedInSeeds.add(v.type);
    }
  }

  const missingFromGui = [...usedInSeeds].filter(
    (t) => !GUI_LANGS.includes(t) && !PENDING_IN_GUI.includes(t),
  );
  assert.deepEqual(
    missingFromGui,
    [],
    `el seed usa tipos que el desplegable Lang de la GUI no ofrece (salida en blanco): ${missingFromGui.join(", ")}`,
  );

  // Los pendientes tienen que ser una lista corta y con nombre: es una cuenta
  // pendiente, no un cajon de sastre. Si growsin, el contrato deja de avisar.
  assert.ok(PENDING_IN_GUI.length <= 3, `hay ${PENDING_IN_GUI.length} tipos pendientes en la GUI: revisa si la cuenta sigue siendo util`);
  for (const type of PENDING_IN_GUI) {
    assert.ok(APPVAR_TYPES.includes(type), `${type} esta pendiente en la GUI pero no es canonico`);
  }
});

console.log(`\n${passed} pass, ${failed} fail`);
console.log("=== AppVar type contract: all good ===");

// Importar `src/lib/db/app.js` arrastra `models.js` y con el el pool de la
// plataforma. Contra PostgreSQL o MSSQL ese socket mantiene el event loop vivo y el
// proceso imprimiria que todo paso sin salir nunca, que es el cuelgue que describe
// close_db.js. Aqui solo hace falta leer la columna, pero el pool se abre igual.
closeDb().catch(() => {});

if (failed > 0) {
  console.error("\n=== FALLOS ===");
  for (const { name, error } of failures) {
    console.error(`\n--- ${name}\n${error.stack}`);
  }
  process.exit(1);
}
