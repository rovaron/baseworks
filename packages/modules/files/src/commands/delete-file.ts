/**
 * Phase 27 / UPL-04 — delete-file: tenant-scoped SOFT delete.
 *
 * DELETE /api/files/:fileId. Tombstones the row (deleted_at=now, status
 * 'deleted') to preserve the audit trail, decrements `bytes_used` when the row
 * was actually counted, deletes the physical object best-effort, and emits
 * `file.deleted`.
 *
 * R3 (prior status): Postgres `UPDATE ... RETURNING` returns the POST-update
 * row, so a RETURNING `status` would read `'deleted'`. To decide whether the
 * row counted toward `bytes_used` we must read the PRIOR status — hence
 * SELECT ... FOR UPDATE then UPDATE, inside one transaction. A `pending` row's
 * bytes live in `bytes_pending` (not `bytes_used`); deleting one is an edge case
 * left to the Phase 31 cleanup job, so we decrement only for counted rows.
 *
 * R7 (non-atomicity): the authoritative atomic action is the DB soft-delete
 * (tombstone + usage decrement in one tx). The physical `storage.delete` is
 * idempotent best-effort AFTER commit; a failed object-delete leaves an orphan
 * the Phase 31 reconciliation sweep handles — the tombstone is never lost, and
 * we never delete the object before the row, so no live row points at a gone
 * object.
 *
 * The SELECT FOR UPDATE uses raw `tx.execute(sql)` (not the banned
 * `select().from(files)` builder — see complete-upload.ts header). The tombstone
 * UPDATE uses the `tx.update(files)` builder (not matched by the ban).
 */

import { env } from "@baseworks/config";
import { getDb } from "@baseworks/db";
import { getErrorTracker } from "@baseworks/observability";
import { defineCommand, err, ok } from "@baseworks/shared";
import { getFileStorage } from "@baseworks/storage";
import { Type } from "@sinclair/typebox";
import { sql } from "drizzle-orm";
import { type SoftDeleteCaptured, softDeleteRow } from "../lib/soft-delete";

const DeleteFileInput = Type.Object({
  fileId: Type.String({ minLength: 1 }),
});

export const deleteFile = defineCommand(DeleteFileInput, async (input, ctx) => {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: files module scopes by ctx.tenantId manually (pre-ScopedDb pattern)

  // Capture the row's physical-object coordinates + owner identity from inside
  // the tx so we can emit + best-effort-delete AFTER commit. Returned from the tx
  // (not a closure-scoped `let`, which TS narrows to `never` after the guard);
  // null when no live row matched → 404 (foreign-tenant id also lands here — R2).
  // The tombstone + quota refund are the shared `softDeleteRow` primitive
  // (lib/soft-delete.ts) — the SINGLE conservation code path also used by
  // attach-file's cascade-on-replace (Phase 29 / SC#4).
  const captured: SoftDeleteCaptured | null = await db.transaction(
    async (tx: any): Promise<SoftDeleteCaptured | null> => {
      // 1. Lock + read the PRIOR state (R3) via raw SQL. FOR UPDATE serializes
      //    concurrent deletes of the same row.
      const rows = (await tx.execute(sql`
      SELECT id, bucket, storage_key, owner_module, owner_record_type, owner_record_id, byte_size, status, transforms
        FROM files
       WHERE id = ${input.fileId}
         AND tenant_id = ${ctx.tenantId}
         AND deleted_at IS NULL
       FOR UPDATE
    `)) as any[];
      const prior = rows[0];
      if (!prior) return null; // no live row → 404

      // 2/3. Tombstone + quota refund (own byte_size + Phase-28 variant bytes).
      return softDeleteRow(tx, ctx.tenantId, prior);
    },
  );

  if (!captured) return err("not_found");
  const c = captured;

  // 4. Best-effort physical delete AFTER commit (idempotent). A failure leaves a
  //    sweepable orphan; the tombstone is authoritative.
  await getFileStorage()
    .delete({ bucket: c.bucket, key: c.key })
    .catch((e) => {
      getErrorTracker().captureException(e, {
        tenantId: ctx.tenantId,
        tags: { module: "files", command: "delete-file" },
      });
    });

  // 5. Lifecycle event.
  ctx.emit("file.deleted", {
    fileId: input.fileId,
    tenantId: ctx.tenantId,
    ownerModule: c.ownerModule,
    ownerRecordType: c.ownerRecordType,
    ownerRecordId: c.ownerRecordId,
    byteSize: c.byteSize,
  });

  return ok({ fileId: input.fileId, deleted: true });
});
