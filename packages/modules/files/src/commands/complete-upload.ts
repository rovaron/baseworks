/**
 * Phase 27 / UPL-02 — complete-upload: server-authoritative finalization.
 *
 * Closes the synchronous upload loop opened by sign-upload. The client PUTs the
 * object to the signed URL, then calls POST /api/files/:fileId/complete. The
 * server NEVER trusts the client's claimed size or Content-Type — it:
 *   1. loads the pending row (tenant-scoped, must be `pending` & not deleted);
 *   2. `stat()`s object storage for the AUTHORITATIVE byte size;
 *   3. rejects if that size exceeds the relation's `maxByteSize` (→ 413);
 *   4. sniffs the real magic bytes of the object (→ 400 on mismatch/unverifiable);
 *   5. on success, flips the row to `uploaded` with the authoritative size and
 *      atomically moves the reservation pending→used (markUploaded).
 *
 * Reject path (steps 2/3/4): the upload never became a real file, so we HARD
 * clean up — delete the storage object (idempotent, best-effort) + the DB row +
 * release the pending reservation. No audit value in a rejected upload.
 *
 * Reads go through raw `db.execute(sql\`… FROM files …\`)`, NOT the drizzle
 * `db.select().from(files)` builder: the latter is banned repo-wide by the
 * no-direct-files-table-access GritQL plugin / grep gate (which cannot
 * path-allowlist), while raw SQL is the sanctioned in-module read shape (matches
 * lib/quota.ts). Writes use the `db.update/db.delete(files)` builders (not
 * matched by the ban). Every statement carries an explicit tenant_id predicate.
 *
 * R6: the FileStorage port has no ranged read, so `getObject` pulls the FULL
 * object just to sniff the first 4 KiB. Bounded by `relation.maxByteSize`
 * (operator-configured); a ranged `getObject` is a future port extension.
 *
 * Status lands at `'uploaded'`, NOT `'ready'` — `'ready'` is reserved for the
 * post-transform state (Phase 28). NEVER returns storageKey/bucket.
 */

import { files } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { getFileStorage } from "@baseworks/storage";
import { Type } from "@sinclair/typebox";
import { and, eq, sql } from "drizzle-orm";
import { verifyMagicBytes } from "../lib/magic-bytes";
import { markUploaded, releaseQuota } from "../lib/quota";
import { findRelationByRecordType } from "../lib/relation-lookup";

const CompleteUploadInput = Type.Object({
  fileId: Type.String({ minLength: 1 }),
});

