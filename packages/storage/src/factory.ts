/**
 * Storage port singleton factories (Phase 24 / FILE-01).
 *
 * Two lazy-singleton factories — one per port — selected by env var:
 *   - STORAGE_PROVIDER         → getFileStorage()      default "local" (D-10)
 *   - IMAGE_TRANSFORM_PROVIDER → getImageTransform()   default "sharp" (D-12)
 *
 * Each factory ships a `set*` + `reset*` trio for tests (D-15/D-16 require
 * test-injectable singletons), mirroring `setTracer`/`resetTracer` in
 * packages/observability/src/factory.ts.
 *
 * IMPORTANT: This file reads `process.env` directly. It does NOT import the
 * shared config package (a) to keep `@baseworks/storage` free of cross-package
 * cycles and (b) to mirror the observability-factory invariant that allows
 * loading from telemetry-bootstrap-sensitive code paths.
 *
 * Phase 24 returns throwing-NotImplemented adapters per D-15/D-16. Phase 25
 * fills FileStorage bodies; Phase 28 fills ImageTransform bodies after the
 * sharp-under-Bun spike (S-1).
 */
import { ImagescriptImageTransform } from "./adapters/imagescript/image-transform";
import { LocalFileStorage } from "./adapters/local/file-storage";
import { S3FileStorage } from "./adapters/s3/file-storage";
import { S3CompatFileStorage } from "./adapters/s3-compat/file-storage";
import { SharpImageTransform } from "./adapters/sharp/image-transform";
import type { FileStorage } from "./ports/file-storage";
import type { ImageTransform } from "./ports/image-transform";

// ---------------------------------------------------------------------------
// FileStorage
// ---------------------------------------------------------------------------

let fileStorageInstance: FileStorage | null = null;

export function getFileStorage(): FileStorage {
  if (!fileStorageInstance) {
    const name = process.env.STORAGE_PROVIDER ?? "local";
    switch (name) {
      case "local":
        fileStorageInstance = new LocalFileStorage();
        break;
      case "s3":
        fileStorageInstance = new S3FileStorage();
        break;
      case "s3-compat":
        fileStorageInstance = new S3CompatFileStorage();
        break;
      default:
        throw new Error(`Unknown STORAGE_PROVIDER: ${name}. Supported: local, s3, s3-compat.`);
    }
  }
  return fileStorageInstance;
}

export function resetFileStorage(): void {
  fileStorageInstance = null;
}

export function setFileStorage(storage: FileStorage): void {
  fileStorageInstance = storage;
}

// ---------------------------------------------------------------------------
// ImageTransform
// ---------------------------------------------------------------------------

let imageTransformInstance: ImageTransform | null = null;

export function getImageTransform(): ImageTransform {
  if (!imageTransformInstance) {
    const name = process.env.IMAGE_TRANSFORM_PROVIDER ?? "sharp";
    switch (name) {
      case "sharp":
        imageTransformInstance = new SharpImageTransform();
        break;
      case "imagescript":
        imageTransformInstance = new ImagescriptImageTransform();
        break;
      default:
        throw new Error(
          `Unknown IMAGE_TRANSFORM_PROVIDER: ${name}. Supported: sharp, imagescript.`,
        );
    }
  }
  return imageTransformInstance;
}

export function resetImageTransform(): void {
  imageTransformInstance = null;
}

export function setImageTransform(transform: ImageTransform): void {
  imageTransformInstance = transform;
}
