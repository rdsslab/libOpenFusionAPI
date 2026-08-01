import { Application, AppVars, Endpoint } from "./models.js";
import {
  deleteEndpoint,
  getEndpointByIdApp,
  upsertEndpoint,
} from "./endpoint.js";
import { getAppVarsByIdApp, upsertAppVar } from "./appvars.js";
import { default_apps } from "./default/index.js";
import { v4 as uuidv4 } from "uuid";
import { system_app } from "./default/system.js";
import { validateEndpointCode } from "../validation/codeValidator.js";


function replaceUFETCH(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_UFETCH_/g, "uFetch");
}

function replaceTELEGRAM(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_TELEGRAM_/g, "ofapi.telegram");
}

function replaceSERVER(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_SERVER_/g, "ofapi.server");
}

function replaceREQUEST(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_REQUEST_/g, "request");
}

function replaceRESPONSE(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_RESPONSE_/g, "reply");
}

function replaceREPLY(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_REPLY_/g, "reply");
}

function replaceGET_INTERNAL_URL(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_GET_INTERNAL_URL_/g, "uFetchAutoEnv.auto");
}

function replace_URL_AUTO_ENV_(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_URL_AUTO_ENV_/g, "uFetchAutoEnv");
}

function replace_SEQUENTIAL_PROMISES(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_SECUENTIAL_PROMISES_/g, "PromiseSequence");
}

function replace_GENTOKEN(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_GEN_TOKEN_/g, "ofapi.genToken");
}

function replace_NODEMAILER(str) {
  if (typeof str !== "string") str = String(str);
  return str.replace(/\$_NODEMAILER_/g, "nodemailer");
}

function replace_Old_FUNCTIONS_NAMES(code) {
  code = replaceUFETCH(code);
  code = replaceGET_INTERNAL_URL(code);
  code = replace_SEQUENTIAL_PROMISES(code);
  code = replaceREQUEST(code);
  code = replaceRESPONSE(code);
  code = replaceREPLY(code);
  code = replace_URL_AUTO_ENV_(code);
  code = replaceTELEGRAM(code);
  code = replaceSERVER(code);
  code = replace_GENTOKEN(code);
  code = replace_NODEMAILER(code);
  return code;
}

export const getAppWithEndpoints = async (
  /** @type {any} */ where,
  /** @type {boolean} */ raw
) => {
  return Application.findAll({
    where: where,
    attributes: [
      "idapp",
      "app",
      "enabled",
      "vars",
      "description",
      "rowkey",
      "params",
      "createdAt",
      "updatedAt",
    ],
    include: {
      model: Endpoint,
      as: "endpoints",
      //required: true, // INNER JOIN
      attributes: [
        "idendpoint",
        "enabled",
        "access",
        "ctrl",
        "environment",
        "resource",
        "method",
        "handler",
        "cors",
        "code",
        "description",
        "keywords",
        "json_schema",
        "headers_test",
        "data_test",
        "rowkey",
        "cache_time",
        "mcp",
        "createdAt",
        "updatedAt",
      ],
      order: [
        ["resource", "ASC"],
        ["environment", "ASC"],
        ["method", "ASC"],
      ],
    },
    raw: raw,
    nest: false,
  });
};

// READ
export const getAppFullById = async (
  /** @type {import("sequelize").Identifier} */ idapp,
  raw = false
) => {
  try {
    const app = await getAppWithEndpoints({ idapp: idapp }, raw);

    return app;
  } catch (error) {
    console.error("Error retrieving app:", error);
    throw error;
  }
};

export const getAllApps = async (attributes = null) => {
  try {
    const options = {};
    if (attributes && Array.isArray(attributes) && attributes.length > 0) {
      options.attributes = attributes;
    }
    const apps = await Application.findAll(options);
    return apps;
  } catch (error) {
    console.error("Error retrieving apps:", error);
    throw error;
  }
};

