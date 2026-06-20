/**
 * Phase 28 / IMG-01, IMG-02, IMG-03 — async image-variant generation job.
 *
 * Queue: `image-transform` (BullMQ). Enqueued by the `file.completed` subscriber
 * (hooks/on-tenant-created.ts) for image uploads whose relation declares
 * `generateVariants`. Registered in the files ModuleDefinition with
 * `concurrency: 2` (caps worker memory — each variant decodes a full buffer).
 *
 * Called DIRECTLY with `job.data` (the worker loop passes `job.data` straight to
 * `handler`), so the unit tests invoke `transformImage({ fileId, tenantId })` for
 * deterministic coverage. Trace propagation (Phase 20 D-02) is automatic: the
 * producer wrapper injected `_otel/_requestId/...` into job.data on enqueue and
 * `wrapProcessorWithAls` reconstructs the parent span — no manual plumbing here.
 *
 * Decompression-bomb defense LAYER (c): a pre-flight `metadata()` check rejects
 * `> 50_000_000` pixels with a STRUCTURED `file.transform-failed` event +
 * `status='failed'` and RETURNS WITHOUT THROWING (no crash, no retry). The tiny
 * 50000x50000 bomb fixture sails past the >20 MB byte cap (layer a) and is caught
 * here — `metadata()` reads its 2.5e9-px header without decoding pixels. LAYER (b)
 * (sharp `limitInputPixels:50M + failOn:'warning'`) fires again inside `resize()`.
 *
 * Failure isolation: any throw (decode/encode error, putObject failure, a single
 * variant failing) is caught → emit `file.transform-failed` + set `status='failed'`
 * + RE-THROW so BullMQ records the attempt and the worker's `on("failed")`
 * ErrorTracker captures it. BullMQ isolates per-job throws, so the worker process
 * never crashes. Per-variant policy is ATOMIC: one variant failing fails the whole
 * job (no partial manifest); a retry regenerates all variants under the same
 * deterministic keys.
 *
 * Result convention: returns void; structured rejection = event + status, hard
 * failure = throw. NEVER returns/leaks storage_key or bucket.
 */

import { env } from "@baseworks/config";
import { type FileTransform, files, getDb } from "@baseworks/db";
import { getFileStorage, getImageTransform } from "@baseworks/storage";
import { and, eq, sql } from "drizzle-orm";
import { variantStorageKey } from "../lib/build-storage-key";
import { addUsed, sumTransformBytes } from "../lib/quota";
import { findRelationByRecordType } from "../lib/relation-lookup";
import { emitTransformEvent } from "../lib/transform-events";

/** LAYER (c) — pre-flight pixel ceiling (re-enforced in sharp resize, layer b). */
const PIXEL_LIMIT = 50_000_000;

/**
 * Phase 28 — SOURCE-format allow-list. The output port union already bans SVG
 * (XSS), but nothing else filters the SOURCE. A relation that allows
 * image/svg+xml would otherwise hand an SVG to sharp's librsvg in the worker,
 * which can dereference external resources/entities (`<image href=…>`) — an
 * SSRF/resource-load surface. We reject any source whose detected raster format
 * is not one of these BEFORE resize (structured failure, no decode of a hostile
 * vector). Same posture as the bomb pre-flight: refuse, don't process.
 */
const ALLOWED_SOURCE_FORMATS = new Set(["png", "jpeg", "webp", "gif"]);

/** Job payload. Trace fields (`_otel`/`_requestId`/...) are injected by the queue
 *  producer wrapper and read by the worker loop / ALS wrapper — not used here. */
export interface TransformImageJob {
  fileId: string;
  tenantId: string;
}

/** Internal shape of the raw files-row read (allow-listed direct access). */
interface FileRow {
  id: string;
  owner_module: string;
  owner_record_type: string;
  storage_key: string;
  bucket: string;
  mime_type: string;
  status: string;
  transforms: FileTransform[] | null;
}

/**
 * Generate the relation's declared image variants for a completed upload.
 *
 * @param data - TransformImageJob payload (`{ fileId, tenantId }`).
 */
