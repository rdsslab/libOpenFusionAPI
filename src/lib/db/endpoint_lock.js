/**
 * @file endpoint_lock.js
 * @description Lock exclusivo por endpoint para llamadas directas (no vía IntervalTask).
 *
 * Cuando un endpoint tiene `exclusive: true`, cualquier llamada (GUI Tester, MCP
 * `execute_endpoint_test`, cliente HTTP directo) debe adquirir el lock antes de
 * ejecutarse. Si otro proceso ya tiene el lock vigente, se rechaza con
 * `409 ENDPOINT_LOCKED`.
 *
 * ## Diseño de rendimiento
 *
 * Para evitar golpear la base de datos en cada request, se usa una caché en memoria
 * (`Map` local al proceso) como primera capa:
 *
 *  1. Si el endpoint tiene una entrada en caché con lock vigente → devolver 409
 *     inmediatamente, sin tocar BD.
 *  2. Si no hay entrada en caché → intentar INSERT atómico en BD.
 *     - Éxito: guardar en caché y ejecutar.
 *     - Fallo (otro proceso tiene el lock): guardar en caché (para next requests)
 *       y devolver 409.
 *  3. Al finalizar la ejecución (finally): borrar de caché y DELETE en BD.
 *
 * La caché expira automáticamente tras el TTL del lock (5 min por defecto), así que
 * si el proceso propietario muere sin liberar, la entrada se vacía sola y la siguiente
 * request puede adquirir el lock en BD.
 *
 * La BD sigue siendo la fuente de verdad para coordinar entre múltiples instancias de
 * la API. La caché es solo una optimización de lectura dentro de cada proceso.
 */

import dbAPIs from "./sequelize.js";

const TABLE_NAME = "ofapi_endpoint_lock";

/**
 * Caché en memoria de locks activos por endpoint.
 * Clave: idendpoint. Valor: { lockedUntil: Date, lockedBy: string }.
 * Se autolimpiará al comparar lockedUntil con ahora en cada lectura.
 */
const localLockCache = new Map();

/**
 * Limpia entradas expiradas de la caché local.
 * Se llama pereza mente en cada acquire/release.
 */
function pruneExpired() {
  const now = new Date();
  for (const [idendpoint, entry] of localLockCache.entries()) {
    if (entry.lockedUntil <= now) {
      localLockCache.delete(idendpoint);
    }
  }
}

/**
 * Intenta adquirir un lock exclusivo para un endpoint.
 *
 * Usa la caché local como primera capa para evitar consultas a BD cuando ya se sabe
 * que hay un lock vigente en este proceso. Si no hay entrada en caché, hace un
 * `INSERT ... ON CONFLICT ... WHERE` atómico en BD para coordinar entre instancias.
 *
 * @param {string} idendpoint UUID del endpoint
 * @param {number} ttlSeconds segundos de vida del lock (lease, default 300)
 * @param {string} lockedBy quién lo solicita: 'interval-task' | 'run-now' | 'manual' | 'mcp' | 'gui'
 * @returns {Promise<{success: boolean, idlock?: string, reason?: string}>}
 */
