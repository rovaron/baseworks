/**
 * Phase 27 / UPL-02 — magic-byte MIME verification unit tests.
 *
 * Exercises the §1.7 decision table with REAL signature headers (PNG/JPEG/WEBP/
 * GIF/PDF) plus spoof/unverifiable/non-detectable cases. No DB, no storage —
 * pure byte inspection via `file-type`.
 */

import { describe, expect, test } from "bun:test";
import { DETECTABLE_MIME, verifyMagicBytes } from "../lib/magic-bytes";

/** 8-byte PNG signature + IHDR chunk header (file-type v22 reads IHDR to
 *  distinguish PNG from APNG, so the bare signature alone is not enough). */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
]);
/** JPEG SOI + JFIF APP0 marker. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
/** RIFF....WEBP container header. */
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
/** GIF89a header. */
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
/** "%PDF-1.4" header. */
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
/** Plain ASCII text ("hello,world") — no binary signature. */
const TEXT = new TextEncoder().encode("hello,world\n1,2,3\n");

describe("verifyMagicBytes — signature matches allow-list", () => {
  test("PNG bytes accepted for an image relation; effectiveMime = sniffed", async () => {
    const r = await verifyMagicBytes(PNG, "image/png", ["image/png", "image/jpeg"]);
    expect(r).toEqual({ ok: true, effectiveMime: "image/png" });
  });

  test("JPEG bytes accepted; effectiveMime = image/jpeg", async () => {
    const r = await verifyMagicBytes(JPEG, "image/jpeg", ["image/png", "image/jpeg"]);
    expect(r).toEqual({ ok: true, effectiveMime: "image/jpeg" });
  });

  test("WEBP bytes accepted; effectiveMime = image/webp", async () => {
    const r = await verifyMagicBytes(WEBP, "image/webp", ["image/webp"]);
    expect(r).toEqual({ ok: true, effectiveMime: "image/webp" });
  });

  test("GIF bytes accepted; effectiveMime = image/gif", async () => {
    const r = await verifyMagicBytes(GIF, "image/gif", ["image/gif"]);
    expect(r).toEqual({ ok: true, effectiveMime: "image/gif" });
  });

  test("PDF bytes accepted; effectiveMime = application/pdf", async () => {
    const r = await verifyMagicBytes(PDF, "application/pdf", ["application/pdf"]);
    expect(r).toEqual({ ok: true, effectiveMime: "application/pdf" });
  });

  test("server overrides a lying declared MIME with the real signature", async () => {
    // Client claimed jpeg but the bytes are PNG (both allowed) → trust the bytes.
    const r = await verifyMagicBytes(PNG, "image/jpeg", ["image/png", "image/jpeg"]);
    expect(r).toEqual({ ok: true, effectiveMime: "image/png" });
  });
});

describe("verifyMagicBytes — signature outside allow-list → mime_mismatch", () => {
  test("a .png that is actually a PDF is rejected", async () => {
    // Spoof: declared image/png, allow-list only image/png, but content is PDF.
    const r = await verifyMagicBytes(PDF, "image/png", ["image/png"]);
    expect(r).toEqual({ ok: false, reason: "mime_mismatch" });
  });

  test("a PNG uploaded to a PDF-only relation is rejected", async () => {
    const r = await verifyMagicBytes(PNG, "application/pdf", ["application/pdf"]);
    expect(r).toEqual({ ok: false, reason: "mime_mismatch" });
  });
});

describe("verifyMagicBytes — no signature", () => {
  test("unverifiable: every allowed type is detectable but no signature found", async () => {
    // A relation that only accepts images, but the bytes carry no magic header
    // (e.g. a renamed script) → reject as unverifiable.
    const r = await verifyMagicBytes(TEXT, "image/png", ["image/png", "image/jpeg"]);
    expect(r).toEqual({ ok: false, reason: "mime_unverifiable" });
  });

  test("accepted: a non-detectable allowed type (text/csv) falls back to declaredMime", async () => {
    const r = await verifyMagicBytes(TEXT, "text/csv", ["text/csv"]);
    expect(r).toEqual({ ok: true, effectiveMime: "text/csv" });
  });

  test("accepted: mixed allow-list with one non-detectable type trusts declaredMime", async () => {
    const r = await verifyMagicBytes(TEXT, "application/json", ["image/png", "application/json"]);
    expect(r).toEqual({ ok: true, effectiveMime: "application/json" });
  });
});

describe("DETECTABLE_MIME", () => {
  test("contains exactly the signed image/pdf set", () => {
    expect([...DETECTABLE_MIME].sort()).toEqual([
      "application/pdf",
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
});
