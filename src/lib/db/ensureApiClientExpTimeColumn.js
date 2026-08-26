/**
 * @file ensureApiClientExpTimeColumn.js
 * @description Garantiza que `ofapi_api_client` tenga la columna `exp_time` para
 * configurar la duración del token JWT por cliente.
 *
 * ¿Por qué no basta con `sync({ alter: true })`? Porque ese sync es global y, sobre una
 * base ya existente, puede abortar por cualquier otra tabla —en SQLite un `changeColumn`
 * se implementa recreando la tabla y choca con las FKs de `ofapi_api_key`—. Cuando
 * aborta, cae al `sync()` simple, que crea tablas nuevas pero NO agrega columnas a las que
 * ya existen. El resultado sería que `loginApiClient` siempre cayera al fallback de 3600s.
 *
 * Esta comprobación es idempotente y de alcance acotado a una sola tabla, así que se
 * ejecuta en cada arranque y no solo con BUILD_DB=true: un despliegue en producción que
 * arranque sin BUILD_DB también necesita la columna.
 */

import { DataTypes } from "sequelize";
import dbAPIs from "./sequelize.js";
import { ModelNames } from "./models.js";

/** Definición de las columnas nuevas, en el orden en que se agregan. */
const API_CLIENT_COLUMNS = [
  [
    "exp_time",
    {
      type: DataTypes.BIGINT,
      allowNull: true,
      defaultValue: 3600,
      comment: "Token expiration time in seconds. Null or 0 falls back to 3600 (1 hour).",
    },
  ],
];

/**
 * Agrega a `ofapi_api_client` las columnas que falten.
 *
 * @param {(...args: any[]) => void} [log] logger opcional del arranque
 * @returns {Promise<string[]>} nombres de las columnas agregadas
 */
export async function ensureApiClientExpTimeColumn(log = () => {}) {
  const table = ModelNames.ApiClient;
  const queryInterface = dbAPIs.getQueryInterface();

  let existing;
  try {
    existing = await queryInterface.describeTable(table);
  } catch (error) {
    // La tabla todavía no existe: el sync la creará con todas las columnas.
    log(`[apiclient] Table ${table} not found yet; skipping exp_time column check.`);
    return [];
  }

  const added = [];
  for (const [name, definition] of API_CLIENT_COLUMNS) {
    if (existing[name]) continue;
    try {
      await queryInterface.addColumn(table, name, definition);
      added.push(name);
    } catch (error) {
      // Una carrera entre dos instancias arrancando a la vez puede duplicar el ADD.
      if (!/duplicate column|already exists/i.test(error?.message || "")) {
        log(`[apiclient] Failed to add column ${table}.${name}:`, error);
        throw error;
      }
    }
  }

  if (added.length > 0) {
    log(`[apiclient] Added columns to ${table}: ${added.join(", ")}`);
  }

  return added;
}
