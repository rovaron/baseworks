/**
 * Phase 26 / QUO-01, QUO-02 — race-safe quota LIVE-DB tests.
 *
 * These tests run against the REAL Postgres (DATABASE_URL) — they are NOT
 * mocked. The whole phase rests on the §1.3 EvalPlanQual recheck argument, so
 * SC#3 (50 concurrent reservations against a tenant at 95% quota) MUST execute
 * against Postgres to prove no over-allocation under contention.
 *
 * Cases:
 *   - reserveQuota increments bytes_pending when under the limit
 *   - reserveQuota returns false (0 rows) when the reservation would exceed limit
 *   - reserveQuota's belt-and-suspenders INSERT creates a missing row (legacy)
 *   - reserveQuota uses COALESCE(bytes_limit, defaultLimit) when limit is NULL
 *   - releaseQuota decrements bytes_pending and GREATEST-floors at 0
 *   - SC#3: 50 concurrent reservations → exactly floor(remaining/perSize) succeed,
 *     final bytes_used + bytes_pending <= bytes_limit (zero over-allocation)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, tenantStorageUsage } from "@baseworks/db";
import { eq, inArray, sql } from "drizzle-orm";
import { decrementUsed, markUploaded, releaseQuota, reserveQuota } from "../lib/quota";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

const DEFAULT_LIMIT = 1_073_741_824;

let db: ReturnType<typeof createDb>;
const createdTenantIds = new Set<string>();

/** Unique, ≤36-char tenant id per call (tenant_id is varchar(36)). */
function newTenantId(tag: string): string {
  const id = `q26_${tag}_${crypto.randomUUID().slice(0, 18)}`;
  createdTenantIds.add(id);
  return id;
}

async function seedUsage(
  tenantId: string,
  bytesUsed: number,
  bytesPending: number,
  bytesLimit: number | null,
): Promise<void> {
  await db
    .insert(tenantStorageUsage)
    .values({ tenantId, bytesUsed, bytesPending, bytesLimit })
    .onConflictDoUpdate({
      target: tenantStorageUsage.tenantId,
      set: { bytesUsed, bytesPending, bytesLimit },
    });
}

async function readUsage(tenantId: string) {
  const [row] = await db
    .select()
    .from(tenantStorageUsage)
    .where(eq(tenantStorageUsage.tenantId, tenantId));
  return row;
}

beforeAll(async () => {
  db = createDb(TEST_DB_URL);
  // Fail loudly if Postgres is unreachable — SC#3 must run, never silently skip.
  await db.execute(sql`SELECT 1`);
});

