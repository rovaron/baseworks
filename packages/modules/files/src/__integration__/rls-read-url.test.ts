/**
 * Phase 4 / Task 4.2 — get-read-url under RLS (LIVE DB, NOT mocked).
 *
 * Proves the single-file read-url lookup is genuinely RLS-backed, not merely
 * app-predicate-scoped:
 *
 *   - Seed `files` rows for tenant A and tenant B via the OWNER connection
 *     (getDb() bypasses RLS, so cross-tenant seeding works).
 *   - Drive `getReadUrl` with a ctx whose `withTenant` is bound to tenant A and
 *     runs against the NON-OWNER baseworks_rls pool (getRlsDb()). A's own fileId
 *     resolves to a signed url; tenant B's fileId resolves to `not_found` (404)
 *     because Postgres RLS hides B's row from A's transaction → 0 rows → 404.
 *   - Direct RLS-backstop assertion: inside ctx.withTenant bound to A, a raw
 *     `SELECT ... WHERE id = <B's id>` (no tenant predicate) returns ZERO rows —
 *     i.e. RLS itself, not the handler's manual `tenant_id = ...` clause, is what
 *     hides B's data.
 *
 * Bun auto-loads .env, so DATABASE_URL_RLS points the RLS pool at the
 * baseworks_rls login (NOBYPASSRLS) and the tenant_isolation policy applies.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, getRlsDb, withTenant } from "@baseworks/db";
import { LocalFileStorage, resetFileStorage, setFileStorage } from "@baseworks/storage";
import { sql } from "drizzle-orm";
import { getReadUrl } from "../queries/get-read-url";

const db = getDb();

const OWNER_MODULE = "rls-ru-mod";
const RT_PLAIN = "rls_ru_plain"; // no relation registered ⇒ no canRead gate

// Unique run prefix so parallel/repeat runs never collide; cleanup is one prefix DELETE.
const RUN = `tnt_p4ru_${Math.random().toString(36).slice(2, 8)}`;
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
async function insertFile(o: { tenantId: string }): Promise<string> {
  keySeq += 1;
  // Owner-connection raw insert (bypasses RLS) so we can seed BOTH tenants.
  const rows = (await db.execute(sql`
    INSERT INTO files
      (tenant_id, owner_module, owner_record_type, owner_record_id,
       storage_key, bucket, mime_type, byte_size, status, original_filename, deleted_at)
    VALUES
      (${o.tenantId}, ${OWNER_MODULE}, ${RT_PLAIN}, 'rec_ru',
       ${`${o.tenantId}/k/${RUN}-${keySeq}-${Math.random().toString(36).slice(2)}`}, 'files',
       'image/png', 123, 'uploaded', 'pic.png', null)
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows[0].id;
}

const storage = new LocalFileStorage();
let ok = false;
beforeAll(async () => {
  // Fail loudly if the RLS role / Postgres is unreachable — this test must RUN.
  await db.execute(sql`SELECT 1`);
  await getRlsDb().execute(sql`SELECT 1`);
  setFileStorage(storage);
  ok = true;
});

afterAll(async () => {
  if (ok) await db.execute(sql`DELETE FROM files WHERE tenant_id LIKE ${`${RUN}%`}`);
  resetFileStorage();
});

describe("getReadUrl under RLS (Phase 4 / Task 4.2)", () => {
  test("resolves the active tenant's own file to a signed url", async () => {
    const aId = await insertFile({ tenantId: TENANT_A });

    const r = await getReadUrl({ fileId: aId }, makeCtx(TENANT_A));

    expect(r.success).toBe(true);
    if (!r.success) throw new Error(r.error);
    expect(typeof r.data.url).toBe("string");
    expect(r.data.url.length).toBeGreaterThan(0);
    // No raw key/bucket ever leaves the module.
    expect(Object.keys(r.data)).toEqual(["url", "expiresAt"]);
  });

  test("returns not_found for another tenant's file (RLS hides B from A)", async () => {
    const bId = await insertFile({ tenantId: TENANT_B });

    // Tenant A asks for B's fileId. The owner row exists, but A's RLS tx sees 0
    // rows → 404. This is the cross-tenant isolation proof.
    const r = await getReadUrl({ fileId: bId }, makeCtx(TENANT_A));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("not_found");

    // Sanity: the OWNER connection (RLS-bypassing) DOES see B's row.
    const ownerRows = (await db.execute(
      sql`SELECT count(*)::int AS n FROM files WHERE id = ${bId}`,
    )) as unknown as Array<{ n: number }>;
    expect(ownerRows[0]?.n ?? 0).toBe(1);
  });

  test("RLS (not the app predicate) hides tenant B's row from tenant A's tx", async () => {
    const bId = await insertFile({ tenantId: TENANT_B });

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
