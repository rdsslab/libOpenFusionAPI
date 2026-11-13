import "dotenv/config";
import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { QueryTypes } from "sequelize";
import dbAPIs from "../../src/lib/db/sequelize.js";
import { ensureEndpointLockTable } from "../../src/lib/db/ensureEndpointLockTable.js";
import {
  acquireEndpointLock,
  releaseEndpointLock,
  isEndpointLocked,
  clearEndpointLockCache,
} from "../../src/lib/db/endpoint_lock.js";
import { closeDb } from "./close_db.js";

/**
 * H4: exclusive lock per endpoint.
 *
 * What is pinned here:
 *
 * 1. **One lease at a time.** A second acquire, in this process or (simulated) in
 *    another one, is rejected while the first lease is valid.
 * 2. **The local cache does not lie.** Clearing it forces the database path, and
 *    the answer must be the same: a valid lease is a valid lease.
 * 3. **Release is ownership-checked.** A process whose lease expired cannot free a
 *    lease that another process acquired afterwards.
 * 4. **The lease expires.** A past `locked_until` lets the next caller in without
 *    any manual cleanup, so a crashed process never blocks the endpoint forever.
 * 5. **The acquire path is atomic.** N concurrent acquires produce exactly one
 *    winner, which is what the conditional UPDATE + unique INSERT rely on.
 * 6. **Release does not delete the row.** Steady state is UPDATE/UPDATE, with no
 *    INSERT/DELETE churn on the lock table.
 */

const TABLE = "ofapi_endpoint_lock";

async function lockRow(idendpoint) {
  const rows = await dbAPIs.query(
    `SELECT idlock, idendpoint, locked_until, locked_by FROM ${TABLE} WHERE idendpoint = ?`,
    { replacements: [idendpoint], type: QueryTypes.SELECT },
  );
  return rows[0] || null;
}

