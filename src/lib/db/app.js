import { Op } from "sequelize";
import {
  Application,
  AppVars,
  Endpoint,
  Bot,
  IntervalTask,
  ApiClient,
  ApiKey,
} from "./models.js";
import {
  deleteEndpoint,
  getEndpointByIdApp,
  upsertEndpoint,
} from "./endpoint.js";
import { getAppVarsByIdApp, upsertAppVar } from "./appvars.js";
import { upsertBot, BOT_RUNTIME_ATTRIBUTES } from "./bot.js";
import {
  upsertIntervalTask,
  INTERVAL_TASK_RUNTIME_ATTRIBUTES,
} from "./interval_task.js";
import { upsertApiClient } from "./apiclient.js";
import { upsertApiKey } from "./apikey.js";
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

/**
 * Restaura las tareas (interval tasks) que vienen al nivel raíz del backup,
 * en el mismo nivel que endpoints (app.tasks), no anidadas en cada endpoint.
 *
 * Solo upsertea las tareas que vienen en el backup. Las tareas que ya
 * existen en base de datos pero no vienen en el backup NO se eliminan.
 *
 * Cada tarea se remapea al idendpoint real: upsertEndpoint puede reutilizar
 * el idendpoint de un endpoint existente con el mismo
 * (idapp + environment + resource + method), por lo que el idendpoint del
 * backup no necesariamente es el que quedó en base de datos. Lo mismo aplica al
 * `idkey`, que se reapunta con el mapa devuelto por restoreApiKeys.
 *
 * `idtask` es autoincremental, así que restaurar el del backup pisaría la tarea que
 * ocupara ese id en el destino —el mismo riesgo que ya se resolvió para ApiKey.idkey—.
 * La fila destino se resuelve en dos pasos: se acepta el `idtask` del backup sólo si esa
 * fila existe Y apunta al mismo endpoint (el caso normal, restaurar sobre la misma
 * instancia), y si no se busca por (idendpoint + note). No se cae a una clave natural más
 * laxa a propósito: emparejar de más fusionaría dos tareas distintas del mismo endpoint,
 * así que ante la duda se inserta dejando que la base asigne un idtask nuevo.
 *
 * La telemetría del scheduler (INTERVAL_TASK_RUNTIME_ATTRIBUTES) se descarta: es estado
 * observado, no configuración.
 *
 * @param {Array} tasks - tareas provenientes del backup (app.tasks)
 * @param {Map<string, string>} idendpoint_map - idendpoint del backup -> idendpoint real
 * @param {Map<number, number>} idkey_map - idkey del backup -> idkey real
 * @returns {Promise<Array>}
 */
async function restoreIntervalTasks(tasks, idendpoint_map, idkey_map = new Map()) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return [];
  }

  const pending = [];
  const skipped = [];
  const orphan_keys = [];

  for (const t of tasks) {
    const target = idendpoint_map.get(t.idendpoint) || t.idendpoint;

    if (!target) {
      skipped.push(t);
      continue;
    }

    // Si el endpoint no vino en el backup, validar que exista en base de datos
    // para no violar la FK idendpoint -> endpoint.
    if (!idendpoint_map.has(t.idendpoint)) {
      const exists = await Endpoint.findByPk(target, {
        attributes: ["idendpoint"],
      });
      if (!exists) {
        skipped.push(t);
        continue;
      }
    }

    const data = { ...t, idendpoint: target };

    for (const field of INTERVAL_TASK_RUNTIME_ATTRIBUTES) delete data[field];

    if (t.idkey != null) {
      const target_key = idkey_map.get(Number(t.idkey));

      if (target_key != null) {
        data.idkey = target_key;
      } else {
        // Mejor sin credencial (la tarea falla con "Missing credentials" y se ve en el
        // historial) que apuntando a la key de otra app.
        const exists = await ApiKey.findByPk(t.idkey, { attributes: ["idkey"] });

        if (!exists) {
          data.idkey = null;
          orphan_keys.push({ idtask: t.idtask, idkey: t.idkey });
        }
      }
    }

    let existing = null;

    if (t.idtask != null) {
      const byId = await IntervalTask.findByPk(t.idtask, {
        attributes: ["idtask", "idendpoint"],
      });
      // Sólo vale si apunta al mismo endpoint: en otra instancia ese id puede ser la
      // tarea de otra aplicación.
      if (byId && byId.idendpoint === target) existing = byId;
    }

    if (!existing) {
      existing = await IntervalTask.findOne({
        where: { idendpoint: target, note: t.note ?? null },
        attributes: ["idtask"],
      });
    }

    if (existing) {
      data.idtask = existing.idtask;
    } else {
      // Deja que la base asigne el idtask para no pisar una tarea ajena
      delete data.idtask;
    }

    pending.push(upsertIntervalTask(data));
  }

  if (orphan_keys.length > 0) {
    console.warn(
      `[restoreIntervalTasks] ${orphan_keys.length} task(s) restored without idkey: the api key was not part of the backup and does not exist in this instance`,
      orphan_keys
    );
  }

  if (skipped.length > 0) {
    console.warn(
      `[restoreIntervalTasks] ${skipped.length} task(s) skipped: idendpoint not found`,
      skipped.map((t) => ({ idtask: t.idtask, idendpoint: t.idendpoint }))
    );
  }

  const results = await Promise.allSettled(pending);

  results.forEach((r, index) => {
    if (r.status === "rejected") {
      console.error(
        `[restoreIntervalTasks] Error restoring task ${index}:`,
        r.reason
      );
    }
  });

  return results;
}

