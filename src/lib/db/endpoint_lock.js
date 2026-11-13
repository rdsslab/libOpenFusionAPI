/**
 * @file endpoint_lock.js
 * @description Exclusive lock per endpoint for direct calls (not only IntervalTask).
 *
 * When an endpoint has `exclusive: true`, any call (GUI Tester, MCP
 * `execute_endpoint_test`, direct HTTP client, or an IntervalTask hitting that
 * endpoint) must acquire the lock before running. If another execution already
 * holds a valid lease, the caller gets `409 ENDPOINT_LOCKED`.
 *
 * ## Performance design
 *
 * The database is only touched when a process actually has to acquire the lock.
 * Endpoints without `exclusive: true` never reach this module, so the vast
 * majority of traffic pays nothing.
 *
 * For exclusive endpoints a process-local `Map` acts as a first layer:
 *
 *  1. Owned lock: the process already holds the lease, so a second concurrent
 *     request is rejected without a query (it cannot run in parallel anyway).
 *  2. Lock held by another process: the conflict is cached for a very short
 *     window (`REMOTE_LOCK_CACHE_MS`) so a burst of concurrent requests collapses
 *     into one query. The window is short on purpose: as soon as the owner
 *     releases the lease, every instance must see it, not wait for the TTL.
 *  3. No cached entry: one atomic `UPDATE` takes over an existing row whose lease
 *     expired. If the row does not exist yet, a single `INSERT` creates it.
 *
 * The row is never deleted: release just moves `locked_until` into the past. That
 * keeps the steady-state cost at one `UPDATE` to acquire and one `UPDATE` to
 * release, with no `INSERT`/`DELETE` churn on a hot table.
 *
 * The database stays the source of truth for multi-instance coordination; the
 * cache is only a read optimization inside each process.
 */

import { randomUUID } from "node:crypto";
import { QueryTypes } from "sequelize";
import dbAPIs from "./sequelize.js";

const TABLE_NAME = "ofapi_endpoint_lock";
const DEFAULT_TTL_SECONDS = 300;

/**
 * How long a "someone else holds the lock" answer is reused before asking the
 * database again. Short enough that a released lease is visible almost
 * immediately, long enough to absorb a burst of concurrent requests.
 */
const REMOTE_LOCK_CACHE_MS = 1000;

/**
 * Soft cap for the local cache. Expired entries are harmless (they are checked
 * on read), so pruning is only about bounded memory, not correctness.
 */
const CACHE_PRUNE_THRESHOLD = 1000;

/**
 * @typedef {object} CacheEntry
 * @property {string} idlock Lease id (primary key of the row).
 * @property {Date} lockedUntil Lease expiry.
 * @property {string} lockedBy Who acquired it.
 * @property {boolean} owned True when this process is the lease owner.
 * @property {Date} cacheUntil When this cache entry stops being trusted.
 */

/** @type {Map<string, CacheEntry>} */
const localLockCache = new Map();

/**
 * Drops cache entries that are no longer trustworthy.
 *
 * @param {Date} now
 */
function pruneExpired(now) {
  for (const [idendpoint, entry] of localLockCache) {
    if (entry.cacheUntil <= now) localLockCache.delete(idendpoint);
  }
}

/**
 * Stores a cache entry for a lease.
 *
 * @param {string} idendpoint
 * @param {object} entry
 * @param {string} entry.idlock
 * @param {Date} entry.lockedUntil
 * @param {string} entry.lockedBy
 * @param {boolean} entry.owned
 * @param {Date} now
 */
function remember(idendpoint, { idlock, lockedUntil, lockedBy, owned }, now) {
  const cacheUntil = owned
    ? lockedUntil
    : new Date(Math.min(lockedUntil.getTime(), now.getTime() + REMOTE_LOCK_CACHE_MS));

  localLockCache.set(idendpoint, {
    idlock,
    lockedUntil,
    lockedBy,
    owned,
    cacheUntil,
  });
}

