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
 * Resolve the bucket for the files module. Single logical bucket; S3_BUCKET when
 * provider=s3/s3-compat, else the literal "files" (local adapter directory).
 *
 * Reads S3_BUCKET directly from process.env (not the typed env) to avoid a config
 * dependency on S3-only vars (R6). Keep this the single source of the bucket string.
 */
export function resolveBucket(): string {
  return process.env.S3_BUCKET ?? "files";
}
