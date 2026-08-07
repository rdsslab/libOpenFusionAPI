import { AppVars } from "./models.js";
import { validateAppVarName } from "./appvarName.js";

/**
 * Error thrown when an AppVar name does not follow the `$_VAR_NAME` convention.
 * Carries `statusCode` and `code` so the function layer can turn it into an
 * actionable 400 instead of a raw Sequelize blob in a 500.
 */
export const createInvalidAppVarNameError = (check, name) => {
  const error = new Error(check.message);
  error.statusCode = 400;
  error.code = "INVALID_APPVAR_NAME";
  error.details = { name, suggestion: check.suggestion };
  return error;
};

export const upsertAppVar = async (
  /** @type {import("sequelize").Optional<any, string>} */ data
) => {
  // Pre-check before hitting the DB. The model validator (models.js) is the real
  // guarantee — it also covers create/bulkCreate — but it raises a
  // SequelizeValidationError; this produces a clean 400 with a suggestion.
  const check = validateAppVarName(data?.name);
  if (!check.valid) {
    throw createInvalidAppVarNameError(check, data?.name);
  }

  try {
    // TODO (2026-08-06): evaluar activar `conflictFields`.
    //
    // Estado actual: la línea está comentada, así que `AppVars.upsert` resuelve
    // el conflicto por la primary key `idvar`, NO por la clave única del negocio.
    //
    // Contexto:
    //   - El modelo declara la unique key `unique_av_combo` sobre
    //     ["idapp", "name", "environment"] (models.js, bloque `uniqueKeys`).
    //   - El índice `idx_av_id_n_e` cubre esos mismos tres campos, pero su
    //     `unique: true` también está comentado (models.js, bloque `indexes`),
    //     así que en la base desplegada puede no existir un índice único real.
    //
    // Consecuencia concreta:
    //   Un upsert SIN `idvar` sobre una combinación idapp+name+environment que
    //   ya existe no encuentra conflicto por PK e intenta INSERTAR una fila
    //   nueva. Entonces, o bien choca contra `unique_av_combo` y revienta con un
    //   error de constraint en vez de hacer el UPDATE esperado, o bien —si el
    //   índice único no llegó a crearse en esa base— inserta un duplicado
    //   silencioso y la resolución de AppVars pasa a depender de cuál devuelva
    //   primero el motor.
    //
    // Relación con otros bugs: es exactamente lo que hacía fallar la rama
    // "reemplazar existente" de `fnAppVarMigrate` cuando no se le pasaba el
    // `idvar` correcto (ver src/lib/server/functions/system/prd/endpoint/index.js).
    //
    // Por qué no se activa ahora: cambiar la estrategia de conflicto altera el
    // comportamiento de las 5 rutas de escritura que pasan por aquí —incluido el
    // restore de backups y el sembrado de los seeds al arrancar— y necesita su
    // propia verificación end-to-end.
    //
    // Qué revisar antes de activarlo:
    //   1. Soporte de `conflictFields` por dialecto: Postgres lo traduce a
    //      `ON CONFLICT (...)`, pero MSSQL usa `MERGE` y SQLite tiene su propia
    //      ruta; el comportamiento no es equivalente en los tres.
    //   2. Que el índice ÚNICO sobre (idapp, name, environment) exista de verdad
    //      en las bases ya desplegadas, no solo en la definición del modelo.
    //      Postgres exige un índice único para `ON CONFLICT`; si no está, falla.
    //   3. Que no haya duplicados previos en esas tres columnas, o la creación
    //      del índice único fallará al migrar.
    const [result] = await AppVars.upsert(data, {
      returning: true,
      //conflictFields: ["idapp", "name", "environment"],
    });
    return result;
  } catch (error) {
    console.error("Error retrieving:", error, data);
    throw error; // c4ca4238-a0b9-2382-0dcc-509a6f75849b
  }
};

// READ
export const getAppVarsById = async (
  /** @type {import("sequelize").Identifier | undefined} */ idAppVars
) => {
  try {
    const appVar = await AppVars.findByPk(idAppVars);
    return appVar;
  } catch (error) {
    console.error("Error retrieving user:", error);
    throw error;
  }
};

// DELETE
export const deleteAppVar = async (
  /** @type {import("sequelize").Identifier | undefined} */ idappvar
) => {
  try {
    const appv = await AppVars.findByPk(idappvar);
    if (appv) {
      await appv.destroy();
      return true; // Deletion successful
    }
    return false; // User not found
  } catch (error) {
    console.error("Error deleting idappvar:", error);
    throw error;
  }
};

// READ
export const getAppVarsByIdApp = async (
  /** @type {import("sequelize").Identifier | undefined} */ idapp
) => {
  try {
    //const AppVarss = await AppVars.findAll({attributes: list_fields, where: { appname: appname } });
    const AppVarss = await AppVars.findAll({ where: { idapp: idapp } });
    return AppVarss;
  } catch (error) {
    console.error("Error retrieving user:", error);
    throw error;
  }
};

export const getAppVarsCatalogByIdApp = async (filters = {}) => {
  const { idapp, environment, include_values, limit, offset } = filters;

  try {
    const where = {};

    if (idapp) {
      where.idapp = idapp;
    }

    if (typeof environment === "string" && environment.trim() !== "") {
      where.environment = environment;
    }

    const attributes = [
      "idvar",
      "idapp",
      "name",
      "type",
      "environment",
      "createdAt",
      "updatedAt",
    ];

    if (include_values === true) {
      attributes.push("value");
    }

    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);

    return await AppVars.findAll({
      where,
      attributes,
      order: [
        ["environment", "ASC"],
        ["name", "ASC"],
      ],
      ...(Number.isFinite(parsedLimit) && parsedLimit > 0 ? { limit: parsedLimit } : {}),
      ...(Number.isFinite(parsedOffset) && parsedOffset >= 0 ? { offset: parsedOffset } : {}),
    });
  } catch (error) {
    console.error("Error retrieving app vars catalog:", error);
    throw error;
  }
};

// Comentado el 2026-08-06: código muerto, cero llamadores en todo el repositorio.
// Se deja comentado un tiempo por si aparece un uso; si no aparece, ELIMINAR.
// Nota: si se reactiva, el validador de nombre del modelo (models.js) también
// cubre `bulkCreate`, así que no haría falta repetir aquí el pre-chequeo de
// `upsertAppVar` — pero sí conviene revisar el TODO de `conflictFields` de
// arriba, porque `ignoreDuplicates` tiene el mismo problema de fondo: silencia
// las colisiones sobre idapp+name+environment en vez de actualizarlas.
//
// export const bulkCreateAppVars = (
//   /** @type {readonly import("sequelize").Optional<any, string>[]} */ list_AppVars
// ) => {
//   // Campos que se utilizarán para verificar duplicados (en este caso, todos excepto 'rowkey' y 'idAppVars')
//   //const uniqueFields = ['idapp', 'namespace', 'name', 'version', 'environment', 'method'];
//   // OJO: No se pudo tener un bulk upsert
//   return AppVars.bulkCreate(list_AppVars, {
//     ignoreDuplicates: true,
//     //updateOnDuplicate: uniqueFields
//   });
// };
