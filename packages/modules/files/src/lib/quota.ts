/**
 * Phase 26 / QUO-01, QUO-02 — race-safe per-tenant storage quota.
 *
 * Operates on the RAW drizzle instance (getDb), NOT ctx.db (the scoped wrapper
 * has no .execute() / raw SQL). The files module is allow-listed for direct
 * tenant_storage_usage / files access; every statement carries an explicit
 * tenant_id predicate.
 *
 * Race-safety (the load-bearing argument for SC#3): tenant_id is the PK, so two
 * concurrent reservations target the SAME row. Under READ COMMITTED the second
 * UPDATE blocks on the row write-lock until the first commits, then Postgres
 * EvalPlanQual re-reads the latest committed bytes_pending and re-evaluates the
 * WHERE predicate — so no two reservations whose sum exceeds the limit can both
 * pass. No SELECT ... FOR UPDATE, no read-modify-write, no TOCTOU window.
 */

import { type getDb, tenantStorageUsage } from "@baseworks/db";
import { sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

/**
 * Atomically reserve `size` bytes of pending quota for `tenantId`.
 * Returns true if reserved, false if the reservation would exceed the limit
 * (caller maps false → HTTP 413 quota_exceeded).
 *
 * `defaultLimit` is env.STORAGE_DEFAULT_QUOTA_BYTES and is used only when the
 * row's bytes_limit is NULL (D-11 per-tenant-override-or-env-default).
 */
export async function reserveQuota(
  db: Db,
  tenantId: string,
  size: number,
  defaultLimit: number,
): Promise<boolean> {
  // Belt-and-suspenders: guarantee a row exists even for legacy/pre-hook tenants,
  // so a 0-row UPDATE result unambiguously means "quota exceeded", never "no row".
  // Idempotent; harmless when the tenant.created hook already inserted the row.
  await db
    .insert(tenantStorageUsage)
    .values({ tenantId, bytesUsed: 0, bytesPending: 0, bytesLimit: defaultLimit })
    .onConflictDoNothing({ target: tenantStorageUsage.tenantId });

  const rows = await db.execute(sql`
    UPDATE tenant_storage_usage
       SET bytes_pending = bytes_pending + ${size},
           updated_at    = now()
     WHERE tenant_id = ${tenantId}
       AND bytes_used + bytes_pending + ${size}
           <= COALESCE(bytes_limit, ${defaultLimit})
    RETURNING bytes_used, bytes_pending, bytes_limit
  `);

  // drizzle-orm/postgres-js: db.execute returns the rows array directly.
  return rows.length > 0;
}

/**
 * Release a previously reserved `size` of pending quota. Called when sign-upload
 * fails AFTER reserveQuota succeeded (files INSERT throws, signUpload throws) so a
 * failed request never leaks pending bytes. GREATEST guards against underflow.
 */
export async function releaseQuota(db: Db, tenantId: string, size: number): Promise<void> {
  await db.execute(sql`
    UPDATE tenant_storage_usage
       SET bytes_pending = GREATEST(bytes_pending - ${size}, 0),
           updated_at    = now()
     WHERE tenant_id = ${tenantId}
  `);
}
