import { Op } from "sequelize";
import { ApiClient, ApiKey, Application } from "./models.js";
import { EncryptPwd, CreateRandomPassword } from "../server/auth.js";
import { GenToken } from "../server/functionVars.js";
import { validatePasswordSecurity } from "./utils.js";
import dbsequelize from "./sequelize.js";


export const AuthorizedEnpointsClient = [];

// Agregar este método estático al modelo ApiClient (después de define)
export const ApiClientfindByIdOrUsername = async (filters = {}) => {
  const { idclient, username } = filters;

  const where = {};

  if (idclient && username) {
    // Si se pasan ambos, usar OR (busca por cualquiera de los dos)
    where[Op.or] = [{ idclient }, { username }];
  } else if (idclient) {
    where.idclient = idclient;
  } else if (username) {
    where.username = username;
  }
  // Si no se pasa ningún filtro, where queda vacío y se devuelve toda la tabla

  const registros = await ApiClient.findAll({
    where,
    attributes: { exclude: ["password"] },
    order: [["username", "ASC"]],
  });

  return registros;
};

/**
 * Inserta un nuevo cliente externo (ApiClient).
 * @param {object} data - Datos del cliente.
 * @returns {Promise<object>} - Resultado de la operación.
 */
export async function createApiClient(data, random_password = true) {
  try {
    let randompwd = CreateRandomPassword();
    let pwd;
    if (random_password) {
      pwd = randompwd.password;
      data.password = randompwd.encrypted;
    } else {
      pwd = data.password || randompwd.password;
      data.password = EncryptPwd(pwd);
    }

    const newClient = await ApiClient.create(data);
    let result = newClient.toJSON();
    result.password = undefined;

    return { client: result, password: pwd };
  } catch (err) {
    throw new Error(err.message);
  }
}

/**
 * Finds a valid API client by username and password.
 * Applies the following constraints:
 *  - enabled = true
 *  - current date is between startAt and endAt
 *  - excludes the "password" field from the result
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<object|null>} ApiClient data without password
 */
export async function loginApiClient(username, password) {
  const now = new Date();

  // 1. Buscar usuario con filtros
  const client = await ApiClient.findOne({
    where: {
      username,
      password: EncryptPwd(password),
      status: ["active", "initial"],
      startAt: { [Op.lte]: now },
      [Op.or]: [{ endAt: null }, { endAt: { [Op.gte]: now } }],
    },
    attributes: {
      exclude: ["password"],
    },
  });

  if (client) {
    let u = client.toJSON();
    // TODO: el modelo ApiClient no define el campo exp_time, por lo que siempre
    // cae en el fallback de 1 hora. Para respetar una vigencia configurable por
    // cliente se debe: (1) agregar exp_time al modelo en src/lib/db/models.js,
    // (2) ejecutar la migración correspondiente en la base de datos, y (3) exponer
    // el campo en las funciones de creación/actualización de ApiClient.
    const tokenSeconds =
      Number.isFinite(Number(u.exp_time)) && Number(u.exp_time) > 0
        ? Number(u.exp_time)
        : 60 * 60; // Una hora por defecto
    // Aqui se asigan los endpoints a los que el cliente tiene acceso (Son definidos desde el sistema y son fijos)
    u.Authorized = AuthorizedEnpointsClient;
    let token = GenToken({ apiclient: u }, tokenSeconds);
    let refresh_token = GenToken(
      {
        api: {
          username: u.username,
          status: u.status,
          email: u.email,
          now: Date.now(),
        },
      },
      tokenSeconds
    ); // Misma vigencia que el token principal

    await client.update({ last_login: new Date() });

    return {
      login: true,
      user: u,
      token: token,
      refresh_token: refresh_token,
      exp_seconds: tokenSeconds,
    };
  }

  return client;
}

/**
 * Actualiza la contraseña de un usuario con validación de la clave anterior
 * @param {string} username - Nombre de usuario
 * @param {string} oldPassword - Contraseña actual
 * @param {string} newPassword - Nueva contraseña
 * @returns {Promise<Object>} - Resultado de la operación
 */
export async function updateAPIClientPassword({
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
    const user = await ApiClient.findOne({
      where: {
        username,
        status: ["active", "initial"],
        startAt: { [Op.lte]: new Date() },
        [Op.or]: [{ endAt: null }, { endAt: { [Op.gte]: new Date() } }],
      },
      transaction,
    });

    if (!user) {
      throw new Error("APIClient not found or inactive");
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
    await user.update(
      {
        password: hashedNewPassword,
      },
      {
        transaction,
      }
    );

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

// Obtiene los datos del cliente y los apikey asociados.
export async function findApiClientTree(filters = {}) {
  const { username, status, email, enabled } = filters;

  const now = new Date();

  // ---------------------------
  // 1. Construcción de filtros dinámicos
  // ---------------------------
  const whereClient = {
    // Fechas válidas
    startAt: { [Op.lte]: now },
    [Op.or]: [{ endAt: { [Op.gte]: now } }, { endAt: null }],
  };

  if (username) whereClient.username = username;
  if (status) whereClient.status = status;
  if (email) whereClient.email = email;

  const whereKey = {
    // Fechas válidas
    startAt: { [Op.lte]: now },
    [Op.or]: [{ endAt: { [Op.gte]: now } }, { endAt: null }],
  };

  if (enabled !== undefined) whereKey.enabled = enabled;

  // ---------------------------
  // 2. Query con JOIN en árbol
  // ---------------------------
  const result = await ApiClient.findAll({
    where: whereClient,
    attributes: {
      exclude: ["password"],
    },
    include: [
      {
        model: ApiKey,
        required: false,
        where: whereKey,
        attributes: ["idkey", "enabled", "startAt", "endAt", "description"],
      },
    ],
    order: [
      ["username", "ASC"],
      [ApiKey, "startAt", "ASC"],
    ],
  });

  return result;
}


export const defaultApiClient = async () => {
  try {
    // Verificar si el usuario "apiuser" ya existe
    const existingUser = await ApiClient.findOne({
      where: { username: "apiuser" },
    });

    if (!existingUser) {
      // El usuario "apiuser" no existe, se realiza la inserción
      await ApiClient.create({
        username: "apiuser",
        password: EncryptPwd("apiuser"),
        first_name: "api",
        last_name: "user",
        email: "apiuser@example.com",
        ctrl: {},
      });
    }

    return true;
    //console.log(' defaultUser >>>>>> ', super_role);
  } catch (error) {
    console.error("Example error:", error);
    return false;
  }
};
