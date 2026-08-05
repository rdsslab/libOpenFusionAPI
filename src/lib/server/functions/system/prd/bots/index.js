import {
  getBotCatalog,
  getBotById,
  upsertBot,
  deleteBot,
  enableBot,
  disableBot,
} from "../../../../../db/bot.js";
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
    const { result, created } = await upsertBot(data);
    const wasCreated = typeof created === "boolean" ? created : !requestedIdBot;
    r.data = { success: true, data: result, created: wasCreated };
    if (warning) r.data.warning = warning;
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
    let success = false;
    if (enabled === true || enabled === "true") {
      success = await enableBot(idbot);
    } else {
      success = await disableBot(idbot);
    }
    if (!success) {
      r.code = 404;
      r.data = { success: false, error: "Bot not found" };
    } else {
      r.data = { success: true, enabled: Boolean(enabled) };
    }
  } catch (error) {
    console.error("[fnEnableDisableBot] error:", error);
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
