/**
 * @file endpoint_lock.js
 * @description Lock exclusivo por endpoint para llamadas directas (no vía IntervalTask).
 *
 * Cuando un endpoint tiene `exclusive: true`, cualquier llamada (GUI Tester, MCP
 * `execute_endpoint_test`, cliente HTTP directo, o IntervalTask que apunte a ese
 * endpoint) debe adquirir el lock antes de ejecutarse. Si otro proceso ya tiene el
 * lock vigente, se rechaza con `409 ENDPOINT_LOCKED`.
 *
 * El lock es un lease con `locked_until` (TTL). Si el proceso propietario muere a
 * media corrida, el lock expira automáticamente y otra llamada puede adquirirlo.
 */

import { Op, where, col } from "sequelize";
import dbAPIs from "./sequelize.js";

const TABLE_NAME = "ofapi_endpoint_lock";
const queryInterface = dbAPIs.getQueryInterface();

/**
 * Intenta adquirir un lock exclusivo para un endpoint.
 *
 * Usa un UPDATE atómico `WHERE locked_until IS NULL OR locked_until < NOW()` para
 * evitar race conditions entre múltiples instancias de la API.
 *
 * @param {string} idendpoint UUID del endpoint
 * @param {number} ttlSeconds segundos de vida del lock (lease)
 * @param {string} lockedBy quién lo solicita: 'interval-task' | 'run-now' | 'manual' | 'mcp' | 'gui'
 * @returns {Promise<{success: boolean, idlock?: string, reason?: string}>}
 */
export async function acquireEndpointLock(idendpoint, ttlSeconds, lockedBy = "manual") {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + Number(ttlSeconds || 300) * 1000);

  // Intentar INSERT (no existe lock) o UPDATE (existe lock expirado)
  // Usamos un enfoque de "upsert atómico": primero intentamos INSERT; si falla por
  // unique constraint (otro proceso lo creó entre tanto), verificamos si el lock
  // existente está expirado y lo actualizamos.
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
        replacements: [
          require("crypto").randomUUID(),
          idendpoint,
          lockedUntil,
          lockedBy,
          now,
        ],
      }
    );

    if (result && result.length > 0 && result[0].idlock) {
      return { success: true, idlock: result[0].idlock };
    }

    // El UPDATE no afectó filas porque el lock está vigente
    return {
      success: false,
      reason: "ENDPOINT_LOCKED",
      message: `El endpoint ${idendpoint} tiene un lock exclusivo vigente (otra ejecución en curso).`,
    };
  } catch (error) {
    // Algunos dialectos (MSSQL, SQLite antiguo) no soportan ON CONFLICT con WHERE.
    // Fallback: verificar manualmente y hacer INSERT.
    return acquireEndpointLockFallback(idendpoint, ttlSeconds, lockedBy);
  }
}

/**
 * Fallback para dialectos que no soportan ON CONFLICT con cláusula WHERE.
 * Lee el lock existente, verifica si está expirado, e intenta INSERT.
 */
async function acquireEndpointLockFallback(idendpoint, ttlSeconds, lockedBy) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + Number(ttlSeconds || 300) * 1000);

  // Leer lock existente
  const [rows] = await queryInterface.sequelize.query(
    `SELECT idlock, locked_until FROM ${TABLE_NAME} WHERE idendpoint = ?`,
    { replacements: [idendpoint], type: queryInterface.sequelize.QueryTypes.SELECT }
  );

  const existing = rows && rows.length > 0 ? rows[0] : null;

  if (existing) {
    const lockUntil = new Date(existing.locked_until);
    if (lockUntil > now) {
      // Lock vigente
      return {
        success: false,
        reason: "ENDPOINT_LOCKED",
        message: `El endpoint ${idendpoint} tiene un lock exclusivo vigente (otra ejecución en curso).`,
      };
    }
    // Lock expirado: intentar actualizar
    const [affected] = await queryInterface.sequelize.query(
      `UPDATE ${TABLE_NAME} SET locked_until = ?, locked_by = ?, locked_at = ?, idlock = ?
       WHERE idendpoint = ? AND locked_until < ?`,
      {
        replacements: [lockedUntil, lockedBy, now, require("crypto").randomUUID(), idendpoint, now],
      }
    );
    if (affected > 0) {
      return { success: true, idlock: existing.idlock };
    }
    // Carrera: otro proceso lo actualizó primero
    return {
      success: false,
      reason: "ENDPOINT_LOCKED",
      message: `El endpoint ${idendpoint} tiene un lock exclusivo vigente (otra ejecución en curso).`,
    };
  }

  // No existe lock: insertar
  const idlock = require("crypto").randomUUID();
  await queryInterface.sequelize.query(
    `INSERT INTO ${TABLE_NAME} (idlock, idendpoint, locked_until, locked_by, locked_at)
     VALUES (?, ?, ?, ?, ?)`,
    { replacements: [idlock, idendpoint, lockedUntil, lockedBy, now] }
  );
  return { success: true, idlock };
}

/**
 * Libera el lock exclusivo de un endpoint.
 *
 * @param {string} idendpoint UUID del endpoint
 * @returns {Promise<boolean>} true si se liberó (o no existía)
 */
export async function releaseEndpointLock(idendpoint) {
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
 *
 * @param {string} idendpoint UUID del endpoint
 * @returns {Promise<{locked: boolean, lockedBy?: string, lockedUntil?: Date}>}
 */
export async function isEndpointLocked(idendpoint) {
  const now = new Date();
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
    return { locked: true, lockedBy: row.locked_by, lockedUntil };
  }

  return { locked: false };
}