export async function acquireEndpointLock(idendpoint, ttlSeconds = 300, lockedBy = "manual") {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + Number(ttlSeconds) * 1000);

  // --- Capa 1: caché local (sin BD) ---
  pruneExpired();
  const cached = localLockCache.get(idendpoint);
  if (cached && cached.lockedUntil > now) {
    // Ya sabemos que este proceso tiene un lock vigente (o lo vimos hace poco).
    // Devolver 409 sin consultar BD.
    return {
      success: false,
      reason: "ENDPOINT_LOCKED",
      message: `Endpoint ${idendpoint} has an exclusive lock in use (another execution is running).`,
    };
  }

  // --- Capa 2: intento atómico en BD ---
  const queryInterface = dbAPIs.getQueryInterface();
  const idlock = require("crypto").randomUUID();

  try {
    const [result] = await queryInterface.sequelize.query(
      `
      INSERT INTO ${TABLE_NAME} (idlock, idendpoint, locked_until, locked_by, locked_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (idendpoint) DO UPDATE SET
        locked_until = EXCLUDED.locked_until,
        locked_by = EXCLUDED.locked_by,
        locked_at = EXCLUDED.locked_at,
        idlock = EXCLUDED.idlock
      WHERE ${TABLE_NAME}.locked_until IS NULL
         OR ${TABLE_NAME}.locked_until < NOW()
      RETURNING idlock;
      `,
      {
        replacements: [idlock, idendpoint, lockedUntil, lockedBy, now],
      }
    );

    if (result && result.length > 0 && result[0].idlock) {
      // Lock adquirido: guardar en caché local para next requests
      localLockCache.set(idendpoint, { lockedUntil, lockedBy });
      return { success: true, idlock };
    }

    // BD dijo que el lock está vigente (otro proceso). Guardar en caché local
    // para evitar golpear BD en las siguientes requests mientras dure el conflicto.
    // Leer locked_until real para la caché.
    const [rows] = await queryInterface.sequelize.query(
      `SELECT locked_until, locked_by FROM ${TABLE_NAME} WHERE idendpoint = ?`,
      { replacements: [idendpoint], type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    if (rows && rows.length > 0) {
      localLockCache.set(idendpoint, {
        lockedUntil: new Date(rows[0].locked_until),
        lockedBy: rows[0].locked_by,
      });
    }

    return {
      success: false,
      reason: "ENDPOINT_LOCKED",
      message: `Endpoint ${idendpoint} has an exclusive lock in use (another execution is running).`,
    };
  } catch (error) {
    // Fallback para dialectos que no soportan ON CONFLICT con WHERE (MSSQL, SQLite viejo).
    return acquireEndpointLockFallback(queryInterface, idendpoint, ttlSeconds, lockedBy, now, lockedUntil);
  }
}

/**
 * Fallback para dialectos que no soportan ON CONFLICT con cláusula WHERE.
 */
async function acquireEndpointLockFallback(queryInterface, idendpoint, ttlSeconds, lockedBy, now, lockedUntil) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT idlock, locked_until FROM ${TABLE_NAME} WHERE idendpoint = ?`,
    { replacements: [idendpoint], type: queryInterface.sequelize.QueryTypes.SELECT }
  );

  const existing = rows && rows.length > 0 ? rows[0] : null;

  if (existing) {
    const lockUntil = new Date(existing.locked_until);
    if (lockUntil > now) {
      // Lock vigente: cachear y devolver 409
      localLockCache.set(idendpoint, { lockedUntil: lockUntil, lockedBy: existing.locked_by });
      return {
        success: false,
        reason: "ENDPOINT_LOCKED",
        message: `Endpoint ${idendpoint} has an exclusive lock in use (another execution is running).`,
      };
    }
    // Lock expirado: intentar actualizar
    const newIdlock = require("crypto").randomUUID();
    const [affected] = await queryInterface.sequelize.query(
      `UPDATE ${TABLE_NAME} SET locked_until = ?, locked_by = ?, locked_at = ?, idlock = ?
       WHERE idendpoint = ? AND locked_until < ?`,
      {
        replacements: [lockedUntil, lockedBy, now, newIdlock, idendpoint, now],
      }
    );
    if (affected > 0) {
      localLockCache.set(idendpoint, { lockedUntil, lockedBy });
      return { success: true, idlock: newIdlock };
    }
    // Carrera: otro proceso lo actualizó primero
    return {
      success: false,
      reason: "ENDPOINT_LOCKED",
      message: `Endpoint ${idendpoint} has an exclusive lock in use (another execution is running).`,
    };
  }

  // No existe lock: insertar
  const idlock = require("crypto").randomUUID();
  await queryInterface.sequelize.query(
    `INSERT INTO ${TABLE_NAME} (idlock, idendpoint, locked_until, locked_by, locked_at)
     VALUES (?, ?, ?, ?, ?)`,
    { replacements: [idlock, idendpoint, lockedUntil, lockedBy, now] }
  );
  localLockCache.set(idendpoint, { lockedUntil, lockedBy });
  return { success: true, idlock };
}

/**
 * Libera el lock exclusivo de un endpoint (caché local + BD).
 *
 * @param {string} idendpoint UUID del endpoint
 * @returns {Promise<boolean>} true si se liberó (o no existía)
 */
export async function releaseEndpointLock(idendpoint) {
  // Borrar de caché local
  localLockCache.delete(idendpoint);

  const queryInterface = dbAPIs.getQueryInterface();
  try {
    await queryInterface.sequelize.query(
      `DELETE FROM ${TABLE_NAME} WHERE idendpoint = ?`,
      { replacements: [idendpoint] }
    );
    return true;
  } catch (error) {
    console.error("[endpoint-lock] Error releasing lock:", error);
    return false;
  }
}

/**
 * Verifica si un endpoint tiene un lock vigente (sin adquirirlo).
 * Consulta BD directamente (usa caché solo como hint rápido).
 *
 * @param {string} idendpoint UUID del endpoint
 * @returns {Promise<{locked: boolean, lockedBy?: string, lockedUntil?: Date}>}
 */
export async function isEndpointLocked(idendpoint) {
  const now = new Date();

  // Hint rápido desde caché local
  const cached = localLockCache.get(idendpoint);
  if (cached && cached.lockedUntil > now) {
    return { locked: true, lockedBy: cached.lockedBy, lockedUntil: cached.lockedUntil };
  }

  const queryInterface = dbAPIs.getQueryInterface();
  const [rows] = await queryInterface.sequelize.query(
    `SELECT locked_by, locked_until FROM ${TABLE_NAME} WHERE idendpoint = ?`,
    { replacements: [idendpoint], type: queryInterface.sequelize.QueryTypes.SELECT }
  );

  if (!rows || rows.length === 0) {
    return { locked: false };
  }

  const row = rows[0];
  const lockedUntil = new Date(row.locked_until);

  if (lockedUntil > now) {
    localLockCache.set(idendpoint, { lockedUntil, lockedBy: row.locked_by });
    return { locked: true, lockedBy: row.locked_by, lockedUntil };
  }

  return { locked: false };
}
