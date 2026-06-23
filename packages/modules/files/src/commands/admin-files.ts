/**
 * Phase 30 / UI-02 — cross-tenant admin files operations.
 *
 * Caller MUST be platform-admin-gated (the apps/api admin route plugin, which is
 * `.use(requirePlatformAdmin())`). `targetTenantId` is the gated `:id` path param
 * — NEVER a client body field. These are PLAIN async functions, not
 * `defineCommand`/`defineQuery`: there is no `HandlerContext.tenantId` injection,
 * because the whole point is that the caller supplies the TARGET tenant
 * explicitly and the function trusts it. Authorization lives at the route, NOT
 * here. They DELIBERATELY bypass per-relation `canRead`/`canWrite` hooks — a
 * platform admin has cross-tenant authority by definition.
 *
 * Every function:
 *   - reuses the SAME quota / key / magic-byte / soft-delete primitives as the
 *     public ctx-scoped commands, only swapping the tenant argument to
 *     `targetTenantId` (so quota is ALWAYS charged to the path tenant, never the
 *     admin's own — R3);
 *   - returns the repo `Result` shape (`ok()/err()`);
 *   - NEVER returns `storage_key`/`bucket` (R4). The list DTO even sanitises the
 *     `transforms` manifest — `FileTransform.storageKey` would otherwise leak the
 *     raw variant keys — exposing only display fields + a `variantCount`.
 *
 * Direct `files` access is allow-listed inside this module: reads use raw
 * `db.execute(sql\`…\`)` (the `db.select().from(files)` builder is banned
 * repo-wide); writes use the `db.update/db.delete(files)` builders. Every
 * statement carries an explicit `tenant_id = targetTenantId` predicate.
 */

import { env } from "@baseworks/config";
import { files, getDb } from "@baseworks/db";
import { getErrorTracker } from "@baseworks/observability";
import { err, ok, type Result } from "@baseworks/shared";
import { fileRelationsRegistry, getFileStorage } from "@baseworks/storage";
import { and, eq, sql } from "drizzle-orm";
import { enqueueTransform } from "../hooks/on-tenant-created";
import { buildStorageKey, resolveBucket } from "../lib/build-storage-key";
import { verifyMagicBytes } from "../lib/magic-bytes";
import { markUploaded, releaseQuota, reserveQuota } from "../lib/quota";
import { dispositionFor, findRelationByRecordType } from "../lib/relation-lookup";
import { type SoftDeleteCaptured, softDeleteRow } from "../lib/soft-delete";

/** The (ownerModule, kind) the admin attachments are keyed under (registry §4). */
const ADMIN_OWNER_MODULE = "files";
const ADMIN_KIND = "admin-attachment";
/** = files.owner_record_type for admin uploads (the file is owned by the tenant). */
const ADMIN_RECORD_TYPE = "tenant";
/** Presigned-upload TTL ceiling — mirror sign-upload's 15-min cap. */
const ADMIN_SIGN_TTL_SEC = 900;
/** Absolute image byte ceiling (decompression-bomb LAYER a; mirror complete-upload). */
const IMAGE_BYTE_CEILING = 20 * 1024 * 1024;
/** List pagination bounds. */
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;

/** A sanitised variant manifest entry — NEVER carries the raw `storageKey`/bucket. */
type AdminVariantDto = {
  name: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
};

/** Display projection of a `files` row for the admin browser. No storage internals. */
export type AdminFileDto = {
  fileId: string;
  ownerModule: string;
  ownerRecordType: string;
  ownerRecordId: string;
  mimeType: string;
  byteSize: number;
  status: string;
  originalFilename: string | null;
  transforms: AdminVariantDto[];
  variantCount: number;
  createdAt: Date;
  uploadedByUserId: string | null;
};

/**
 * Strip every storage-key-bearing field from the persisted `transforms` jsonb.
 * `FileTransform` carries `storageKey` for the worker/manifest only; surfacing it
 * in an API response would breach the storage-internals invariant (R4). We expose
 * just the display fields the browser needs to show a variant exists.
 */
