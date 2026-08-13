/**
 * @file interval_task_run.js
 * @description Historial de ejecuciones de las tareas programadas.
 *
 * A diferencia de los backups de endpoints o bots, aquí cada ejecución es distinta, así
 * que no hay deduplicación por hash que acote el crecimiento: la poda es explícita y se
 * gobierna con `history_limit` de cada tarea (0 = no guardar historial).
 */

import { Op } from "sequelize";
import { IntervalTaskRun } from "./models.js";

/** Tope de la respuesta guardada, en caracteres del JSON serializado. */
const MAX_RESPONSE_CHARS = 4096;

/**
 * Recorta la respuesta para que una tarea que devuelve megabytes no infle la tabla.
 * @param {any} response
 * @returns {any} la respuesta original, o un marcador con el fragmento inicial
 */
export function truncateResponse(response) {
  if (response === undefined || response === null) return null;

  let serialized;
  try {
    serialized = JSON.stringify(response);
  } catch (error) {
    return { truncated: true, note: "response is not serializable" };
  }

  if (!serialized || serialized.length <= MAX_RESPONSE_CHARS) return response;

  return {
    truncated: true,
    size: serialized.length,
    preview: serialized.slice(0, MAX_RESPONSE_CHARS),
  };
}

/**
 * Registra una ejecución. Nunca lanza: el historial es observabilidad, no puede tumbar
 * la ejecución de la tarea.
 *
 * @param {{idtask: number|string, started_at: Date, finished_at?: Date, duration_ms?: number, status: number, http_status?: number|null, error?: string|null, response?: any}} data
 * @returns {Promise<object|null>}
 */
export const createIntervalTaskRun = async (data) => {
  try {
    return await IntervalTaskRun.create({
      idtask: data.idtask,
      started_at: data.started_at,
      finished_at: data.finished_at || new Date(),
      duration_ms: Math.max(0, Math.floor(Number(data.duration_ms) || 0)),
      status: data.status,
      http_status: data.http_status ?? null,
      error: data.error ? String(data.error).slice(0, 2000) : null,
      response: truncateResponse(data.response),
    });
  } catch (error) {
    console.error("Error creating interval task run:", error);
    return null;
  }
};

/**
 * Deja solo las `keep` ejecuciones más recientes de la tarea.
 *
 * @param {number|string} idtask
 * @param {number} keep 0 borra todo el historial de la tarea
 * @returns {Promise<number>} filas borradas
 */
export const pruneIntervalTaskRuns = async (idtask, keep) => {
  try {
    const limit = Math.max(0, Math.floor(Number(keep) || 0));

    if (limit === 0) {
      return await IntervalTaskRun.destroy({ where: { idtask } });
    }

    // Se busca el corte y luego se borra por id: `DELETE ... LIMIT/OFFSET` no es
    // portable entre los dialectos que soporta el proyecto.
    const survivors = await IntervalTaskRun.findAll({
      attributes: ["idrun"],
      where: { idtask },
      order: [["idrun", "DESC"]],
      limit,
      raw: true,
    });

    if (survivors.length < limit) return 0;

    const oldestKept = survivors[survivors.length - 1].idrun;

    return await IntervalTaskRun.destroy({
      where: { idtask, idrun: { [Op.lt]: oldestKept } },
    });
  } catch (error) {
    console.error("Error pruning interval task runs:", error);
    return 0;
  }
};

/**
 * Últimas ejecuciones de una tarea, de la más reciente a la más antigua.
 *
 * @param {number|string} idtask
 * @param {{limit?: number}} [options]
 * @returns {Promise<object[]>}
 */
export const getIntervalTaskRuns = async (idtask, options = {}) => {
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);

  return await IntervalTaskRun.findAll({
    where: { idtask },
    order: [["idrun", "DESC"]],
    limit,
  });
};
