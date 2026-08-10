/**
 * @file bot.js
 * @description Capa de acceso a datos para la tabla `ofapi_bot`.
 *
 * Esta capa maneja todas las operaciones CRUD para los bots de mensajería.
 * Cada bot pertenece a un `provider` (telegram, whatsapp, ms_teams, etc.).
 * Los bots están atados a una Application y usan las AppVars de dicha app.
 *
 * Los bots NO son endpoints: no existe un handler de endpoint para bots.
 * Documentación: src/docs/bots/ (y las herramientas MCP get_bot_skill /
 * get_bot_provider_skill).
 */

import { Bot, Application, AppVars } from "./models.js";
import { Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";

/**
 * Columnas de estado observado del runtime. Las escribe el BotLifecycleTask, nunca el
 * usuario: `enabled` sigue siendo intención y estas columnas son diagnóstico.
 * Ver src/lib/server/bot-manager/failurePolicy.js.
 */
export const BOT_RUNTIME_ATTRIBUTES = Object.freeze([
  "runtime_status",
  "failure_count",
  "last_error_type",
  "last_error_message",
  "last_failure_at",
  "next_retry_at",
  "last_started_at",
  "last_healthy_at",
  "disabled_by",
  "disabled_reason",
]);

const BOT_RUNTIME_ATTRIBUTE_SET = new Set(BOT_RUNTIME_ATTRIBUTES);

/** Tope del mensaje de error persistido: un stack completo no aporta en una columna de estado. */
const MAX_ERROR_MESSAGE_LENGTH = 500;

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

    // Cada cambio de configuración deja una versión en `ofapi_bot_bkp`. Un fallo aquí
    // nunca debe tumbar el guardado del bot: el respaldo es una red de seguridad, no
    // parte del contrato del upsert.
    try {
      const { createBotBackup } = await import("./bot_backup.js");
      await createBotBackup({ data, idbot: result.idbot });
    } catch (error) {
      console.error("[bot.js] Error creating bot backup:", error);
    }

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
      // Estado observado del runtime: sin esto el operador solo ve que el bot no está
      // corriendo, no por qué ni cuándo se vuelve a intentar.
      ...BOT_RUNTIME_ATTRIBUTES,
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
        // Se devuelven para que el ciclo de vida pueda rehidratar el backoff tras un
        // reinicio del proceso: sin esto, al reiniciar se pierde `next_retry_at` y todos
        // los bots en cuarentena vuelven a golpear al proveedor de inmediato.
        runtime_status: plain.runtime_status,
        failure_count: plain.failure_count,
        last_error_type: plain.last_error_type,
        next_retry_at: plain.next_retry_at,
        last_started_at: plain.last_started_at,
        last_healthy_at: plain.last_healthy_at,
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
 * Actualiza únicamente el estado observado del runtime de un bot.
 *
 * Solo acepta las columnas de BOT_RUNTIME_ATTRIBUTES: es la barrera que impide que la
 * telemetría del ciclo de vida pise por accidente la configuración del usuario (token,
 * code, enabled). Falla en silencio si el bot ya no existe, porque el ciclo de vida puede
 * intentar persistir el estado de un bot recién borrado.
 *
 * @param {string} idbot
 * @param {Object} patch subconjunto de BOT_RUNTIME_ATTRIBUTES
 * @returns {Promise<boolean>} true si se actualizó al menos 1 fila
 */
export const updateBotRuntimeState = async (idbot, patch = {}) => {
  if (!idbot) return false;

  const values = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!BOT_RUNTIME_ATTRIBUTE_SET.has(key)) continue;
    values[key] =
      key === "last_error_message" && typeof value === "string"
        ? value.slice(0, MAX_ERROR_MESSAGE_LENGTH)
        : value;
  }

  if (Object.keys(values).length === 0) return false;

  try {
    const [updated] = await Bot.update(values, { where: { idbot } });
    return updated > 0;
  } catch (error) {
    console.error("[bot.js] Error in updateBotRuntimeState:", error, values);
    throw error;
  }
};