export async function transformImage(data: unknown): Promise<void> {
  const { fileId, tenantId } = data as TransformImageJob;
  const db = getDb(env.DATABASE_URL);

  // 1. Load the row raw, tenant-scoped (no `kind` column → recover relation from
  //    owner_module/owner_record_type). deleted_at IS NULL excludes tombstones.
  const rows = (await db.execute(sql`
    SELECT id, owner_module, owner_record_type, storage_key, bucket, mime_type, status, transforms
      FROM files
     WHERE id = ${fileId}
       AND tenant_id = ${tenantId}
       AND deleted_at IS NULL
     LIMIT 1
  `)) as unknown as FileRow[];
  const row = rows[0];
  if (!row) {
    // Nothing to retry — the row vanished (deleted between enqueue and run).
    emitTransformEvent("file.transform-failed", { fileId, tenantId, reason: "not_found" });
    return;
  }

  // 2. Idempotency / status gate. `ready` → already transformed (re-delivery
  //    no-op). Only `uploaded` | `transforming` proceed; any other state
  //    (pending/failed/deleted) is a defensive no-op.
  if (row.status === "ready") return;
  if (row.status !== "uploaded" && row.status !== "transforming") return;

  // 3. Recover the relation + its variant specs. Empty/absent → flip to `ready`
  //    (defensive: the enqueue gate should already prevent enqueuing these).
  const relation = findRelationByRecordType(row.owner_module, row.owner_record_type);
  const variants = relation?.generateVariants ?? [];
  if (variants.length === 0) {
    await db
      .update(files)
      .set({ status: "ready" })
      .where(and(eq(files.id, fileId), eq(files.tenantId, tenantId), eq(files.status, "uploaded")));
    return;
  }

  const bucket = row.bucket;
  const originalKey = row.storage_key;
  // bytes previously counted toward usage (for the idempotent signed delta).
  const oldVariantBytes = sumTransformBytes(row.transforms);

  try {
    // 4. Flip status → 'transforming' (conditional; tolerate re-entry from a
    //    retry that already advanced past this point).
    await db
      .update(files)
      .set({ status: "transforming" })
      .where(and(eq(files.id, fileId), eq(files.tenantId, tenantId), eq(files.status, "uploaded")));

    // 5. Pull the original bytes.
    const bytes = await getFileStorage().getObject({ bucket, key: originalKey });

    // 6. LAYER (c) PRE-FLIGHT — reject the decompression bomb structurally, BEFORE
    //    any variant decode. metadata() reads dims without allocating pixels.
    const meta = await getImageTransform().metadata(bytes);
    if ((meta.pixels ?? meta.width * meta.height) > PIXEL_LIMIT) {
      await db
        .update(files)
        .set({ status: "failed" })
        .where(and(eq(files.id, fileId), eq(files.tenantId, tenantId)));
      emitTransformEvent("file.transform-failed", {
        fileId,
        tenantId,
        reason: "pixel_limit_exceeded",
        width: meta.width,
        height: meta.height,
      });
      // Structured rejection — NO throw, NO retry (the bomb would just re-fail).
      return;
    }

    // 6b. SOURCE-format allow-list — reject non-raster / hostile sources (SVG and
    //     anything not png/jpeg/webp/gif) BEFORE handing bytes to the transform
    //     adapter. Mirrors the bomb pre-flight: structured `file.transform-failed`,
    //     status='failed', NO throw (a wrong-format source will never succeed on
    //     retry). Closes the librsvg SSRF/resource-load surface even when a
    //     relation mistakenly allows image/svg+xml.
    if (!ALLOWED_SOURCE_FORMATS.has(meta.format)) {
      await db
        .update(files)
        .set({ status: "failed" })
        .where(and(eq(files.id, fileId), eq(files.tenantId, tenantId)));
      emitTransformEvent("file.transform-failed", {
        fileId,
        tenantId,
        reason: "unsupported_source_format",
      });
      return;
    }

    // 7. Generate each variant at a DETERMINISTIC key (overwrite-safe under retry).
    const manifest: FileTransform[] = [];
    for (const variant of variants) {
      const key = variantStorageKey(originalKey, variant.name, variant.format);
      const result = await getImageTransform().resize({
        input: bytes,
        width: variant.width,
        height: variant.height,
        format: variant.format,
        quality: variant.quality,
      });
      await getFileStorage().putObject({
        bucket,
        key,
        body: result.output,
        mimeType: result.mimeType,
      });
      manifest.push({
        name: variant.name,
        storageKey: key,
        mimeType: result.mimeType,
        byteSize: result.output.byteLength,
        width: result.width,
        height: result.height,
      });
    }

    // 8. Manifest write — single tx: overwrite transforms + flip to `ready`, and
    //    apply the SIGNED variant-byte delta so retries never double-count (§5.2).
    const newVariantBytes = sumTransformBytes(manifest);
    await db.transaction(async (tx: any) => {
      await tx
        .update(files)
        .set({ transforms: manifest, status: "ready" })
        .where(and(eq(files.id, fileId), eq(files.tenantId, tenantId)));
      await addUsed(tx, tenantId, newVariantBytes - oldVariantBytes);
    });

    // 9. Symmetric lifecycle event (cheap, best-effort).
    emitTransformEvent("file.transformed", {
      fileId,
      tenantId,
      variants: manifest.map((t) => t.name),
    });
  } catch (err) {
    // 10. Failure isolation — mark failed + emit + RE-THROW so BullMQ + the
    //     worker's on("failed") ErrorTracker capture it (worker stays alive).
    await db
      .update(files)
      .set({ status: "failed" })
      .where(and(eq(files.id, fileId), eq(files.tenantId, tenantId)))
      .catch(() => {});
    // SECURITY: emit ONLY a fixed reason code — NEVER `err.message`. Underlying
    // storage errors (e.g. a LocalFileStorage ENOENT) embed the full object path
    // = bucket + storage_key, which this module must never leak (events are
    // forwarded onto the registry bus and may be logged by subscribers). The raw
    // error is preserved by the RE-THROW below → captured by the worker's
    // on("failed") ErrorTracker, which is the sanctioned sink for diagnostics.
    emitTransformEvent("file.transform-failed", {
      fileId,
      tenantId,
      reason: "transform_failed",
    });
    throw err;
  }
}
