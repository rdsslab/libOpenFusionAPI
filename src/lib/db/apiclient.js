import { Op } from "sequelize";
import { ApiClient, ApiKey, Application } from "./models.js";
import { EncryptPwd, CreateRandomPassword, passwordMatches } from "../server/auth.js";
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
 * Hace UPSERT de un ApiClient tal cual viene en los datos.
 *
 * A diferencia de createApiClient, NO genera ni hashea la contraseña: se asume
 * que `data.password` ya viene hasheada (p.ej. proveniente de un backup). Usar
 * createApiClient para el alta normal de un cliente.
 *
 * @param {object} data - Datos del cliente (password ya hasheada si viene).
 * @returns {Promise<{ result: any, created: boolean }>}
 */
export const upsertApiClient = async (data) => {
  try {
    const [result, created] = await ApiClient.upsert(data, { returning: true });
    return { result, created };
  } catch (error) {
    console.error("Error performing upsert on ApiClient:", error, {
      idclient: data?.idclient,
      username: data?.username,
    });
    throw error;
  }
};

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
      status: ["active", "initial"],
      startAt: { [Op.lte]: now },
      [Op.or]: [{ endAt: null }, { endAt: { [Op.gte]: now } }],
    },
  });

  if (!client) {
    return null;
  }

  const { valid, needsRehash } = passwordMatches(String(password ?? ""), client.password);
  if (!valid) {
    return null;
  }

  // Migración perezosa: hash legacy (en claro o con otra JWT_KEY) -> formato actual
  if (needsRehash) {
    await client.update({ password: EncryptPwd(String(password ?? "")) });
  }

  let u = client.toJSON();
  delete u.password;
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

    // 3. Verificar contraseña actual (con compatibilidad legacy)
    const { valid: isCurrentPasswordValid } = passwordMatches(
      String(oldPassword || ""),
      user.password
    );

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


/**
 * Actualiza un ApiClient existente por idclient.
 * Si se provee password, se hashea automáticamente.
 * Nunca permite cambiar el idclient ni el username.
 *
 * @param {string} idclient - UUID del cliente a actualizar.
 * @param {object} data - Campos a actualizar.
 * @returns {Promise<object>} Cliente actualizado sin password.
 */
export async function updateApiClient(idclient, data) {
  try {
    if (!idclient) throw new Error("idclient is required.");

    const client = await ApiClient.findByPk(idclient);
    if (!client) throw new Error("ApiClient not found.");

    // Proteger campos inmutables
    delete data.idclient;
    delete data.username;
    delete data.createdAt;
    delete data.updatedAt;

    // Hashear password si se provee
    if (data.password) {
      data.password = EncryptPwd(data.password);
    }

    await client.update(data);

    let result = client.toJSON();
    result.password = undefined;
    return result;
  } catch (error) {
    throw new Error(error.message);
  }
}

/**
 * Elimina un ApiClient por idclient.
 * También elimina las ApiKey asociadas en cascada.
 *
 * @param {string} idclient - UUID del cliente a eliminar.
 * @returns {Promise<boolean>} true si se eliminó, false si no se encontró.
 */
export async function deleteApiClient(idclient) {
  try {
    if (!idclient) throw new Error("idclient is required.");

    const client = await ApiClient.findByPk(idclient);
    if (!client) return false;

    // Eliminar ApiKeys asociadas primero (si no hay CASCADE en la FK)
    await ApiKey.destroy({ where: { idclient } });
    await client.destroy();
    return true;
  } catch (error) {
    throw new Error(error.message);
  }
}

export const defaultApiClient = async () => {
  const defaultClient = {
    username: "apiuser",
    password: "apiuser",
    data: {
      first_name: "api",
      last_name: "user",
      email: "apiuser@example.com",
      ctrl: {},
    },
  };

  try {
    // Verificar si el usuario "apiuser" ya existe
    const existingUser = await ApiClient.findOne({
      where: { username: defaultClient.username },
    });

    if (!existingUser) {
      // El usuario "apiuser" no existe, se realiza la inserción
      await ApiClient.create({
        username: defaultClient.username,
        password: EncryptPwd(defaultClient.password),
        ...defaultClient.data,
      });
      return true;
    }

    // Recuperación extrema de clave: la fila existe pero la clave está
    // vacía/nula (borrada a propósito desde la DB); se restaura la default.
    if (existingUser.password == null || String(existingUser.password).trim() === "") {
      await existingUser.update({ password: EncryptPwd(defaultClient.password) });
      console.warn(
        `[${new Date().toISOString()}] Seed: el api client default '${defaultClient.username}' tenia la clave vacia; se restauro la clave por defecto.`
      );
    }

    return true;
  } catch (error) {
    console.error("Example error:", error);
    return false;
  }
};
