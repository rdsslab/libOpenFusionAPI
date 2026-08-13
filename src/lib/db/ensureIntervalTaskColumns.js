/**
 * @file ensureIntervalTaskColumns.js
 * @description Garantiza que `ofapi_intervaltask` tenga las columnas de control de
 * concurrencia, autenticación y planificación (allow_concurrent, idkey, schedule_mode,
 * cron, ventana horaria, max_failed_attempts, history_limit).
 *
 * ¿Por qué no basta con `sync({ alter: true })`? Porque ese sync es global, solo corre
 * con BUILD_DB y, sobre una base ya existente, puede abortar por cualquier otra tabla.
 * Cuando aborta cae al `sync()` simple, que crea tablas nuevas pero NO agrega columnas a
 * las que ya existen: el worker fallaría en cada ciclo con "no such column" y ninguna
 * tarea programada volvería a ejecutarse.
 *
 * Es idempotente y de alcance acotado a una tabla, así que se ejecuta en cada arranque.
 * Mismo patrón que `ensureBotRuntimeColumns.js`.
 */

import { DataTypes } from "sequelize";
import dbAPIs from "./sequelize.js";
import { ModelNames } from "./models.js";

/** Definición de cada columna nueva, en el orden en que se agregan. */
const INTERVAL_TASK_COLUMNS = [
  [
    "allow_concurrent",
    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  ],
  ["idkey", { type: DataTypes.BIGINT, allowNull: true }],
  [
    "schedule_mode",
    { type: DataTypes.STRING(10), allowNull: false, defaultValue: "interval" },
  ],
  ["cron", { type: DataTypes.STRING(120), allowNull: true }],
  ["timezone", { type: DataTypes.STRING(64), allowNull: true }],
  ["window_start", { type: DataTypes.STRING(5), allowNull: true }],
  ["window_end", { type: DataTypes.STRING(5), allowNull: true }],
  ["window_days", { type: DataTypes.STRING(20), allowNull: true }],
  [
    "max_failed_attempts",
    { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 10 },
  ],
  [
    "history_limit",
    { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 50 },
  ],
];

/**
 * Agrega a `ofapi_intervaltask` las columnas que falten.
 *
 * @param {(...args: any[]) => void} [log] logger opcional del arranque
 * @returns {Promise<string[]>} nombres de las columnas agregadas
 */
export async function ensureIntervalTaskColumns(log = () => {}) {
  const table = ModelNames.IntervalTask;
  const queryInterface = dbAPIs.getQueryInterface();

  let existing;
  try {
    existing = await queryInterface.describeTable(table);
  } catch (error) {
    // La tabla todavía no existe: el sync la creará con todas las columnas.
    log(`[tasks] Table ${table} not found yet; skipping column check.`);
    return [];
  }

  const added = [];
  for (const [name, definition] of INTERVAL_TASK_COLUMNS) {
    if (existing[name]) continue;
    try {
      await queryInterface.addColumn(table, name, definition);
      added.push(name);
    } catch (error) {
      // Una carrera entre dos instancias arrancando a la vez puede duplicar el ADD.
      if (!/duplicate column|already exists/i.test(error?.message || "")) {
        log(`[tasks] Failed to add column ${table}.${name}:`, error);
        throw error;
      }
    }
  }

  if (added.length > 0) {
    log(`[tasks] Added columns to ${table}: ${added.join(", ")}`);
  }

  return added;
}
