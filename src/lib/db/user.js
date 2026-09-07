import { customError } from "../server/utils.js";
import { EncryptPwd } from "../server/auth.js";
import { GenToken, JWTKEY } from "../server/functionVars.js";
import { validatePasswordSecurity } from "./utils.js";
import { validateCtrlSchema, fullAccessCtrl, emptyCtrl } from "../server/permissions.js";
import { User, PasswordRecovery } from "./models.js";
import dbsequelize from "./sequelize.js";
import { Op } from "sequelize";
import { createHmac, randomInt } from "crypto";
import { getAppVarsByIdApp } from "./appvars.js";

const DEFAULT_TOKEN_SECONDS = 3600; // 1 hora
const REFRESH_TOKEN_SECONDS = 3600; // 1 hora

// Recuperación de contraseña (OTP)
const SYSTEM_IDAPP = "cfcd2084-95d5-65ef-66e7-dff9f98764da";
const OTP_TTL_MS = 30 * 60 * 1000; // 30 minutos
const OTP_MAX_ATTEMPTS = 5;
const VAR_SMTP_TRANSPORT = "$_VAR_EMAIL_TRANSPORT";
const VAR_EMAIL_FROM = "$_VAR_EMAIL_FROM";
const VAR_TELEGRAM_TOKEN = "$_VAR_TELEGRAM_TOKEN";
const FLAG_EMAIL = "$_VAR_RESET_EMAIL_ENABLED";
const FLAG_TELEGRAM = "$_VAR_RESET_TELEGRAM_ENABLED";

const findVar = (rows, name, environment) => {
  if (!Array.isArray(rows)) return undefined;
  const env = String(environment || "").trim().toLowerCase();
  return rows.find(
    (row) =>
      row?.name === name &&
      String(row?.environment || "").trim().toLowerCase() === env,
  );
};

const isFlagEnabled = (rows, name, environment) => {
  const row = findVar(rows, name, environment);
  if (!row || row.value === undefined || row.value === null) return true;
  if (typeof row.value === "boolean") return row.value;
  const s = String(row.value).trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(s);
};

const parseTransport = (value) => {
  if (!value || value === "") return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
};

const transportConfigured = (transport) => {
  return (
    !!transport &&
    typeof transport === "object" &&
    typeof transport.host === "string" &&
    transport.host.trim() !== ""
  );
};

const getRecoveryVars = async (environment) => {
  const rows = await getAppVarsByIdApp(SYSTEM_IDAPP);
  const targetEnv = String(environment || "prd").trim().toLowerCase() || "prd";
  const transport = parseTransport(findVar(rows, VAR_SMTP_TRANSPORT, targetEnv)?.value);
  const telegramTokenRow = findVar(rows, VAR_TELEGRAM_TOKEN, targetEnv)?.value;
  const telegramToken =
    typeof telegramTokenRow === "string" && telegramTokenRow.trim() !== ""
      ? telegramTokenRow.trim()
      : null;

  return {
    rows,
    targetEnv,
    transport,
    telegramToken,
  };
};

/**
 * Resuelve la configuración de los canales de recuperación para un environment.
 * Un canal está habilitado cuando su flag lo permite Y su configuración es
 * válida: email requiere transporte SMTP con host, telegram requiere token.
 * La ausencia del flag se interpreta como habilitado por defecto.
 */
export async function getRecoveryChannelConfig(environment = "prd") {
  const { rows, targetEnv, transport, telegramToken } = await getRecoveryVars(environment);

  const emailEnabled =
    isFlagEnabled(rows, FLAG_EMAIL, targetEnv) && transportConfigured(transport);

  const telegramEnabled =
    isFlagEnabled(rows, FLAG_TELEGRAM, targetEnv) && !!telegramToken;

  const emailFromRow = findVar(rows, VAR_EMAIL_FROM, targetEnv);

  return {
    email: {
      enabled: emailEnabled,
      transport: emailEnabled ? transport : null,
      from:
        emailFromRow?.value ||
        transport?.from ||
        transport?.auth?.user ||
        null,
    },
    telegram: {
      enabled: telegramEnabled,
      token: telegramEnabled ? telegramToken : null,
    },
  };
}

