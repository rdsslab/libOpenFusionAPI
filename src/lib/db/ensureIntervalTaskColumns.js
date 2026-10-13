/**
 * @file ensureIntervalTaskColumns.js
 * @description Garantiza que `ofapi_intervaltask` tenga las columnas de control de
 * concurrencia, autenticación y planificación (allow_concurrent, idkey, schedule_mode,
 * cron, ventana horaria, max_failed_attempts, history_limit, disabled_by, disabled_reason)
 * y marca como suspendidas por el sistema las tareas que versiones anteriores habían
 * apagado (`enabled = false`) por agotar sus reintentos.
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

import { DataTypes, Op, where, col } from "sequelize";
import dbAPIs from "./sequelize.js";
import { ModelNames, IntervalTask } from "./models.js";

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
  // H7: el backoff era un tope global fijo (1 h) y no se podía desactivar. Para una
  // tarea de monitoreo eso es contraproducente: el chequeo que debe seguir corriendo
  // justo cuando el sistema falla es el primero que se ralentiza. `backoff_enabled`
  // mantiene el intervalo aunque la tarea falle; el valor por defecto true conserva
  // el comportamiento actual. `max_backoff_seconds` sustituye a la constante
  // MAX_BACKOFF_SECONDS cuando está definido.
  [
    "backoff_enabled",
    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  ],
  [
    "max_backoff_seconds",
    { type: DataTypes.SMALLINT, allowNull: true },
  ],
  // La suspensión por fallos dejó de ser un `enabled = false` (que colapsaba "el
  // sistema la apagó" con "el usuario la apagó"). Ahora `enabled` es la intención del
  // usuario y estas dos columnas describen la suspensión del sistema. Nullables, así
  // que el ADD es metadata-only en PostgreSQL/MSSQL.
  ["disabled_by", { type: DataTypes.STRING(8), allowNull: true }],
  ["disabled_reason", { type: DataTypes.TEXT, allowNull: true }],
];

/**
 * Marca las tareas que en versiones anteriores quedaron `enabled = false` por haber
 * alcanzado `max_failed_attempts`, para que la GUI y el reset las reconozcan como
 * suspendidas por el sistema en vez de apagadas por el usuario.
 *
 * Deja `enabled` TAL CUAL a propósito: la tarea sigue sin correr (la puerta de
 * elegibilidad exige `enabled = true`), así que un despliegue nunca reanuda en
 * producción una tarea que estaba detenida; solo le cambia la etiqueta. El reset es
 * quien la vuelve a habilitar, de forma explícita.
 *
 * Idempotente: en cuanto `disabled_by` deja de ser null, el filtro la ignora.
 * Heurística: `failed_attempts >= max_failed_attempts`. Un usuario que hubiera
 * apagado la tarea justo después de una racha la vería etiquetada como "sistema";
 * el efecto es cosmético y se corrige al resetear.
 *
 * @param {(...args: any[]) => void} [log]
 * @returns {Promise<number>} filas marcadas
 */
async function backfillLegacySuspensions(log = () => {}) {
  try {
    const [updated] = await IntervalTask.update(
      {
        disabled_by: "system",
        disabled_reason:
          "Auto-suspended after reaching max_failed_attempts (migrated)",
      },
      {
        where: {
          disabled_by: { [Op.is]: null },
          enabled: false,
          max_failed_attempts: { [Op.gt]: 0 },
          [Op.and]: [
            where(col("failed_attempts"), Op.gte, col("max_failed_attempts")),
          ],
        },
      },
    );

    if (updated > 0) {
      log(
        `[tasks] Marked ${updated} legacy auto-disabled task(s) as system-suspended (enabled unchanged).`,
      );
    }

    return updated;
  } catch (error) {
    // No es fatal: si falla, las filas quedan como estaban (`enabled = false`), que
    // sigue siendo seguro, y el siguiente arranque lo reintenta.
    log(`[tasks] Legacy suspension backfill failed:`, error?.message || error);
    return 0;
  }
}

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

  // Solo tiene sentido una vez que las dos columnas existen (recién añadidas o de un
  // arranque anterior). Si la tabla no existía se salió antes: la crea el sync y no
  // hay filas heredadas que marcar.
  await backfillLegacySuspensions(log);

  return added;
}
