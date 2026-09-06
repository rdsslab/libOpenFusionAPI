import { getUserPasswordTokenFromRequest } from "../../../../auth.js";
import {
  createUser,
  login,
  getAllUsers,
  updateUserPassword,
  resetUserPassword,
  updateUser,
  deleteUser,
  createPasswordRecovery,
  consumePasswordRecovery,
  linkTelegramChat,
  cleanupExpiredRecoveryTokens,
  updatePasswordRecoveryChannel,
  getRecoveryChannelConfig,
} from "../../../../../db/user.js";
import {
  isRateLimited,
  markRecoveryAttempt,
  deliverOtpByEmail,
  deliverOtpByTelegram,
} from "./recoveryService.js";

export async function fnCreateUser(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await createUser(params?.request?.body);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}



export async function fnLogin(params) {
  let r = { code: 204, data: undefined };
  try {
    let auth_data = getUserPasswordTokenFromRequest(params.request);
    const xForwardedProto = params?.request?.headers?.["x-forwarded-proto"];
    const isHttpsRequest =
      params?.request?.protocol === "https" ||
      (typeof xForwardedProto === "string" && xForwardedProto.includes("https"));

    let user = await login(auth_data.Basic.username, auth_data.Basic.password);

    // Establecer una cookie básica
    params.reply.setCookie("OFAPI_TOKEN", "", {
      path: "/",
      httpOnly: true,
      secure: isHttpsRequest,
      sameSite: "Strict",
      maxAge: 5,
    });

    if (user.login) {

      let aut = `Bearer ${user.token}`;
      params.reply.header("Authorization", aut);

      params.reply.setCookie("OFAPI_TOKEN", user.token, {
        path: "/",
        httpOnly: true,
        secure: isHttpsRequest,
        sameSite: "Lax",
        maxAge: user.exp_seconds || 3600,
      });

      r.data = user;
      r.code = 200;
    } else {
      r.data = user;
      r.code = 401;
    }
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnLogout(params) {
  let r = { data: undefined, code: 204 };
  try {
    // TODO: ver la forma de hacer un logout correctamente e invalide el token
    params.reply.set("OFAPI_TOKEN", undefined);

    r.data = {
      logout: true,
    };
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetUsersList(params) {
  let r = { code: 204, data: undefined };
  try {
    let us = await getAllUsers();

    us = us.map((u) => {
      return {
        iduser: u.iduser,
        enabled: u.enabled,
        username: u.username,
        name: u.last_name + " " + u.first_name,
        email: u.email,
        ctrl: u.ctrl
          ? JSON.parse(JSON.stringify(u.ctrl))
          : { as_admin: false, env: {} },
      };
    });

    r.data = us;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnUpdateUserPassword(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await updateUserPassword(params?.request?.body);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnResetUserPassword(params) {
  let r = { data: undefined, code: 204 };
  try {
    const iduser = params?.request?.body?.iduser || params?.request?.query?.iduser;
    const newPassword = params?.request?.body?.newPassword || params?.request?.query?.newPassword;
    if (!iduser || !newPassword) {
      r.data = { error: "iduser and newPassword are required." };
      r.code = 400;
      return r;
    }

    let data = await resetUserPassword(iduser, newPassword);
    if (data.success) {
      r.data = data;
      r.code = 200;
    } else {
      r.data = data;
      r.code = 400;
    }
  } catch (error) {
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

export async function fnUpdateUser(params) {
  let r = { data: undefined, code: 204 };
  try {
    const iduser = params?.request?.body?.iduser || params?.request?.query?.iduser;
    if (!iduser) {
      r.data = { error: "iduser is required." };
      r.code = 400;
      return r;
    }

    let data = await updateUser(iduser, params?.request?.body);
    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

export async function fnDeleteUser(params) {
  let r = { data: undefined, code: 204 };
  try {
    const iduser = params?.request?.body?.iduser || params?.request?.query?.iduser;
    if (!iduser) {
      r.data = { error: "iduser is required." };
      r.code = 400;
      return r;
    }

    let deleted = await deleteUser(iduser);
    if (deleted) {
      r.data = { success: true, message: "User deleted." };
      r.code = 200;
    } else {
      r.data = { success: false, message: "User not found." };
      r.code = 404;
    }
  } catch (error) {
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recuperación de contraseña (OTP por email / telegram)
// ─────────────────────────────────────────────────────────────────────────────

const RECOVERY_GENERIC_MESSAGE =
  "If the account exists and the selected channel is available, you will receive a verification code.";

const DEFAULT_RECOVERY_ENVIRONMENT = "prd";

const extractClientIp = (request) => {
  const headers = request?.headers || {};
  return (
    headers["x-forwarded-for"] || headers["x-real-ip"] || request?.socket?.remoteAddress || ""
  );
};

/**
 * GET /user/recovery/options
 * Devuelve los canales de recuperación globalmente habilitados (config de la
 * app system), sin información por-usuario para no filtrar la existencia de
 * cuentas. La GUI oculta los canales deshabilitados.
 */
export async function fnRecoveryOptions(params) {
  let r = { data: undefined, code: 204 };
  try {
    const environment =
      params?.request?.query?.environment || DEFAULT_RECOVERY_ENVIRONMENT;
    const config = await getRecoveryChannelConfig(environment);
    r.data = {
      email: { enabled: config.email.enabled },
      telegram: { enabled: config.telegram.enabled },
      environment,
    };
    r.code = 200;
  } catch (error) {
    console.error("[fnRecoveryOptions] error:", error.message);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

/**
 * POST /user/forgotpassword
 * Body: { username, channel?: "email"|"telegram", environment?: "dev"|"qa"|"prd" }
 *
 * Genera un OTP de 6 dígitos y lo entrega por el canal pedido. Si el canal
 * pedido no es viable (no hay email en la cuenta, no hay Telegram vinculado),
 * cae al otro canal; si falla la entrega, reintenta por el otro canal. Nunca
 * envía por ambos. La respuesta es genérica y siempre 200 para no revelar la
 * existencia de la cuenta ni el resultado del envío.
 */
export async function fnForgotPassword(params) {
  let r = { data: undefined, code: 204 };

  try {
    const body = params?.request?.body || {};
    const username = String(body.username || "").trim();
    if (!username) {
      r.data = { error: "username field is required." };
      r.code = 400;
      return r;
    }

    const ip = extractClientIp(params.request);
    if (isRateLimited(ip, username)) {
      r.data = { success: true, message: RECOVERY_GENERIC_MESSAGE, channel: null };
      r.code = 200;
      return r;
    }
    markRecoveryAttempt(ip, username);

    const environment =
      String(body.environment || "").trim() ||
      params?.request?.query?.environment ||
      DEFAULT_RECOVERY_ENVIRONMENT;
    const config = await getRecoveryChannelConfig(environment);

    const requested = String(body.channel || "").trim().toLowerCase();
    const created = await createPasswordRecovery({
      username,
      channel: requested === "telegram" ? "telegram" : "email",
    });

    if (!created.found) {
      r.data = { success: true, message: RECOVERY_GENERIC_MESSAGE, channel: null };
      r.code = 200;
      return r;
    }

    const { otp, user, idrecovery } = created;
    const emailViable = config.email.enabled && !!user.email;
    const telegramViable =
      config.telegram.enabled && !!user.custom_data?.telegram_chat_id;

    let selected =
      requested === "telegram" ? "telegram" : emailViable ? "email" : "telegram";
    if (selected === "telegram" && !telegramViable && emailViable) selected = "email";
    if (selected === "email" && !emailViable && telegramViable) selected = "telegram";
    if ((selected === "email" && !emailViable) || (selected === "telegram" && !telegramViable)) {
      selected = null;
    }

    let delivery = null;
    if (selected === "email") {
      delivery = await deliverOtpByEmail({
        transport: config.email.transport,
        from: config.email.from,
        to: user.email,
        otp,
        username,
      });
    } else if (selected === "telegram") {
      delivery = await deliverOtpByTelegram({
        token: config.telegram.token,
        chatId: user.custom_data.telegram_chat_id,
        otp,
        username,
      });
    }

    if (!delivery || !delivery.ok) {
      // Fallback al canal alternativo si está disponible.
      if (selected === "email" && telegramViable) {
        delivery = await deliverOtpByTelegram({
          token: config.telegram.token,
          chatId: user.custom_data.telegram_chat_id,
          otp,
          username,
        });
        if (delivery?.ok) selected = "telegram";
        else selected = null;
      } else if (selected === "telegram" && emailViable) {
        delivery = await deliverOtpByEmail({
          transport: config.email.transport,
          from: config.email.from,
          to: user.email,
          otp,
          username,
        });
        if (delivery?.ok) selected = "email";
        else selected = null;
      } else {
        selected = null;
      }
    }

    if (selected) {
      await updatePasswordRecoveryChannel(idrecovery, selected);
      console.log(
        `[fnForgotPassword] OTP entregado por ${selected} para ${username} (ip ${ip})`,
      );
    }

    r.data = { success: true, message: RECOVERY_GENERIC_MESSAGE, channel: selected };
    r.code = 200;
  } catch (error) {
    console.error("[fnForgotPassword] error:", error.message);
    r.data = { success: true, message: RECOVERY_GENERIC_MESSAGE, channel: null };
    r.code = 200;
  }
  return r;
}

/**
 * POST /user/resetpassword/confirm
 * Body: { username, otp, newPassword }
 * Canjea el OTP (válido, no usado, vigente, máx. intentos) y cambia la clave.
 */
export async function fnResetPasswordConfirm(params) {
  let r = { data: undefined, code: 204 };
  try {
    const body = params?.request?.body || {};
    const username = String(body.username || "").trim();
    const otp = String(body.otp || "").trim();
    const newPassword = String(body.newPassword || "");

    if (!username || !otp || !newPassword) {
      r.data = { error: "username, otp and newPassword are required." };
      r.code = 400;
      return r;
    }

    const result = await consumePasswordRecovery({ username, otp, newPassword });
    if (result.success) {
      r.data = result;
      r.code = 200;
    } else {
      r.data = { success: false, error: result.error };
      if (result.code === "WEAK_PASSWORD") {
        r.code = 400;
      } else {
        r.code = 400;
      }
    }
  } catch (error) {
    console.error("[fnResetPasswordConfirm] error:", error.message);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

/**
 * POST /user/linktelegram
 * Body: { chat_id }
 * Vincular el chat de Telegram a la cuenta autenticada (guarda el chat_id en
 * custom_data.telegram_chat_id). Solo el propio usuario puede vincular su chat.
 */
export async function fnLinkTelegram(params) {
  let r = { data: undefined, code: 204 };
  try {
    const adminUser = params?.request?.openfusionapi?.user?.admin;
    const iduser = adminUser?.iduser;
    if (!iduser) {
      r.data = { error: "Authenticated user is required." };
      r.code = 401;
      return r;
    }

    const chatId = params?.request?.body?.chat_id ?? params?.request?.query?.chat_id;
    if (chatId === undefined || chatId === null || chatId === "") {
      r.data = { error: "chat_id is required." };
      r.code = 400;
      return r;
    }

    const result = await linkTelegramChat(iduser, chatId);
    if (result.success) {
      r.data = result;
      r.code = 200;
    } else {
      r.data = result;
      r.code = 400;
    }
  } catch (error) {
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

/**
 * POST /user/recoverycleanup
 * Elimina las solicitudes de recuperación expiradas/consumidas (mantenimiento).
 * Se ejecuta por interval task; por ser mantenimiento interno, access Local.
 */
export async function fnCleanupRecoveryTokens(params) {
  let r = { data: undefined, code: 204 };
  try {
    const result = await cleanupExpiredRecoveryTokens();
    r.data = result;
    r.code = 200;
  } catch (error) {
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}