export const completeUpload = defineCommand(CompleteUploadInput, async (input, ctx) => {
  // Every tenant DB statement runs through the request-scoped RLS transaction
  // (ctx.withTenant) against the NON-OWNER baseworks_rls pool: Postgres RLS
  // constrains `files` + `tenant_storage_usage` to ctx.tenantId
  // transaction-locally, independent of the manual `tenant_id = ...` predicates
  // below (which STAY as defense-in-depth). Storage stat/getObject/delete are
  // intentionally kept OUTSIDE these transactions (matching the pre-RLS shape):
  // the load + reject-cleanup + success transition + settled-read are each their
  // own atomic withTenant unit — no nested db.transaction.

  // 1. Load the row tenant-scoped (raw SQL — see header). A foreign-tenant id
  //    returns 0 rows → 404 (no existence leak — R2). deleted_at IS NULL
  //    excludes tombstones.
  const rows = (await requireWithTenant(ctx)((tx) =>
    tx.execute(sql`
    SELECT id, owner_module, owner_record_type, storage_key, bucket, mime_type, byte_size, status
      FROM files
     WHERE id = ${input.fileId}
       AND tenant_id = ${ctx.tenantId}
       AND deleted_at IS NULL
     LIMIT 1
  `),
  )) as any[];
  const row = rows[0];
  if (!row) return err("not_found");

  // 2. Idempotency: a non-pending row was already completed — return its state
  //    without re-stat or double-counting quota.
  if (row.status !== "pending") {
    // Echo the already-persisted MIME so the idempotent DTO matches the success
    // DTO shape (unifies the command's return type; no storage internals leak).
    return ok({
      fileId: row.id,
      status: row.status,
      byteSize: Number(row.byte_size),
      mimeType: row.mime_type,
    });
  }

  // 3. Recover the relation from (owner_module, owner_record_type) — the row has
  //    no `kind`. Missing should never happen for a sign-upload row → 400.
  const relation = findRelationByRecordType(row.owner_module, row.owner_record_type);
  if (!relation) return err("unknown_relation");

  const reservedSize = Number(row.byte_size); // reserved against the client's claim
  const bucket = row.bucket as string;
  const key = row.storage_key as string;

  // Shared HARD-cleanup for every reject branch (§1.1): storage delete (idempotent,
  // best-effort) → DB row delete + release the pending reservation, atomically.
  //
  // The release is GATED on the row actually being deleted by THIS call
  // (`.returning()` rowcount === 1). Two concurrent rejects of the same fileId
  // would otherwise each call `releaseQuota(reservedSize)`: the loser's DELETE
  // matches 0 rows (the row is already gone) but the unconditional release would
  // still decrement bytes_pending a SECOND time, silently consuming pending bytes
  // belonging to OTHER in-flight uploads of the tenant (GREATEST only floors at
  // 0). Gating on the deleted rowcount makes the loser a quota no-op.
  const reject = async (code: string) => {
    await getFileStorage()
      .delete({ bucket, key })
      .catch(() => {});
    await requireWithTenant(ctx)(async (tx: any) => {
      const deleted = await tx
        .delete(files)
        .where(and(eq(files.tenantId, ctx.tenantId), eq(files.id, input.fileId)))
        .returning({ id: files.id });
      if (deleted.length === 1) await releaseQuota(tx, ctx.tenantId, reservedSize);
    });
    return err(code);
  };

  // 4. AUTHORITATIVE size from object storage. null → the object never landed
  //    (PUT failed / client raced) → reject → 400.
  const stat = await getFileStorage().stat({ bucket, key });
  if (stat === null) return reject("object_not_found");

  const authoritativeSize = stat.byteSize;

  // 5. Per-relation hard size cap on the AUTHORITATIVE size → 413.
  if (authoritativeSize > relation.maxByteSize) return reject("file_too_large");

  // 6. Magic-byte verification on the real object bytes (§1.7 decision table).
  const objectBytes = await getFileStorage().getObject({ bucket, key });
  const verdict = await verifyMagicBytes(objectBytes, row.mime_type, relation.allowedMimeTypes);
  if (!verdict.ok) return reject(verdict.reason); // mime_mismatch | mime_unverifiable → 400

  const effectiveMime = verdict.effectiveMime;

  // 6a. Phase 28 / IMG-01 — decompression-bomb defense LAYER (a): reject any
  //     image/* over the absolute 20 MB image ceiling BEFORE it can be enqueued
  //     to the transform worker (→ sharp never decodes it). This is a hard cap on
  //     TOP of the relation's maxByteSize (which may be lower). The byte cap and
  //     the 50 M PIXEL cap (layers b/c) are independent — a tiny-byte high-pixel
  //     bomb slips past this and is caught in the worker's pre-flight.
  //
  //     CRITICAL: keyed off the AUTHORITATIVE `effectiveMime` (post magic-byte
  //     sniff), NOT the client-claimed `row.mime_type`. A relation that allows
  //     both an image and a non-image type would otherwise let a client claim a
  //     non-image MIME (e.g. application/pdf) for a >20 MB PNG: the sign-time
  //     claim skips this cap, magic-byte verification then resolves
  //     effectiveMime=image/png, the row finalizes as a 25 MB image, and the
  //     enqueue subscriber (which gates on effectiveMime) hands it to the worker —
  //     exactly the large-byte case layer (a) exists to block. The byte cap and
  //     the enqueue decision MUST use the same MIME source.
  if (effectiveMime.startsWith("image/") && authoritativeSize > 20 * 1024 * 1024) {
    return reject("image_too_large");
  }

  // 7. SUCCESS — single transaction: flip the row to `uploaded` with the
  //    authoritative size + persisted MIME, and move pending→used atomically.
  //
  //    Concurrency gate (SC#3 conservation): step 1 loads the row with an UNLOCKED
  //    read, so between that read and here a racing /complete or /delete may have
  //    already transitioned the row. The conditional UPDATE's `status='pending'`
  //    predicate is the serialization point — under READ COMMITTED the loser's
  //    UPDATE matches 0 rows. markUploaded() (which moves pending→used) therefore
  //    runs ONLY when THIS call actually performed the transition (`.returning()`
  //    rowcount === 1); firing it unconditionally would double-increment
  //    bytes_used and double-decrement bytes_pending (eating other reservations,
  //    or permanently leaking used bytes when a concurrent delete tombstoned the
  //    row first). The loser touches no quota.
  const transitioned = await requireWithTenant(ctx)(async (tx: any) => {
    const updated = await tx
      .update(files)
      .set({
        byteSize: authoritativeSize,
        mimeType: effectiveMime,
        status: "uploaded",
      })
      .where(
        and(
          eq(files.id, input.fileId),
          eq(files.tenantId, ctx.tenantId),
          eq(files.status, "pending"),
        ),
      )
      .returning({ id: files.id });
    if (updated.length === 1) {
      await markUploaded(tx, ctx.tenantId, reservedSize, authoritativeSize);
      return true;
    }
    return false;
  });

  // Lost the race: a concurrent /complete or /delete won between our unlocked
  // load and the UPDATE. Quota was left untouched above. Return the row's settled
  // state (idempotent ok, matching the step-2 guard shape) — or 404 if a
  // concurrent delete tombstoned it. No re-stat, no double-count, no emit.
  if (!transitioned) {
    const after = (await requireWithTenant(ctx)((tx) =>
      tx.execute(sql`
      SELECT id, status, byte_size, mime_type
        FROM files
       WHERE id = ${input.fileId}
         AND tenant_id = ${ctx.tenantId}
         AND deleted_at IS NULL
       LIMIT 1
    `),
    )) as any[];
    const settled = after[0];
    if (!settled) return err("not_found");
    return ok({
      fileId: settled.id,
      status: settled.status,
      byteSize: Number(settled.byte_size),
      mimeType: settled.mime_type,
    });
  }

  // Symmetric lifecycle event (not required by SC, but cheap). After commit.
  ctx.emit("file.completed", {
    fileId: row.id,
    tenantId: ctx.tenantId,
    byteSize: authoritativeSize,
    mimeType: effectiveMime,
  });

  // No storageKey / bucket in the response.
  return ok({
    fileId: row.id,
    status: "uploaded",
    byteSize: authoritativeSize,
    mimeType: effectiveMime,
  });
});