function sanitizeTransforms(raw: unknown): AdminVariantDto[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => ({
    name: String((t as { name?: unknown }).name ?? ""),
    mimeType: String((t as { mimeType?: unknown }).mimeType ?? ""),
    byteSize: Number((t as { byteSize?: unknown }).byteSize ?? 0),
    width: (t as { width?: number }).width,
    height: (t as { height?: number }).height,
  }));
}

/**
 * LIST — tenant-WIDE (NOT owner-record-scoped). Returns EVERY live file in the
 * target tenant (avatars, logos, admin-attachments) so the operator sees the full
 * surface. Explicit column list (no `SELECT *`) and a sanitised `transforms` keep
 * `storage_key`/`bucket` out of the projection (R4).
 */
export async function adminListFilesForTenant(
  targetTenantId: string,
  opts?: { limit?: number; offset?: number },
): Promise<Result<{ files: AdminFileDto[]; total: number }>> {
  const limit = Math.min(
    Math.max(Math.trunc(opts?.limit ?? LIST_DEFAULT_LIMIT), 1),
    LIST_MAX_LIMIT,
  );
  const offset = Math.max(Math.trunc(opts?.offset ?? 0), 0);
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant op — explicit targetTenantId, gated by requirePlatformAdmin

  const rows = (await db.execute(sql`
    SELECT id, owner_module, owner_record_type, owner_record_id, mime_type, byte_size, status,
           original_filename, transforms, created_at, uploaded_by_user_id
      FROM files
     WHERE tenant_id = ${targetTenantId}
       AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT ${limit} OFFSET ${offset}
  `)) as any[];

  const countRows = (await db.execute(sql`
    SELECT COUNT(*)::int AS total
      FROM files
     WHERE tenant_id = ${targetTenantId}
       AND deleted_at IS NULL
  `)) as any[];
  const total = Number(countRows[0]?.total ?? 0);

  const filesDto: AdminFileDto[] = rows.map((r) => {
    const transforms = sanitizeTransforms(r.transforms);
    return {
      fileId: r.id,
      ownerModule: r.owner_module,
      ownerRecordType: r.owner_record_type,
      ownerRecordId: r.owner_record_id,
      mimeType: r.mime_type,
      byteSize: Number(r.byte_size),
      status: r.status,
      originalFilename: r.original_filename ?? null,
      transforms,
      variantCount: transforms.length,
      createdAt: r.created_at,
      uploadedByUserId: r.uploaded_by_user_id ?? null,
    };
  });

  return ok({ files: filesDto, total });
}

/**
 * SIGN — charges the TARGET tenant quota; key + pending row under the TARGET
 * tenant; `owner_record_id = targetTenantId` (auto-attached to the tenant record,
 * so admin uploads need no separate attach step). Same rollback discipline as
 * sign-upload.ts: release the reservation + delete the orphan row on any failure,
 * and NEVER echo the raw DB error (a unique-violation message can carry the
 * constraint name / offending storage_key).
 */
export async function adminSignUpload(
  targetTenantId: string,
  input: { mimeType: string; byteSize: number; originalFilename?: string },
): Promise<
  Result<{
    fileId: string;
    method: string;
    url: string;
    headers?: Record<string, string>;
    fields?: Record<string, string>;
    expiresAt: string;
  }>
