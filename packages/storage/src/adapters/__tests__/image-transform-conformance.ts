/**
 * Phase 28 / IMG-01 / IMG-02 — Shared ImageTransform conformance suite.
 *
 * One reusable, adapter-agnostic test function consumed by both per-adapter test
 * files (`sharp/image-transform.test.ts` runs it under `describe.skipIf(!sharp)`;
 * `imagescript/image-transform.test.ts` runs it unconditionally — pure JS always
 * loads). It exercises ONLY the `ImageTransform` port surface (`resize` +
 * `metadata`) so the same behavioral contract is proven against every adapter.
 *
 * Named `image-transform-conformance.ts` (NOT `*.test.ts`) so `bun test` never
 * executes it standalone — it has no adapter of its own and is imported by the
 * per-adapter `*.test.ts` files (contract §3 / §9).
 *
 * Honest WebP handling (contract §0 probe results): imagescript ENCODES webp but
 * cannot DECODE it, and the port's `ImageMetadata` carries no EXIF fields. So the
 * EXIF-strip assertion is a CONTAINER byte-scan of the transformed output (no
 * decode required) — it runs for every adapter and every format. The optional
 * `caps.reReadMetadata` round-trip (re-decode the variant to confirm valid dims)
 * is gated by `caps.canDecodeWebp` for webp outputs; when the re-reader cannot
 * decode webp that round-trip is skipped, but the byte-scan EXIF check still runs.
 *
 * Two complementary EXIF guarantees:
 *  - The CLEAN baseline (no embedded EXIF) guards "adapter must NOT INJECT
 *    metadata" — sharp must not call `.withMetadata()`, imagescript must emit no
 *    Exif/XMP chunk.
 *  - The EXIF-BEARING fixture (`exif-bearing.jpg`, real GPS + camera Make/Model)
 *    is the LOAD-BEARING STRIP regression gate (IMG-03 / SC#5): a transform of an
 *    input that HAS EXIF must produce output with the EXIF/GPS/XMP markers GONE.
 *    The suite first asserts the INPUT actually carries the markers (so a fixture
 *    regression can't silently neuter the gate), then asserts every output is
 *    clean. JPEG input decodes under BOTH adapters, so this runs for each.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { ImageTransform } from "../../ports/image-transform";
import { loadFixture } from "../../test-support/fixtures";

/** Round-trip source: committed 100x100 PNG (no EXIF). */
const BASELINE = "baseline-100x100.png" as const;
/** Decompression-bomb fixture: 225-byte PNG, IHDR 50000x50000 = 2.5e9 px. */
const BOMB = "bomb-50000x50000.png" as const;
/** EXIF-strip gate input: 80x60 JPEG carrying real GPS + camera Make/Model EXIF. */
const EXIF_BEARING = "exif-bearing.jpg" as const;

/** Output format this suite knows how to assert magic bytes for. */
export type TransformFormat = "webp" | "jpeg" | "png";

/**
 * Capability descriptor so the WebP-decode gap is handled honestly, not faked.
 * - `formats`: the output formats this adapter ENCODES (drives per-format coverage).
 *   imagescript and sharp both encode webp/jpeg/png (contract §0), so both pass the
 *   full set; the field exists so a future encode-limited adapter runs a subset.
 * - `canDecodeWebp`: whether `reReadMetadata` can DECODE webp bytes. Drives the
 *   optional webp round-trip re-read only — the container byte-scan EXIF check is
 *   independent of decode capability and always runs.
 * - `reReadMetadata`: adapter used to re-read a transformed variant's metadata
 *   (typically the sharp instance when loadable). Used for the round-trip dims
 *   sanity check; never the source of the EXIF assertion.
 */
export interface ImageTransformCaps {
  formats: ReadonlyArray<TransformFormat>;
  canDecodeWebp: boolean;
  reReadMetadata: ImageTransform;
}

