/**
 * @file interval_task_duplicates.js
 * @description Detección de tareas de intervalo duplicadas, por identidad operativa.
 *
 * Módulo puro: no toca base de datos ni red, así que se puede probar aislado. Lo
 * consume el endpoint interno `GET /interval_tasks/duplicates` (tool MCP
 * `list_interval_task_duplicates`) para que un operador vea qué tareas llaman al
 * mismo endpoint con el mismo payload antes de decidir si sobra alguna.
 *
 * La identidad operativa de una tarea es `(idendpoint + params)`: es lo que decide
 * qué ocurre cuando la tarea se dispara. Dos tareas con esa misma identidad hacen
 * exactamente el mismo trabajo, y si además comparten horario son un duplicado
 * accidental (el que dejó el seed duplicado en bases anteriores a la migración a
 * UUID). Si el horario difiere, pueden ser intencionales —la misma llamada a horas
 * distintas— y por eso el grupo se reporta con `same_schedule: false` en lugar de
 * marcarse como error.
 */
import { stableStringify } from "./utils.js";

/**
 * Clave de identidad operativa de una tarea: mismo endpoint + mismos params.
 * El orden de las claves de `params` no altera la clave (`stableStringify`).
 *
 * @param {object} task
 * @returns {string}
 */
export function taskEquivalenceKey(task) {
  return `${task?.idendpoint ?? ""}::${stableStringify(task?.params ?? {})}`;
}

/**
 * Firma del horario. `same_schedule` compara estas firmas: dos tareas idénticas en
 * endpoint y payload pero con distinto horario no son, necesariamente, un error.
 *
 * @param {object} task
 * @returns {string}
 */
export function scheduleSignature(task) {
  return [
    task?.schedule_mode || "interval",
    task?.cron || "",
    String(task?.interval ?? ""),
    task?.timezone || "",
    task?.window_start || "",
    task?.window_end || "",
    task?.window_days || "",
  ].join("|");
}

/**
 * Agrupa las tareas que comparten `(idendpoint + params)`.
 *
 * @param {Array<object>} tasks - filas tal como las devuelve `getIntervalTask`.
 * @returns {Array<object>} solo los grupos con dos o más tareas.
 */
export function findDuplicateTaskGroups(tasks = []) {
  const groups = new Map();

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task?.idendpoint) continue;
    const key = taskEquivalenceKey(task);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }

  const duplicates = [];

  for (const items of groups.values()) {
    if (items.length < 2) continue;

    const schedules = new Set(items.map(scheduleSignature));
    const first = items[0];

    duplicates.push({
      idendpoint: first.idendpoint,
      method: first.method ?? null,
      resource: first.resource ?? null,
      environment: first.environment ?? null,
      idapp: first.idapp ?? null,
      app: first.app ?? null,
      params: first.params ?? {},
      count: items.length,
      enabled_count: items.filter((i) => i.task_enabled === true || i.task_enabled === 1).length,
      // true = todas idénticas en horario (casi seguro accidental);
      // false = horarios distintos (pueden ser intencionales: misma llamada a horas distintas).
      same_schedule: schedules.size === 1,
      tasks: items.map((i) => ({
        idtask: i.idtask,
        note: i.note ?? null,
        task_enabled: i.task_enabled === true || i.task_enabled === 1,
        schedule_mode: i.schedule_mode || "interval",
        interval: i.interval ?? null,
        cron: i.cron ?? null,
        timezone: i.timezone ?? null,
        idkey: i.idkey ?? null,
        disabled_by: i.disabled_by ?? null,
        last_run: i.last_run ?? null,
        next_run: i.next_run ?? null,
      })),
    });
  }

  // Más copias primero; a igual cantidad, orden estable por app/recurso y endpoint.
  duplicates.sort(
    (a, b) =>
      b.count - a.count ||
      String(a.app).localeCompare(String(b.app)) ||
      String(a.resource).localeCompare(String(b.resource)) ||
      String(a.idendpoint).localeCompare(String(b.idendpoint)),
  );

  return duplicates;
}