export const hashOtp = (otp) =>
  createHmac("sha256", process.env.OTP_HASH_SECRET || `${JWTKEY}::otp`)
    .update(String(otp))
    .digest("hex");

export async function cleanupExpiredRecoveryTokens() {
  const before = new Date();
  const deleted = await PasswordRecovery.destroy({
    where: {
      [Op.or]: [{ used: true }, { expires_at: { [Op.lt]: before } }],
    },
  });
  return { deleted };
}

export const upsertUser = async (
  /** @type {import("sequelize").Optional<any, string>} */ userData
) => {
  try {
    const [user, created] = await User.upsert(userData);
    return { user, created };
  } catch (error) {
    console.error("Error performing UPSERT on user:", error);
    throw error;
  }
};

// READ
export const getUserById = async (
  /** @type {import("sequelize").Identifier | undefined} */ userId
) => {
  try {
    const user = await User.findByPk(userId);
    return user;
  } catch (error) {
    console.error("Error retrieving user:", error);
    throw error;
  }
};

export const getAllUsers = async () => {
  try {
    const users = await User.findAll();
    return users;
  } catch (error) {
    console.error("Error retrieving users:", error);
    throw error;
  }
};

// DELETE
export const deleteUser = async (
  /** @type {import("sequelize").Identifier | undefined} */ userId
) => {
  try {
    const user = await User.findByPk(userId);
    if (user) {
      await PasswordRecovery.destroy({ where: { iduser: userId } });
      await user.destroy();
      return true; // Deletion successful
    }
    return false; // User not found
  } catch (error) {
    console.error("Error deleting user:", error);
    throw error;
  }
};

/**
 * Actualiza un usuario existente por iduser.
 * Si se provee password, se hashea automáticamente.
 * Nunca permite cambiar el iduser ni el username.
 *
 * @param {number} iduser - ID del usuario a actualizar.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object>} Usuario actualizado sin password.
 */
export async function updateUser(iduser, data) {
  try {
    if (!iduser) throw new Error("iduser is required.");

    const user = await User.findByPk(iduser);
    if (!user) throw new Error("User not found.");

    // Proteger campos inmutables
    delete data.iduser;
    delete data.username;
    delete data.createdAt;
    delete data.updatedAt;

    // Validar ctrl si se provee
    if (data.ctrl !== undefined) {
      const ctrlCheck = validateCtrlSchema(data.ctrl);
      if (!ctrlCheck.valid) {
        throw new Error("Invalid ctrl: " + ctrlCheck.errors.join("; "));
      }
    }

    // Hashear password si se provee
    if (data.password) {
      data.password = EncryptPwd(data.password);
    }

    await user.update(data);

    let result = user.toJSON();
    result.password = undefined;
    return result;
  } catch (error) {
    throw new Error(error.message);
  }
}

/**
 * @param {string} username
 * @param {string} password
 */
export const getUserByCredentials = async (username, password) => {
  let dataUser = await User.findOne({
    where: { username: username, password: password },
    attributes: [
      "iduser",
      "enabled",
      "username",
      "first_name",
      "last_name",
      "email",
      "ctrl",
      "exp_time",
    ],
  });

  return dataUser;
};

