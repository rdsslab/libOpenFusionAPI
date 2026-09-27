import { DataTypes } from "sequelize";

/**
 * Conversion de `bigint` a numero SOLO cuando no se pierde precision.
 *
 * Vive aqui, y no en `handler/ConnectionPool.js`, porque lo consume la capa de base
 * de datos de la plataforma —que expone por HTTP las filas de sus propios modelos, y
 * tiene columnas `BIGINT`— y esa capa no deberia arrastrar el grafo del handler SQL
 * (`tedious`, `pg-types`, `handler/utils.js`) para usar una funcion de veinte lineas
 * sin dependencias. La otra capa que consumia esto, el handler SQL a traves de la
 * opcion `parse_bigint` de un endpoint, dejo de hacerlo en 13.11.10: la opcion se
 * retiro porque nunca llego al driver. La funcion se queda porque la plataforma si la
 * usa y si funciona.
 *
 * @param {string} value
 * @returns {number|string}
 */
export function parseBigintIfSafe(value) {
  if (typeof value !== "string" || value.trim() === "") return value;

  // Solo decimal canonico. `BigInt()` acepta ademas "0x10", "0b101" y "0o17",
  // que PostgreSQL nunca emite para un int8 pero que, si llegaran, se convertirian
  // silenciosamente a 16, 5 y 15. Un identificador reinterpretado es peor que un
  // identificador que llega como texto, asi que el contrato se limita a lo que el
  // driver puede enviar de verdad.
  if (!/^[+-]?\d+$/.test(value.trim())) return value;

  try {
    const asBigInt = BigInt(value.trim());
    if (
      asBigInt <= BigInt(Number.MAX_SAFE_INTEGER) &&
      asBigInt >= BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return Number(asBigInt);
    }
  } catch {
    // Fuera del rango de BigInt: se devuelve tal cual, que es lo que hacia pg.
  }

  return value;
}

/**
 * Escribe un valor en una fila sin pasar por el accessor de la instancia.
 *
 * `inst.column = 5` no siempre es lo mismo que `inst.set("column", 5)`: sobre una
 * clave primaria el accessor de Sequelize descarta la escritura sin avisar, y el
 * `id` devuelto por un `create()` se queda en el string que trajo el driver. Por
 * eso se escribe directamente en `dataValues` cuando la fila es una instancia, y
 * en la propia fila cuando es un objeto plano (`findAll({ raw: true })`).
 */
function assignBigint(row, key, value) {
  if (row.dataValues && typeof row.dataValues === "object") {
    row.dataValues[key] = value;
    return;
  }
  row[key] = value;
}

/** Una instancia de un modelo de Sequelize se reconoce por su clase constructora. */
function esInstanciaDeModelo(valor) {
  return (
    valor !== null &&
    typeof valor === "object" &&
    valor.constructor &&
    typeof valor.constructor.rawAttributes === "object"
  );
}

/**
 * Normaliza a numero las columnas `BIGINT` de las filas de un modelo, dentro del
 * rango en el que no hay perdida de precision.
 *
 * Por que hace falta y por que aqui: los drivers entregan `bigint` como texto y
 * el tipo de la columna no se propaga solo. PostgreSQL lo hace por diseno (un
 * int8 llega a 9.2e18 y `Number` no lo representa con exactitud) y `tedious` lo
 * hace de la misma forma, asi que la API devolvia `{"idtask":"7",
 * "interval":"600"}` en ambos motores y `{"idtask":7,"interval":600}` solo en
 * SQLite. Un cliente HTTP que recibe `"600"` tiene que distinguir strings de
 * numeros, y cualquier comparacion o suma posterior falla en silencio.
 *
 * El arreglo es aqui y no en el driver porque Sequelize no deja elegir el parser
 * de tipos: su `connection-manager` sobrescribe `connectionConfig.types` en cada
 * conexion y su lista blanca de `dialectOptions` no incluye `types`, asi que
 * `dialectOptions.types.getTypeParser` se ignora en silencio —que es exactamente lo
 * que hacia que la opcion `parse_bigint` del handler SQL no sirviera para nada, y
 * por eso se retiro en 13.11.10 en vez de arreglar—. Un `DataTypes.BIGINT` con
 * `parse()` propio tampoco sirve: Sequelize no lo invoca al leer. Y los hooks
 * globales de `Sequelize#addHook` reciben `options.model` como `undefined`, que
 * es justo el dato que haria falta para saber que columnas normalizar; por eso
 * el enganche es por modelo.
 *
 * Tambien recorre las asociaciones cargadas con `include`. No es un extra: el
 * respaldo de una app es un unico `Application.findOne({ include })` seguido de
 * `toJSON()`, y las `interval task` que van dentro salen de ahi. El `afterFind`
 * del modelo incluido no se dispara nunca—una asociacion no es un `find`—, asi
 * que sin este recorrido el `interval` llegaba como texto al backup y de ahí al
 * cliente, que es justo el valor que este arreglo viene a normalizar.
 *
 * @param {object|object[]} rows una instancia, una fila plana, o un array de ellas
 * @param {object} model el modelo de Sequelize, para leer sus `rawAttributes`
 * @param {Set} visitados interno: corta cualquier ciclo del grafo de asociaciones
 */