export const getAppsCatalog = async (filters = {}) => {
  const { app, enabled, limit, offset } = filters;

  try {
    const where = {};

    if (typeof app === "string" && app.trim() !== "") {
      where.app = app.toLowerCase();
    }

    if (enabled !== null && enabled !== undefined) {
      where.enabled = enabled;
    }

    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);

    return await Application.findAll({
      where,
      attributes: [
        "idapp",
        "app",
        "enabled",
        "description",
        "createdAt",
        "updatedAt",
      ],
      order: [["app", "ASC"]],
      ...(Number.isFinite(parsedLimit) && parsedLimit > 0 ? { limit: parsedLimit } : {}),
      ...(Number.isFinite(parsedOffset) && parsedOffset >= 0 ? { offset: parsedOffset } : {}),
    });
  } catch (error) {
    console.error("Error retrieving apps catalog:", error);
    throw error;
  }
};

// UPSERT
export const upsertApp = async (
  /** @type {import("sequelize").Optional<any, string>} */ appData,
  /** @type {undefined} */ transaction
) => {
  try {
    let [app] = await Application.upsert(appData, transaction);

    return app;
  } catch (error) {
    console.error("Error performing UPSERT on app:", error);
    throw error;
  }
};

export const saveAppWithEndpoints = async (app) => {
  try {
    if (app.idapp) {
      // Obtener la app actual
      let array_current_app = await getAppById(app.idapp, false);

      if (array_current_app.length > 0) {
        let current_app = array_current_app[0];

        // Buscar los endpoints que no están en la app actual
        let endpoints_to_delete = current_app.endpoints.filter(
          (ep) => !app.endpoints.find((e) => e.idendpoint === ep.idendpoint)
        );

        // Eliminar los endpoints que no están en la app actual
        let promises_delete = endpoints_to_delete.map((ep) => {
          return deleteEndpoint(ep.idendpoint);
        });
        await Promise.allSettled(promises_delete);
      }
    }
  } catch (error) {
    console.error("Error saveAppWithEndpoints:", error);
  }

  try {
    // Actualizar la app y sus endpoints
    let data = await upsertApp(app);

    if (data.idapp) {
      // Inserta / Actualiza los endpoints
      let promises_upsert = app.endpoints.map((ep) => {
        ep.idapp = data.idapp;
        if (!ep.idendpoint) {
          ep.idendpoint = uuidv4();
        }
        if (!ep.handler) {
          ep.handler = "";
        }

        return Endpoint.upsert(ep, { returning: true });
      });

      let result_endpoints = await Promise.allSettled(promises_upsert);
      // console.log("result_endpoints ==>>>", result_endpoints);
      //TODO: mejorar el retorno del upsert de lo endpoints
      return { app: data, endpoints: result_endpoints };
    } else {
      throw new Error("App could not be saved");
    }
  } catch (error) {
    throw error;
  }
};