/**
 * Normalizes the affected-row count returned by `sequelize.query` for write
 * statements. Dialects disagree: Postgres/SQLite/MSSQL return a number, MySQL
 * returns `affectedRows`, and older shapes return a `[count]` tuple.
 *
 * @param {unknown} result
 * @returns {number}
 */
function affectedRows(result) {
  if (typeof result === "number") return result;
  if (Array.isArray(result)) return Number(result[0]) || 0;
  if (result && typeof result === "object") {
    if (typeof result.affectedRows === "number") return result.affectedRows;
    if (typeof result.changes === "number") return result.changes;
    if (typeof result.rowCount === "number") return result.rowCount;
  }
  return 0;
}

/**
 * Detects a duplicate-key error without depending on one dialect's error shape.
 *
 * @param {any} error
 * @returns {boolean}
 */
function isUniqueViolation(error) {
  const code = String(error?.parent?.code || error?.original?.code || "");
  if (["23505", "2627", "2601", "ER_DUP_ENTRY", "SQLITE_CONSTRAINT"].includes(code)) {
    return true;
  }
  const name = String(error?.name || "");
  if (/UniqueConstraint/i.test(name)) return true;
  return /unique constraint|duplicate (key|entry)|UNIQUE constraint failed/i.test(
    String(error?.message || ""),
  );
}

/**
 * @param {string} idendpoint
 * @param {string} lockedBy
 * @returns {{success: false, reason: string, message: string}}
 */
function lockedResponse(idendpoint, lockedBy) {
  const holder = lockedBy ? ` (held by ${lockedBy})` : "";
  return {
    success: false,
    reason: "ENDPOINT_LOCKED",
    message: `Endpoint ${idendpoint} is locked by another execution in progress${holder}.`,
  };
}

/**
 * Tries to acquire the exclusive lock of an endpoint.
 *
 * @param {string} idendpoint Endpoint UUID.
 * @param {number} [ttlSeconds=300] Lease length in seconds.
 * @param {string} [lockedBy="manual"] Caller label: 'interval-task' | 'run-now' | 'manual' | 'mcp' | 'gui'.
 * @returns {Promise<{success: boolean, idlock?: string, lockedUntil?: Date, reason?: string, message?: string}>}
 */
export async function acquireEndpointLock(idendpoint, ttlSeconds = DEFAULT_TTL_SECONDS, lockedBy = "manual") {
  if (!idendpoint) {
    throw new Error("acquireEndpointLock: idendpoint is required");
  }

  const ttl = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : DEFAULT_TTL_SECONDS;
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttl * 1000);

  // --- Layer 1: process-local cache (no database round trip) ---
  if (localLockCache.size > CACHE_PRUNE_THRESHOLD) pruneExpired(now);

  const cached = localLockCache.get(idendpoint);
  if (cached) {
    if (cached.cacheUntil > now) {
      return lockedResponse(idendpoint, cached.lockedBy);
    }
    localLockCache.delete(idendpoint);
  }

  // --- Layer 2: one atomic statement takes over an expired (or empty) lease ---
  const idlock = randomUUID();
  const updated = await dbAPIs.query(
    `UPDATE ${TABLE_NAME}
        SET locked_until = ?, locked_by = ?, locked_at = ?, idlock = ?
      WHERE idendpoint = ?
        AND (locked_until IS NULL OR locked_until < ?)`,
    {
      replacements: [lockedUntil, lockedBy, now, idlock, idendpoint, now],
      type: QueryTypes.BULKUPDATE,
    },
  );

  if (affectedRows(updated) > 0) {
    remember(idendpoint, { idlock, lockedUntil, lockedBy, owned: true }, now);
    return { success: true, idlock, lockedUntil };
  }

  // --- Layer 3: no row yet? create it. A lost race means another holder won. ---
  const rows = await dbAPIs.query(
    `SELECT idlock, locked_until, locked_by FROM ${TABLE_NAME} WHERE idendpoint = ?`,
    { replacements: [idendpoint], type: QueryTypes.SELECT },
  );

  const existing = rows && rows[0];
  if (existing) {
    const holderUntil = new Date(existing.locked_until);
    const holderBy = existing.locked_by || "unknown";
    remember(
      idendpoint,
      { idlock: existing.idlock, lockedUntil: holderUntil, lockedBy: holderBy, owned: false },
      now,
    );
    return lockedResponse(idendpoint, holderBy);
  }

  try {
    await dbAPIs.query(
      `INSERT INTO ${TABLE_NAME} (idlock, idendpoint, locked_until, locked_by, locked_at)
       VALUES (?, ?, ?, ?, ?)`,
      {
        replacements: [idlock, idendpoint, lockedUntil, lockedBy, now],
        type: QueryTypes.INSERT,
      },
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Another instance inserted the row between our UPDATE and INSERT: it owns the lease.
    return lockedResponse(idendpoint, "another process");
  }

  remember(idendpoint, { idlock, lockedUntil, lockedBy, owned: true }, now);
  return { success: true, idlock, lockedUntil };
}

