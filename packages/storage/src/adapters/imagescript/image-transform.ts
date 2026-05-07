/**
 * ImagescriptImageTransform adapter scaffold (Phase 24 / FILE-01 / D-16).
 *
 * Phase 24 ships throwing-NotImplemented; Phase 28 fills the body after
 * spike S-1. Imagescript is the pure-JS fallback if sharp's native binding
 * is RED under Bun-on-Linux-Docker (D-12).
 *
 * Message format (D-16 — Claude's Discretion under CONTEXT D-16; chosen
 * parallel to the verbatim D-15 form):
 *   `ImageTransform.{method}: not yet implemented in Phase 24; arriving in Phase 28`
 * NO parenthetical adapter discriminator; adapter identity preserved via
 * the stack-trace class name (this class). Error strings are byte-identical
 * to SharpImageTransform.
 */
import type { ImageMetadata, ImageTransform } from "../../ports/image-transform";

export class ImagescriptImageTransform implements ImageTransform {
  readonly name = "imagescript";

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