export const defaultUser = async () => {
  try {
    // Verificar si el usuario "admin" ya existe
    const existingUser = await User.findOne({
      where: { username: "superopenfusionapi" },
    });

    if (!existingUser) {
      // El usuario "superopenfusionapi" no existe, se realiza la inserción
      await User.create({
        username: "superopenfusionapi",
        password: EncryptPwd("superopenfusionapi"),
        first_name: "super",
        last_name: "user",
        email: "superopenfusionapi@example.com",
        ctrl: fullAccessCtrl(),
      });
    }

    const existingClient = await User.findOne({
      where: { username: "client_api" },
    });

    if (!existingClient) {
      // El usuario "superopenfusionapi" no existe, se realiza la inserción
      await User.create({
        username: "client_api",
        password: EncryptPwd("1234567890"),
        first_name: "client",
        last_name: "api",
        email: "superopenfusionapi@example.com",
        ctrl: fullAccessCtrl(),
      });
    }

    // Verificar si el usuario "admin" ya existe
    const existingUserAdmin = await User.findOne({
      where: { username: "admin" },
    });

    if (!existingUserAdmin) {
      // El usuario "demouser" no existe, se realiza la inserción
      await User.create({
        username: "admin",
        password: EncryptPwd("admin@admin"),
        first_name: "admin",
        last_name: "user",
        email: "admin@example.com",
        ctrl: fullAccessCtrl(),
      });
    }

    // Verificar si el usuario "demo" ya existe
    const existingUserDemo = await User.findOne({
      where: { username: "demo" },
    });

    if (!existingUserDemo) {
      // El usuario "demo" no existe, se realiza la inserción
      await User.create({
        username: "demo",
        password: EncryptPwd("demo1234"),
        first_name: "demo",
        last_name: "user",
        email: "demo@example.com",
        ctrl: {
          as_admin: false,
          env: {
            dev: {
              users:      { read: true, create: false, edit: false, delete: false },
              apiclients: { read: true, create: false, edit: false, delete: false },
              endpoints:  { read: true, create: false, edit: false, delete: false },
              apps:       { read: true },
              appvars:    { read: true },
              bots:       { read: true },
              logs:       { read: true },
            },
            qa: {},
            prd: {},
          },
        },
      });
    }

    return true;
    //console.log(' defaultUser >>>>>> ', super_role);
  } catch (error) {
    console.error("Example error:", error);
    return false;
  }
};

/**
 * @param {string} username
 * @param {string} password
 */
export async function login(username, password) {
  try {
    let user = await User.findOne({
      where: {
        username: username || "",
        password: EncryptPwd(password || ""),
        enabled: true,
        start_date: { [Op.lte]: new Date() },
        end_date: { [Op.gte]: new Date() },
      },
      attributes: [
        "iduser",
        "enabled",
        "username",
        "first_name",
        "last_name",
        "email",
        "ctrl",
        "exp_time",
        "change_password",
      ],
    });

    if (user) {
      let u = user.toJSON();
      const tokenSeconds =
        Number.isFinite(Number(u.exp_time)) && Number(u.exp_time) > 0
          ? Number(u.exp_time)
          : DEFAULT_TOKEN_SECONDS;

      let token = GenToken({ admin: u }, tokenSeconds);
      let refresh_token = GenToken(
        {
          api: {
            username: u.username,
            iduser: u.iduser,
            email: u.email,
            now: Date.now(),
          },
        },
        REFRESH_TOKEN_SECONDS
      ); // Válido por una hora

      await user.update({ last_login: new Date() });

      return {
        login: true,
        user: u,
        token: token,
        refresh_token: refresh_token,
        exp_seconds: tokenSeconds,
      };
    } else {
      return customError(2);
    }
  } catch (error) {
    return error;
  }
}

/**
 * Actualiza la contraseña de un usuario con validación de la clave anterior
 * @param {string} username - Nombre de usuario
 * @param {string} oldPassword - Contraseña actual
 * @param {string} newPassword - Nueva contraseña
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function updateUserPassword({
  username,
  oldPassword,
  newPassword,
}) {
  const transaction = await dbsequelize.transaction();

  try {
    // 1. Validar parámetros de entrada
    if (!username || !oldPassword || !newPassword) {
      throw new Error(
        "All parameters are required: username, oldPassword, newPassword"
      );
    }

    if (oldPassword === newPassword) {
      throw new Error("The new password must be different from the old one.");
    }

    let validationSecurity = validatePasswordSecurity(newPassword);
    if (!validationSecurity.isValid) {
      throw new Error(validationSecurity.errors[0]);
    }

    // 2. Buscar usuario y verificar contraseña actual
    const user = await User.findOne({
      where: {
        username,
        enabled: true,
        start_date: { [Op.lte]: new Date() },
        end_date: { [Op.gte]: new Date() },
      },
      transaction,
    });

    if (!user) {
      throw new Error("User not found or inactive");
    }

    const oldPasswordHash = EncryptPwd(oldPassword || "");
    // 3. Verificar contraseña actual
    const isCurrentPasswordValid = oldPasswordHash == user.password;

    if (!isCurrentPasswordValid) {
      throw new Error("The current password is incorrect.");
    }

    // 4. Hashear nueva contraseña
    const hashedNewPassword = EncryptPwd(newPassword);

    // 5. Actualizar contraseña y desactivar la marca de cambio obligatorio
    const [affectedRows] = await User.update(
      {
        password: hashedNewPassword,
        change_password: false,
      },
      {
        where: { username },
        transaction,
      }
    );

    if (affectedRows === 0) {
      throw new Error("The password could not be updated.");
    }

    // 6. Confirmar transacción
    await transaction.commit();

    return {
      success: true,
      message: "Password successfully updated",
      username: user.username,
      updatedAt: new Date(),
    };
  } catch (error) {
    // 7. Revertir transacción en caso de error
    await transaction.rollback();

    console.error("Password update error:", error.message);

    return {
      success: false,
      error: error.message,
      username,
    };
  }
}

/**
 * Inserta un nuevo usuario en la tabla User.
 * @param {object} data - Datos del nuevo usuario.
 * @returns {Promise<object>} - Resultado de la operación.
 */
