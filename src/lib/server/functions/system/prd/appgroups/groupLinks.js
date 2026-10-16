/**
 * Vínculos grupo↔aplicación por-aplicación.
 *
 * El vínculo vive en la AppVar `$_VAR_TELEGRAM_GROUPS` de CADA aplicación, no en
 * la app system:
 *
 *   $_VAR_TELEGRAM_GROUPS = { "<chat_id>": { environment, linked_by, linked_at, notify_changes?, notify_activity? } }
 *
 * El `idapp` es implícito (la app dueña de la variable), por lo que el vínculo
 * viaja con el backup de la app. Un mismo chat de Telegram puede estar vinculado
 * a varias aplicaciones: este módulo agrega la relación chat -> [{ idapp, ... }].
 *
 * `notify_activity` decide qué tráfico de la app llega al grupo como digest
 * (`all`, `errors`, `5xx`, `off`; ver `NOTIFY_ACTIVITY_MODES`). Es independiente de
 * `notify_changes`, que gobierna los avisos de cambios de configuración. Si el campo
 * no está en el vínculo se asume `errors`, así que un vínculo anterior a este campo
 * (o creado sin pedirlo) no cambia de comportamiento por accidente: solo recibe el
 * digest cuando la ventana tiene algún 4xx o 5xx.
 *
 * Los cursores de deduplicación NO viven aquí: siguen en la app system
 * (`$_VAR_GROUP_APP_CURSORS` por grupo y `$_VAR_GROUP_APP_CHANGES_CURSOR` global)
 * y las tareas de intervalo los escriben vía capa de base de datos (sin
 * invalidación de caché de endpoints).
 *
 * Escritura: este módulo solo usa la capa DB (`upsertAppVar` / `ensureAppVarOnce`),
 * que NO borra el caché de endpoints. Es intencional: la variable no se interpola
 * en código de endpoints; solo la leen el bot y los scanners en cada corrida.
 */
import { getAppVarsByIdApp, upsertAppVar, ensureAppVarOnce } from "../../../../../db/appvars.js";
import { Application } from "../../../../../db/models.js";

export const GROUPS_VAR = "$_VAR_TELEGRAM_GROUPS";
const ENV = "prd";

/**
 * Modos del filtro de actividad por vínculo.
 *  - `all`    envía el digest con cualquier petición en la ventana.
 *  - `errors` lo envía solo si la ventana tiene algún 4xx o 5xx (default).
 *  - `5xx`    solo si hay algún 5xx.
 *  - `off`    nunca; el vínculo sigue activo para comandos y avisos de cambios.
 */
export const NOTIFY_ACTIVITY_MODES = Object.freeze(["all", "errors", "5xx", "off"]);

/** Modo efectivo cuando el vínculo no trae `notify_activity`. */
export const DEFAULT_NOTIFY_ACTIVITY = "errors";

/**
 * Normaliza el valor de `notify_activity` de un vínculo.
 *
 * @param {unknown} value
 * @returns {string|null} un modo válido, o `null` si viene vacío o desconocido.
 */
export function normalizeNotifyActivity(value) {
  if (value === undefined || value === null) return null;
  const mode = String(value).trim().toLowerCase();
  return NOTIFY_ACTIVITY_MODES.includes(mode) ? mode : null;
}

