/**
 * Vínculos grupo↔aplicación por-aplicación.
 *
 * El vínculo vive en la AppVar `$_VAR_TELEGRAM_GROUPS` de CADA aplicación, no en
 * la app system:
 *
 *   $_VAR_TELEGRAM_GROUPS = { "<chat_id>": { environment, linked_by, linked_at, notify_changes? } }
 *
 * El `idapp` es implícito (la app dueña de la variable), por lo que el vínculo
 * viaja con el backup de la app. Un mismo chat de Telegram puede estar vinculado
 * a varias aplicaciones: este módulo agrega la relación chat -> [{ idapp, ... }].
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
 * linked_at, notify_changes? }]. Lee la var de cada aplicación y la aplana.
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
 * Re-vincular conserva `notify_changes` previo si no se pasa uno nuevo.
 *
 * Semántica de `environment`: un entorno EXPLÍCITO (p. ej. el que elige el
 * operador desde el picker del bot) se aplica SIEMPRE — antes `current.environment`
 * ganaba por defecto y un cambio de entorno quedaba ignorado. Si el llamador no
 * envía entorno, se conserva el previo del vínculo o se usa el default `ENV`.
 */
export async function writeAppGroupLink({
  idapp,
  chat_id,
  environment,
  linked_by = "",
  linked_at = new Date().toISOString(),
  notify_changes,
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