/**
 * Restaura los bots de mensajería que vienen al nivel raíz del backup (app.bots).
 *
 * `upsertBot` resuelve sólo por `idbot`, así que restaurar en una instancia donde el bot
 * lógico ya existe con otro UUID creaba una segunda fila y el BotLifecycleTask podía
 * arrancar las dos contra el mismo token del provider. La fila destino se resuelve antes
 * por (idapp + environment + name), que es lo estable entre instancias.
 *
 * El estado de runtime es observado, no configuración: restaurar un `QUARANTINED` o un
 * `next_retry_at` viejo haría que un bot recién restaurado arrancara con un backoff que ya
 * no corresponde a nada.
 *
 * Solo upsertea los bots que vienen en el backup; los que existen en base de datos y no
 * vienen NO se eliminan.
 *
 * @param {Array} bots - bots provenientes del backup (app.bots)
 * @param {string} idapp - idapp destino
 * @returns {Promise<Array>}
 */
async function restoreBots(bots, idapp) {
  if (!Array.isArray(bots) || bots.length === 0) {
    return [];
  }

  const pending = [];

  for (const bot of bots) {
    const data = { ...bot, idapp };

    for (const field of BOT_RUNTIME_ATTRIBUTES) delete data[field];

    if (data.name) {
      const existing = await Bot.findOne({
        where: {
          idapp,
          environment: data.environment || "prd",
          name: data.name,
        },
        attributes: ["idbot"],
      });

      if (existing) {
        data.idbot = existing.idbot;
      }
    }

    pending.push(upsertBot(data));
  }

  const results = await Promise.allSettled(pending);

  results.forEach((r, index) => {
    if (r.status === "rejected") {
      console.error(`[restoreBots] Error restoring bot ${index}:`, r.reason);
    }
  });

  return results;
}

/**
 * Restaura los usuarios externos (ApiClient) que vienen al nivel raíz del
 * backup (app.clients).
 *
 * `username` es único a nivel global, así que si ya existe un cliente con ese
 * username pero otro idclient (p.ej. restaurando un backup de otra instancia)
 * se reutiliza el idclient existente en lugar de insertar una fila que
 * violaría la restricción de unicidad. El mapeo resultante se usa para
 * reapuntar las api keys.
 *
 * Solo upsertea los clientes que vienen en el backup; los que existen en base
 * de datos y no vienen NO se eliminan.
 *
 * @param {Array} clients - clientes provenientes del backup (app.clients)
 * @returns {Promise<Map<string, string>>} idclient del backup -> idclient real
 */
async function restoreApiClients(clients) {
  const idclient_map = new Map();

  if (!Array.isArray(clients) || clients.length === 0) {
    return idclient_map;
  }

  for (const c of clients) {
    try {
      const data = { ...c };

      if (data.username) {
        const existing = await ApiClient.findOne({
          where: { username: data.username },
          attributes: ["idclient"],
        });

        if (existing && existing.idclient !== data.idclient) {
          if (data.idclient) {
            idclient_map.set(data.idclient, existing.idclient);
          }
          data.idclient = existing.idclient;
        }
      }

      const res = await upsertApiClient(data);

      if (c.idclient && res?.result?.idclient) {
        idclient_map.set(c.idclient, res.result.idclient);
      }
    } catch (error) {
      console.error(
        `[restoreApiClients] Error restoring client ${c?.username || c?.idclient}:`,
        error
      );
    }
  }

  return idclient_map;
}