/**
 * Releases the exclusive lock of an endpoint.
 *
 * Ownership is checked with `idlock`, so a process whose lease already expired
 * cannot free a lease that another process acquired in the meantime. When the
 * caller does not know its lease id, only an already-expired lease is cleared.
 *
 * @param {string} idendpoint Endpoint UUID.
 * @param {string} [idlock] Lease id returned by {@link acquireEndpointLock}.
 * @returns {Promise<boolean>} true when the row was released or already free.
 */
export async function releaseEndpointLock(idendpoint, idlock) {
  const cached = localLockCache.get(idendpoint);
  const ownedId = idlock || (cached && cached.owned ? cached.idlock : null);
  localLockCache.delete(idendpoint);

  const now = new Date();
  const expired = new Date(now.getTime() - 1000);

  try {
    if (ownedId) {
      await dbAPIs.query(
        `UPDATE ${TABLE_NAME}
            SET locked_until = ?, locked_by = ?
          WHERE idendpoint = ? AND idlock = ?`,
        {
          replacements: [expired, "released", idendpoint, ownedId],
          type: QueryTypes.BULKUPDATE,
        },
      );
    } else {
      await dbAPIs.query(
        `UPDATE ${TABLE_NAME}
            SET locked_until = ?, locked_by = ?
          WHERE idendpoint = ? AND locked_until < ?`,
        {
          replacements: [expired, "released", idendpoint, now],
          type: QueryTypes.BULKUPDATE,
        },
      );
    }
    return true;
  } catch (error) {
    console.error("[endpoint-lock] Error releasing lock:", error);
    return false;
  }
}

/**
 * Reports whether an endpoint currently has a valid lease, without acquiring it.
 * The process-local cache is used as a fast hint; otherwise the database is read.
 *
 * @param {string} idendpoint Endpoint UUID.
 * @returns {Promise<{locked: boolean, lockedBy?: string, lockedUntil?: Date}>}
 */
export async function isEndpointLocked(idendpoint) {
  const now = new Date();

  const cached = localLockCache.get(idendpoint);
  if (cached && cached.cacheUntil > now) {
    return { locked: true, lockedBy: cached.lockedBy, lockedUntil: cached.lockedUntil };
  }

  const rows = await dbAPIs.query(
    `SELECT locked_by, locked_until FROM ${TABLE_NAME} WHERE idendpoint = ?`,
    { replacements: [idendpoint], type: QueryTypes.SELECT },
  );

  const row = rows && rows[0];
  if (!row) return { locked: false };

  const lockedUntil = new Date(row.locked_until);
  if (lockedUntil > now) {
    remember(
      idendpoint,
      { idlock: null, lockedUntil, lockedBy: row.locked_by, owned: false },
      now,
    );
    return { locked: true, lockedBy: row.locked_by, lockedUntil };
  }

  return { locked: false };
}

/**
 * Drops the process-local cache. Intended for tests and for shutdown hooks.
 */
export function clearEndpointLockCache() {
  localLockCache.clear();
}
