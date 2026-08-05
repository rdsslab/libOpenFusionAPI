/**
 * @file bot.js
 * @description Capa de acceso a datos para la tabla `ofapi_bot`.
 *
 * Esta capa maneja todas las operaciones CRUD para los bots de mensajería.
 * Cada bot pertenece a un `provider` (telegram, whatsapp, ms_teams, etc.).
 * Los bots están atados a una Application y usan las AppVars de dicha app.
 *
 * IMPORTANTE: El handler `TELEGRAM_BOT` en la tabla `ofapi_endpoint` está DEPRECADO.
 * No crear nuevos bots vía endpoints. Usar esta capa directamente.
 */

import { Bot, Application, AppVars } from "./models.js";
import { Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";

// ────────────────────────────────────────────────────────────
// CREATE / UPDATE
// ────────────────────────────────────────────────────────────

/**
 * Crea o actualiza un bot.
 * Si se provee `idbot` y existe, actualiza. Si no, crea uno nuevo.
 *
 * @param {Object} data
 * @param {string} [data.idbot]       - UUID del bot (omitir para crear nuevo)
 * @param {string} data.idapp         - UUID de la aplicación dueña del bot
 * @param {string} data.name          - Nombre descriptivo del bot
 * @param {string} [data.description] - Descripción del propósito del bot
 * @param {string} data.token         - Token/credencial del bot para el provider
 * @param {string} data.code          - Código JavaScript del bot (específico del provider)
 * @param {string} [data.provider]    - Provider de mensajería: telegram, whatsapp, ms_teams (default: telegram)
 * @param {string} [data.environment] - Ambiente: dev, qa, prd (default: prd)
 * @param {boolean} [data.enabled]    - Si el bot debe estar activo (default: true)
 * @param {Object} [data.params]      - Parámetros adicionales del bot
 * @returns {Promise<{result: Bot, created: boolean}>}
 */
export const upsertBot = async (data) => {
  try {
    if (!data.idbot) {
      data.idbot = uuidv4();
    }
    const [result, created] = await Bot.upsert(data, { returning: true });
    return { result, created };
  } catch (error) {
    console.error("[bot.js] Error in upsertBot:", error, data);
    throw error;
  }
};

// ────────────────────────────────────────────────────────────
// READ
// ────────────────────────────────────────────────────────────

/**
 * Obtiene un bot por su ID primario.
 *
 * @param {string} idbot - UUID del bot
 * @returns {Promise<Bot|null>}
 */
export const getBotById = async (idbot) => {
  try {
    const bot = await Bot.findByPk(idbot);
    return bot;
  } catch (error) {
    console.error("[bot.js] Error in getBotById:", error);
    throw error;
  }
};

/**
 * Obtiene el catálogo de bots con filtros opcionales.
 * NO incluye el token ni el código por defecto (seguridad).
 *
 * @param {Object} [filters]
 * @param {string} [filters.idapp]        - Filtrar por aplicación
 * @param {string} [filters.environment]  - Filtrar por ambiente
 * @param {boolean} [filters.enabled]     - Filtrar por estado
 * @param {boolean} [filters.include_code]  - Incluir campo code en respuesta
 * @param {boolean} [filters.include_token] - Incluir campo token en respuesta
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {Promise<Bot[]>}
 */
export const getBotCatalog = async (filters = {}) => {
  const {
    idapp,
    environment,
    provider,
    enabled,
    include_code = false,
    include_token = false,
    limit,
    offset,
  } = filters;

  try {
    const where = {};
    if (idapp) where.idapp = idapp;
    if (typeof environment === "string" && environment.trim() !== "") {
      where.environment = environment.toLowerCase();
    }
    if (typeof provider === "string" && provider.trim() !== "") {
      where.provider = provider.toLowerCase();
    }
    if (enabled !== null && enabled !== undefined) {
      where.enabled = enabled;
    }

    const attributes = [
      "idbot",
      "idapp",
      "name",
      "provider",
      "description",
      "enabled",
      "environment",
      "params",
      "createdAt",
      "updatedAt",
    ];

    if (include_token) attributes.push("token");
    if (include_code) attributes.push("code");

    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);

    return await Bot.findAll({
      where,
      attributes,
      order: [
        ["name", "ASC"],
        ["environment", "ASC"],
      ],
      ...(Number.isFinite(parsedLimit) && parsedLimit > 0
        ? { limit: parsedLimit }
        : {}),
      ...(Number.isFinite(parsedOffset) && parsedOffset >= 0
        ? { offset: parsedOffset }
        : {}),
    });
  } catch (error) {
    console.error("[bot.js] Error in getBotCatalog:", error);
    throw error;
  }
};