/**
 * Restaura las api keys que vienen al nivel raíz del backup (app.keys).
 *
 * - Todas las keys se fuerzan al idapp que se está restaurando.
 * - El idclient se remapea con el mapa devuelto por restoreApiClients; si el
 *   cliente no vino en el backup se valida que exista en base de datos para no
 *   violar la FK idclient.
 * - `idkey` es autoincremental, por lo que un idkey de otra instancia puede
 *   corresponder a la key de otra app en el destino. Para no sobrescribirla, la
 *   fila destino se resuelve por (idapp + idclient + token) y, si no existe, se
 *   inserta dejando que la base asigne un idkey nuevo.
 *
 * Solo upsertea las keys que vienen en el backup; las que existen en base de
 * datos y no vienen NO se eliminan.
 *
 * Como el idkey destino casi nunca coincide con el del backup, se devuelve el mapeo:
 * las interval tasks lo necesitan para reapuntar su `idkey` (el Bearer con el que el
 * scheduler llama al endpoint). Sin ese mapeo la tarea quedaba autenticándose con la key
 * que por casualidad ocupara ese id en el destino.
 *
 * @param {Array} keys - api keys provenientes del backup (app.keys)
 * @param {string} idapp - idapp destino
 * @param {Map<string, string>} idclient_map - idclient del backup -> idclient real
 * @returns {Promise<Map<number, number>>} idkey del backup -> idkey real
 */
async function restoreApiKeys(keys, idapp, idclient_map) {
  const idkey_map = new Map();

  if (!Array.isArray(keys) || keys.length === 0) {
    return idkey_map;
  }

  const skipped = [];

  for (const k of keys) {
    const target_client = idclient_map.get(k.idclient) || k.idclient;

    if (!target_client || !k.token) {
      skipped.push(k);
      continue;
    }

    // Si el cliente no vino en el backup, validar que exista en base de datos
    // para no violar la FK idclient -> api_client.
    if (!idclient_map.has(k.idclient)) {
      const exists = await ApiClient.findOne({
        where: { idclient: target_client },
        attributes: ["idclient"],
      });
      if (!exists) {
        skipped.push(k);
        continue;
      }
    }

    try {
      const data = { ...k, idapp, idclient: target_client };

      const existing = await ApiKey.findOne({
        where: { idapp, idclient: target_client, token: data.token },
        attributes: ["idkey"],
      });

      if (existing) {
        data.idkey = existing.idkey;
      } else {
        // Deja que la base asigne el idkey para no pisar una key ajena
        delete data.idkey;
      }

      const res = await upsertApiKey(data);
      const real_idkey = res?.result?.idkey ?? data.idkey;

      if (k.idkey != null && real_idkey != null) {
        idkey_map.set(Number(k.idkey), Number(real_idkey));
      }
    } catch (error) {
      console.error(
        `[restoreApiKeys] Error restoring key ${k?.idkey} for client ${target_client}:`,
        error
      );
    }
  }

  if (skipped.length > 0) {
    console.warn(
      `[restoreApiKeys] ${skipped.length} key(s) skipped: client not found or missing token`,
      skipped.map((k) => ({ idkey: k.idkey, idclient: k.idclient }))
    );
  }

  return idkey_map;
}

function safeParseJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Elimina endpoints existentes que entren en conflicto de nombre MCP con el
 * endpoint que se va a restaurar. El seed del sistema es la fuente de verdad;
 * si la ruta de un endpoint cambió pero conserva el mismo mcp.name, el
 * endpoint antiguo debe ser reemplazado para evitar errores de unicidad.
 */
