import "dotenv/config";
import assert from "node:assert/strict";
import { DataTypes } from "sequelize";
import dbsequelize from "../../src/lib/db/sequelize.js";
// Importar solo `db/sequelize.js` deja el registro de modelos vacio: son los
// modelos los que se enganchan al definirse, y sin ellos no hay nada que validar.
import "../../src/lib/db/models.js";
import { normalizeBigintValues, parseBigintIfSafe } from "../../src/lib/bigint.js";
import { closeDb } from "./close_db.js";

/**
 * Normalizacion de `bigint` a numero en los modelos de la plataforma.
 *
 * Este test existe porque el que habia para esta materia (`sql_parse_bigint_test.js`,
 * borrado en 13.11.10) pasaba sin comprobar nada de lo que importa: ejercitaba
 * `parseBigintIfSafe` como funcion pura y `buildBigintAwareTypeParser` sobre OIDs
 * inventados, sin abrir nunca una conexion. Ese test era ademas la unica prueba de
 * la opcion `parse_bigint` de un endpoint, que se retiro porque no llegaba al driver:
 * era correcta la funcion y no se ejecutaba nunca el camino que hacia falta. Este
 * test sigue cubriendo lo que si funciona —la normalizacion en los modelos de la
 * plataforma— y si abre una conexion de verdad.
 *
 * Que se normalice depende del motor, y por eso el mismo criterio no vale para todos:
 *
 * | Dialect   | Como entrega un `bigint`                    | Que se espera aqui                        |
 * |-----------|----------------------------------------------|------------------------------------------|
 * | postgres  | texto (`pg` lo hace por diseno)             | numero dentro del rango seguro           |
 * | mssql     | texto (`tedious`, igual que `pg`)            | numero dentro del rango seguro           |
 * | sqlite    | numero ya en el driver                      | numero, y el helper no interviene        |
 *
 * En SQLite el bug nunca existio, asi que las aserciones se adaptan al dialecto en vez
 * de fijar un unico resultado: lo que se valida es que el rango seguro llegue SIEMPRE
 * como numero, sea cual sea el motor, y que fuera del rango no se invente precision que
 * JavaScript no puede representar.
 */

const dialect = dbsequelize.getDialect();
const NUMERO_SEGURO = "9007199254740991"; // 2^53 - 1, el maximo exacto de Number
const FUERA_DE_RANGO = "9223372036854775807"; // 2^63 - 1, que un Number no representa

// --- El helper puro, que es la base de todo ----------------------------------

assert.equal(parseBigintIfSafe(NUMERO_SEGURO), 9007199254740991, "el limite seguro es un numero");
assert.equal(parseBigintIfSafe(FUERA_DE_RANGO), FUERA_DE_RANGO, "fuera de rango se conserva el texto");
assert.equal(parseBigintIfSafe("0x10"), "0x10", "hexadecimal no se reinterpretan como decimal");
assert.equal(parseBigintIfSafe(" 42 "), 42, "el texto con espacios es un numero");
assert.equal(parseBigintIfSafe(7), 7, "un numero que ya lo es no se toca");
assert.equal(parseBigintIfSafe(null), null);
assert.equal(parseBigintIfSafe(undefined), undefined);
console.log("  parseBigintIfSafe: rango seguro, fuera de rango y entradas que no son bigint");

// --- El modelo: todos tienen que llevar el enganche --------------------------
//
// Es la asercion que protege contra el olvido. Enganchar el hook modelo por modelo
// seria el error facil de cometer: un modelo nuevo nace sin normalizar y nadie se
// entera hasta que un cliente recibe un id de tipo incorrecto. Envolver `define` en
// `db/sequelize.js` lo hace imposible, y esto lo comprueba.

const conBigint = Object.values(dbsequelize.models).filter((model) =>
  Object.values(model.rawAttributes).some((atributo) => atributo.type instanceof DataTypes.BIGINT),
);
assert.ok(conBigint.length > 0, "debe haber modelos con columnas BIGINT que validar");

for (const model of conBigint) {
  for (const hook of ["afterFind", "afterSave"]) {
    const registrados = model.options.hooks?.[hook];
    assert.ok(
      Array.isArray(registrados) && registrados.length > 0,
      `${model.name} no tiene ningun hook ${hook}: se define con define() y deberia llevar la normalizacion`,
    );
  }
}
console.log(`  ${conBigint.length} modelos con BIGINT llevan afterFind y afterSave`);

// --- Conexion real: el valor tiene que llegar como numero --------------------

const TABLA = "ofapi_test_bigint_probe";
const Sonda = dbsequelize.define("TestBigintProbe", {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  seguro: { type: DataTypes.BIGINT },
  grande: { type: DataTypes.BIGINT },
  texto: { type: DataTypes.STRING },
}, { tableName: TABLA, timestamps: false });

try {
  await Sonda.sync({ force: true });

  // La escritura: un `create()` entrega la clave primaria tal como la emitio el
  // driver, y sin normalizar el cliente recibe un id de tipo distinto del que
  // recibe al leerlo despues.
  const creado = await Sonda.create({ seguro: 1, grande: 42, texto: "x" });
  assert.equal(
    typeof creado.get("id"),
    "number",
    `el id devuelto por create() deberia ser numero, y es ${typeof creado.get("id")}`,
  );

  // El rango seguro llega como numero en cualquier motor.
  const leido = await Sonda.findByPk(creado.get("id"));
  assert.equal(typeof leido.get("id"), "number", "findByPk: el id deberia ser numero");
  assert.equal(leido.get("id"), creado.get("id"), "el id no puede cambiar de valor entre escritura y lectura");
  assert.equal(typeof leido.get("grande"), "number", "findByPk: un bigint en rango seguro es numero");
  assert.equal(leido.get("grande"), 42);

  // `raw: true` devuelve filas planas, no instancias: es otra ruta de escritura y
  // por eso el helper distingue una cosa de otra.
  const [planas] = await Sonda.findAll({ where: { id: creado.get("id") }, raw: true });
  assert.equal(typeof planas.id, "number", "raw: true: el id tambien deberia ser numero");
  assert.equal(planas.texto, "x", "una columna de texto no se toca");

  // Fuera del rango seguro el texto se conserva: es preferible un string a un id
  // que cambio de valor por el camino. En sqlite el driver ya devolvia numero (con
  // perdida), y ahi no hay texto que conservar, asi que no se afirma nada.
  if (dialect !== "sqlite") {
    const conGrande = await Sonda.findByPk(creado.get("id"));
    conGrande.set("grande", FUERA_DE_RANGO);
    await conGrande.save();

    const releido = await Sonda.findByPk(creado.get("id"));
    assert.equal(
      String(releido.get("grande")),
      FUERA_DE_RANGO,
      "un bigint fuera del rango seguro debe conservar su valor exacto",
    );
  }

  const total = await Sonda.count();
  assert.equal(total, 1, "el count no se ve afectado por la normalizacion");
  console.log(`  conexion real (${dialect}): create, findByPk, raw:true y fuera de rango`);
} finally {
  await dbsequelize.getQueryInterface().dropTable(TABLA).catch(() => {});
}

console.log("OK  db_bigint_normalization: los bigint de la plataforma llegan como numero cuando se puede");

await closeDb();
