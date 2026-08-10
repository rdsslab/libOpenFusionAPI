/**
 * @file bot_backup.js
 * @description Historial de versiones de la configuración de los bots (`ofapi_bot_bkp`).
 *
 * Espejo de `endpoint_backup.js`: cada `upsertBot` y cada `deleteBot` deja un snapshot
 * de la configuración del bot. Las versiones se deduplican por hash de contenido, así
 * que guardar dos veces lo mismo no crea filas nuevas y no hay poda: el historial crece
 * solo cuando la configuración cambia de verdad.
 *
 * Herramientas MCP asociadas: `bot_change_history` y `bot_restore_version`.
 */

import { BotBackup } from "./models.js";
import { BOT_RUNTIME_ATTRIBUTES } from "./bot.js";
import crypto from "crypto";

function sortObjectDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectDeep);
  }

  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortObjectDeep(value[key]);
    }
    return sorted;
  }

  return value;
}

function hashObjectSync(obj) {
  const jsonString = JSON.stringify(sortObjectDeep(obj));
  return crypto.createHash("sha256").update(jsonString).digest("hex");
}

/**
 * Campos que no describen la configuración del bot y que cambian solos en cada escritura.
 * Si entraran al hash, dos guardados idénticos se verían como versiones distintas.
 */
const VOLATILE_FIELDS = Object.freeze([
  "rowkey",
  "createdAt",
  "updatedAt",
  "internal_hash_row",
]);

/**
 * Normaliza el snapshot antes de hashearlo.
 *
 * Además de neutralizar las marcas de tiempo, quita las columnas de estado observado del
 * runtime (`BOT_RUNTIME_ATTRIBUTES`). Son diagnóstico que escribe el BotLifecycleTask, no
 * configuración: si entraran al hash, cada latido de telemetría generaría una versión
 * nueva, y al restaurar se pisaría la salud actual del bot con la de hace semanas.
 *
 * @param {Object} data
 * @returns {Object}
 */
function normalizeBotSnapshot(data) {
  const snapshot = { ...data };
  // Se borran en lugar de fijarse a null: el snapshot se reinyecta tal cual en
  // `Bot.upsert` al restaurar, y un `createdAt: null` explícito viaja a la columna en
  // vez de dejar que Sequelize la gestione. Ausentes, el hash es igualmente estable.
  for (const field of VOLATILE_FIELDS) {
    delete snapshot[field];
  }
  for (const field of BOT_RUNTIME_ATTRIBUTES) {
    delete snapshot[field];
  }
  return snapshot;
}

/**
 * Inserta un backup SOLO si la combinación (idbot + hash) no existe.
 *
 * @param {Object} args
 * @param {string} args.idbot - UUID del bot
 * @param {Object} args.data  - Datos a respaldar (objeto plano)
 * @returns {Promise<{ created: boolean, instance: BotBackup | null }>}
 */
export async function createBotBackup({ idbot, data }) {
  if (!idbot || typeof idbot !== "string") {
    throw new Error("idbot debe ser un string UUID válido");
  }

  if (!data || typeof data !== "object") {
    throw new Error("data debe ser un objeto válido");
  }

  const dataToHash = normalizeBotSnapshot(data);
  const hash = hashObjectSync(dataToHash);

  try {
    // `upsert` es más robusto entre dialectos que `findOrCreate` y evita la carrera
    // entre la comprobación y la inserción.
    const [instance, created] = await BotBackup.upsert(
      {
        idbot,
        hash,
        data: dataToHash,
      },
      {
        logging: false,
        returning: true,
      },
    );

    return {
      created: created === true,
      instance: created === true ? instance : null,
    };
  } catch (error) {
    // Duplicado esperado: ya existe un backup idéntico.
    const parentCode = error?.parent?.code;
    const parentNumber = error?.parent?.number;
    const isDuplicate =
      error?.name === "SequelizeUniqueConstraintError" ||
      parentCode === "SQLITE_CONSTRAINT" || // sqlite
      parentCode === "23505" || // postgres unique_violation
      parentCode === "ER_DUP_ENTRY" || // mysql/mariadb
      parentNumber === 2601 || // mssql duplicate key row
      parentNumber === 2627; // mssql unique constraint

    if (isDuplicate) {
      return { created: false, instance: null };
    }

    console.error("[bot_backup.js] Error creating bot backup:", error);
    throw error;
  }
}

/**
 * Devuelve una versión concreta del historial.
 *
 * @param {number|string} idbackup
 * @returns {Promise<BotBackup|null>}
 */
export const getBotBackupById = async (idbackup) => {
  try {
    return await BotBackup.findByPk(idbackup);
  } catch (error) {
    console.error("[bot_backup.js] Error in getBotBackupById:", error);
    throw error;
  }
};

/**
 * Historial completo de un bot, del más reciente al más antiguo.
 * Incluye el snapshot `data` entero (y por tanto el token del bot).
 *
 * @param {string} idbot
 * @returns {Promise<Array>}
 */
export const getBotBackupByIdBot = async (idbot) => {
  try {
    return await BotBackup.findAll({
      where: { idbot },
      order: [["idbackup", "DESC"]],
    });
  } catch (error) {
    console.error("[bot_backup.js] Error in getBotBackupByIdBot:", error);
    throw error;
  }
};

/**
 * Versión ligera: solo idbackup, idbot, hash y createdAt.
 * Excluye el campo pesado `data` (snapshot completo del bot, con credenciales).
 * Es la forma recomendada de listar el historial antes de pedir una versión concreta.
 *
 * @param {string} idbot
 * @returns {Promise<Array>}
 */
export const getBotBackupByIdBotLightweight = async (idbot) => {
  try {
    return await BotBackup.findAll({
      where: { idbot },
      attributes: ["idbackup", "idbot", "hash", "createdAt"],
      order: [["idbackup", "DESC"]],
    });
  } catch (error) {
    console.error(
      "[bot_backup.js] Error in getBotBackupByIdBotLightweight:",
      error,
    );
    throw error;
  }
};