> {
  const relation = fileRelationsRegistry.get(ADMIN_OWNER_MODULE, ADMIN_KIND);
  if (!relation) return err("unknown_relation");
  if (!relation.allowedMimeTypes.includes(input.mimeType)) return err("mime_not_allowed");
  if (input.byteSize > relation.maxByteSize) return err("file_too_large");

  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant op — explicit targetTenantId, gated by requirePlatformAdmin

  // Charge the TARGET tenant's quota (R3). 0 rows ⇒ over limit ⇒ 413.
  const reserved = await reserveQuota(
    db,
    targetTenantId,
    input.byteSize,
    env.STORAGE_DEFAULT_QUOTA_BYTES,
  );
  if (!reserved) return err("quota_exceeded");

  let insertedFileId: string | undefined;
  try {
    const bucket = resolveBucket();
    const key = buildStorageKey({
      tenantId: targetTenantId,
      ownerModule: ADMIN_OWNER_MODULE,
      kind: ADMIN_KIND,
      mimeType: input.mimeType,
    });

    const [row] = await db
      .insert(files)
      .values({
        tenantId: targetTenantId,
        ownerModule: ADMIN_OWNER_MODULE,
        ownerRecordType: ADMIN_RECORD_TYPE,
        // Auto-attached to the tenant record itself (no separate attach step).
        ownerRecordId: targetTenantId,
        storageKey: key,
        bucket,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        status: "pending",
        originalFilename: input.originalFilename ?? null,
        // Admin context has no per-tenant userId in the TARGET tenant.
        uploadedByUserId: null,
      })
      .returning({ id: files.id });
    insertedFileId = row.id;

    const signed = await getFileStorage().signUpload({
      bucket,
      key,
      mimeType: input.mimeType,
      maxByteSize: input.byteSize,
      expiresInSec: ADMIN_SIGN_TTL_SEC,
    });

    // No storageKey / bucket in the response.
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
      await db
        .delete(files)
        .where(and(eq(files.tenantId, targetTenantId), eq(files.id, insertedFileId)))
        .catch(() => {});
    }
    await releaseQuota(db, targetTenantId, input.byteSize);
    getErrorTracker().captureException(error, {
      tenantId: targetTenantId,
      tags: { module: "files", command: "admin-sign-upload" },
    });
    return err("sign_upload_failed");
  }
}

/**
 * COMPLETE — server-authoritative finalize for the TARGET tenant. Identical logic
 * to complete-upload.ts (stat → relation cap → magic bytes → image>20MB cap →
 * markUploaded / reject hard-cleanup), scoped to `targetTenantId`. On success it
 * calls `enqueueTransform` directly (the admin route has no registry event bus).
 */
export async function adminCompleteUpload(
  targetTenantId: string,
  fileId: string,
): Promise<Result<{ fileId: string; status: string; byteSize: number; mimeType: string }>> {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant op — explicit targetTenantId, gated by requirePlatformAdmin

  const rows = (await db.execute(sql`
    SELECT id, owner_module, owner_record_type, storage_key, bucket, mime_type, byte_size, status
      FROM files
     WHERE id = ${fileId}
       AND tenant_id = ${targetTenantId}
       AND deleted_at IS NULL
     LIMIT 1
  `)) as any[];
  const row = rows[0];
  if (!row) return err("not_found");

  // Idempotency: an already-completed row returns its settled state.
  if (row.status !== "pending") {
    return ok({
      fileId: row.id,
      status: row.status,
      byteSize: Number(row.byte_size),
      mimeType: row.mime_type,
    });
  }

  const relation = findRelationByRecordType(row.owner_module, row.owner_record_type);
  if (!relation) return err("unknown_relation");

  const reservedSize = Number(row.byte_size);
  const bucket = row.bucket as string;
  const key = row.storage_key as string;

  // Shared HARD-cleanup for every reject branch (gated on the delete rowcount so a
  // racing reject is a quota no-op — see complete-upload.ts).
  const reject = async (code: string) => {
    await getFileStorage()
      .delete({ bucket, key })
      .catch(() => {});
    await db.transaction(async (tx: any) => {
      const deleted = await tx
        .delete(files)
        .where(and(eq(files.tenantId, targetTenantId), eq(files.id, fileId)))
        .returning({ id: files.id });
      if (deleted.length === 1) await releaseQuota(tx, targetTenantId, reservedSize);
    });
    return err(code);
  };

  const stat = await getFileStorage().stat({ bucket, key });
  if (stat === null) return reject("object_not_found");

  const authoritativeSize = stat.byteSize;
  if (authoritativeSize > relation.maxByteSize) return reject("file_too_large");

  const objectBytes = await getFileStorage().getObject({ bucket, key });
  const verdict = await verifyMagicBytes(objectBytes, row.mime_type, relation.allowedMimeTypes);
  if (!verdict.ok) return reject(verdict.reason);

  const effectiveMime = verdict.effectiveMime;
  // Decompression-bomb LAYER (a): keyed off the AUTHORITATIVE effectiveMime.
  if (effectiveMime.startsWith("image/") && authoritativeSize > IMAGE_BYTE_CEILING) {
    return reject("image_too_large");
  }

  const transitioned = await db.transaction(async (tx: any) => {
    const updated = await tx
      .update(files)
      .set({ byteSize: authoritativeSize, mimeType: effectiveMime, status: "uploaded" })
      .where(
        and(eq(files.id, fileId), eq(files.tenantId, targetTenantId), eq(files.status, "pending")),
      )
      .returning({ id: files.id });
    if (updated.length === 1) {
      await markUploaded(tx, targetTenantId, reservedSize, authoritativeSize);
      return true;
    }
    return false;
  });

  if (!transitioned) {
    const after = (await db.execute(sql`
      SELECT id, status, byte_size, mime_type
        FROM files
       WHERE id = ${fileId}
         AND tenant_id = ${targetTenantId}
         AND deleted_at IS NULL
       LIMIT 1
    `)) as any[];
    const settled = after[0];
    if (!settled) return err("not_found");
    return ok({
      fileId: settled.id,
      status: settled.status,
      byteSize: Number(settled.byte_size),
      mimeType: settled.mime_type,
    });
  }

  // Admin path — enqueue image variants directly (no registry event bus). The
  // helper is best-effort + self-guarding (raster-only, generateVariants, no-Redis
  // skip, try/catch) so it never fails the finalize.
  await enqueueTransform({ fileId, tenantId: targetTenantId });

  return ok({
    fileId: row.id,
    status: "uploaded",
    byteSize: authoritativeSize,
    mimeType: effectiveMime,
  });
}

