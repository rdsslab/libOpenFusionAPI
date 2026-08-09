/**
 * @file ensureBotRuntimeColumns.js
 * @description Garantiza que `ofapi_bot` tenga las columnas de estado observado del
 * runtime (runtime_status, failure_count, next_retry_at, ...).
 *
 * ¿Por qué no basta con `sync({ alter: true })`? Porque ese sync es global y, sobre una
 * base ya existente, puede abortar por cualquier otra tabla —en SQLite un `changeColumn`
 * se implementa recreando la tabla y choca con las FKs de `ofapi_application`—. Cuando
 * aborta, cae al `sync()` simple, que crea tablas nuevas pero NO agrega columnas a las que
 * ya existen. El resultado sería que `getActiveBots()` fallara en cada ciclo con
 * "no such column" y todos los bots quedaran caídos.
 *
 * Esta comprobación es idempotente y de alcance acotado a una sola tabla, así que se
 * ejecuta en cada arranque y no solo con BUILD_DB=true: un despliegue en producción que
 * arranque sin BUILD_DB también necesita las columnas.
 */

import { DataTypes } from "sequelize";
import dbAPIs from "./sequelize.js";
import { ModelNames } from "./models.js";

/** Definición de cada columna nueva, en el orden en que se agregan. */
const RUNTIME_COLUMNS = [
  ["runtime_status", { type: DataTypes.STRING(24), allowNull: false, defaultValue: "STOPPED" }],
  ["failure_count", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }],
  ["last_error_type", { type: DataTypes.STRING(40), allowNull: true }],
  ["last_error_message", { type: DataTypes.TEXT, allowNull: true }],
  ["last_failure_at", { type: DataTypes.DATE, allowNull: true }],
  ["next_retry_at", { type: DataTypes.DATE, allowNull: true }],
  ["last_started_at", { type: DataTypes.DATE, allowNull: true }],
  ["last_healthy_at", { type: DataTypes.DATE, allowNull: true }],
  ["disabled_by", { type: DataTypes.STRING(8), allowNull: true }],
  ["disabled_reason", { type: DataTypes.TEXT, allowNull: true }],
];

/**
 * Agrega las columnas de runtime que falten en `ofapi_bot`.
 *
 * @param {(...args: any[]) => void} [log] logger opcional del arranque
 * @returns {Promise<string[]>} nombres de las columnas agregadas
 */
export async function ensureBotRuntimeColumns(log = () => {}) {
  const table = ModelNames.Bot;
  const queryInterface = dbAPIs.getQueryInterface();

  let existing;
  try {
    existing = await queryInterface.describeTable(table);
  } catch (error) {
    // La tabla todavía no existe: el sync la creará con todas las columnas.
    log(`[bots] Table ${table} not found yet; skipping runtime column check.`);
    return [];
  }

  const added = [];
  for (const [name, definition] of RUNTIME_COLUMNS) {
    if (existing[name]) continue;
    try {
      await queryInterface.addColumn(table, name, definition);
      added.push(name);
    } catch (error) {
      // Una carrera entre dos instancias arrancando a la vez puede duplicar el ADD.
      if (!/duplicate column|already exists/i.test(error?.message || "")) {
        log(`[bots] Failed to add column ${table}.${name}:`, error);
        throw error;
      }
    }
  }

  if (added.length > 0) {
    log(`[bots] Added runtime columns to ${table}: ${added.join(", ")}`);
  }

  // El índice declarado en el modelo se intenta crear durante el sync, es decir antes de
  // que esta función agregue la columna, así que ahí falla. Se crea aquí, ya con la
  // columna presente. `IF NOT EXISTS` lo hace repetible en cada arranque.
  try {
    await queryInterface.addIndex(table, ["runtime_status"], {
      name: "idx_bot_runtime_status",
      ifNotExists: true,
    });
  } catch (error) {
    if (!/already exists/i.test(error?.message || "")) {
      log(`[bots] Failed to create idx_bot_runtime_status:`, error?.message || error);
    }
  }

  return added;
}
