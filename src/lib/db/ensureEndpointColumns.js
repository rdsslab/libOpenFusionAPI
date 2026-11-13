/**
 * @file ensureEndpointColumns.js
 * @description Garantiza que `ofapi_endpoint` tenga la columna `exclusive` para
 * protección contra llamadas concurrentes (Hallazgo 4 del informe del cliente).
 *
 * Idempotente y de alcance acotado a una tabla. Se ejecuta en cada arranque del
 * servidor (ver `src/lib/index.js` donde se registra el auto-migrate).
 *
 * ¿Por qué no basta con `sync({ alter: true })`? Porque ese sync es global y puede
 * abortar sobre tablas existentes. Este archivo solo toca `ofapi_endpoint`.
 */

import { DataTypes } from "sequelize";
import dbAPIs from "./sequelize.js";
import { ModelNames } from "./models.js";

/** Definición de cada columna nueva, en el orden en que se agregan. */
const ENDPOINT_COLUMNS = [
  // H4: si es true, el endpoint se protege con un lock exclusivo para TODA llamada:
  // IntervalTask programada, runNowIntervalTask, GUI Tester, MCP execute_endpoint_test
  // y cliente HTTP directo.
  ["exclusive", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }],
];

/**
 * Agrega a `ofapi_endpoint` las columnas que falten.
 *
 * @param {(...args: any[]) => void} [log] logger opcional del arranque
 * @returns {Promise<string[]>} nombres de las columnas agregadas
 */
export async function ensureEndpointColumns(log = () => {}) {
  const table = ModelNames.Endpoint;
  const queryInterface = dbAPIs.getQueryInterface();

  let existing;
  try {
    existing = await queryInterface.describeTable(table);
  } catch (error) {
    // La tabla todavía no existe: el sync la creará con todas las columnas.
    log(`[endpoint] Table ${table} not found yet; skipping column check.`);
    return [];
  }

  const added = [];
  for (const [name, definition] of ENDPOINT_COLUMNS) {
    if (existing[name]) continue;
    try {
      await queryInterface.addColumn(table, name, definition);
      added.push(name);
    } catch (error) {
      // Una carrera entre dos instancias arrancando a la vez puede duplicar el ADD.
      if (!/duplicate column|already exists/i.test(error?.message || "")) {
        log(`[endpoint] Failed to add column ${table}.${name}:`, error);
        throw error;
      }
    }
  }

  if (added.length > 0) {
    log(`[endpoint] Added columns to ${table}: ${added.join(", ")}`);
  }

  return added;
}
