/**
 * SharpImageTransform conformance runner (Phase 28 / IMG-01, IMG-02, IMG-03).
 *
 * Runs the shared ImageTransform conformance suite (resize + WebP output + EXIF
 * strip + metadata + bomb pre-flight) against the DEFAULT sharp adapter. Gated by
 * `describe.skipIf(!sharpLoadable)`: a one-time probe loads sharp and runs
 * `.metadata()` on the baseline fixture; if the native binding is unavailable on
 * the host the suite is skipped (mirrors Phase 25's S3 gating) and the committed
 * Docker smoke test (`__smoke__/bun-docker-spike.test.ts`) + CI remain the hard
 * gate. On this dev host + in `oven/bun:1` the spike is green, so it runs.
 *
 * sharp DECODES webp, so `canDecodeWebp: true` and the webp round-trip re-read
 * runs; `reReadMetadata` is the sharp instance itself.
 */
import { describe } from "bun:test";
import { loadFixture } from "../../test-support/fixtures";
import {
  type ImageTransformCaps,
  runImageTransformConformance,
} from "../__tests__/image-transform-conformance";
import { SharpImageTransform } from "./image-transform";

/** One-time native-binding probe (load + a real metadata() call). */
let sharpLoadable = false;
try {
  const sharp = (await import("sharp")).default;
  await sharp(Buffer.from(loadFixture("baseline-100x100.png"))).metadata();
  sharpLoadable = true;
} catch {
  sharpLoadable = false;
}

const adapter = new SharpImageTransform();
const caps: ImageTransformCaps = {
  formats: ["webp", "jpeg", "png"],
  canDecodeWebp: true,
  reReadMetadata: adapter,
};

describe.skipIf(!sharpLoadable)("sharp (native binding loadable)", () => {
  runImageTransformConformance("sharp", () => adapter, caps);
});