export async function createUser(data) {
  try {
    // Validaciones mínimas
    if (!data.username) {
      throw new Error("El campo 'username' es obligatorio.");
    }

    // Validar ctrl si se provee
    if (data.ctrl !== undefined && data.ctrl !== null) {
      const ctrlCheck = validateCtrlSchema(data.ctrl);
      if (!ctrlCheck.valid) {
        throw new Error("Invalid ctrl: " + ctrlCheck.errors.join("; "));
      }
    }

    // Crear usuario
    const newUser = await User.create({
      username: data.username,
      password: data.password ? EncryptPwd(data.password) : null,
      first_name: data.first_name || null,
      last_name: data.last_name || null,
      email: data.email || null,
      enabled: data.enabled ?? true,
      ctrl: data.ctrl || {},
      change_password: data.change_password ?? true,
      start_date: data.start_date || "2000-01-01",
      end_date: data.end_date || "9999-12-31",
      exp_time: data.exp_time ?? 3600,
    });

    // Retornar estructura limpia
    return {
      success: true,
      message: "Usuario creado correctamente.",
      iduser: newUser.iduser,
      username: newUser.username,
    };
  } catch (err) {
    // Error de username duplicado (unique constraint)
    if (err.name === "SequelizeUniqueConstraintError") {
      return {
        success: false,
        message: `User '${data.username}' already exists.`,
        error: err.errors?.map((e) => e.message) || err.message,
      };
    }

    // Otros errores
    return {
      success: false,
      message: "Error while creating the user.",
      error: err.message,
    };
  }
}

/**
 * Resetea la contraseña de un usuario interno sin validar la clave anterior.
 * A diferencia de updateUserPassword (self-service), esta operación la realiza
 * un administrador: asigna una clave temporal y marca change_password = true
 * para que el usuario deba cambiarla en su próximo ingreso.
 *
 * @param {number} iduser - ID del usuario.
 * @param {string} newPassword - Clave temporal que cumpla la política de seguridad.
 * @returns {Promise<object>} { success, username, message } o { success:false, error }.
 */
export async function resetUserPassword(iduser, newPassword) {
  if (!iduser || !newPassword) {
    return {
      success: false,
      error: "The 'iduser' and 'newPassword' parameters are required.",
    };
  }

  const validationSecurity = validatePasswordSecurity(newPassword);
  if (!validationSecurity.isValid) {
    return { success: false, error: validationSecurity.errors[0] };
  }

  const user = await User.findByPk(iduser);
  if (!user) {
    return { success: false, error: "User not found." };
  }

  await user.update({
    password: EncryptPwd(newPassword),
    change_password: true,
  });

  return {
    success: true,
    message: "Password reset. The user must change it on their next login.",
    username: user.username,
    iduser: user.iduser,
  };
}

/**
 * Localiza un usuario activo y vigente por username.
 * Devuelve null si no existe, está deshabilitado o fuera de su rango de validez.
 */
async function findActiveUserByUsername(username) {
  const clean = String(username || "").trim();
  if (!clean) return null;

  return User.findOne({
    where: {
      username: clean,
      enabled: true,
      start_date: { [Op.lte]: new Date() },
      end_date: { [Op.gte]: new Date() },
    },
  });
}

