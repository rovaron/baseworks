/**
 * Phase 26 / UPL-03, CR-01 — storage key construction.
 *
 * This is the ONLY place a storage key is constructed. `storage_key` MUST NEVER
 * appear in any API response (the SignedUpload envelope excludes it by type).
 */

import { nanoid } from "nanoid";

/** Map a MIME type to a file extension; "" when unknown (never throws). */
function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
  };
  return map[mimeType] ?? "";
}

/**
 * Build a collision-resistant storage key. Structure:
 *   {tenantId}/{ownerModule}/{kind}/{nanoid(24)}{ext}
 *
 * - The tenant prefix is INFORMATIONAL only (CR-01): tenant READ isolation comes
 *   from ScopedDb + the files-access ban, NOT from the key. Never parse the key
 *   to authorize.
 * - Collision resistance comes from the mandatory nanoid(24) segment (the unique
 *   index files_bucket_key_uq is the hard backstop).
 */
export function buildStorageKey(args: {
  tenantId: string;
  ownerModule: string;
  kind: string;
  mimeType: string;
}): string {
  const id = nanoid(24); // MANDATORY — 24-char url-safe id
  return `${args.tenantId}/${args.ownerModule}/${args.kind}/${id}${extFromMime(args.mimeType)}`;
}

/**
 * Phase 28 / IMG-01 — deterministic storage key for a generated image variant.
 *
 * Derived purely from `{ originalKey, variantName, format }` so re-running the
 * transform job OVERWRITES the same objects (never piles up duplicates → the
 * manifest stays idempotent under BullMQ retry). The original extension is
 * stripped and the variant is nested under a folder named after the original's
 * id segment:
 *   original: {tenant}/{module}/{kind}/{nanoid24}.png
 *   variant:  {tenant}/{module}/{kind}/{nanoid24}/{variantName}.{ext}
 *
 * Like every storage key this MUST NEVER appear in an API response (FileTransform
 * carries it for internal/manifest use only).
 */
export function variantStorageKey(
  originalKey: string,
  variantName: string,
  format: "webp" | "jpeg" | "png",
): string {
  const ext = { webp: "webp", jpeg: "jpg", png: "png" }[format];
  // Strip the original file extension (last dot-segment of the final path part).
  const base = originalKey.replace(/\.[^/.]+$/, "");
  return `${base}/${variantName}.${ext}`;
}

/**
 * Resolve the bucket for the files module. Single logical bucket; S3_BUCKET when
 * provider=s3/s3-compat, else the literal "files" (local adapter directory).
 *
 * Reads S3_BUCKET directly from process.env (not the typed env) to avoid a config
 * dependency on S3-only vars (R6). Keep this the single source of the bucket string.
 */
export function resolveBucket(): string {
  return process.env.S3_BUCKET ?? "files";
}
