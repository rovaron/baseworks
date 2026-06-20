/**
 * ImagescriptImageTransform adapter (Phase 28 / IMG-01, IMG-02, IMG-03).
 *
 * Pure-JS fallback ImageTransform implementation (no native bindings — always
 * loads under Bun). sharp remains the DEFAULT and the only WebP-DECODE-capable
 * adapter; imagescript is the emergency fallback selected via
 * IMAGE_TRANSFORM_PROVIDER=imagescript.
 *
 * Verified imagescript@1.3.1 capabilities (probe this session):
 * - DECODE: PNG / JPEG / GIF only. `Image.decode(webp)` throws
 *   `Unsupported image type` — relations never declare WebP *sources*, so this
 *   is acceptable for the variant pipeline.
 * - ENCODE: PNG (`.encode()`), JPEG (`.encodeJPEG(q)`), WebP (`.encodeWEBP(q)`,
 *   valid RIFF/WEBP container). EXIF is stripped from output by default (JPEG
 *   output carries no `Exif` APP1 marker).
 * - metadata(): imagescript has NO header-only reader; its only option is a
 *   full `Image.decode()` which allocates the entire pixel buffer and would OOM
 *   on the decompression-bomb fixture. THEREFORE metadata() uses the dedicated
 *   pure-JS header parser (`lib/image-header.ts`) — never decodes pixels, so
 *   the Phase-28 layer-(c) pre-flight works identically under this fallback.
 *
 * Result/error convention: throws on unsupported input (structured Error
 * message); callers map to {error}.
 */
import { Image } from "imagescript";
import { parseImageHeader } from "../../lib/image-header";
import type { ImageMetadata, ImageTransform } from "../../ports/image-transform";

const QUALITY_DEFAULT = 80;

export class ImagescriptImageTransform implements ImageTransform {
  readonly name = "imagescript";

  async resize(args: {
    input: Uint8Array;
    width: number;
    height?: number;
    fit?: "cover" | "contain" | "inside";
    format: "webp" | "jpeg" | "png";
    quality?: number;
  }): Promise<{ output: Uint8Array; mimeType: string; width: number; height: number }> {
    // Decode (PNG/JPEG/GIF only — WebP input is unsupported by imagescript).
    const img = await Image.decode(Buffer.from(args.input));

    // Resize. With both dims, imagescript stretches to the exact box; with
    // width only, RESIZE_AUTO preserves aspect ratio. imagescript has no
    // center-crop "cover", so `fit` is accepted for port-parity but does not
    // change the simple box mapping the variant specs require (sharp is the
    // fit-accurate default).
    const out = args.height
      ? img.resize(args.width, args.height)
      : img.resize(args.width, Image.RESIZE_AUTO);

    let bytes: Uint8Array;
    let mimeType: string;
    switch (args.format) {
      case "png":
        // quality is ignored for png (lossless).
        bytes = await out.encode();
        mimeType = "image/png";
        break;
      case "jpeg":
        // imagescript brands its quality args (JPEGQuality/WEBPQuality, 1-100);
        // cast the plain number through the method's own parameter type.
        bytes = await out.encodeJPEG(
          (args.quality ?? QUALITY_DEFAULT) as Parameters<typeof out.encodeJPEG>[0],
        );
        mimeType = "image/jpeg";
        break;
      case "webp":
        bytes = await out.encodeWEBP(
          (args.quality ?? QUALITY_DEFAULT) as Parameters<typeof out.encodeWEBP>[0],
        );
        mimeType = "image/webp";
        break;
    }

    return {
      output: new Uint8Array(bytes),
      mimeType,
      // Authoritative post-resize dims from the imagescript instance.
      width: out.width,
      height: out.height,
    };
  }

  async metadata(input: Uint8Array): Promise<ImageMetadata> {
    // BOMB-SAFE: header parse only — never Image.decode() (which would allocate
    // the full pixel buffer and OOM on the 50000x50000 bomb fixture).
    const { width, height, format } = parseImageHeader(input);
    return { width, height, format, pixels: width * height };
  }
}
