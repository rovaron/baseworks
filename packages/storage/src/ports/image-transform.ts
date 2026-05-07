/**
 * ImageTransform port interface (Phase 24 / FILE-01).
 *
 * Contract for image-processing adapters. Phase 24 ships throwing-NotImplemented
 * scaffolds (SharpImageTransform, ImagescriptImageTransform) per D-16;
 * Phase 28 fills the bodies after the sharp-under-Bun smoke spike (S-1).
 *
 * Design decisions:
 * - `resize` AND `metadata` are BOTH required (ROADMAP success criterion #2).
 *   `metadata` is used by the decompression-bomb pre-flight check (Pitfall on
 *   image-bomb prevention; consumer in Phase 28).
 * - `format` union excludes SVG (T-24-01-02 mitigation; SVG with embedded
 *   <script> is an XSS vector — Pitfall 10 / IDA-02 reject-at-sign rule).
 * - Adapter selection via IMAGE_TRANSFORM_PROVIDER env (default `"sharp"` — D-12).
 *
 * Type ownership:
 * - `ImageVariantSpec` is canonically declared in `@baseworks/shared`
 *   (`packages/shared/src/types/module.ts`, Plan 24-03 / declared in 24-01
 *   per the soft-dependency resolution). This file import-and-re-exports the
 *   type so that downstream code can continue to
 *   `import { ImageVariantSpec } from "@baseworks/storage"` without changing
 *   its import path. Per PATTERNS lines 760-762: the type lives where it
 *   has zero workspace deps (shared) and is safe to import from any package;
 *   `ModuleDefinition` is the contract owner and lives in shared.
 * - `ImageMetadata` is owned by this file (storage-specific — only the
 *   ImageTransform adapter needs it).
 */

// Re-export ImageVariantSpec from its canonical home in @baseworks/shared.
// DO NOT redeclare here — keeping a single source of truth prevents drift.
export type { ImageVariantSpec } from "@baseworks/shared";

export interface ImageTransform {
  /** Adapter identifier (e.g., `"sharp" | "imagescript"`). */
  readonly name: string;

  resize(args: {
    input: Uint8Array;
    width: number;
    height?: number;
    fit?: "cover" | "contain" | "inside";
    format: "webp" | "jpeg" | "png";
    quality?: number;
  }): Promise<{
    output: Uint8Array;
    mimeType: string;
    width: number;
    height: number;
  }>;

  /**
   * Read pixel/format metadata WITHOUT decoding the full image. Used for
   * decompression-bomb pre-flight checks in Phase 28.
   */
  metadata(input: Uint8Array): Promise<ImageMetadata>;
}

export interface ImageMetadata {
  width: number;
  height: number;
  format:
    | "webp"
    | "jpeg"
    | "png"
    | "gif"
    | "tiff"
    | "bmp"
    | "heif"
    | "avif"
    | string;
  /** Total pixel count (width × height). Phase 28 rejects > 50_000_000. */
  pixels?: number;
}
