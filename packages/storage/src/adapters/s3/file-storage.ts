/**
 * Phase 25 / FILE-02 / FILE-03 — S3FileStorage (AWS S3) adapter (D-25-03).
 *
 * Wraps `Bun.S3Client` configured for AWS S3 (region-based addressing) and
 * delegates all six `FileStorage` operations to the shared
 * {@link BaseS3FileStorage} implementation. The only S3-vs-S3-compat difference
 * lives in construction: this class reads AWS env (`AWS_REGION`), whereas
 * `S3CompatFileStorage` reads `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE`.
 *
 * Config source (matches `validateStorageEnv()` var names exactly):
 *   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`.
 *
 * Construction is intentionally NON-throwing on missing env: the factory
 * invariant (D-15) is that `getFileStorage()` ALWAYS returns a real instance, and
 * `validateStorageEnv()` is the single hard boot gate that crashes (named-var
 * message) when an `s3`-selected runtime is misconfigured. `Bun.S3Client`
 * construction is pure/lazy (no network), so empty creds here only surface at the
 * first real operation — never at construction or at presign minting.
 *
 * An optional `config` argument injects a pre-normalized {@link S3ClientConfig}
 * (used by tests / DI) and bypasses env reads entirely.
 *
 * No `@baseworks/config` import (dependency-light, per contract). `Bun.S3Client`
 * is a runtime built-in — no `@aws-sdk/*`.
 */
import type { FileStorage } from "../../ports/file-storage";
import { BaseS3FileStorage, createS3Client, type S3ClientConfig } from "./shared-s3";

/** Build the AWS S3 client config from `process.env` (soft reads; see header). */
function configFromEnv(): S3ClientConfig {
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    region: process.env.AWS_REGION ?? "",
    bucket: process.env.S3_BUCKET ?? "",
  };
}

export class S3FileStorage extends BaseS3FileStorage implements FileStorage {
  readonly name = "s3";

  constructor(config?: S3ClientConfig) {
    super(createS3Client(config ?? configFromEnv()));
  }
}