/** Lee un objeto JSON serializado en AppVar tolerando valores incompletos. */
function parseJsonVar(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Fila AppVar `$_VAR_TELEGRAM_GROUPS` (environment) de una app, o undefined. */
async function findGroupsVar(idapp) {
  const rows = await getAppVarsByIdApp(idapp);
  const list = (rows || []).map((r) => (r.toJSON ? r.toJSON() : r));
  return list.find((r) => r.name === GROUPS_VAR && String(r.environment || "") === ENV);
}

/** Mapa { chat_id: entry } de una app concreta. */
export async function readAppGroupsMap(idapp) {
  const row = await findGroupsVar(idapp);
  if (!row || row.value === null || row.value === undefined) return {};
  return parseJsonVar(row.value, {});
}

/** Upsert seguro (capa DB): reusa idvar si la variable ya existe. */
async function setAppGroupsMap(idapp, map) {
  const existing = await findGroupsVar(idapp);
  const payload = {
    idapp,
    name: GROUPS_VAR,
    environment: ENV,
    type: "string",
    value: JSON.stringify(map),
  };
  if (existing?.idvar) return upsertAppVar({ ...payload, idvar: existing.idvar });
  return ensureAppVarOnce(payload);
}

/**
 * Todos los vínculos del servidor, chat -> [{ idapp, environment, linked_by,
 * linked_at, notify_changes?, notify_activity }]. Lee la var de cada aplicación y la aplana.
 * `notify_activity` es el modo EFECTIVO: los vínculos sin el campo devuelven el default.
 */
export async function readAppGroupLinks() {
  let apps = [];
  try {
    apps = await Application.findAll({ attributes: ["idapp"] });
  } catch (error) {
    console.error("[groupLinks] list apps:", error.message);
  }

  const links = [];
  for (const app of apps) {
    const plain = app.toJSON ? app.toJSON() : app;
    const idapp = String(plain?.idapp || "");
    if (!idapp) continue;
    const map = await readAppGroupsMap(idapp);
    for (const [chatId, entry] of Object.entries(map)) {
      if (!entry || typeof entry !== "object") continue;
      links.push({
        chat_id: String(chatId),
        idapp,
        environment: String(entry.environment || ENV),
        linked_by: entry.linked_by,
        linked_at: entry.linked_at,
        notify_changes: entry.notify_changes,
        // Modo efectivo: un vínculo sin el campo cae al default (`errors`), no a `all`.
        notify_activity: normalizeNotifyActivity(entry.notify_activity) || DEFAULT_NOTIFY_ACTIVITY,
      });
    }
  }
  return links;
}

/** Índice chat -> vínculos (preservando el orden de las apps). */
export async function readGroupLinksByChat() {
  const links = await readAppGroupLinks();
  const byChat = new Map();
  for (const link of links) {
    if (!byChat.has(link.chat_id)) byChat.set(link.chat_id, []);
    byChat.get(link.chat_id).push(link);
  }
  return byChat;
}

/** Vínculos de un chat concreto. */
export async function getGroupLinksForChat(chatId) {
  const key = String(chatId);
  const byChat = await readGroupLinksByChat();
  return byChat.get(key) || [];
}

/**
 * Crea o actualiza el vínculo chat -> app en la var de la app.
 * Re-vincular conserva `notify_changes` y `notify_activity` previos si no se pasa uno nuevo.
 *
 * Semántica de `environment`: un entorno EXPLÍCITO (p. ej. el que elige el
 * operador desde el picker del bot) se aplica SIEMPRE — antes `current.environment`
 * ganaba por defecto y un cambio de entorno quedaba ignorado. Si el llamador no
 * envía entorno, se conserva el previo del vínculo o se usa el default `ENV`.
 *
 * Un `notify_activity` desconocido se ignora y se conserva el previo: solo tiene
 * sentido persistir uno de `NOTIFY_ACTIVITY_MODES`. Quien necesita rechazar el valor
 * inválido con un 400 debe validarlo antes (lo hace `fnAppGroupLinkWrite`).
 */
export async function writeAppGroupLink({
  idapp,
  chat_id,
  environment,
  linked_by = "",
  linked_at = new Date().toISOString(),
  notify_changes,
  notify_activity,
}) {
  const key = String(chat_id);
  const map = await readAppGroupsMap(idapp);
  const current = map[key] || {};
  const next = {
    environment: environment ?? current.environment ?? ENV,
    linked_by: linked_by !== undefined ? linked_by : current.linked_by || "",
    linked_at: linked_at || current.linked_at || new Date().toISOString(),
  };
  if (notify_changes !== undefined) next.notify_changes = notify_changes === true || notify_changes === "true";
  else if (current.notify_changes !== undefined) next.notify_changes = current.notify_changes;
  if (notify_activity !== undefined) {
    const mode = normalizeNotifyActivity(notify_activity);
    if (mode) next.notify_activity = mode;
    else if (current.notify_activity !== undefined) next.notify_activity = current.notify_activity;
  } else if (current.notify_activity !== undefined) {
    next.notify_activity = current.notify_activity;
  }
  map[key] = next;
  await setAppGroupsMap(idapp, map);
  return true;
}

/** Elimina el vínculo chat -> app de la var de la app. */
export async function removeAppGroupLink({ idapp, chat_id }) {
  const key = String(chat_id);
  const map = await readAppGroupsMap(idapp);
  if (map[key] === undefined) return false;
  delete map[key];
  await setAppGroupsMap(idapp, map);
  return true;
}

/** Cambia la bandera notify_changes de un vínculo existente. */
export async function setNotifyChanges({ idapp, chat_id, notify_changes }) {
  const key = String(chat_id);
  const map = await readAppGroupsMap(idapp);
  if (map[key] === undefined) return false;
  map[key].notify_changes = notify_changes === true || notify_changes === "true";
  await setAppGroupsMap(idapp, map);
  return true;
}

/**
 * Cambia el filtro de actividad (`notify_activity`) de un vínculo existente.
 *
 * @returns {Promise<string|null>} el modo persistido, o `null` si el vínculo no
 *   existe o el modo no es válido. El campo no se escribe si no es válido: el
 *   llamador (endpoint/bot) traduce `null` en un 400 con la lista de modos.
 */
export async function setNotifyActivity({ idapp, chat_id, notify_activity }) {
  const mode = normalizeNotifyActivity(notify_activity);
  if (!mode) return null;

  const key = String(chat_id);
  const map = await readAppGroupsMap(idapp);
  if (map[key] === undefined) return null;
  map[key].notify_activity = mode;
  await setAppGroupsMap(idapp, map);
  return mode;
}