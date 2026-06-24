/**
 * Phase 26 / UPL-01, UPL-03, MOD-02 — sign-upload command.
 *
 * End-to-end sign-time flow for a single file upload:
 *   1. fileRelationsRegistry.get(ownerModule, kind) → unknown ⇒ 400 (MOD-02).
 *   2. Per-relation MIME allow-list ⇒ 400.
 *   3. Per-relation max byte size ⇒ 400 (distinct from quota's 413).
 *   4. reserveQuota — single atomic conditional UPDATE; 0 rows ⇒ 413 (QUO-02).
 *   5. buildStorageKey (the ONLY place a key is constructed; CR-01).
 *   6. Insert a pending `files` row (direct files-table access — the module is
 *      allow-listed; explicit tenant_id via ctx.tenantId).
 *   7. getFileStorage().signUpload (TTL ≤ 15 min); NEVER returns storage_key.
 *
 * Everything after a successful reserveQuota is wrapped in try/catch so any
 * failure releases the reservation — a failed request never leaks pending bytes
 * (R3 pending-byte leak).
 */

import { env } from "@baseworks/config";
import { files } from "@baseworks/db";
import { getErrorTracker } from "@baseworks/observability";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { fileRelationsRegistry, getFileStorage } from "@baseworks/storage";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { buildStorageKey, resolveBucket } from "../lib/build-storage-key";
import { releaseQuota, reserveQuota } from "../lib/quota";

const SignUploadInput = Type.Object({
  ownerModule: Type.String({ minLength: 1 }),
  kind: Type.String({ minLength: 1 }),
  mimeType: Type.String({ minLength: 1 }),
  byteSize: Type.Integer({ minimum: 1 }),
});

/** Presigned-URL TTL ceiling (UPL-01): never mint a URL valid for > 15 min. */
const SIGN_TTL_SEC = 900;

export const signUpload = defineCommand(SignUploadInput, async (input, ctx) => {
  // 1. Relation lookup — unknown (ownerModule, kind) ⇒ 400 (MOD-02).
  const relation = fileRelationsRegistry.get(input.ownerModule, input.kind);
  if (!relation) return err("unknown_relation");

  // 2. MIME allow-list (per-relation) ⇒ 400.
  if (!relation.allowedMimeTypes.includes(input.mimeType)) return err("mime_not_allowed");

  // 3. Per-relation max size ⇒ 400 (distinct from quota's 413).
  if (input.byteSize > relation.maxByteSize) return err("file_too_large");

  // Run the entire DB flow through the request-scoped RLS transaction
  // (ctx.withTenant): Postgres RLS constrains `files` + `tenant_storage_usage`
  // to ctx.tenantId transaction-locally, independent of the manual tenant_id
  // predicates below (which STAY as defense-in-depth). `tx` is passed to the
  // quota helpers (reserveQuota/releaseQuota) and the files insert/delete.
  return requireWithTenant(ctx)(async (tx) => {
    // 4. Atomic quota reservation ⇒ 413 on 0 rows (QUO-02).
    const reserved = await reserveQuota(
      tx,
      ctx.tenantId,
      input.byteSize,
      env.STORAGE_DEFAULT_QUOTA_BYTES,
    );
    if (!reserved) return err("quota_exceeded");

    // Everything past reserveQuota must roll back on failure: release the pending
    // bytes (R3) AND delete any pending row we inserted, so a failed sign leaves
    // no orphan row or leaked quota. NEVER echo the raw error to the caller — a DB
    // error (e.g. the files_bucket_key_uq unique violation) can carry the
    // constraint name / offending storage_key, which would breach the invariant
    // that storage internals never reach a response. Report it out-of-band.
    let insertedFileId: string | undefined;
    try {
      const bucket = resolveBucket();
      const key = buildStorageKey({
        tenantId: ctx.tenantId,
        ownerModule: input.ownerModule,
        kind: input.kind,
        mimeType: input.mimeType,
      });

      // 5. Insert pending files row (direct files-table access — module is
      //    allow-listed; explicit tenant_id via ctx.tenantId). ownerRecordId is
      //    "" (unattached) — Phase 27 attachFile links it to a real record.
      const [row] = await tx
        .insert(files)
        .values({
          tenantId: ctx.tenantId,
          ownerModule: input.ownerModule,
          ownerRecordType: relation.recordType,
          ownerRecordId: "",
          storageKey: key,
          bucket,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          status: "pending",
          uploadedByUserId: ctx.userId ?? null,
        })
        .returning({ id: files.id });
      insertedFileId = row.id;

      // 6. Sign (TTL ≤ 15 min). signUpload NEVER returns storage_key.
      const signed = await getFileStorage().signUpload({
        bucket,
        key,
        mimeType: input.mimeType,
        maxByteSize: input.byteSize,
        expiresInSec: SIGN_TTL_SEC,
      });

      // 7. Response — fileId + signed PUT envelope. NO storageKey, NO bucket/key.
      return ok({
        fileId: row.id,
        method: signed.method,
        url: signed.url,
        headers: signed.headers,
        fields: signed.fields,
        expiresAt: signed.expiresAt,
      });
    } catch (error) {
      if (insertedFileId) {
        await tx
          .delete(files)
          .where(and(eq(files.tenantId, ctx.tenantId), eq(files.id, insertedFileId)))
          .catch(() => {});
      }
      await releaseQuota(tx, ctx.tenantId, input.byteSize);
      getErrorTracker().captureException(error, {
        tenantId: ctx.tenantId,
        tags: { module: "files", command: "sign-upload" },
      });
      return err("sign_upload_failed");
    }
  });
});
