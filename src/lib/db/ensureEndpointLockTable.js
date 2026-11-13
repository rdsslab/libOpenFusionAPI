/**
 * @file ensureEndpointLockTable.js
 * @description Crea la tabla `ofapi_endpoint_lock` para proteger endpoints con
 * `exclusive: true` contra llamadas concurrentes de cualquier origen
 * (IntervalTask programada, runNowIntervalTask, GUI Tester, MCP execute_endpoint_test,
 * cliente HTTP directo).
 *
 * Tabla separada de `ofapi_intervaltask` porque el lock por endpoint es un concepto
 * distinto: protege el endpoint, no una tarea concreta. Dos tareas que apuntan al
 * mismo endpoint con `exclusive: true` se bloquean entre sí, y también se bloquea
 * contra una llamada manual directa.
 *
 * Idempotente: si la tabla ya existe, no hace nada.
 */

import { DataTypes } from "sequelize";
import dbAPIs from "./sequelize.js";
import { ModelNames } from "./models.js";

const TABLE_NAME = "ofapi_endpoint_lock";

/**
 * Crea la tabla si no existe.
 *
 * @param {(...args: any[]) => void} [log] logger opcional del arranque
 * @returns {Promise<boolean>} true si se creó (o ya existía), false si falló
 */
export async function ensureEndpointLockTable(log = () => {}) {
  const queryInterface = dbAPIs.getQueryInterface();

  try {
    await queryInterface.describeTable(TABLE_NAME);
    // Ya existe
    return true;
  } catch (error) {
    // No existe: crear
  }

  try {
    await queryInterface.createTable(TABLE_NAME, {
      idlock: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      idendpoint: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "Endpoint protegido por este lock",
      },
      locked_until: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: "Hasta cuándo vence el lock (lease)",
      },
      locked_by: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "manual",
        comment:
          "Quién tiene el lock: 'interval-task', 'run-now', 'manual', 'mcp', 'gui'",
      },
      locked_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: "Instante en que se adquirió el lock",
      },
    });

    await queryInterface.addIndex(TABLE_NAME, {
      fields: ["idendpoint"],
      name: "idx_endpoint_lock_idendpoint",
    });

    await queryInterface.addIndex(TABLE_NAME, {
      fields: ["locked_until"],
      name: "idx_endpoint_lock_locked_until",
    });

    log(`[endpoint-lock] Created table ${TABLE_NAME}`);
    return true;
  } catch (error) {
    log(`[endpoint-lock] Failed to create table ${TABLE_NAME}:`, error);
    return false;
  }
}