/**
 * Obtiene únicamente el código fuente de un bot.
 * Útil para agentes que solo necesitan leer/modificar el código.
 *
 * @param {string} idbot
 * @returns {Promise<{idbot: string, idapp: string, name: string, environment: string, enabled: boolean, code: string}|null>}
 */
export const getBotCode = async (idbot) => {
  if (!idbot) throw new Error("idbot es obligatorio.");
  try {
    const bot = await Bot.findByPk(idbot, {
      attributes: ["idbot", "idapp", "name", "provider", "environment", "enabled", "code"],
    });
    if (!bot) return null;
    return bot.toJSON ? bot.toJSON() : bot;
  } catch (error) {
    console.error("[bot.js] Error in getBotCode:", error);
    throw error;
  }
};

/**
 * Obtiene todos los bots activos con su aplicación y AppVars.
 * Usado por BotLifecycleTask para sincronizar workers.
 *
 * Un bot "activo" es aquel cuyo `enabled = true` y cuya aplicación también tiene `enabled = true`.
 *
 * @returns {Promise<Array>} Lista de bots con datos de la app y sus vars
 */
export const getActiveBots = async () => {
  try {
    const bots = await Bot.findAll({
      where: { enabled: true },
      include: [
        {
          model: Application,
          as: "app",
          where: { enabled: true },
          required: true,
          include: [
            {
              model: AppVars,
              as: "vrs",
              required: false,
            },
          ],
        },
      ],
    });

    return bots.map((bot) => {
      const plain = bot.toJSON ? bot.toJSON() : bot;
      return {
        idbot: plain.idbot,
        idapp: plain.idapp,
        name: plain.name,
        provider: plain.provider,
        description: plain.description,
        enabled: plain.enabled,
        environment: plain.environment,
        token: plain.token,
        code: plain.code,
        params: plain.params,
        app: plain.app
          ? {
              idapp: plain.app.idapp,
              app: plain.app.app,
              enabled: plain.app.enabled,
              vrs: plain.app.vrs || [],
            }
          : null,
      };
    });
  } catch (error) {
    console.error("[bot.js] Error in getActiveBots:", error);
    throw error;
  }
};

// ────────────────────────────────────────────────────────────
// UPDATE PARTIAL
// ────────────────────────────────────────────────────────────

/**
 * Deshabilita un bot (enabled = false) sin eliminarlo.
 * Llamado automáticamente por BotManager cuando un bot falla 3 veces consecutivas.
 *
 * @param {string} idbot
 * @returns {Promise<boolean>} true si se actualizó al menos 1 fila
 */
export const disableBot = async (idbot) => {
  try {
    const [updated] = await Bot.update(
      { enabled: false },
      { where: { idbot } }
    );
    return updated > 0;
  } catch (error) {
    console.error("[bot.js] Error in disableBot:", error);
    throw error;
  }
};

/**
 * Habilita un bot (enabled = true).
 *
 * @param {string} idbot
 * @returns {Promise<boolean>}
 */
export const enableBot = async (idbot) => {
  try {
    const [updated] = await Bot.update(
      { enabled: true },
      { where: { idbot } }
    );
    return updated > 0;
  } catch (error) {
    console.error("[bot.js] Error in enableBot:", error);
    throw error;
  }
};

// ────────────────────────────────────────────────────────────
// DELETE
// ────────────────────────────────────────────────────────────

/**
 * Elimina un bot permanentemente.
 *
 * @param {string} idbot
 * @returns {Promise<boolean>}
 */
export const deleteBot = async (idbot) => {
  try {
    const bot = await Bot.findByPk(idbot);
    if (bot) {
      await bot.destroy();
      return true;
    }
    return false;
  } catch (error) {
    console.error("[bot.js] Error in deleteBot:", error);
    throw error;
  }
};
