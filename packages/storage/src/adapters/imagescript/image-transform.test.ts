/**
 * ImagescriptImageTransform unit test (Phase 28 / IMG-01, IMG-02, IMG-03).
 *
 * Focused proof that the pure-JS fallback adapter resizes the committed baseline
 * fixture and that every output it claims to encode (png/jpeg/webp) round-trips
 * to the right magic bytes + dimensions, plus the bomb-safe header `metadata()`.
 * imagescript is pure JS, so this runs unconditionally under Bun (no native gate).
 */

import { describe, expect, test } from "bun:test";
import { Image } from "imagescript";
import { loadFixture } from "../../test-support/fixtures";
import {
  type ImageTransformCaps,
  runImageTransformConformance,
} from "../__tests__/image-transform-conformance";
import { SharpImageTransform } from "../sharp/image-transform";
import { ImagescriptImageTransform } from "./image-transform";

const adapter = new ImagescriptImageTransform();

// SC#2 — both adapters pass the SAME shared conformance suite. imagescript runs
// it unconditionally (pure JS, always loads). It ENCODES webp/jpeg/png but cannot
// DECODE webp, so the webp round-trip re-read is delegated to sharp when its
// native binding is loadable (canDecodeWebp = sharpLoadable); when sharp is
// absent the webp round-trip is skipped, but the decode-free container EXIF scan
// still asserts the webp output is metadata-clean (documented fallback limit).
let sharpLoadable = false;
try {
  const sharp = (await import("sharp")).default;
  await sharp(Buffer.from(loadFixture("baseline-100x100.png"))).metadata();
  sharpLoadable = true;
} catch {
  sharpLoadable = false;
}
const conformanceCaps: ImageTransformCaps = {
  formats: ["webp", "jpeg", "png"],
  canDecodeWebp: sharpLoadable,
  reReadMetadata: sharpLoadable ? new SharpImageTransform() : adapter,
};
runImageTransformConformance("imagescript", () => adapter, conformanceCaps);

describe("ImagescriptImageTransform", () => {
  test("name discriminator", () => {
    expect(adapter.name).toBe("imagescript");
  });

  test("resize baseline 100x100 -> 50px PNG decodes back at 50x50", async () => {
    const input = loadFixture("baseline-100x100.png");
    const { output, mimeType, width, height } = await adapter.resize({
      input,
      width: 50,
      height: 50,
      format: "png",
    });

    expect(width).toBe(50);
    expect(height).toBe(50);
    expect(mimeType).toBe("image/png");
    expect(output.byteLength).toBeGreaterThan(0);

    // Round-trip: the output must decode and report the resized dimensions.
    const decoded = await Image.decode(Buffer.from(output));
    expect(decoded.width).toBe(50);
    expect(decoded.height).toBe(50);
  });

  test("resize width-only preserves aspect ratio", async () => {
    const input = loadFixture("baseline-100x100.png");
    const { width, height } = await adapter.resize({ input, width: 40, format: "png" });
    expect(width).toBe(40);
    expect(height).toBe(40); // square source -> square output
  });

  test("PNG output has PNG magic bytes (89 50 4E 47)", async () => {
    const input = loadFixture("baseline-100x100.png");
    const { output } = await adapter.resize({ input, width: 50, format: "png" });
    expect(Buffer.from(output.slice(0, 4)).toString("hex")).toBe("89504e47");
  });

  test("JPEG output has JPEG magic + no Exif APP1 marker (EXIF stripped)", async () => {
    const input = loadFixture("baseline-100x100.png");
    const { output, mimeType } = await adapter.resize({
      input,
      width: 50,
      height: 50,
      format: "jpeg",
      quality: 80,
    });
    expect(mimeType).toBe("image/jpeg");
    expect(Buffer.from(output.slice(0, 3)).toString("hex")).toBe("ffd8ff");
    expect(Buffer.from(output).includes(Buffer.from("Exif"))).toBe(false);
  });

  test("WebP output has RIFF....WEBP container + no EXIF/XMP chunk", async () => {
    const input = loadFixture("baseline-100x100.png");
    const { output, mimeType } = await adapter.resize({
      input,
      width: 50,
      height: 50,
      format: "webp",
      quality: 80,
    });
    expect(mimeType).toBe("image/webp");
    expect(Buffer.from(output.slice(0, 4)).toString("ascii")).toBe("RIFF");
    expect(Buffer.from(output.slice(8, 12)).toString("ascii")).toBe("WEBP");
    // Container inspection: no EXIF / XMP fourCC present.
    const buf = Buffer.from(output);
    expect(buf.includes(Buffer.from("EXIF"))).toBe(false);
    expect(buf.includes(Buffer.from("XMP "))).toBe(false);
  });

  test("metadata reads baseline header (bomb-safe, no decode)", async () => {
    const input = loadFixture("baseline-100x100.png");
    const meta = await adapter.metadata(input);
    expect(meta).toEqual({ width: 100, height: 100, format: "png", pixels: 10_000 });
  });

  test("metadata reads 50000x50000 bomb header WITHOUT decoding (layer c)", async () => {
    const input = loadFixture("bomb-50000x50000.png");
    const meta = await adapter.metadata(input);
    expect(meta.width).toBe(50_000);
    expect(meta.height).toBe(50_000);
    expect(meta.pixels).toBe(2_500_000_000);
    // The policy the Phase-28 worker enforces (layer c).
    expect(meta.pixels).toBeGreaterThan(50_000_000);
  });

  test("metadata throws structured error on unsupported magic", async () => {
    const input = loadFixture("svg-with-script.svg");
    await expect(adapter.metadata(input)).rejects.toThrow("unsupported_image");
  });

  test("decode of WebP input throws (documented imagescript limitation)", async () => {
    const input = loadFixture("baseline-100x100.png");
    const { output } = await adapter.resize({ input, width: 50, height: 50, format: "webp" });
    // imagescript cannot DECODE webp — resize on a webp source rejects.
    await expect(adapter.resize({ input: output, width: 25, format: "png" })).rejects.toThrow();
  });
});
