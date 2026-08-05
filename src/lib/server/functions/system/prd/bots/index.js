import {
  getBotCatalog,
  getBotById,
  upsertBot,
  deleteBot,
  enableBot,
  disableBot,
} from "../../../../../db/bot.js";

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
    const { result, created } = await upsertBot(data);
    const wasCreated = typeof created === "boolean" ? created : !requestedIdBot;
    r.data = { success: true, data: result, created: wasCreated };
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