export const restoreAppFromBackup = async (app) => {
  try {
    if (app.idapp) {
      // Si ya existe una app con el mismo nombre pero con un idapp distinto
      // (p.ej. restaurando un backup exportado de otro ambiente/instancia),
      // se reutiliza el idapp existente para actualizar esa misma app en
      // lugar de intentar insertar una fila nueva que violaría la restricción
      // de unicidad del campo "app".
      if (app.app) {
        const existing_app = await Application.findOne({
          where: { app: String(app.app).toLowerCase() },
        });

        if (existing_app && existing_app.idapp !== app.idapp) {
          const old_idapp = app.idapp;
          app.idapp = existing_app.idapp;

          if (Array.isArray(app.endpoints)) {
            app.endpoints.forEach((ep) => {
              if (ep.idapp === old_idapp) {
                ep.idapp = existing_app.idapp;
              }
            });
          }

          if (Array.isArray(app.vrs)) {
            app.vrs.forEach((v) => {
              if (v.idapp === old_idapp) {
                v.idapp = existing_app.idapp;
              }
            });
          }
        }
      }

      // Upsert a la tabla de aplicaciones
      let restore_app = await upsertApp(app);

      let migration_report = {};

      if (restore_app.idapp == app.idapp) {
        // Restaurado, se procede a cargar el resto de tablas relacionadas

        // Para la version anterior del backup
        // TODO: Esto se debe eliminar despues de la migración
        if (app.vars && typeof app.vars === "object") {
          // Hacemos un upsert de las variables de aplicación
          let promises_vars = [];
          let k_env = Object.keys(app.vars);
          for (let index = 0; index < k_env.length; index++) {
            const env_name = k_env[index];

            let k_vars = Object.keys(app.vars[env_name]);

            for (let index2 = 0; index2 < k_vars.length; index2++) {
              const name_var = k_vars[index2];
              let v = {
                idapp: app.idapp,
                name: name_var,
                environment: env_name,
                value: app.vars[env_name][name_var],
              };
              promises_vars.push(upsertAppVar(v));
            }
          }

          await Promise.allSettled(promises_vars);
        }

        if (Array.isArray(app.vrs) && app.vrs.length > 0) {
          // Hacemos un upsert de las variables de aplicación
          let promises_appvars = app.vrs.map((v) => {
            return upsertAppVar(v);
          });

          await Promise.allSettled(promises_appvars);
        }

        if (Array.isArray(app.endpoints) && app.endpoints.length > 0) {

          let promises_endpoints = app.endpoints.map(async (ep) => {
            if (!ep.idapp) {
              ep.idapp = app.idapp;
            }

            if (ep.handler == "JS" || ep.handler == "MONGODB" || ep.handler == "TELEGRAM_BOT") {
              // Este bloque es para compatibilidad con versiones antiguas del backup
              ep.code = replace_Old_FUNCTIONS_NAMES(ep.code);

              // Detecta y autocorrige llamadas a APIs de librerías desactualizadas
              // (ej. uFetch.GET -> uFetch.get). No bloquea el restore: lo que no se
              // puede autocorregir queda documentado en el reporte para revisión manual.
              try {
                const validation = await validateEndpointCode({
                  handler: ep.handler,
                  code: ep.code,
                  custom_data: ep.custom_data,
                  dryRun: false,
                });

                if (validation.applicable && validation.findings.length > 0) {
                  if (validation.autofixed) {
                    ep.code = validation.fixed_code;
                  }
                  migration_report[ep.idendpoint || ep.resource] = validation;
                }
              } catch (validationError) {
                console.error("Error validating endpoint code during restore:", validationError);
              }
            } else if (ep.handler == "SOAP") {
              try {
                // Este bloque permite subir un backup de un endpoint SOAP de una version anterior
                ep.custom_data = JSON.parse(ep.code);
              } catch (error) {
                // Deja como está porque se debe estar usando una variable de aplicación
                // Informativo: código SOAP antiguo que no es JSON válido (se usa variable de app)
                console.debug("[migration] SOAP endpoint code is not JSON (expected for app-var endpoints):", error.message);
              }
            }else if(ep.handler == "SQL" || ep.handler == "HANA"){
              try {
                // Este bloque permite subir un backup de un endpoint SQL de una version anterior
                let params = JSON.parse(ep.code);
                ep.code = params.query;
                ep.custom_data = params.config;
              } catch (error) {
                // Deja como está porque se debe estar usando una variable de aplicación
                // Informativo: código SQL antiguo que no es JSON válido (se usa variable de app)
                console.debug("[migration] SQL/HANA endpoint code is not JSON (expected for app-var endpoints):", error.message);
              }
            }else if(ep.handler == "TEXT"){
              try {
                // Este bloque permite subir un backup de un endpoint TEXT de una version anterior
                let params = JSON.parse(ep.code);
                ep.code = typeof params.payload === "string"
                  ? params.payload
                  : typeof params.content === "string"
                    ? params.content
                    : ep.code;
                ep.custom_data = {
                  ...(ep.custom_data && typeof ep.custom_data === "object" ? ep.custom_data : {}),
                  ...(typeof params.mimeType === "string" && params.mimeType.length > 0
                    ? { mimeType: params.mimeType }
                    : {}),
                  ...(typeof params.mime === "string" && params.mime.length > 0
                    ? { mimeType: params.mime }
                    : {}),
                };
              } catch (error) {
                // Deja como está porque puede tratarse del formato actual: code=texto, custom_data=config
                console.debug("[migration] TEXT endpoint code is not JSON (expected for current raw-text endpoints):", error.message);
              }
            }else if(ep.handler == "SQL_BULK_I"){
              try {
                // Este bloque permite subir un backup de un endpoint SQL de una version anterior
                let params = JSON.parse(ep.code);
                ep.code = params.table_name;
                ep.custom_data = params.config;
              } catch (error) {
                // Deja como está porque se debe estar usando una variable de aplicación
                console.log("Backup Endpoint SQL_BULK_I Error parsing code. Only by old version. Error:", error);
              }
            }

            return upsertEndpoint(ep);
          });
          let result_endpoints = await Promise.allSettled(promises_endpoints);
          console.log("result_endpoints ==>>>", result_endpoints.length);
        }
      }

      let new_backup = await getAppBackupById(app.idapp);
      return Object.keys(migration_report).length > 0
        ? { ...new_backup, migration_report }
        : new_backup;
    }
  } catch (error) {
    console.error("Error restoring backup app:", error);
    return error;
  }
};

