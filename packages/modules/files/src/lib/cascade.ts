/**
 * Phase 27 / MOD-03 — generic cascade soft-delete of a record's files.
 *
 * When an owner record is deleted (e.g. a user), every file attached to it must
 * be tombstoned and its counted bytes returned to the tenant's quota. This is
 * the DB-atomic core invoked by the generic cascade subscriber registered in
 * `hooks/on-tenant-created.ts` — one transaction per owner-deletion event.
 *
 * R3 (prior status): Postgres `UPDATE ... RETURNING` returns the POST-update
 * row, so we cannot read the PRIOR status from a RETURNING clause. To know which
 * rows counted toward `bytes_used` we SELECT ... FOR UPDATE first (capturing the
 * prior status), THEN tombstone, all inside one tx. FOR UPDATE serializes a
 * concurrent delete/cascade on the same rows.
 *
 * Physical objects are NOT deleted here — left to the Phase 31 orphan
 * reconciliation sweep. Keeping the subscriber DB-only makes the cascade fast
 * and fully atomic; the SC#5 contract asserts soft-delete + `bytes_used`
 * decrement only. The tombstone is authoritative; a leftover object is sweepable.
 *
 * Direct files-table access is allow-listed for this module (path-prefix exempt
 * in scripts/lint-no-direct-files-access.sh). The SELECT FOR UPDATE uses raw
 * `tx.execute(sql)` (not the banned `select().from(files)` builder — see
 * complete-upload.ts header); the tombstone UPDATE uses the `tx.update(files)`
 * builder. Every statement carries an explicit tenant_id predicate.
 */

import { files, type getDb } from "@baseworks/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { decrementUsed } from "./quota";

type Db = ReturnType<typeof getDb>;

/** Prior statuses that counted toward `bytes_used` (so the cascade refunds them). */
const COUNTED_STATUSES = new Set(["uploaded", "ready", "transforming"]);

export interface CascadeSoftDeleteArgs {
  tenantId: string;
  ownerModule: string;
  recordType: string;
  recordId: string;
  /** Emits `file.deleted` per tombstoned row AFTER the tx commits. */
  emit: (event: string, data: unknown) => void;
}

/**
 * Soft-delete every live file owned by `(ownerModule, recordType, recordId)` for
 * a tenant and refund the counted bytes. No-op when the record owns no files.
 *
 * @param db   raw drizzle instance (getDb) — a tx is opened internally
 * @param args owner tuple + emit callback (contract §6)
 */
export async function cascadeSoftDelete(db: Db, args: CascadeSoftDeleteArgs): Promise<void> {
  const { tenantId, ownerModule, recordType, recordId, emit } = args;

  // Rows tombstoned in the tx, captured for the post-commit emit.
  let tombstoned: Array<{ id: string; byteSize: number }> = [];

  await db.transaction(async (tx: any) => {
    // 1. Lock + read PRIOR state (R3). FOR UPDATE serializes concurrent cascades.
    const rows = (await tx.execute(sql`
      SELECT id, byte_size, status
        FROM files
       WHERE tenant_id = ${tenantId}
         AND owner_module = ${ownerModule}
         AND owner_record_type = ${recordType}
         AND owner_record_id = ${recordId}
         AND deleted_at IS NULL
       FOR UPDATE
    `)) as any[];
    if (rows.length === 0) return; // nothing owned → no-op

    // 2. Tombstone all of them in one statement (idempotent via deleted_at IS NULL).
    await tx
      .update(files)
      .set({ deletedAt: new Date(), status: "deleted" })
      .where(
        and(
          eq(files.tenantId, tenantId),
          eq(files.ownerModule, ownerModule),
          eq(files.ownerRecordType, recordType),
          eq(files.ownerRecordId, recordId),
          isNull(files.deletedAt),
        ),
      );

    // 3. Refund only the bytes that were actually counted toward bytes_used.
    const countedBytes = rows.reduce(
      (sum, r) => (COUNTED_STATUSES.has(r.status) ? sum + Number(r.byte_size) : sum),
      0,
    );
    if (countedBytes > 0) await decrementUsed(tx, tenantId, countedBytes);

    tombstoned = rows.map((r) => ({ id: r.id as string, byteSize: Number(r.byte_size) }));
  });

  // 4. Lifecycle events AFTER commit — one per tombstoned row.
  for (const row of tombstoned) {
    emit("file.deleted", {
      fileId: row.id,
      tenantId,
      ownerModule,
      ownerRecordType: recordType,
      ownerRecordId: recordId,
      byteSize: row.byteSize,
    });
  }
}