async function removeConflictingMcpEndpoints(appId, environment, endpointData) {
  if (!appId || !environment || !endpointData) return;

  const mcp = safeParseJson(endpointData.mcp);
  if (!mcp?.enabled || !mcp?.name) return;

  const targetName = String(mcp.name).trim();
  if (!targetName) return;

  const where = {
    idapp: appId,
    environment: String(environment).toLowerCase(),
  };

  if (endpointData.idendpoint) {
    where.idendpoint = { [Op.ne]: endpointData.idendpoint };
  }

  const existing = await Endpoint.findAll({
    where,
    attributes: ["idendpoint", "mcp", "resource", "method"],
  });

  const conflictingIds = [];
  for (const ep of existing) {
    const plain = ep.toJSON ? ep.toJSON() : ep;
    const currentMcp = safeParseJson(plain.mcp);
    if (
      currentMcp?.enabled &&
      String(currentMcp.name).trim() === targetName
    ) {
      conflictingIds.push(plain.idendpoint);
    }
  }

  if (conflictingIds.length > 0) {
    console.log(
      `[restoreAppFromBackup] Removing ${conflictingIds.length} endpoint(s) with conflicting MCP name '${targetName}' before restore:`,
      conflictingIds.map((id) => ({ idendpoint: id }))
    );
    await Endpoint.destroy({ where: { idendpoint: conflictingIds } });
  }
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

          if (Array.isArray(app.bots)) {
            app.bots.forEach((b) => {
              if (b.idapp === old_idapp) {
                b.idapp = existing_app.idapp;
              }
            });
          }

          if (Array.isArray(app.keys)) {
            app.keys.forEach((k) => {
              if (k.idapp === old_idapp) {
                k.idapp = existing_app.idapp;
              }
            });
          }
        }
      }

      // Upsert a la tabla de aplicaciones
      let restore_app = await upsertApp(app);

      let migration_report = {};
      // Variables de aplicación que el restore no pudo guardar (típicamente por
      // no cumplir la convención de nombre `$_VAR_NOMBRE`). Antes se perdían:
      // los dos bucles hacían `Promise.allSettled` y descartaban el resultado,
      // así que un backup se restauraba a medias sin avisar a nadie.
      let appvars_rejected = [];

      // Recoge los rechazos de un `Promise.allSettled` sobre upserts de AppVars.
      const collectAppVarRejections = (settled, sources) => {
        settled.forEach((outcome, index) => {
          if (outcome.status !== "rejected") {
            return;
          }

          const source = sources[index] || {};
          const detail = {
            name: source.name,
            environment: source.environment,
            error: outcome.reason?.message || String(outcome.reason),
            ...(outcome.reason?.code ? { code: outcome.reason.code } : {}),
            ...(outcome.reason?.details?.suggestion
              ? { suggestion: outcome.reason.details.suggestion }
              : {}),
          };

          appvars_rejected.push(detail);
          console.error(
            `[restoreAppFromBackup] AppVar "${detail.name}" (${detail.environment}) rejected: ${detail.error}`,
          );
        });
      };

      if (restore_app.idapp == app.idapp) {
        // Restaurado, se procede a cargar el resto de tablas relacionadas

        // Para la version anterior del backup
        // TODO: Esto se debe eliminar despues de la migración
        if (app.vars && typeof app.vars === "object") {
          // Hacemos un upsert de las variables de aplicación
          let promises_vars = [];
          let sources_vars = [];
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
              sources_vars.push(v);
              promises_vars.push(upsertAppVar(v));
            }
          }

          collectAppVarRejections(
            await Promise.allSettled(promises_vars),
            sources_vars,
          );
        }

        if (Array.isArray(app.vrs) && app.vrs.length > 0) {
          // Hacemos un upsert de las variables de aplicación
          let promises_appvars = app.vrs.map((v) => {
            return upsertAppVar(v);
          });

          collectAppVarRejections(
            await Promise.allSettled(promises_appvars),
            app.vrs,
          );
        }

        await restoreBots(app.bots, app.idapp);

        // Restaurar los usuarios externos y sus api keys. Los clientes van
        // primero por la FK idclient de las api keys.
        const idclient_map = await restoreApiClients(app.clients);

        // idkey del backup -> idkey real. Se declara fuera del if para que las
        // interval tasks puedan consultarlo aunque el backup no traiga keys.
        let idkey_map = new Map();

        if (Array.isArray(app.keys) && app.keys.length > 0) {
          idkey_map = await restoreApiKeys(app.keys, app.idapp, idclient_map);
        }

        // idendpoint del backup -> idendpoint real luego del upsert.
        // Se declara aquí para que esté disponible al restaurar app.tasks
        // incluso si el backup no trae endpoints.
        let idendpoint_map = new Map();

        if (Array.isArray(app.endpoints) && app.endpoints.length > 0) {

          let promises_endpoints = app.endpoints.map(async (ep) => {
            // Capturar el idendpoint original ANTES del upsert: upsertEndpoint
            // reescribe ep.idendpoint in-place cuando encuentra un endpoint
            // existente con el mismo (idapp + environment + resource + method).
            const source_idendpoint = ep.idendpoint;

            if (!ep.idapp) {
              ep.idapp = app.idapp;
            }

            if (ep.handler == "JS" || ep.handler == "MONGODB") {
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

            // Antes de restaurar el endpoint, eliminar endpoints antiguos que
            // compartan el mismo nombre MCP en el mismo (idapp + environment).
            // Esto permite que el backup reemplace una ruta obsoleta sin
            // violar la restricción de unicidad de nombres MCP.
            await removeConflictingMcpEndpoints(app.idapp, ep.environment, ep);

            // Restaurar el endpoint. Si ya existe un endpoint con el mismo
            // (idapp + environment + resource + method), upsertEndpoint lo
            // reemplaza por completo con los datos del backup.
            let res = await upsertEndpoint(ep);

            return { res, source_idendpoint };
          });

          let result_endpoints = await Promise.allSettled(promises_endpoints);
          console.log("result_endpoints ==>>>", result_endpoints.length);

          for (const r of result_endpoints) {
            if (r.status !== "fulfilled" || !r.value?.res?.result) continue;
            const { res, source_idendpoint } = r.value;
            if (source_idendpoint) {
              idendpoint_map.set(source_idendpoint, res.result.idendpoint);
            }
          }
        }

        // Restaurar las interval tasks del backup. Vienen al mismo nivel que
        // endpoints (app.tasks) y se procesan DESPUÉS de los endpoints por la
        // FK idendpoint. Las tareas que existan en BD pero no estén en el
        // backup NO se eliminan; solo se upsertean las que vienen en él.
        if (Array.isArray(app.tasks) && app.tasks.length > 0) {
          await restoreIntervalTasks(app.tasks, idendpoint_map, idkey_map);
        }
      }

      let new_backup = await getAppBackupById(app.idapp);
      return {
        ...new_backup,
        ...(Object.keys(migration_report).length > 0 ? { migration_report } : {}),
        // Se reporta para que quien restaure sepa que el backup quedó incompleto
        // en lugar de asumir que se restauró todo.
        ...(appvars_rejected.length > 0 ? { appvars_rejected } : {}),
      };
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
    // with_clients: el backup incluye los usuarios externos con api key en la
    // app y esas api keys, al mismo nivel que endpoints.
    const data = await getApplicationTreeByFilters({
      idapp: idapp,
      with_clients: true,
    });
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