export const defaultApps = async () => {
  let promises = default_apps.map(async (app) => {
    try {
      let r = await restoreAppFromBackup(app);
      return { app: app, result: r };
    } catch (error) {
      console.log("Error defaultApps:", error);
      return { app: app, error: error };
    }
  });

  return await Promise.all(promises);
};

export const getAppById = async (
  /** @type {import("sequelize").Identifier} */ idapp,
  raw = false
) => {
  try {
    const app = await Application.findByPk(idapp);

    return app;
  } catch (error) {
    console.error("Error retrieving app:", error);
    throw error;
  }
};

export async function getAppBackupById(idapp) {
  try {
    const data = await getApplicationTreeByFilters({ idapp: idapp });
    return data;
  } catch (error) {
    console.error("Error al obtener Application:", error);
    throw new Error("No se pudo obtener la aplicación");
  }
}

function ValidateEndpoint(default_endpoints, system_endpoints) {
  let result = { valid: true, message: "All endpoints are correct." };

  for (let index = 0; index < default_endpoints.length; index++) {
    const element = default_endpoints[index];

    let dif = system_endpoints.find((item) => {
      return item.idendpoint == element.idendpoint;
    });

    if (!dif) {
      // No se encontró el endoint sale del bucle y reporta la diferencia
      result.valid = false;
      result.diff = { endpoint: element };
      result.message = `Endpoint ${element.idendpoint} not found`;
      break;
    } else {
      let field_diff = [];

      if (
        JSON.stringify(element.json_schema) !== JSON.stringify(dif.json_schema)
      ) {
        field_diff.push("json_schema");
      }
      if (element.enabled !== dif.enabled) {
        field_diff.push("enabled");
      }
      if (element.enabled !== dif.enabled) {
        field_diff.push("enabled");
      }
      if (element.idapp !== dif.idapp) {
        field_diff.push("idapp");
      }
      if (element.environment !== dif.environment) {
        field_diff.push("environment");
      }
      if (element.resource !== dif.resource) {
        field_diff.push("resource");
      }
      if (element.title !== dif.title) {
        field_diff.push("title");
      }
      if (element.description !== dif.description) {
        field_diff.push("description");
      }
      if (element.keywords !== dif.keywords) {
        field_diff.push("keywords");
      }
      if (element.method !== dif.method) {
        field_diff.push("method");
      }

      if (element.handler !== dif.handler) {
        field_diff.push("handler");
      }
      if (element.access !== dif.access) {
        field_diff.push("access");
      }
      if (JSON.stringify(element.ctrl) !== JSON.stringify(dif.ctrl)) {
        field_diff.push("ctrl");
      }
      if (JSON.stringify(element.cors) !== JSON.stringify(dif.cors)) {
        field_diff.push("cors");
      }
      if (JSON.stringify(element.mcp) !== JSON.stringify(dif.mcp)) {
        field_diff.push("mcp");
      }
      if (JSON.stringify(element.code) !== JSON.stringify(dif.code)) {
        field_diff.push("code");
      }
      if (element.cache_time !== dif.cache_time) {
        field_diff.push("cache_time");
      }

      result.valid = field_diff.length == 0;
      if (!result.valid) {
        result.diff = { endpoint: element };
        result.message = `Endpoint ${element.idendpoint
          } has modified fields: ${field_diff.join(", ")}`;
        break;
      }
    }
  }
  return result;
}

