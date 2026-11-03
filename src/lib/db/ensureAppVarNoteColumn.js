/**
 * @file ensureAppVarNoteColumn.js
 * @description Garantiza que `ofapi_appvars` tenga la columna `note` (texto libre
 * para notas/comentarios del operador).
 *
 * ¿Por qué no basta con `sync({ alter: true })`? Porque ese sync es global y, sobre una
 * base ya existente, puede abortar por cualquier otra tabla —en SQLite un `changeColumn`
 * se implementa recreando la tabla y choca con las FKs de `ofapi_application`—. Cuando
 * aborta, cae al `sync()` simple, que crea tablas nuevas pero NO agrega columnas a las que
 * ya existen. El resultado sería que cualquier lectura de AppVars fallara con
 * "no such column: note" en las bases ya desplegadas.
 *
 * Esta comprobación es idempotente y de alcance acotado a una sola tabla, así que se
 * ejecuta en cada arranque y no solo con BUILD_DB=true: un despliegue en producción que
 * arranque sin BUILD_DB también necesita la columna.
 */

import { DataTypes } from "sequelize";
import dbAPIs from "./sequelize.js";
import { ModelNames } from "./models.js";

/** Definición de las columnas nuevas, en el orden en que se agregan. */
const APPVAR_COLUMNS = [
  [
    "note",
    {
      type: DataTypes.TEXT,
      allowNull: true,
      comment:
        "Free-text notes/comments for the operator. It is metadata only: it is never " +
        "resolved as an AppVar value and it is not part of any unique key.",
    },
  ],
];

/**
 * Agrega a `ofapi_appvars` las columnas que falten.
 *
 * @param {(...args: any[]) => void} [log] logger opcional del arranque
 * @returns {Promise<string[]>} nombres de las columnas agregadas
 */
export async function ensureAppVarNoteColumn(log = () => {}) {
  const table = ModelNames.AppVars;
  const queryInterface = dbAPIs.getQueryInterface();

  let existing;
  try {
    existing = await queryInterface.describeTable(table);
  } catch (error) {
    // La tabla todavía no existe: el sync la creará con todas las columnas.
    log(`[appvars] Table ${table} not found yet; skipping note column check.`);
    return [];
  }

  const added = [];
  for (const [name, definition] of APPVAR_COLUMNS) {
    if (existing[name]) continue;
    try {
      await queryInterface.addColumn(table, name, definition);
      added.push(name);
    } catch (error) {
      // Una carrera entre dos instancias arrancando a la vez puede duplicar el ADD.
      if (!/duplicate column|already exists/i.test(error?.message || "")) {
        log(`[appvars] Failed to add column ${table}.${name}:`, error);
        throw error;
      }
    }
  }

  if (added.length > 0) {
    log(`[appvars] Added columns to ${table}: ${added.join(", ")}`);
  }

  return added;
}