export function normalizeBigintValues(rows, model, visitados = new Set()) {
  if (!rows || !model?.rawAttributes) return;

  const atributos = Object.entries(model.rawAttributes).filter(
    ([, atributo]) => atributo.type instanceof DataTypes.BIGINT,
  );

  for (const row of Array.isArray(rows) ? rows : [rows]) {
    if (!row || typeof row !== "object") continue;

    // Una instancia visitada dos veces (belongsTo que vuelve al mismo padre) no se
    // vuelve a recorrer, y evita un bucle infinito en vez de confiar en que el
    // grafo de includes es un arbol.
    if (esInstanciaDeModelo(row)) {
      if (visitados.has(row)) continue;
      visitados.add(row);
    }

    if (atributos.length > 0) {
      for (const [key] of atributos) {
        const valor = row[key];
        // `parseBigintIfSafe` ya devuelve intacto lo que no es un string entero, asi
        // que aqui solo hace falta descartar null/undefined para no escribir encima.
        if (valor === null || valor === undefined) continue;
        assignBigint(row, key, parseBigintIfSafe(valor));
      }
    }

    // Solo se recorren asociaciones de una instancia. En una fila plana (`raw: true`)
    // las incluidas vienen como objetos sin modelo, y sin `rawAttributes` no hay
    // forma de saber que columnas son BIGINT: se deja el texto intacto antes que
    // convertir a ciegas.
    if (row.dataValues && typeof row.dataValues === "object") {
      for (const valor of Object.values(row.dataValues)) {
        if (Array.isArray(valor)) {
          for (const item of valor) {
            if (esInstanciaDeModelo(item)) {
              normalizeBigintValues(item, item.constructor, visitados);
            }
          }
        } else if (esInstanciaDeModelo(valor)) {
          normalizeBigintValues(valor, valor.constructor, visitados);
        }
      }
    }
  }
}

/**
 * Engancha la normalizacion a un modelo concreto.
 *
 * `afterFind` cubre las lecturas (`findAll`, `findOne`, `findByPk`, y tambien
 * `raw: true`, que entrega filas planas). `afterSave` cubre la escritura: sin el,
 * un `create()` devuelve la clave primaria tal como la emitio el driver, en
 * texto, y el cliente recibe un `id` string en la respuesta del POST que creo el
 * registro pero un `id` numerico al leerlo despues.
 *
 * Lo que NO cubre, y es una limitacion conocida: `Model.update()` y
 * `Model.destroy()` a nivel de coleccion devuelven un conteo, no filas, asi que
 * no hay nada que normalizar; y `upsert()` puede devolver la instancia sin
 * pasar por `afterSave`.
 *
 * @param {object} model
 */
export function attachBigintNormalization(model) {
  const normalizar = (rows) => normalizeBigintValues(rows, model);

  model.addHook("afterFind", normalizar);
  model.addHook("afterSave", normalizar);
}