export async function checkSystemApp(restore = false) {
  try {
    let result = { valid: true, diff: {} };

    // Obtener la data actual
    const data = await getApplicationTreeByFilters({
      idapp: "cfcd2084-95d5-65ef-66e7-dff9f98764da",
    });

    // Validar endpoints
    result = ValidateEndpoint(system_app.endpoints, data.endpoints);

    // Si se solicita sincronizar hacerlo
    if (restore && !result.valid) {
      let r = await restoreAppFromBackup(system_app);
      result = ValidateEndpoint(system_app.endpoints, r.endpoints);
    }

    // Devuelve si hay diferencias
    return result;
  } catch (error) {
    console.error("Error al verificar los datos del sistema:", error);
    throw new Error("The system endpoints could not be verified");
  }
}

export function parseAppVar(appvar) {
  let v;

  try {
    switch (appvar.type) {
      case "number":
        v =
          typeof appvar.value === "number"
            ? appvar.value
            : parseFloat(appvar.value);
        break;

      case "json":
        v =
          typeof appvar.value === "object"
            ? appvar.value
            : JSON.parse(appvar.value);
        break;
      case "object":
        v =
          typeof appvar.value === "object"
            ? appvar.value
            : JSON.parse(appvar.value);
        break;
      case "js":
        v =
          typeof appvar.value === "object"
            ? appvar.value
            : JSON.parse(appvar.value);
        break;
      default:
        v = JSON.stringify(appvar.value);
        break;
    }
  } catch (error) {
    v = appvar.value;
  }
  return v;
}

/**
 * Obtiene la información completa de las Application con sus AppVars y Endpoints,
 * filtrando por app, method, environment y resource (opcionales).
 *
 * @param {object} filters
 * @param {string=} filters.app
 * @param {string=} filters.method
 * @param {string=} filters.environment
 * @param {string=} filters.resource
 * @returns {Promise<object|null>}
 */
export async function getApplicationsTreeByFilters(filters = {}) {
  const { idapp, app, enabled, endpoint } = filters;
  try {
    const appWhere = {};
    const endpointWhere = {};

    if (idapp) {
      appWhere.idapp = idapp;
    }

    if (enabled !== null && enabled !== undefined) {
      appWhere.enabled = enabled;
    }

    if (app) {
      appWhere.app = app.toLowerCase();
    }

    if (endpoint?.idendpoint) {
      endpointWhere.idendpoint = endpoint.idendpoint;
    }

    if (endpoint?.method) {
      endpointWhere.method = endpoint.method.toUpperCase();
    }

    if (endpoint?.handler) {
      endpointWhere.handler = endpoint.handler.toUpperCase();
    }

    if (endpoint?.environment) {
      endpointWhere.environment = endpoint.environment;
    }

    if (endpoint?.resource) {
      endpointWhere.resource = endpoint.resource;
    }

    if (endpoint?.enabled !== null && endpoint?.enabled !== undefined) {
      endpointWhere.enabled = endpoint.enabled;
    }

    const data = await Application.findAll({
      where: appWhere,
      include: [
        {
          model: AppVars,
          as: "vrs",
          required: false,
        },
        {
          model: Endpoint,
          as: "endpoints",
          required: Object.keys(endpointWhere).length > 0,
          where:
            Object.keys(endpointWhere).length > 0 ? endpointWhere : undefined,
        },
      ],
    });

    if (!data) return [];

    const appData = data.map((item) => {
      const appItem = item.toJSON();
      appItem.vrs = appItem.vrs.map((v) => {
        v.value = parseAppVar(v);
        return v;
      });
      return appItem;
    });

    return appData;
  } catch (error) {
    console.error("Error en getApplicationsTreeByFilters:", error);
    throw error;
  }
}

