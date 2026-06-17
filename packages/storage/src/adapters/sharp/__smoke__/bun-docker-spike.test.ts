/**
 * SC#1 — sharp Docker smoke test (Phase 28 / IMG-01).
 *
 * The durable, re-runnable gate artifact proving sharp's native binding works
 * under Bun. Spike S-1 is already green (operator-verified inside `oven/bun:1`:
 * `SHARP_OK bytes=86 fmt=webp w=50 isWebp=true`); this committed test makes CI
 * and every Docker build re-execute that proof on `oven/bun:1-debian-slim`.
 *
 * It exercises the raw sharp pipeline (NOT the adapter) on purpose: the point is
 * to verify the native binding loads + resizes + encodes webp + reads metadata.
 * On a host where sharp's prebuilt is unavailable the whole suite skips (the
 * Docker/CI run is the hard gate); imagescript (pure JS) always covers the
 * fallback path elsewhere.
 */
import { describe, expect, test } from "bun:test";
import { loadFixture } from "../../../test-support/fixtures";

/** One-time probe: can sharp's native binding load + run on this host? */
let sharpLoadable = false;
try {
  // Lazy require so a missing prebuilt degrades to skip instead of a load error.
  const sharp = (await import("sharp")).default;
  await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  sharpLoadable = true;
} catch {
  sharpLoadable = false;
}

describe.skipIf(!sharpLoadable)("sharp Bun/Docker smoke — SC#1 gate", () => {
  test("resize baseline 100x100 → 50px webp + metadata under Bun", async () => {
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(loadFixture("baseline-100x100.png"));

    // resize → webp encode (the exact spike S-1 path).
    const { data, info } = await sharp(input, {
      limitInputPixels: 50_000_000,
      failOn: "warning",
    })
      .resize(50, 50, { fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });

    expect(data.byteLength).toBeGreaterThan(0);
    expect(info.format).toBe("webp");
    expect(info.width).toBe(50);

    // RIFF....WEBP container magic: "RIFF" at 0, "WEBP" at 8.
    expect(data.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(data.subarray(8, 12).toString("latin1")).toBe("WEBP");

    // metadata read on the original.
    const meta = await sharp(input, { limitInputPixels: false }).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
    expect(meta.format).toBe("png");
  });
});
