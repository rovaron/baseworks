/**
 * Phase 27 / UPL-02, UPL-04, ATT-01 — relation recovery from a files row.
 *
 * A `files` row stores `owner_module + owner_record_type` but NOT the registry
 * `kind` (the registry is keyed by `${ownerModule}:${kind}` per D-08). The
 * lifecycle commands (complete-upload, read-url, attach, list-for-record) must
 * recover the `FileRelation` to enforce its `maxByteSize`, `allowedMimeTypes`,
 * and `canRead`/`canWrite` hooks. This is the single helper that walks the
 * registry snapshot and matches on `recordType`.
 *
 * R5 (1:1 assumption): `recordType` → `kind` is treated as 1:1 within a module.
 * `findRelationByRecordType` returns the FIRST relation whose key starts with
 * `${ownerModule}:` AND whose `recordType` matches. If two kinds in one module
 * shared a `recordType` with different limits, complete-upload could validate
 * against the wrong relation — acceptable for the starter (1:1 in practice); the
 * alternative (a `kind` column) is out of scope this phase (schema is locked).
 */

import type { FileRelation } from "@baseworks/shared";
import { fileRelationsRegistry } from "@baseworks/storage";

/**
 * Recover the `FileRelation` for a files row from its `(ownerModule, recordType)`
 * pair. Returns `undefined` when no registered relation matches (caller maps to
 * `unknown_relation` → 400).
 */
export function findRelationByRecordType(
  ownerModule: string,
  recordType: string,
): FileRelation | undefined {
  const prefix = `${ownerModule}:`;
  for (const [key, relation] of fileRelationsRegistry.getAll()) {
    if (key.startsWith(prefix) && relation.recordType === recordType) return relation;
  }
  return undefined;
}

/**
 * MIME types safe to render `inline` in the storage origin. Deliberately an
 * EXPLICIT raster + PDF allow-list rather than a `image/*` prefix match: SVG
 * (`image/svg+xml`) is XML/text that can embed `<script>`, and it carries no
 * binary magic number, so verifyMagicBytes cannot validate it (a relation that
 * allows it would accept the client-declared MIME unverified — magic-bytes.ts
 * §"no signature & some allowed type non-detectable"). Serving such a file
 * `inline` from a signed URL would execute the script in the storage origin —
 * a stored-XSS vector. Any image type NOT on this list (svg, and future
 * vector/exotic formats) falls through to `attachment` (forced download).
 */
const INLINE_MIME: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

/**
 * Build a `Content-Disposition` for a signed READ url. Raster images and PDFs
 * (INLINE_MIME) render inline in the browser; everything else — INCLUDING
 * `image/svg+xml` (stored-XSS risk, see INLINE_MIME) — downloads as an
 * attachment, preserving the original filename when known. Returns `undefined`
 * when no useful disposition applies (caller omits the header).
 */
export function dispositionFor(row: {
  mimeType: string;
  originalFilename?: string | null;
}): string | undefined {
  if (INLINE_MIME.has(row.mimeType)) return "inline";
  if (row.originalFilename) {
    // Strip quotes/newlines that could break the header (defensive — filenames
    // are operator/user-supplied at sign-time).
    const safe = row.originalFilename.replace(/["\r\n]/g, "");
    return `attachment; filename="${safe}"`;
  }
  return "attachment";
}