/** Magic-byte signature check for the requested encoded format. */
function hasFormatMagic(bytes: Uint8Array, format: TransformFormat): boolean {
  switch (format) {
    case "png":
      // \x89 P N G \r \n \x1a \n
      return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    case "jpeg":
      // FF D8 FF (SOI + first marker)
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "webp":
      // "RIFF" at 0..4, "WEBP" at 8..12
      return (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
  }
}

/** ASCII tokens that betray retained image metadata across the three containers. */
const EXIF_MARKERS = [
  "Exif", // JPEG APP1 payload tag
  "EXIF", // WebP "EXIF" chunk fourCC
  "eXIf", // PNG eXIf ancillary chunk
  "XMP ", // WebP "XMP " chunk fourCC
  "<?xpacket", // XMP packet sentinel (any container)
  "ns.adobe.com/xap", // XMP namespace (any container)
] as const;

/** True if `bytes` contains the ASCII `token` anywhere (latin1 byte compare). */
function containsToken(bytes: Uint8Array, token: string): boolean {
  const needle = Buffer.from(token, "latin1");
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(needle);
}

/** First EXIF/XMP marker found in the buffer, or null when metadata-free. */
function findExifMarker(bytes: Uint8Array): string | null {
  for (const marker of EXIF_MARKERS) {
    if (containsToken(bytes, marker)) return marker;
  }
  return null;
}

/**
 * Runs the full ImageTransform behavioral contract against the adapter produced
 * by `makeTransform` (resolved once per suite in `beforeAll`). Per-format
 * behaviors iterate `caps.formats` so an encode-limited adapter only asserts the
 * formats it actually supports — no faked passes.
 */
export function runImageTransformConformance(
  label: string,
  makeTransform: () => ImageTransform | Promise<ImageTransform>,
  caps: ImageTransformCaps,
): void {
  describe(`ImageTransform conformance — ${label}`, () => {
    let transform: ImageTransform;
    let baseline: Uint8Array;
    let bomb: Uint8Array;
    let exifBearing: Uint8Array;

    beforeAll(async () => {
      transform = await makeTransform();
      baseline = loadFixture(BASELINE);
      bomb = loadFixture(BOMB);
      exifBearing = loadFixture(EXIF_BEARING);
    });

    // The EXIF-strip gate is only meaningful if the INPUT actually carries EXIF.
    // Assert that once up front — a fixture regression that strips the markers
    // from the SOURCE would otherwise silently turn the strip test into a no-op.
    test("EXIF-bearing fixture genuinely carries EXIF/GPS/camera markers (gate sanity)", () => {
      expect(findExifMarker(exifBearing)).not.toBeNull();
      expect(containsToken(exifBearing, "Exif")).toBe(true);
    });

    // (1) Pure — adapter identity present for log lines.
    test("name discriminator is a non-empty string", () => {
      expect(typeof transform.name).toBe("string");
      expect(transform.name.length).toBeGreaterThan(0);
    });

    // (5) metadata() on the baseline reads exact dims + pixel count.
    test("metadata reads baseline dims (100x100, 10000 px)", async () => {
      const meta = await transform.metadata(baseline);
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(100);
      expect(meta.format).toBe("png");
      expect(meta.pixels).toBe(10_000);
    });

    // (6) Decompression-bomb pre-flight: metadata() reads the 2.5e9-px header
    // WITHOUT decoding/crashing, and the policy ceiling (50M) is exceeded.
    test("metadata rejects the bomb by pixel count without crashing", async () => {
      const meta = await transform.metadata(bomb);
      expect(meta.width).toBe(50_000);
      expect(meta.height).toBe(50_000);
      expect(meta.pixels).toBe(2_500_000_000);
      // The worker's layer-(c) policy: pixels > 50M → structured rejection.
      expect(meta.pixels ?? 0).toBeGreaterThan(50_000_000);
    });

    // Per-format behaviors (2, 3, 4) — only for formats this adapter encodes.
    for (const format of caps.formats) {
      describe(`format: ${format}`, () => {
        // (2) resize baseline 100x100 → 50px wide; magic + returned width.
        test("resize produces non-empty output with correct magic + width", async () => {
          const result = await transform.resize({
            input: baseline,
            width: 50,
            format,
          });

          expect(result.output.byteLength).toBeGreaterThan(0);
          expect(result.mimeType).toBe(`image/${format}`);
          // Returned dims are authoritative post-resize (info object), width===50.
          expect(result.width).toBe(50);
          expect(hasFormatMagic(result.output, format)).toBe(true);
        });

        // (3) WebP container magic explicitly (RIFF....WEBP) — both adapters
        // encode webp (contract §0), so both run this when "webp" ∈ formats.
        if (format === "webp") {
          test("webp output has RIFF....WEBP container magic", async () => {
            const result = await transform.resize({
              input: baseline,
              width: 50,
              format,
            });
            expect(result.output.subarray(0, 4)).toEqual(new Uint8Array([0x52, 0x49, 0x46, 0x46]));
            expect(result.output.subarray(8, 12)).toEqual(new Uint8Array([0x57, 0x45, 0x42, 0x50]));
          });
        }

        // (4) EXIF NON-INJECTION — a transform of the CLEAN baseline must not
        // introduce any Exif/XMP marker. Decode-free; runs for every adapter+format.
        test("transformed output carries no EXIF/XMP/GPS metadata (no injection)", async () => {
          const result = await transform.resize({
            input: baseline,
            width: 50,
            format,
          });
          const marker = findExifMarker(result.output);
          expect(marker).toBeNull();
        });

        // (4-strip) EXIF STRIP regression gate (IMG-03 / SC#5) — transform an
        // input that HAS real GPS + camera EXIF and assert the markers are GONE
        // from the output. This is the load-bearing gate: it FAILS if sharp ever
        // adds `.withMetadata()`/`.withExif()` or imagescript starts copying
        // metadata. The (4) non-injection check above cannot catch a strip
        // regression on its own (clean input → clean output regardless).
        test("EXIF/GPS stripped from an EXIF-bearing input", async () => {
          const result = await transform.resize({
            input: exifBearing,
            width: 40,
            format,
          });
          expect(result.output.byteLength).toBeGreaterThan(0);
          expect(hasFormatMagic(result.output, format)).toBe(true);
          // None of the source's EXIF/GPS/XMP markers survive into the variant.
          expect(findExifMarker(result.output)).toBeNull();
          // Belt-and-suspenders: the specific camera fields are gone too.
          expect(containsToken(result.output, "BaseworksCam")).toBe(false);
          expect(containsToken(result.output, "Phase28-Model")).toBe(false);
        });

        // (4b) Optional round-trip: re-decode the variant via caps.reReadMetadata
        // to confirm it is a valid image with the resized width. Gated for webp by
        // caps.canDecodeWebp (imagescript can't decode webp → skipped, but the
        // byte-scan EXIF check above still asserts the container is clean).
        const canReRead = format !== "webp" || caps.canDecodeWebp;
        test.skipIf(!canReRead)("variant re-reads as a valid image (round-trip dims)", async () => {
          const result = await transform.resize({
            input: baseline,
            width: 50,
            format,
          });
          const meta = await caps.reReadMetadata.metadata(result.output);
          expect(meta.width).toBe(50);
          expect(meta.format).toBe(format);
        });
      });
    }
  });
}
