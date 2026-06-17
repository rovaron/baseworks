/**
 * SharpImageTransform adapter (Phase 28 / IMG-01 / IMG-02 / IMG-03).
 *
 * The DEFAULT ImageTransform adapter (IMAGE_TRANSFORM_PROVIDER=sharp). Spike S-1
 * proved sharp 0.35.1 resizes + encodes webp + reads metadata under Bun inside
 * `oven/bun:1` (x64). This fills the Phase 24 throwing-NotImplemented scaffold.
 *
 * Decompression-bomb defense — LAYER (b): every `resize()` constructs the sharp
 * pipeline with `limitInputPixels: 50_000_000` + `failOn: "warning"`, so a bomb
 * (or malformed/truncated input) THROWS before any pixel buffer is allocated.
 *
 * EXIF strip (IMG-03): sharp drops ALL metadata by default. We deliberately do
 * NOT call `.withMetadata()`, so every variant output carries no EXIF/GPS/ICC.
 *
 * metadata() — LAYER (c) source: constructed with `limitInputPixels: false` so
 * the header read can report the bomb's dimensions (50000×50000 = 2.5e9 px)
 * WITHOUT sharp throwing; the app-code pre-flight then rejects > 50M structurally.
 */
import sharp from "sharp";
import type { ImageMetadata, ImageTransform } from "../../ports/image-transform";

/** Default encode quality for lossy formats (webp/jpeg). PNG is lossless. */
const QUALITY_DEFAULT = 80;

/** LAYER (b) — hard pixel ceiling enforced on EVERY transform pipeline. */
const RESIZE_PIXEL_LIMIT = 50_000_000;

export class SharpImageTransform implements ImageTransform {
  readonly name = "sharp";

  async resize(args: {
    input: Uint8Array;
    width: number;
    height?: number;
    fit?: "cover" | "contain" | "inside";
    format: "webp" | "jpeg" | "png";
    quality?: number;
  }): Promise<{ output: Uint8Array; mimeType: string; width: number; height: number }> {
    // LAYER (b): pixel ceiling + reject malformed/truncated/bomb inputs.
    let pipeline = sharp(Buffer.from(args.input), {
      limitInputPixels: RESIZE_PIXEL_LIMIT,
      failOn: "warning",
    });

    // fit maps 1:1 to sharp's fit ("cover" | "contain" | "inside").
    pipeline = pipeline.resize(args.width, args.height, {
      fit: args.fit ?? "cover",
      withoutEnlargement: false,
    });

    // EXIF STRIP (IMG-03): do NOT call .withMetadata() — sharp drops metadata by default.
    let mimeType: string;
    switch (args.format) {
      case "webp":
        pipeline = pipeline.webp({ quality: args.quality ?? QUALITY_DEFAULT });
        mimeType = "image/webp";
        break;
      case "jpeg":
        pipeline = pipeline.jpeg({ quality: args.quality ?? QUALITY_DEFAULT, mozjpeg: true });
        mimeType = "image/jpeg";
        break;
      case "png":
        // quality is ignored for png (lossless).
        pipeline = pipeline.png();
        mimeType = "image/png";
        break;
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    // width/height come from sharp's info — authoritative post-resize dims.
    return {
      output: new Uint8Array(data),
      mimeType,
      width: info.width,
      height: info.height,
    };
  }

  async metadata(input: Uint8Array): Promise<ImageMetadata> {
    // LAYER (c) source: limitInputPixels:false lets the header read report the
    // bomb's dims (2.5e9 px) WITHOUT sharp throwing; the worker pre-flight then
    // rejects > 50M structurally. The 50M ceiling is re-enforced in resize().
    const m = await sharp(Buffer.from(input), { limitInputPixels: false }).metadata();
    const width = m.width ?? 0;
    const height = m.height ?? 0;
    return {
      width,
      height,
      format: m.format ?? "unknown",
      pixels: width * height,
    };
  }
}