/**
 * Obtiene el árbol completo de una aplicación: datos de la app, variables,
 * bots, endpoints, interval tasks y (opcionalmente) los usuarios externos
 * con sus api keys. Todas las colecciones se devuelven al mismo nivel.
 * Usado por getAppBackupById para generar el backup exportable de una app.
 *
 * @param {object} filters
 * @param {boolean} [filters.with_clients] - Incluye `clients` (ApiClient) y
 *   `keys` (ApiKey) en el resultado. Solo para el backup: estas colecciones
 *   contienen credenciales (password hasheada y token), por lo que NO deben
 *   viajar en el árbol que consume el runtime.
 */
export async function getApplicationTreeByFilters(filters = {}) {
  const { idapp, app, enabled, endpoint, with_clients = false } = filters;
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

    const include = [
      {
        model: AppVars,
        as: "vrs",
        required: false,
      },
      {
        model: Bot,
        as: "bots",
        required: false,
      },
      {
        model: Endpoint,
        as: "endpoints",
        required: Object.keys(endpointWhere).length > 0,
        where:
          Object.keys(endpointWhere).length > 0 ? endpointWhere : undefined,
        include: [
          {
            model: IntervalTask,
            as: "tasks",
            required: false,
          }
        ],
      },
    ];

    if (with_clients) {
      // Las api keys de la app traen anidado su usuario externo (ApiClient);
      // ambos se aplanan más abajo a keys / clients.
      include.push({
        model: ApiKey,
        as: "keys",
        required: false,
        include: [
          {
            model: ApiClient,
            as: "client",
            required: false,
          },
        ],
      });
    }

    const data = await Application.findOne({
      where: appWhere,
      include,
    });

    if (!data) return {};

    const appData = data.toJSON();

    // Las interval tasks se exponen al mismo nivel que endpoints (app.tasks),
    // no anidadas dentro de cada endpoint.
    const flat_tasks = [];
    appData.endpoints = (appData.endpoints || []).map((ep) => {
      const { tasks, ...endpoint } = ep;
      if (Array.isArray(tasks) && tasks.length > 0) {
        flat_tasks.push(...tasks);
      }
      return endpoint;
    });
    appData.tasks = flat_tasks;

    if (with_clients) {
      // Los usuarios externos se exponen al mismo nivel que keys (app.clients),
      // deduplicados: un mismo cliente puede tener varias api keys en la app.
      const clients = new Map();
      appData.keys = (appData.keys || []).map((k) => {
        const { client, ...key } = k;
        if (client && !clients.has(client.idclient)) {
          clients.set(client.idclient, client);
        }
        return key;
      });
      appData.clients = [...clients.values()];
    }

    appData.vrs = (appData.vrs || []).map((item) => {
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


