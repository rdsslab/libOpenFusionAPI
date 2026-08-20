import {
  getBotCatalog,
  getBotById,
  upsertBot,
  deleteBot,
  enableBot,
  disableBot,
  restoreBotFromBackup,
} from "../../../../../db/bot.js";
import {
  getBotBackupByIdBot,
  getBotBackupByIdBotLightweight,
} from "../../../../../db/bot_backup.js";
import { getBotLogs } from "../../../../../db/bot_log.js";
import { getAppVarsByIdApp } from "../../../../../db/appvars.js";
import { readBotSkill, readBotProviderSkill } from "../../../../botDocs.js";

export async function fnGetAllBots(params) {
  let r = { code: 204, data: undefined };
  try {
    r.data = await getBotCatalog();
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnListBots(params) {
  let r = { code: 200, data: undefined };
  try {
    const query = params.request.query || {};

    // If idbot is provided, return a single bot (GET /bots?idbot=...).
    if (query.idbot) {
      const bot = await getBotById(query.idbot);
      if (!bot) {
        r.code = 404;
        r.data = { success: false, error: "Bot not found" };
      } else {
        r.data = { success: true, data: bot };
      }
      return r;
    }

    const {
      idapp,
      environment,
      provider,
      enabled,
      include_code,
      include_token,
      limit,
      offset,
    } = query;

    r.data = {
      success: true,
      data: await getBotCatalog({
        idapp,
        environment,
        provider,
        enabled:
          enabled !== undefined
            ? enabled === "true" || enabled === true
            : undefined,
        include_code: include_code === "true" || include_code === true,
        include_token: include_token === "true" || include_token === true,
        limit,
        offset,
      }),
    };
  } catch (error) {
    console.error("[fnListBots] error:", error);
    r.data = { success: false, error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

// Kept for backward compatibility; prefer GET /bots?idbot=<idbot>.
export async function fnGetBotData(params) {
  let r = { code: 200, data: undefined };
  try {
    const idbot = params.request.query?.idbot;
    const bot = await getBotById(idbot);
    if (!bot) {
      r.code = 404;
      r.data = { success: false, error: "Bot not found" };
    } else {
      r.data = { success: true, data: bot };
    }
  } catch (error) {
    console.error("[fnGetBotData] error:", error);
    r.data = { success: false, error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

/**
 * Si el token es una referencia a una variable de aplicación (`$_...`), avisa cuando
 * esa variable todavía no existe para el ambiente destino. No bloquea el upsert: la
 * variable puede crearse después, y el bot solo la necesita al arrancar.
 *
 * @returns {Promise<string|undefined>} mensaje de advertencia, o undefined si todo ok.
 */
async function checkBotTokenAppVar(data) {
  const token = String(data.token ?? "").trim();
  if (!token.startsWith("$_")) return undefined;

  const environment = String(data.environment || "prd").toLowerCase();

  try {
    const vars = await getAppVarsByIdApp(data.idapp);
    const found = (vars || []).some((v) => {
      const plain = v?.toJSON ? v.toJSON() : v;
      return (
        plain?.name === token &&
        String(plain?.environment || "").toLowerCase() === environment
      );
    });

    if (found) return undefined;

    return (
      `Token references the application variable '${token}', but it is not defined for ` +
      `environment '${environment}'. Create it with appvar_upsert or the bot will fail to ` +
      `start with a bot_token_error log.`
    );
  } catch (error) {
    console.error("[fnUpsertBot] token appvar check failed:", error);
    return undefined;
  }
}

/**
 * Accede al BotManager vivo para descartar el backoff en memoria de un bot.
 *
 * Habilitar o editar un bot es una petición explícita de reintento inmediato. Sin esto,
 * el `cooldownUntil` que dejó el último fallo seguía vigente y `startBot` rechazaba el
 * arranque con `BOT_COOLDOWN`, de modo que ni siquiera la intervención manual servía
 * hasta que venciera la espera.
 *
 * @param {Object} params contexto de la función de sistema
 * @param {string} idbot
 * @param {string} reason
 */
function resetBotBackoff(params, idbot, reason) {
  try {
    const task =
      params?.reply?.openfusionapi?.server?.backgroundTasks?.botLifecycleTask;
    if (!task) return;
    task.manager.resetFailureState(idbot, reason);
    // Sincroniza de inmediato en lugar de esperar al ciclo de 10 s.
    task.runOnce().catch((err) => {
      console.error("[bots] runOnce after backoff reset failed:", err);
    });
  } catch (error) {
    // Nunca debe tumbar la respuesta HTTP: es una optimización de latencia.
    console.error("[bots] resetBotBackoff failed:", error);
  }
}

/**
 * Si el bot había sido apagado POR EL SISTEMA tras fallos permanentes y el usuario acaba
 * de cambiar el token o el código, se re-habilita solo.
 *
 * Corregir la causa es el remedio natural; exigir además un toggle manual convierte un
 * error ya resuelto en una tarea pendiente. Un bot apagado por el usuario
 * (`disabled_by = 'user'`) nunca se re-habilita solo: esa decisión es suya.
 *
 * @param {Object} data payload del upsert, mutado en sitio
 * @returns {Promise<string|undefined>} nota informativa para la respuesta
 */
async function reviveSystemDisabledBot(data) {
  if (!data.idbot) return undefined;
  // Un `enabled` explícito en el payload manda: no adivinar por encima del usuario.
  if (data.enabled !== undefined) return undefined;

  const existing = await getBotById(data.idbot);
  if (!existing) return undefined;

  const plain = existing.toJSON ? existing.toJSON() : existing;
  if (plain.enabled || plain.disabled_by !== "system") return undefined;

  const configChanged =
    (data.token !== undefined && data.token !== plain.token) ||
    (data.code !== undefined && data.code !== plain.code);
  if (!configChanged) return undefined;

  data.enabled = true;
  data.disabled_by = null;
  data.disabled_reason = null;
  data.failure_count = 0;
  data.runtime_status = "STOPPED";
  data.next_retry_at = null;

  return (
    `Bot was auto-disabled by the system (${plain.disabled_reason || "permanent failure"}). ` +
    `Its token/code changed, so it was re-enabled automatically and will start on the next cycle.`
  );
}

export async function fnUpsertBot(params) {
  let r = { code: 200, data: undefined };
  try {
    const data = params.request.body || {};
    if (!data.idapp || !data.token || !data.code || !data.name) {
      r.code = 400;
      r.data = {
        success: false,
        error: "Missing required fields: idapp, token, code, name",
      };
      return r;
    }
    if (!data.provider) {
      data.provider = "telegram";
    }
    // Sequelize upsert on SQLite may return created=null; infer from request.
    const requestedIdBot = data.idbot;
    const warning = await checkBotTokenAppVar(data);
    const revived = await reviveSystemDisabledBot(data);
    const { result, created } = await upsertBot(data);
    const wasCreated = typeof created === "boolean" ? created : !requestedIdBot;
    // Un cambio de configuración es una petición implícita de reintento: el hash de
    // config del manager reiniciará el worker, pero solo si el cooldown no lo bloquea.
    if (requestedIdBot) resetBotBackoff(params, requestedIdBot, "config_changed");
    r.data = { success: true, data: result, created: wasCreated };
    if (warning) r.data.warning = warning;
    if (revived) r.data.info = revived;
  } catch (error) {
    console.error("[fnUpsertBot] error:", error);
    r.data = { success: false, error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

export async function fnDeleteBot(params) {
  let r = { code: 200, data: undefined };
  try {
    const idbot = params.request.query?.idbot || params.request.body?.idbot;
    const success = await deleteBot(idbot);
    if (!success) {
      r.code = 404;
      r.data = { success: false, error: "Bot not found" };
    } else {
      r.data = { success: true };
    }
  } catch (error) {
    console.error("[fnDeleteBot] error:", error);
    r.data = { success: false, error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

export async function fnEnableDisableBot(params) {
  let r = { code: 200, data: undefined };
  try {
    const idbot = params.request.query?.idbot || params.request.body?.idbot;
    const { enabled } = params.request.body || {};
    if (enabled === undefined) {
      r.code = 400;
      r.data = { success: false, error: "Missing required field: enabled" };
      return r;
    }
    const shouldEnable = enabled === true || enabled === "true";
    let success = false;
    if (shouldEnable) {
      success = await enableBot(idbot);
    } else {
      // `by: "user"` es lo que impide que el sistema lo vuelva a encender solo: un
      // apagado deliberado del operador se respeta siempre.
      success = await disableBot(idbot, { by: "user" });
    }
    if (!success) {
      r.code = 404;
      r.data = { success: false, error: "Bot not found" };
    } else {
      // `Bot.update` en bloque no dispara el hook de invalidación, así que el reintento
      // inmediato hay que pedirlo aquí de forma explícita.
      if (shouldEnable) resetBotBackoff(params, idbot, "manual_enable");
      r.data = { success: true, enabled: shouldEnable };
    }
  } catch (error) {
    console.error("[fnEnableDisableBot] error:", error);
    r.data = { success: false, error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

/**
 * Historial de versiones de la configuración de un bot.
 *
 * Por defecto responde en modo ligero: el snapshot completo contiene el token del bot,
 * así que solo se devuelve cuando se pide `lightweight: false` explícitamente.
 */
export async function fnGetBotBackupByIdBot(params) {
  let r = { code: 200, data: undefined };
  try {
    const query = params.request.query || {};
    const body = params.request.body || {};
    const idbot = query.idbot || body.idbot;

    if (!idbot) {
      r.code = 400;
      r.data = { success: false, error: "Missing required field: idbot" };
      return r;
    }

    const rawLightweight =
      query.lightweight !== undefined ? query.lightweight : body.lightweight;
    const lightweight =
      rawLightweight === undefined
        ? true
        : rawLightweight === true || rawLightweight === "true";

    r.data = lightweight
      ? await getBotBackupByIdBotLightweight(idbot)
      : await getBotBackupByIdBot(idbot);
  } catch (error) {
    console.error("[fnGetBotBackupByIdBot] error:", error);
    r.data = { success: false, error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

/**
 * Rollback de un bot a una versión concreta del historial.
 */
export async function fnBotRestoreBackup(params) {
  let r = { code: 200, data: undefined };
  try {
    const idbackup =
      params?.request?.query?.idbackup || params?.request?.body?.idbackup;

    if (!idbackup) {
      r.code = 400;
      r.data = { success: false, error: "Missing required field: idbackup" };
      return r;
    }

    const result = await restoreBotFromBackup(idbackup);
    // Igual que en el upsert: restaurar es un cambio de configuración y por tanto una
    // petición implícita de reintento, así que el worker debe reiniciarse ya.
    resetBotBackoff(params, result.idbot, "config_changed");
    r.data = result;
  } catch (error) {
    console.error("[fnBotRestoreBackup] error:", error);
    r.data = { success: false, error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

export async function fnGetBotSkill(params) {
  let r = { code: 204, data: undefined };
  try {
    r.data = await readBotSkill();
    r.code = 200;
  } catch (error) {
    console.error("[fnGetBotSkill] error:", error);
    r.data = { error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

export async function fnGetBotProviderSkill(params) {
  let r = { code: 204, data: undefined };
  try {
    const provider = String(
      params.request.query?.provider ?? params.request.body?.provider ?? ""
    )
      .trim()
      .toLowerCase();

    if (!provider) {
      r.code = 400;
      r.data = {
        error:
          "Parameter 'provider' is required. Call get_bot_skill to list the documented providers.",
      };
      return r;
    }

    r.data = await readBotProviderSkill(provider);
    r.code = 200;
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[fnGetBotProviderSkill] error:", message);
    r.data = { error: message };
    if (/not found/i.test(message)) {
      r.code = 404;
    } else if (/invalid|denied/i.test(message)) {
      r.code = 400;
    } else {
      r.code = 500;
    }
  }
  return r;
}

export async function fnGetBotLogs(params) {
  let r = { code: 204, data: undefined };
  try {
    const query = params.request.query || {};
    const {
      idbot,
      idapp,
      event,
      environment,
      provider,
      error_type,
      trace_id,
      log_level,
      last_hours,
      limit,
      offset,
    } = query;

    if (!idbot) {
      r.code = 400;
      r.data = { success: false, error: "Missing required field: idbot" };
      return r;
    }

    const logs = await getBotLogs({
      idbot,
      idapp,
      event,
      environment,
      provider,
      error_type,
      trace_id,
      log_level: log_level !== undefined ? Number(log_level) : undefined,
      last_hours: last_hours !== undefined ? Number(last_hours) : 24,
      limit: limit !== undefined ? Number(limit) : 200,
      offset: offset !== undefined ? Number(offset) : 0,
    });

    r.data = { success: true, data: logs };
    r.code = 200;
  } catch (error) {
    console.error("[fnGetBotLogs] error:", error);
    r.data = { success: false, error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}
