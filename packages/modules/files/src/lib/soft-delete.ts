/**
 * Phase 29 / IDA-01 — single quota-conserving soft-delete primitive.
 *
 * Extracted from delete-file (Phase 27) so BOTH delete-file AND attach-file's
 * cascade-on-replace (cardinality:"single") share ONE tombstone+refund code
 * path — there must be exactly one place that conserves `bytes_used` when a row
 * leaves the live set (SC#4 conservation invariant).
 *
 * `softDeleteRow` tombstones a single live row (deleted_at=now, status='deleted')
 * and, when the row's PRIOR status counted toward usage, decrements `bytes_used`
 * by the row's own byte_size PLUS its Phase-28 variant bytes (the transform job
 * credited those into bytes_used, so the refund MUST debit them too or every
 * deletion of a transformed file permanently leaks its variant bytes).
 *
 * Runs inside the caller's transaction (`tx`). The row argument is the raw
 * snake_case projection of a prior `SELECT ... FOR UPDATE` (serialized against
 * concurrent deletes). The returned coordinates let the caller do a best-effort
 * physical `storage.delete()` + emit `file.deleted` AFTER commit (R7) — the DB
 * tombstone is the authoritative atomic action; the object delete is sweepable.
 */

import { files } from "@baseworks/db";
import { and, eq, isNull } from "drizzle-orm";
import { decrementUsed, sumTransformBytes } from "./quota";

/** Prior statuses that counted toward `bytes_used` (so deletion decrements it). */
export const COUNTED_STATUSES = new Set(["uploaded", "ready", "transforming"]);

/** Physical-object coordinates + owner identity captured for post-commit work. */
export type SoftDeleteCaptured = {
  fileId: string;
  bucket: string;
  key: string;
  ownerModule: string;
  ownerRecordType: string;
  ownerRecordId: string;
  byteSize: number;
};

/** Raw snake_case row shape returned by a `SELECT ... FOR UPDATE` over `files`. */
export type SoftDeleteRow = {
  id: string;
  bucket: string;
  storage_key: string;
  owner_module: string;
  owner_record_type: string;
  owner_record_id: string;
  byte_size: string | number;
  status: string;
  transforms: unknown;
};

/**
 * Tombstone one live `files` row and refund its counted bytes inside `tx`.
 * Returns the coordinates for a post-commit best-effort storage delete + emit.
 */
export async function softDeleteRow(
  tx: any,
  tenantId: string,
  row: SoftDeleteRow,
): Promise<SoftDeleteCaptured> {
  // Tombstone (idempotent: the deleted_at IS NULL predicate means a racing
  // delete that already committed updates 0 rows).
  await tx
    .update(files)
    .set({ deletedAt: new Date(), status: "deleted" })
    .where(and(eq(files.id, row.id), eq(files.tenantId, tenantId), isNull(files.deletedAt)));

  // Decrement counted usage only — row's own byte_size PLUS its variant bytes.
  if (COUNTED_STATUSES.has(row.status)) {
    const variantBytes = sumTransformBytes(row.transforms as any);
    await decrementUsed(tx, tenantId, Number(row.byte_size) + variantBytes);
  }

  return {
    fileId: row.id,
    bucket: row.bucket,
    key: row.storage_key,
    ownerModule: row.owner_module,
    ownerRecordType: row.owner_record_type,
    ownerRecordId: row.owner_record_id,
    byteSize: Number(row.byte_size),
  };
}
