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

import { type FileTransform, type getDb, tenantStorageUsage } from "@baseworks/db";
import { sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

/**
 * Phase 28 / IMG-01 — Σ `byteSize` over a file's generated-variant manifest
 * (`files.transforms` jsonb). 0 for an empty/absent manifest. Single source of
 * truth for variant-byte accounting: the transform job CREDITS this sum into
 * `bytes_used`, so every refund path (delete, cascade) MUST DEBIT the same sum
 * alongside the row's own `byte_size` — otherwise deleting a transformed file
 * leaks its variant bytes and drifts `bytes_used` upward forever (SC#3
 * conservation invariant).
 */
export function sumTransformBytes(manifest: FileTransform[] | null | undefined): number {
  return (manifest ?? []).reduce((acc, t) => acc + (t.byteSize ?? 0), 0);
}

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

/**
 * Phase 27 / UPL-02 — move a completed upload's bytes from pending to used in
 * ONE atomic statement. Called inside the complete-upload transaction with the
 * `tx` passed as `db`.
 *
 * Releases EXACTLY the originally-RESERVED bytes from pending (the size the
 * client claimed at sign-time) and adds the server-AUTHORITATIVE bytes (from
 * `storage.stat()`) to used — that split is the whole point of size
 * verification: pending was reserved against the claim, used reflects reality.
 * GREATEST(...,0) guards pending underflow.
 *
 * Risk R1: if the client under-claimed (authoritative > reserved), bytes_used
 * can exceed what was reserved by up to relation.maxByteSize per file — bounded
 * by the complete-upload step-6 per-file cap. Stricter delta re-reservation is
 * deferred to Phase 31.
 */
export async function markUploaded(
  db: Db,
  tenantId: string,
  reservedSize: number,
  authoritativeSize: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE tenant_storage_usage
       SET bytes_pending = GREATEST(bytes_pending - ${reservedSize}, 0),
           bytes_used    = bytes_used + ${authoritativeSize},
           updated_at    = now()
     WHERE tenant_id = ${tenantId}
  `);
}

/**
 * Phase 27 / UPL-04 — decrement counted (bytes_used) storage for a tenant.
 * Used by the delete and cascade-soft-delete paths once a row that was actually
 * counted toward usage (prior status ∈ {uploaded,ready,transforming}) is
 * tombstoned. `size` is the row's byte_size (delete) or the SUM of counted
 * rows' byte_size (cascade). GREATEST(...,0) guards against underflow.
 *
 * Pending rows are NOT decremented here — their bytes live in bytes_pending and
 * are the Phase 31 cleanup job's concern (locked decision #5).
 */
export async function decrementUsed(db: Db, tenantId: string, size: number): Promise<void> {
  await db.execute(sql`
    UPDATE tenant_storage_usage
       SET bytes_used  = GREATEST(bytes_used - ${size}, 0),
           updated_at  = now()
     WHERE tenant_id = ${tenantId}
  `);
}

/**
 * Phase 28 / IMG-01 — apply a SIGNED delta to bytes_used for generated image
 * variants. `delta` is `Σ new variant bytes − Σ previously-counted variant bytes`
 * (the old sum read from the row's existing `transforms` manifest), so a BullMQ
 * retry that regenerates the SAME deterministic keys nets a 0 delta and never
 * double-counts (locked decision §5.2 / Risk #4). Call inside the same tx as the
 * manifest UPDATE. GREATEST guards underflow when the delta is negative.
 */
export async function addUsed(db: Db, tenantId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  await db.execute(sql`
    UPDATE tenant_storage_usage
       SET bytes_used  = GREATEST(bytes_used + ${delta}, 0),
           updated_at  = now()
     WHERE tenant_id = ${tenantId}
  `);
}