/**
 * READ URL — short-lived signed GET for ANY file in the target tenant. Bypasses
 * `canRead` (admin authority). Returns `{ url, expiresAt }` only.
 */
export async function adminGetReadUrl(
  targetTenantId: string,
  fileId: string,
): Promise<Result<{ url: string; expiresAt: string }>> {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant op — explicit targetTenantId, gated by requirePlatformAdmin

  const rows = (await db.execute(sql`
    SELECT bucket, storage_key, mime_type, original_filename
      FROM files
     WHERE id = ${fileId}
       AND tenant_id = ${targetTenantId}
       AND deleted_at IS NULL
     LIMIT 1
  `)) as any[];
  const row = rows[0];
  if (!row) return err("not_found");

  const signed = await getFileStorage().signRead({
    bucket: row.bucket,
    key: row.storage_key,
    expiresInSec: env.STORAGE_SIGNED_URL_TTL_SEC,
    responseContentDisposition: dispositionFor({
      mimeType: row.mime_type,
      originalFilename: row.original_filename,
    }),
  });

  return ok({ url: signed.url, expiresAt: signed.expiresAt });
}

/**
 * DELETE — tenant-scoped SOFT delete for ANY file in the target tenant. Reuses the
 * shared `softDeleteRow` primitive (tombstone + refund of own + variant bytes).
 * Best-effort physical delete AFTER commit (the tombstone is authoritative).
 */
export async function adminDeleteFile(
  targetTenantId: string,
  fileId: string,
): Promise<Result<{ fileId: string; deleted: true }>> {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant op — explicit targetTenantId, gated by requirePlatformAdmin

  const captured: SoftDeleteCaptured | null = await db.transaction(
    async (tx: any): Promise<SoftDeleteCaptured | null> => {
      const rows = (await tx.execute(sql`
        SELECT id, bucket, storage_key, owner_module, owner_record_type, owner_record_id, byte_size, status, transforms
          FROM files
         WHERE id = ${fileId}
           AND tenant_id = ${targetTenantId}
           AND deleted_at IS NULL
         FOR UPDATE
      `)) as any[];
      const prior = rows[0];
      if (!prior) return null;
      return softDeleteRow(tx, targetTenantId, prior);
    },
  );

  if (!captured) return err("not_found");
  const c = captured;

  await getFileStorage()
    .delete({ bucket: c.bucket, key: c.key })
    .catch((e) => {
      getErrorTracker().captureException(e, {
        tenantId: targetTenantId,
        tags: { module: "files", command: "admin-delete-file" },
      });
    });

  return ok({ fileId, deleted: true });
}
