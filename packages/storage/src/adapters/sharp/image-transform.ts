/**
 * SharpImageTransform adapter scaffold (Phase 24 / FILE-01 / D-16).
 *
 * Phase 24 ships throwing-NotImplemented; Phase 28 fills the body after
 * spike S-1 (sharp-under-Bun-Docker smoke test). If the spike is RED,
 * Phase 28 may flip the default to imagescript per D-12.
 *
 * Message format (D-16 — Claude's Discretion under CONTEXT D-16; chosen
 * parallel to the verbatim D-15 form):
 *   `ImageTransform.{method}: not yet implemented in Phase 24; arriving in Phase 28`
 * NO parenthetical adapter discriminator; adapter identity preserved via
 * the stack-trace class name (this class).
 */
import type { ImageMetadata, ImageTransform } from "../../ports/image-transform";

export class SharpImageTransform implements ImageTransform {
  readonly name = "sharp";

  async resize(_args: {
    input: Uint8Array;
    width: number;
    height?: number;
    fit?: "cover" | "contain" | "inside";
    format: "webp" | "jpeg" | "png";
    quality?: number;
  }): Promise<{ output: Uint8Array; mimeType: string; width: number; height: number }> {
    throw new Error("ImageTransform.resize: not yet implemented in Phase 24; arriving in Phase 28");
  }
  async metadata(_input: Uint8Array): Promise<ImageMetadata> {
    throw new Error(
      "ImageTransform.metadata: not yet implemented in Phase 24; arriving in Phase 28",
    );
  }
}
