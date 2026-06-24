/**
 * Phase 4 / Task 4.1 — list-for-record under RLS (LIVE DB, NOT mocked).
 *
 * Proves the request path is genuinely RLS-backed, not just app-predicate-scoped:
 *
 *   - Seed `files` rows for tenant A and tenant B via the OWNER connection
 *     (getDb() bypasses RLS, so cross-tenant seeding works).
 *   - Drive `listForRecord` with a ctx whose `withTenant` is bound to tenant A
 *     and runs against the NON-OWNER baseworks_rls pool (getRlsDb()). Assert only
 *     A's files come back.
 *   - Direct RLS-backstop assertion: inside ctx.withTenant bound to A, a raw
 *     `SELECT ... WHERE tenant_id = B` returns ZERO rows — i.e. Postgres RLS, not
 *     the handler's manual `tenant_id = ...` predicate, is what hides B's data.
 *
 * Bun auto-loads .env, so DATABASE_URL_RLS points the RLS pool at the
 * baseworks_rls login (NOBYPASSRLS) and the tenant_isolation policy applies.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, getRlsDb, withTenant } from "@baseworks/db";
import { sql } from "drizzle-orm";
import { listForRecord } from "../queries/list-for-record";

const db = getDb();

const OWNER_MODULE = "rls-mod";
const RT_PLAIN = "rls_plain"; // no relation registered ⇒ no canRead gate

// Unique run prefix so parallel/repeat runs never collide; cleanup is one prefix DELETE.
const RUN = `tnt_p4rls_${Math.random().toString(36).slice(2, 8)}`;
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

let keySeq = 0;
async function insertFile(o: {
  tenantId: string;
  ownerRecordId: string;
  ownerRecordType?: string;
  status?: string;
  deleted?: boolean;
}): Promise<string> {
  keySeq += 1;
  // Owner-connection raw insert (bypasses RLS) so we can seed BOTH tenants.
  const rows = (await db.execute(sql`
    INSERT INTO files
      (tenant_id, owner_module, owner_record_type, owner_record_id,
       storage_key, bucket, mime_type, byte_size, status, deleted_at)
    VALUES
      (${o.tenantId}, ${OWNER_MODULE}, ${o.ownerRecordType ?? RT_PLAIN}, ${o.ownerRecordId},
       ${`${o.tenantId}/k/${RUN}-${keySeq}-${Math.random().toString(36).slice(2)}`}, 'files',
       'image/png', 123, ${o.status ?? "uploaded"}, ${o.deleted ? new Date() : null})
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows[0].id;
}

let ok = false;
beforeAll(async () => {
  // Fail loudly if the RLS role / Postgres is unreachable — this test must RUN.
  await db.execute(sql`SELECT 1`);
  await getRlsDb().execute(sql`SELECT 1`);
  ok = true;
});

afterAll(async () => {
  if (ok) await db.execute(sql`DELETE FROM files WHERE tenant_id LIKE ${`${RUN}%`}`);
});

describe("listForRecord under RLS (Phase 4 / Task 4.1)", () => {
  test("returns only the active tenant's files (RLS-scoped request path)", async () => {
    const RECORD = "rec_rls_1";
    const a1 = await insertFile({ tenantId: TENANT_A, ownerRecordId: RECORD });
    const a2 = await insertFile({ tenantId: TENANT_A, ownerRecordId: RECORD });
    // Tenant B has files for the SAME owner tuple — must be invisible to A.
    await insertFile({ tenantId: TENANT_B, ownerRecordId: RECORD });
    await insertFile({ tenantId: TENANT_B, ownerRecordId: RECORD });

    const r = await listForRecord(
      { ownerModule: OWNER_MODULE, ownerRecordType: RT_PLAIN, recordId: RECORD },
      makeCtx(TENANT_A),
    );

    expect(r.success).toBe(true);
    if (!r.success) throw new Error(r.error);

    const ids = r.data.files.map((f: any) => f.fileId).sort();
    expect(ids).toEqual([a1, a2].sort());
  });

  test("RLS (not the app predicate) hides tenant B's rows from tenant A's tx", async () => {
    const RECORD = "rec_rls_2";
    await insertFile({ tenantId: TENANT_B, ownerRecordId: RECORD });

    // Inside tenant A's RLS transaction, an UNFILTERED-by-app query for B's rows
    // still returns zero — proving the isolation comes from Postgres RLS itself.
    const seenB = await withTenant(getRlsDb(), TENANT_A, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT count(*)::int AS n FROM files WHERE tenant_id = ${TENANT_B}`,
      )) as unknown as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    });
    expect(seenB).toBe(0);

    // Sanity: the OWNER connection (RLS-bypassing) DOES see B's row.
    const ownerRows = (await db.execute(
      sql`SELECT count(*)::int AS n FROM files WHERE tenant_id = ${TENANT_B} AND owner_record_id = ${RECORD}`,
    )) as unknown as Array<{ n: number }>;
    expect(ownerRows[0]?.n ?? 0).toBeGreaterThanOrEqual(1);
  });
});
