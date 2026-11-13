/**
 * @file ensureEndpointLockTable.js
 * @description Creates the `ofapi_endpoint_lock` table that protects endpoints
 * with `exclusive: true` against concurrent calls from any origin (scheduled
 * IntervalTask, runNowIntervalTask, GUI Tester, MCP execute_endpoint_test,
 * direct HTTP client).
 *
 * Separate from `ofapi_intervaltask` because the endpoint lock is a different
 * concept: it protects the endpoint, not a single task. Two tasks pointing at
 * the same `exclusive` endpoint block each other, and a manual call is blocked
 * too.
 *
 * Idempotent: if the table already exists, it only ensures the unique index on
 * `idendpoint` exists (required for the atomic acquire/insert race).
 */

import { DataTypes, QueryTypes } from "sequelize";
import dbAPIs from "./sequelize.js";

const TABLE_NAME = "ofapi_endpoint_lock";
const UNIQUE_INDEX_NAME = "uq_endpoint_lock_idendpoint";

/**
 * Returns true when `showIndex` already reports a unique index on `idendpoint`.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @returns {Promise<boolean>}
 */
async function hasUniqueEndpointIndex(queryInterface) {
  let indexes = [];
  try {
    indexes = await queryInterface.showIndex(TABLE_NAME);
  } catch (error) {
    // Some dialects (or a missing table) cannot list indexes; treat as absent.
    return false;
  }

  return indexes.some((index) => {
    if (!index.unique) return false;
    const fields = index.fields || [];
    return fields.some((field) => {
      const name = field.attribute || field.name || field;
      return name === "idendpoint";
    });
  });
}

/**
 * Ensures `idendpoint` is unique.
 *
 * The acquire path relies on this: one row per endpoint makes the conditional
 * `UPDATE` and the `INSERT` race unambiguous. Instances created by v14.1.3 got
 * a plain (non-unique) index, so this repairs them in place. Duplicate rows
 * (only possible without the unique index) are collapsed to the newest lease.
 *
 * @param {import("sequelize").QueryInterface} queryInterface
 * @param {(...args: any[]) => void} log
 */
async function ensureUniqueEndpointIndex(queryInterface, log) {
  if (await hasUniqueEndpointIndex(queryInterface)) return;

  const rows = await dbAPIs.query(
    `SELECT idlock, idendpoint FROM ${TABLE_NAME} ORDER BY locked_until DESC`,
    { type: QueryTypes.SELECT },
  );

  const seen = new Set();
  const losers = [];
  for (const row of rows || []) {
    if (seen.has(row.idendpoint)) {
      losers.push(row.idlock);
    } else {
      seen.add(row.idendpoint);
    }
  }

  if (losers.length > 0) {
    await queryInterface.bulkDelete(TABLE_NAME, { idlock: losers });
    log(`[endpoint-lock] Removed ${losers.length} duplicate lock row(s)`);
  }

  try {
    await queryInterface.addIndex(TABLE_NAME, {
      fields: ["idendpoint"],
      unique: true,
      name: UNIQUE_INDEX_NAME,
    });
    log(`[endpoint-lock] Added unique index ${UNIQUE_INDEX_NAME}`);
  } catch (error) {
    // Two instances starting at once can race on the index creation.
    if (!/already exists|duplicate/i.test(String(error?.message || ""))) {
      throw error;
    }
  }
}

/**
 * Creates the table if missing and guarantees the unique index.
 *
 * @param {(...args: any[]) => void} [log] startup logger
 * @returns {Promise<boolean>} true if the table exists (created or already there)
 */
export async function ensureEndpointLockTable(log = () => {}) {
  const queryInterface = dbAPIs.getQueryInterface();

  let exists = false;
  try {
    await queryInterface.describeTable(TABLE_NAME);
    exists = true;
  } catch (error) {
    exists = false;
  }

  if (!exists) {
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
          comment: "Endpoint protected by this lock",
        },
        locked_until: {
          type: DataTypes.DATE,
          allowNull: false,
          comment: "Lease expiry (a past value means the endpoint is free)",
        },
        locked_by: {
          type: DataTypes.STRING(40),
          allowNull: false,
          defaultValue: "manual",
          comment:
            "Who holds the lease: 'interval-task', 'run-now', 'manual', 'mcp', 'gui', 'released'",
        },
        locked_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
          comment: "Instant the lease was acquired",
        },
      });

      await queryInterface.addIndex(TABLE_NAME, {
        fields: ["locked_until"],
        name: "idx_endpoint_lock_locked_until",
      });

      log(`[endpoint-lock] Created table ${TABLE_NAME}`);
    } catch (error) {
      log(`[endpoint-lock] Failed to create table ${TABLE_NAME}:`, error);
      return false;
    }
  }

  try {
    await ensureUniqueEndpointIndex(queryInterface, log);
  } catch (error) {
    log(`[endpoint-lock] Failed to ensure unique index on ${TABLE_NAME}:`, error);
    return false;
  }

  return true;
}
