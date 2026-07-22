import { customError } from "../server/utils.js";
import { EncryptPwd } from "../server/auth.js";
import { GenToken } from "../server/functionVars.js";
import { validatePasswordSecurity } from "./utils.js";
import { User } from "./models.js";
import dbsequelize from "./sequelize.js";
import { Op } from "sequelize";

const DEFAULT_TOKEN_SECONDS = 3600; // 1 hora
const REFRESH_TOKEN_SECONDS = 3600; // 1 hora

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
        ctrl: {},
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
        ctrl: {},
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
        ctrl: {
          as_admin: true,
          env: {
            dev: {
              app: {
                create: true,
                delete: true,
                edit: true,
                read: true,
              },
            },
            qa: {
              app: {
                create: true,
                delete: true,
                edit: true,
                read: true,
              },
            },
            prd: {
              app: {
                create: true,
                delete: true,
                edit: true,
                read: true,
              },
            },
          },
        },
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
          as_admin: true,
          env: {
            dev: {
              app: {
                create: true,
                delete: true,
                edit: true,
                read: true,
              },
            },
            qa: {
              app: {},
            },
            prd: {
              app: {},
            },
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

    // 5. Actualizar contraseña
    const [affectedRows] = await User.update(
      {
        password: hashedNewPassword,
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

    // Crear usuario
    const newUser = await User.create({
      username: data.username,
      password: data.password || null,
      first_name: data.first_name || null,
      last_name: data.last_name || null,
      email: data.email || null,
      enabled: data.enabled ?? true,
      ctrl: data.ctrl || {},
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
        message: `El usuario '${data.username}' ya existe.`,
        error: err.errors?.map((e) => e.message) || err.message,
      };
    }

    // Otros errores
    return {
      success: false,
      message: "Error al crear el usuario.",
      error: err.message,
    };
  }
}
