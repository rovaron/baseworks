/**
 * Phase 4 / Task 4.3 — sign-upload under RLS (LIVE DB, NOT mocked).
 *
 * Proves the sign-upload command's quota-reserve + pending-row insert run through
 * the request-scoped RLS transaction (ctx.withTenant) against the NON-OWNER
 * baseworks_rls pool, and that the rows it creates are genuinely tenant-isolated
 * by Postgres RLS — not merely by the handler's manual `tenant_id = ...` predicate:
 *
 *   - Drive `signUpload` as tenant A and as tenant B (each through its own
 *     ctx.withTenant). Both succeed and return a fileId.
 *   - The owner connection (RLS-bypassing) confirms each created `files` row is
 *     stamped with the driving tenant's id.
 *   - Inside tenant A's RLS transaction, listing the run's files returns ONLY A's
 *     rows; tenant B's pending upload is invisible (cross-tenant isolation).
 *   - Direct RLS-backstop assertion: inside ctx.withTenant bound to A, a raw
 *     `SELECT ... WHERE id = <B's id>` (no tenant predicate) returns ZERO rows —
 *     i.e. RLS itself hides B's data from A's transaction.
 *
 * Bun auto-loads .env, so DATABASE_URL_RLS points the RLS pool at the
 * baseworks_rls login (NOBYPASSRLS) and the tenant_isolation policy applies.
 * The 50-concurrent quota RACE test lives in __integration__/quota.test.ts and
 * exercises reserveQuota directly (unchanged by this task).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, getRlsDb, withTenant } from "@baseworks/db";
import {
  fileRelationsRegistry,
  LocalFileStorage,
  resetFileStorage,
  setFileStorage,
} from "@baseworks/storage";
import { sql } from "drizzle-orm";
import { signUpload } from "../commands/sign-upload";

const db = getDb();

// Unique owner module/kind so the registered relation + the run's files never
// collide with the other live-DB suites sharing this Postgres.
const RUN = `tnt_p4su_${Math.random().toString(36).slice(2, 8)}`;
const OWNER_MODULE = `rls-su-mod-${Math.random().toString(36).slice(2, 6)}`;
const KIND = "avatar";
const RECORD_TYPE = "rls_su_user";
const MIME = "image/png";

const TENANT_A = `${RUN}_a`;
const TENANT_B = `${RUN}_b`;

/**
 * Request-scoped ctx mirroring the apps/api construction: `withTenant` opens an
 * RLS-role transaction with app.tenant_id set transaction-locally for this tenant.
 */
function makeCtx(tenantId: string): any {
  return {
    tenantId,
    userId: "usr_test",
    db: {},
    emit: () => undefined,
    withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), tenantId, fn),
  };
}

const storage = new LocalFileStorage();
let ok = false;

beforeAll(async () => {
  // Fail loudly if the RLS role / Postgres is unreachable — this test must RUN.
  await db.execute(sql`SELECT 1`);
  await getRlsDb().execute(sql`SELECT 1`);
  setFileStorage(storage);
  fileRelationsRegistry.register(OWNER_MODULE, KIND, {
    recordType: RECORD_TYPE,
    allowedMimeTypes: [MIME],
    maxByteSize: 5_000_000,
  });
  ok = true;
});

afterAll(async () => {
  if (ok) {
    // Owner connection (RLS-bypassing) cleans up BOTH tenants' rows in one shot.
    await db.execute(sql`DELETE FROM files WHERE tenant_id LIKE ${`${RUN}%`}`);
    await db.execute(sql`DELETE FROM tenant_storage_usage WHERE tenant_id LIKE ${`${RUN}%`}`);
  }
  resetFileStorage();
});

async function sign(tenantId: string): Promise<string> {
  const r = await signUpload(
    { ownerModule: OWNER_MODULE, kind: KIND, mimeType: MIME, byteSize: 2048 },
    makeCtx(tenantId),
  );
  expect(r.success).toBe(true);
  if (!r.success) throw new Error(`expected success, got ${r.error}`);
  expect(typeof r.data.fileId).toBe("string");
  return r.data.fileId;
}

describe("signUpload under RLS (Phase 4 / Task 4.3)", () => {
  test("reserves quota + inserts a pending row stamped for the active tenant", async () => {
    const aId = await sign(TENANT_A);

    // Owner connection sees the created row stamped tenant A.
    const rows = (await db.execute(
      sql`SELECT tenant_id, status FROM files WHERE id = ${aId}`,
    )) as unknown as Array<{ tenant_id: string; status: string }>;
    expect(rows[0]?.tenant_id).toBe(TENANT_A);
    expect(rows[0]?.status).toBe("pending");

    // Quota was reserved for A under the RLS tx (pending bytes for the claim).
    const usage = (await db.execute(
      sql`SELECT bytes_pending::int AS p FROM tenant_storage_usage WHERE tenant_id = ${TENANT_A}`,
    )) as unknown as Array<{ p: number }>;
    expect(usage[0]?.p).toBe(2048);
  });

  test("RLS hides tenant B's pending upload from tenant A's transaction", async () => {
    const bId = await sign(TENANT_B);

    // Within A's RLS transaction, list this run's files: only A's rows appear.
    const seen = await withTenant(getRlsDb(), TENANT_A, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT tenant_id FROM files WHERE owner_module = ${OWNER_MODULE}`,
      )) as unknown as Array<{ tenant_id: string }>;
      return new Set(rows.map((r) => r.tenant_id));
    });
    expect(seen.has(TENANT_A)).toBe(true);
    expect(seen.has(TENANT_B)).toBe(false);

    // Sanity: the OWNER connection (RLS-bypassing) DOES see B's row.
    const ownerRows = (await db.execute(
      sql`SELECT count(*)::int AS n FROM files WHERE id = ${bId}`,
    )) as unknown as Array<{ n: number }>;
    expect(ownerRows[0]?.n ?? 0).toBe(1);
  });

  test("RLS (not the app predicate) hides tenant B's row from tenant A's tx", async () => {
    const bId = await sign(TENANT_B);

    // Inside tenant A's RLS transaction, an UNFILTERED-by-tenant query for B's
    // row still returns zero — proving isolation comes from Postgres RLS itself.
    const seenB = await withTenant(getRlsDb(), TENANT_A, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT count(*)::int AS n FROM files WHERE id = ${bId}`,
      )) as unknown as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    });
    expect(seenB).toBe(0);
  });
});