export async function getApplicationTreeByFilters(filters = {}) {
  const { idapp, app, enabled, endpoint } = filters;
  try {
    const appWhere = {};
    const endpointWhere = {};

    if (idapp) {
      appWhere.idapp = idapp;
    }

    if (enabled !== null && enabled !== undefined) {
      appWhere.enabled = enabled;
    }

    if (app) {
      appWhere.app = app.toLowerCase();
    }

    if (endpoint?.idendpoint) {
      endpointWhere.idendpoint = endpoint.idendpoint;
    }

    if (endpoint?.method) {
      endpointWhere.method = endpoint.method.toUpperCase();
    }

    if (endpoint?.handler) {
      endpointWhere.handler = endpoint.handler.toUpperCase();
    }

    if (endpoint?.environment) {
      endpointWhere.environment = endpoint.environment;
    }

    if (endpoint?.resource) {
      endpointWhere.resource = endpoint.resource;
    }

    if (endpoint?.enabled !== null && endpoint?.enabled !== undefined) {
      endpointWhere.enabled = endpoint.enabled;
    }

    const data = await Application.findOne({
      where: appWhere,
      include: [
        {
          model: AppVars,
          as: "vrs",
          required: false,
        },
        {
          model: Endpoint,
          as: "endpoints",
          required: Object.keys(endpointWhere).length > 0,
          where:
            Object.keys(endpointWhere).length > 0 ? endpointWhere : undefined,
        },
      ],
    });

    if (!data) return {};

    const appData = data.toJSON();

    appData.vrs = appData.vrs.map((item) => {
      item.value = parseAppVar(item);
      return item;
    });

    return appData;
  } catch (error) {
    console.error("Error en getApplicationTreeByFilters:", error);
    throw error;
  }
}

export async function getApplicationEndpointByRoute(filters = {}) {
  const {
    idapp,
    app,
    enabled = true,
    endpoint = {},
  } = filters;

  try {
    const appWhere = {};
    const endpointWhere = {};

    if (idapp) {
      appWhere.idapp = idapp;
    }

    if (app) {
      appWhere.app = app.toLowerCase();
    }

    if (enabled !== null && enabled !== undefined) {
      appWhere.enabled = enabled;
    }

    if (endpoint.idendpoint) {
      endpointWhere.idendpoint = endpoint.idendpoint;
    }

    if (endpoint.method) {
      endpointWhere.method = endpoint.method.toUpperCase();
    }

    if (endpoint.environment) {
      endpointWhere.environment = endpoint.environment.toLowerCase();
    }

    if (endpoint.resource) {
      endpointWhere.resource = endpoint.resource.toLowerCase();
    }

    if (endpoint.handler) {
      endpointWhere.handler = endpoint.handler.toUpperCase();
    }

    if (endpoint.enabled !== null && endpoint.enabled !== undefined) {
      endpointWhere.enabled = endpoint.enabled;
    } else {
      endpointWhere.enabled = true;
    }

    const data = await Application.findOne({
      where: appWhere,
      include: [
        {
          model: AppVars,
          as: "vrs",
          required: false,
        },
        {
          model: Endpoint,
          as: "endpoints",
          required: true,
          where: endpointWhere,
          limit: 1,
        },
      ],
    });

    if (!data) return {};

    const appData = data.toJSON();
    appData.vrs = (appData.vrs || []).map((item) => {
      item.value = parseAppVar(item);
      return item;
    });

    if (Array.isArray(appData.endpoints) && appData.endpoints.length > 1) {
      appData.endpoints = [appData.endpoints[0]];
    }

    return appData;
  } catch (error) {
    console.error("Error en getApplicationEndpointByRoute:", error);
    throw error;
  }
}


