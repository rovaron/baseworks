/**
 * Phase 27 / UPL-02 — server-authoritative magic-byte MIME verification.
 *
 * On /complete the server NEVER trusts the client-declared Content-Type. It
 * sniffs the real bytes that landed in object storage and decides whether the
 * content is allowed for the file's relation. This module owns that decision —
 * `commands/complete-upload.ts` calls `verifyMagicBytes` after pulling the
 * object via the storage port.
 *
 * Library: `file-type@22.0.0` (`fileTypeFromBuffer`) — pure-ESM, zero native
 * deps, Bun-compatible. It is the ROADMAP SC#1 named approach; an inline sniffer
 * was rejected to avoid drifting from real-world magic-byte tables (WebP RIFF,
 * multi-variant JPEG/PNG headers, PDF). `fileTypeFromBuffer` reads only the
 * leading bytes, so we hand it the first 4 KiB (`SNIFF_BYTES`).
 *
 * `file-type` returns `undefined` for signature-less formats (`text/csv`,
 * `application/json`, `text/plain`). The DETECTABLE_MIME guard distinguishes
 * "a signature was EXPECTED but absent" (reject — likely a spoofed binary) from
 * "this relation legitimately accepts non-magic content" (accept the declared
 * MIME). See the decision table below — it mirrors §1.7 of the Phase 27 plan
 * contract verbatim.
 */

import { fileTypeFromBuffer } from "file-type";

/** How many leading bytes we sniff. `file-type` needs only the header. */
export const SNIFF_BYTES = 4096;

/**
 * The MIME types `file-type` reliably detects by signature in this codebase
 * (and that `extFromMime` maps). If EVERY allowed type for a relation is in
 * this set, a missing signature means the upload is almost certainly spoofed
 * (e.g. a `.exe` renamed to `.png`) and must be rejected. If any allowed type
 * is NOT here (a text/json relation), absence of a signature is expected and
 * legitimate, so we fall back to the client-declared MIME.
 */
export const DETECTABLE_MIME: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

/**
 * Result of a magic-byte verification. On success it reports the MIME the
 * server will persist (`effectiveMime`); on failure it reports the rejection
 * code the command maps to an HTTP status (`mime_mismatch`/`mime_unverifiable`
 * → 400).
 */
export type MagicByteResult =
  | { ok: true; effectiveMime: string }
  | { ok: false; reason: "mime_mismatch" | "mime_unverifiable" };

/**
 * Verify uploaded bytes against a relation's allow-list (§1.7 decision table).
 *
 * @param bytes          the object content (full or partial; only the first
 *                       `SNIFF_BYTES` are inspected)
 * @param declaredMime   the client-declared MIME stored at sign-time
 *                       (`files.mime_type`) — used only when the relation
 *                       accepts a non-detectable type and no signature is found
 * @param allowedMimeTypes  the relation's `allowedMimeTypes`
 *
 * Decision table:
 *   - signature found & ∈ allow-list      → accept, effectiveMime = sniffed MIME
 *   - signature found & ∉ allow-list      → reject "mime_mismatch"
 *   - no signature & every allowed type
 *       is detectable (signature expected) → reject "mime_unverifiable"
 *   - no signature & some allowed type is
 *       non-detectable (text/json/csv …)   → accept, effectiveMime = declaredMime
 */
export async function verifyMagicBytes(
  bytes: Uint8Array,
  declaredMime: string,
  allowedMimeTypes: readonly string[],
): Promise<MagicByteResult> {
  const sniff = await fileTypeFromBuffer(bytes.subarray(0, SNIFF_BYTES));

  if (sniff) {
    return allowedMimeTypes.includes(sniff.mime)
      ? { ok: true, effectiveMime: sniff.mime }
      : { ok: false, reason: "mime_mismatch" };
  }

  // No signature. If every allowed type is one we KNOW carries a signature, we
  // expected magic bytes and got none → unverifiable (reject). Otherwise the
  // relation legitimately accepts signature-less content → trust the declared
  // MIME (the magic check is not applicable to text/json/csv).
  const signatureExpected = allowedMimeTypes.every((m) => DETECTABLE_MIME.has(m));
  return signatureExpected
    ? { ok: false, reason: "mime_unverifiable" }
    : { ok: true, effectiveMime: declaredMime };
}