afterAll(async () => {
  if (createdTenantIds.size > 0) {
    await db
      .delete(tenantStorageUsage)
      .where(inArray(tenantStorageUsage.tenantId, [...createdTenantIds]));
  }
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("reserveQuota (live DB)", () => {
  test("reserves and increments bytes_pending when under the limit", async () => {
    const tenantId = newTenantId("under");
    await seedUsage(tenantId, 100, 0, 1_000);

    const ok = await reserveQuota(db, tenantId, 200, DEFAULT_LIMIT);
    expect(ok).toBe(true);

    const row = await readUsage(tenantId);
    expect(row?.bytesPending).toBe(200);
    expect(row?.bytesUsed).toBe(100);
  });

  test("returns false (0 rows) when the reservation would exceed the limit", async () => {
    const tenantId = newTenantId("over");
    await seedUsage(tenantId, 950, 0, 1_000);

    const ok = await reserveQuota(db, tenantId, 100, DEFAULT_LIMIT);
    expect(ok).toBe(false);

    // No pending bytes leaked on the rejected path.
    const row = await readUsage(tenantId);
    expect(row?.bytesPending).toBe(0);
  });

  test("belt-and-suspenders INSERT creates a missing row, then reserves", async () => {
    const tenantId = newTenantId("legacy");
    // No seed — the row does not exist yet.
    const ok = await reserveQuota(db, tenantId, 500, DEFAULT_LIMIT);
    expect(ok).toBe(true);

    const row = await readUsage(tenantId);
    expect(row).toBeDefined();
    expect(row?.bytesPending).toBe(500);
    expect(row?.bytesLimit).toBe(DEFAULT_LIMIT);
  });

  test("uses COALESCE(bytes_limit, defaultLimit) when bytes_limit is NULL", async () => {
    const tenantId = newTenantId("nulllim");
    await seedUsage(tenantId, 0, 0, null);

    // Just under the env default ⇒ allowed; over it ⇒ rejected.
    const ok = await reserveQuota(db, tenantId, DEFAULT_LIMIT, DEFAULT_LIMIT);
    expect(ok).toBe(true);

    const tooBig = await reserveQuota(db, tenantId, 1, DEFAULT_LIMIT);
    expect(tooBig).toBe(false);
  });
});

describe("releaseQuota (live DB)", () => {
  test("decrements bytes_pending", async () => {
    const tenantId = newTenantId("rel");
    await seedUsage(tenantId, 0, 500, 1_000);

    await releaseQuota(db, tenantId, 200);
    const row = await readUsage(tenantId);
    expect(row?.bytesPending).toBe(300);
  });

  test("GREATEST-floors bytes_pending at 0 (no underflow)", async () => {
    const tenantId = newTenantId("floor");
    await seedUsage(tenantId, 0, 100, 1_000);

    await releaseQuota(db, tenantId, 999);
    const row = await readUsage(tenantId);
    expect(row?.bytesPending).toBe(0);
  });
});

describe("markUploaded (live DB) — Phase 27 / UPL-02", () => {
  test("moves the reserved bytes from pending to used (authoritative == reserved)", async () => {
    const tenantId = newTenantId("mu_eq");
    // 300 reserved as pending, nothing used yet.
    await seedUsage(tenantId, 0, 300, 10_000);

    await markUploaded(db, tenantId, 300, 300);

    const row = await readUsage(tenantId);
    expect(row?.bytesPending).toBe(0);
    expect(row?.bytesUsed).toBe(300);
  });

  test("releases the RESERVED size from pending but adds the AUTHORITATIVE size to used", async () => {
    const tenantId = newTenantId("mu_neq");
    // Client claimed 300 (pending). Authoritative server size is 500 (under-claim).
    await seedUsage(tenantId, 1_000, 300, 100_000);

    await markUploaded(db, tenantId, 300, 500);

    const row = await readUsage(tenantId);
    // pending loses exactly the reserved 300; used gains the authoritative 500.
    expect(row?.bytesPending).toBe(0);
    expect(row?.bytesUsed).toBe(1_500);
  });

  test("GREATEST floors bytes_pending at 0 when reserved exceeds pending", async () => {
    const tenantId = newTenantId("mu_floor");
    await seedUsage(tenantId, 0, 100, 10_000);

    await markUploaded(db, tenantId, 999, 100);

    const row = await readUsage(tenantId);
    expect(row?.bytesPending).toBe(0);
    expect(row?.bytesUsed).toBe(100);
  });
});

describe("decrementUsed (live DB) — Phase 27 / UPL-04", () => {
  test("decrements bytes_used by the given size", async () => {
    const tenantId = newTenantId("du");
    await seedUsage(tenantId, 800, 0, 10_000);

    await decrementUsed(db, tenantId, 300);

    const row = await readUsage(tenantId);
    expect(row?.bytesUsed).toBe(500);
  });

  test("GREATEST floors bytes_used at 0 (no underflow)", async () => {
    const tenantId = newTenantId("du_floor");
    await seedUsage(tenantId, 100, 0, 10_000);

    await decrementUsed(db, tenantId, 999);

    const row = await readUsage(tenantId);
    expect(row?.bytesUsed).toBe(0);
  });
});

describe("SC#3 — 50 concurrent reservations are race-safe (live DB, NOT mocked)", () => {
  test("exactly floor(remaining/perSize) succeed; no over-allocation", async () => {
    const tenantId = newTenantId("race");

    const LIMIT = 1_000_000;
    const USED = 950_000; // tenant at 95% quota
    const PER_SIZE = 2_000; // remaining 50_000 ⇒ headroom = 25
    const REMAINING = LIMIT - USED;
    const EXPECTED_ACCEPTED = Math.floor(REMAINING / PER_SIZE); // 25
    const CONCURRENCY = 50;

    await seedUsage(tenantId, USED, 0, LIMIT);

    // Fire 50 concurrent reservations at the SAME row; the conditional UPDATE
    // takes the row write-lock and Postgres EvalPlanQual re-evaluates the WHERE
    // predicate against each prior committed winner — so the sum can never
    // exceed LIMIT no matter the interleaving.
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        reserveQuota(db, tenantId, PER_SIZE, DEFAULT_LIMIT),
      ),
    );

    const accepted = results.filter((r) => r === true).length;
    const rejected = results.filter((r) => r === false).length;

    // (a) exactly the headroom number of reservations succeed
    expect(accepted).toBe(EXPECTED_ACCEPTED);
    // the rest are rejected (⇒ HTTP 413)
    expect(rejected).toBe(CONCURRENCY - EXPECTED_ACCEPTED);

    // (b) the invariant: final used + pending never exceeds the limit
    const row = await readUsage(tenantId);
    const used = row?.bytesUsed ?? 0;
    const pending = row?.bytesPending ?? 0;
    expect(used + pending).toBeLessThanOrEqual(LIMIT);
    // and pending reflects exactly the accepted reservations (zero over-allocation)
    expect(pending).toBe(EXPECTED_ACCEPTED * PER_SIZE);
    expect(used + pending).toBe(USED + EXPECTED_ACCEPTED * PER_SIZE);
  });
});