/**
 * Genera una solicitud de recuperación (OTP de 6 dígitos) para un usuario.
 * Invalida cualquier OTP previo pendiente del usuario. Nunca devuelve datos del
 * usuario si la cuenta no existe (found: false) para no filtrar la existencia.
 *
 * @param {object} input - { username, channel: "email"|"telegram", ttlMs }
 * @returns {Promise<object>} { found, otp?, user? } con user = { iduser, username, email, custom_data }
 */
export async function createPasswordRecovery({
  username,
  channel,
  ttlMs = OTP_TTL_MS,
}) {
  const user = await findActiveUserByUsername(username);
  if (!user) {
    return { found: false };
  }

  await PasswordRecovery.update(
    { used: true },
    { where: { iduser: user.iduser, used: false } },
  );

  const otp = String(randomInt(100000, 999999));
  const row = await PasswordRecovery.create({
    iduser: user.iduser,
    otp_hash: hashOtp(otp),
    channel: String(channel || "").trim() || "email",
    expires_at: new Date(Date.now() + ttlMs),
  });

  return {
    found: true,
    idrecovery: row.idrecovery,
    otp,
    user: {
      iduser: user.iduser,
      username: user.username,
      email: user.email,
      custom_data: user.custom_data || {},
    },
  };
}

/**
 * Actualiza el canal registrado de una solicitud de recuperación (informativo).
 * Se usa cuando la entrega cae en el canal alternativo de respaldo.
 */
export async function updatePasswordRecoveryChannel(idrecovery, channel) {
  if (!idrecovery) return false;
  const [updated] = await PasswordRecovery.update(
    { channel: String(channel || "").trim() || "email" },
    { where: { idrecovery } },
  );
  return updated > 0;
}

/**
 * Consume un OTP y, si es válido, cambia la contraseña del usuario.
 * El OTP es de un solo uso, expira y admite un número limitado de intentos.
 *
 * @param {object} input - { username, otp, newPassword }
 * @returns {Promise<object>} { success, message?, error? }
 */
export async function consumePasswordRecovery({ username, otp, newPassword }) {
  const transaction = await dbsequelize.transaction();

  try {
    const user = await findActiveUserByUsername(username);
    if (!user) {
      await transaction.rollback();
      return { success: false, error: "INVALID_OTP" };
    }

    const row = await PasswordRecovery.findOne({
      where: { iduser: user.iduser, used: false, expires_at: { [Op.gt]: new Date() } },
      order: [["createdAt", "DESC"]],
      transaction,
    });

    if (!row) {
      await transaction.rollback();
      return { success: false, error: "INVALID_OTP" };
    }

    if (row.otp_hash !== hashOtp(otp)) {
      const attempts = Number(row.attempts || 0) + 1;
      await row.update({ attempts }, { transaction });
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await row.update({ used: true }, { transaction });
      }
      await transaction.commit();
      return {
        success: false,
        error: "INVALID_OTP",
        attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - attempts),
      };
    }

    const validationSecurity = validatePasswordSecurity(newPassword);
    if (!validationSecurity.isValid) {
      await transaction.rollback();
      return { success: false, error: validationSecurity.errors[0], code: "WEAK_PASSWORD" };
    }

    await user.update(
      { password: EncryptPwd(newPassword), change_password: false },
      { transaction },
    );
    await row.update({ used: true }, { transaction });

    await transaction.commit();

    return {
      success: true,
      message: "Password successfully updated",
      username: user.username,
      updatedAt: new Date(),
    };
  } catch (error) {
    await transaction.rollback();
    console.error("Password recovery consume error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Vincula el chat_id de Telegram del usuario almacenándolo en su custom_data
 * (sin modificar el modelo). El iduser corresponde al usuario autenticado.
 */
export async function linkTelegramChat(iduser, chatId) {
  const clean = String(chatId || "").trim();
  if (!/^-?\d+$/.test(clean)) {
    return { success: false, error: "Invalid chat_id." };
  }

  const user = await User.findByPk(iduser);
  if (!user) {
    return { success: false, error: "User not found." };
  }

  const customData = { ...(user.custom_data || {}) };
  customData.telegram_chat_id = clean;

  const updated = await updateUser(iduser, { custom_data: customData });
  return {
    success: true,
    message: "Telegram chat linked.",
    user: updated,
  };
}