async function runTests() {
  console.log("--- Starting Endpoint Lock Tests ---");

  const ok = await ensureEndpointLockTable(console.log);
  assert.equal(ok, true, "the lock table must exist (or be created) for this suite");

  // ------------------------------------------------------------------
  // 1) One lease at a time (cache path)
  // ------------------------------------------------------------------
  {
    const idendpoint = uuidv4();
    clearEndpointLockCache();

    const first = await acquireEndpointLock(idendpoint, 60, "manual");
    assert.equal(first.success, true, "first acquire must win");
    assert.ok(first.idlock, "acquire must return the lease id");

    const second = await acquireEndpointLock(idendpoint, 60, "mcp");
    assert.equal(second.success, false, "a second acquire while held must fail");
    assert.equal(second.reason, "ENDPOINT_LOCKED");
    assert.match(second.message, /locked by another execution/i);

    const released = await releaseEndpointLock(idendpoint, first.idlock);
    assert.equal(released, true);
    console.log("[1/6] Cache path: one lease at a time — OK");
  }

  // ------------------------------------------------------------------
  // 2) The database agrees (cache cleared = another process)
  // ------------------------------------------------------------------
  {
    const idendpoint = uuidv4();
    clearEndpointLockCache();

    const first = await acquireEndpointLock(idendpoint, 60, "interval-task");
    assert.equal(first.success, true);

    clearEndpointLockCache(); // simulate a different API instance

    const other = await acquireEndpointLock(idendpoint, 60, "manual");
    assert.equal(other.success, false, "another process must see the lease in the database");
    assert.equal(other.reason, "ENDPOINT_LOCKED");
    assert.match(other.message, /interval-task/, "the message names the current holder");

    const state = await isEndpointLocked(idendpoint);
    assert.equal(state.locked, true);
    assert.equal(state.lockedBy, "interval-task");

    await releaseEndpointLock(idendpoint, first.idlock);
    console.log("[2/6] Database path: another instance sees the lease — OK");
  }

  // ------------------------------------------------------------------
  // 3) Release is ownership-checked
  // ------------------------------------------------------------------
  {
    const idendpoint = uuidv4();
    clearEndpointLockCache();

    const owner = await acquireEndpointLock(idendpoint, 60, "manual");
    assert.equal(owner.success, true);

    // A process that does not own the lease must not free it.
    const freed = await releaseEndpointLock(idendpoint, uuidv4());
    assert.equal(freed, true, "release resolves without throwing");

    clearEndpointLockCache();
    const stillLocked = await acquireEndpointLock(idendpoint, 60, "manual");
    assert.equal(stillLocked.success, false, "a foreign lease must survive a foreign release");

    // The owner can free it.
    await releaseEndpointLock(idendpoint, owner.idlock);
    clearEndpointLockCache();
    const afterRelease = await acquireEndpointLock(idendpoint, 60, "manual");
    assert.equal(afterRelease.success, true, "the owner release frees the endpoint");
    await releaseEndpointLock(idendpoint, afterRelease.idlock);

    console.log("[3/6] Release: ownership-checked — OK");
  }

  // ------------------------------------------------------------------
  // 4) An expired lease is taken over with no cleanup
  // ------------------------------------------------------------------
  {
    const idendpoint = uuidv4();
    clearEndpointLockCache();

    const first = await acquireEndpointLock(idendpoint, 60, "manual");
    assert.equal(first.success, true);

    // Force the lease into the past, as if the owner had crashed long ago.
    await dbAPIs.query(
      `UPDATE ${TABLE} SET locked_until = ? WHERE idendpoint = ?`,
      {
        replacements: [new Date(Date.now() - 60_000), idendpoint],
        type: QueryTypes.BULKUPDATE,
      },
    );
    clearEndpointLockCache();

    const takeover = await acquireEndpointLock(idendpoint, 60, "manual");
    assert.equal(takeover.success, true, "an expired lease must be acquirable");
    assert.notEqual(takeover.idlock, first.idlock, "takeover must use a new lease id");

    await releaseEndpointLock(idendpoint, takeover.idlock);
    console.log("[4/6] Expiry: expired lease is taken over — OK");
  }

  // ------------------------------------------------------------------
  // 5) Concurrent acquires: exactly one winner
  // ------------------------------------------------------------------
  {
    const idendpoint = uuidv4();
    clearEndpointLockCache();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => acquireEndpointLock(idendpoint, 60, "manual")),
    );

    const winners = results.filter((r) => r.success);
    const losers = results.filter((r) => !r.success);

    assert.equal(winners.length, 1, `expected exactly one winner, got ${winners.length}`);
    assert.equal(losers.length, 9);
    for (const loser of losers) {
      assert.equal(loser.reason, "ENDPOINT_LOCKED");
    }

    const rows = await dbAPIs.query(
      `SELECT COUNT(*) AS total FROM ${TABLE} WHERE idendpoint = ?`,
      { replacements: [idendpoint], type: QueryTypes.SELECT },
    );
    assert.equal(Number(rows[0].total), 1, "the unique index must keep one row per endpoint");

    await releaseEndpointLock(idendpoint, winners[0].idlock);
    console.log("[5/6] Concurrency: exactly one winner out of 10 — OK");
  }

  // ------------------------------------------------------------------
  // 6) Release keeps the row (UPDATE/UPDATE steady state)
  // ------------------------------------------------------------------
  {
    const idendpoint = uuidv4();
    clearEndpointLockCache();

    const lease = await acquireEndpointLock(idendpoint, 60, "manual");
    assert.equal(lease.success, true);

    await releaseEndpointLock(idendpoint, lease.idlock);

    const row = await lockRow(idendpoint);
    assert.ok(row, "release must not delete the row");
    assert.equal(row.locked_by, "released");
    assert.ok(new Date(row.locked_until) < new Date(), "released lease is in the past");

    // And the endpoint is immediately acquirable again.
    clearEndpointLockCache();
    const again = await acquireEndpointLock(idendpoint, 60, "manual");
    assert.equal(again.success, true, "a released endpoint is acquirable");
    await releaseEndpointLock(idendpoint, again.idlock);

    console.log("[6/6] Release: row kept, no INSERT/DELETE churn — OK");
  }

  console.log("--- All Endpoint Lock Tests Passed Successfully! ---");
}

runTests()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