/**
 * Deshabilita un bot (enabled = false) sin eliminarlo.
 *
 * `by` distingue quién lo apagó y es lo que hace posible la recuperación autónoma: un bot
 * apagado por el sistema (`system`) se vuelve a habilitar solo cuando el usuario corrige
 * el token o el código, mientras que uno apagado por el usuario (`user`) nunca se
 * re-habilita solo. El sistema solo llega aquí por fallos PERMANENTES —token revocado,
 * código inválido—; un fallo de red jamás deshabilita, se reintenta indefinidamente.
 *
 * @param {string} idbot
 * @param {Object} [options]
 * @param {"user"|"system"} [options.by="user"]
 * @param {string} [options.reason] motivo legible, solo para el auto-disable
 * @returns {Promise<boolean>} true si se actualizó al menos 1 fila
 */
export const disableBot = async (idbot, { by = "user", reason = null } = {}) => {
  try {
    const [updated] = await Bot.update(
      {
        enabled: false,
        disabled_by: by,
        disabled_reason: reason,
        ...(by === "system"
          ? { runtime_status: "DISABLED_ERROR" }
          : { runtime_status: "STOPPED", next_retry_at: null }),
      },
      { where: { idbot } }
    );
    return updated > 0;
  } catch (error) {
    console.error("[bot.js] Error in disableBot:", error);
    throw error;
  }
};

/**
 * Habilita un bot (enabled = true) y limpia el estado de fallo persistido.
 *
 * Habilitar es una acción explícita del operador: equivale a pedir un reintento ya, así
 * que la racha de fallos y el `next_retry_at` se descartan. El backoff en memoria lo
 * resetea `fnEnableDisableBot` a través del BotManager.
 *
 * @param {string} idbot
 * @returns {Promise<boolean>}
 */
export const enableBot = async (idbot) => {
  try {
    const [updated] = await Bot.update(
      {
        enabled: true,
        disabled_by: null,
        disabled_reason: null,
        runtime_status: "STOPPED",
        failure_count: 0,
        next_retry_at: null,
      },
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
      // Snapshot antes de destruir: `ofapi_bot_bkp` no tiene FK contra `ofapi_bot`, así
      // que el historial sobrevive al borrado y `bot_restore_version` puede recrear el
      // bot entero (token incluido) si se eliminó por error.
      try {
        const { createBotBackup } = await import("./bot_backup.js");
        await createBotBackup({ idbot, data: bot.toJSON() });
      } catch (error) {
        console.error("[bot.js] Error creating bot backup before delete:", error);
      }

      await bot.destroy();
      return true;
    }
    return false;
  } catch (error) {
    console.error("[bot.js] Error in deleteBot:", error);
    throw error;
  }
};

// ────────────────────────────────────────────────────────────
// RESTORE
// ────────────────────────────────────────────────────────────

/**
 * Restaura un bot a partir de una versión del historial (`ofapi_bot_bkp`).
 *
 * Si el bot fue borrado, el upsert lo vuelve a crear con el mismo `idbot`. El snapshot no
 * contiene columnas de runtime, así que el estado de salud observado del bot vivo no se
 * pisa. La propia restauración queda registrada como una versión más, de modo que la
 * configuración que se reemplazó sigue siendo recuperable.
 *
 * @param {number|string} idbackup
 * @returns {Promise<{success: boolean, idbot: string}>}
 */
export const restoreBotFromBackup = async (idbackup) => {
  if (!idbackup) throw new Error("idbackup es obligatorio.");

  const { getBotBackupById, createBotBackup } = await import("./bot_backup.js");

  const backup = await getBotBackupById(idbackup);
  if (!backup) {
    throw new Error(`No se encontró el respaldo con ID ${idbackup}`);
  }

  const backupData = backup.toJSON ? backup.toJSON() : backup;
  const botData = { ...backupData.data };
  // El snapshot manda sobre cualquier idbot que traiga el payload guardado.
  botData.idbot = backupData.idbot;

  const [result] = await Bot.upsert(botData, { returning: true });

  try {
    await createBotBackup({ data: botData, idbot: result.idbot });
  } catch (error) {
    console.error("[bot.js] Error creating bot backup after restore:", error);
  }

  return { success: true, idbot: result.idbot };
};
