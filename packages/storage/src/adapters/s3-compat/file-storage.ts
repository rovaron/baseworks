/**
 * S3CompatFileStorage adapter (Phase 25 / FILE-02 / FILE-03 — D-25-03).
 *
 * `Bun.S3Client`-backed `FileStorage` for S3-compatible services (MinIO, R2,
 * Backblaze B2, Wasabi, Garage). Identical 6-method mapping to the AWS S3
 * adapter; the ONLY differences are in `Bun.S3Client` construction:
 *   - an explicit `endpoint` (`S3_ENDPOINT`) instead of AWS regional defaults, and
 *   - `S3_FORCE_PATH_STYLE` → `virtualHostedStyle` (see §"Path-style mapping").
 *
 * Path-style mapping (R3 of 25-PLAN-CONTRACT): Bun exposes `virtualHostedStyle`,
 * NOT `forcePathStyle`. The two are inverses:
 *   - `S3_FORCE_PATH_STYLE=true`  → `virtualHostedStyle:false` → path-style URL
 *     `http://endpoint/{bucket}/{key}` (the MinIO / Garage default).
 *   - `S3_FORCE_PATH_STYLE=false` → `virtualHostedStyle:true`  → vhost-style URL
 *     `http://{bucket}.endpoint/{key}` (R2 / B2 custom-domain style).
 * When `S3_FORCE_PATH_STYLE` is unset we default to path-style (`true`) because
 * the most common self-hosted compat targets (MinIO, Garage) require it.
 *
 * Shared logic note (D-25-03): this duplicates the small `Bun.S3Client` →
 * `FileStorage` mapping that the AWS S3 adapter also performs. The contract
 * earmarks `s3/shared-s3.ts` as the eventual single home; Phase 25 keeps the
 * mapping inline here to avoid editing the S3 adapter file during parallel
 * work. The bodies are trivially extractable to that shared helper later.
 *
 * Security / Pitfall 1: sign results carry NO raw `key`/`storageKey` field —
 * the key lives only inside the presigned URL (made unforgeable by the AWS
 * SigV4 signature). `expiresAt` is computed locally to mirror the URL's
 * `X-Amz-Expires` window (Bun's `presign` returns only the URL string).
 */
import type { FileStorage, ObjectStat, SignedRead, SignedUpload } from "../../ports/file-storage";
import type { StorageBucket, StorageKey } from "../../ports/types";

/** Read a required env var; throw a NAMED-var error (never echoes the value). */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when STORAGE_PROVIDER=s3-compat. Set ${name}.`);
  }
  return value;
}

/**
 * Map `S3_FORCE_PATH_STYLE` to Bun's `virtualHostedStyle` (inverse). Defaults to
 * path-style (`forcePathStyle=true` ⇒ `virtualHostedStyle=false`) when unset,
 * matching the MinIO / Garage default addressing mode.
 */
function virtualHostedStyleFromEnv(): boolean {
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false";
  return !forcePathStyle;
}

/**
 * Compute the ISO `expiresAt` that matches the presigned URL's `X-Amz-Expires`
 * window. Epoch SECONDS (floored) + `expiresInSec`, mirroring the Local adapter
 * so all three adapters report expiry identically (conformance behavior #9).
 */
function computeExpiresAt(expiresInSec: number): string {
  const expSec = Math.floor(Date.now() / 1000) + expiresInSec;
  return new Date(expSec * 1000).toISOString();
}

export class S3CompatFileStorage implements FileStorage {
  readonly name = "s3-compat";

  private clientInstance: Bun.S3Client | null = null;

  /**
   * Lazily build the `Bun.S3Client` on first I/O. Construction is deferred (not
   * done in the constructor) so the factory can instantiate the adapter for
   * provider-selection without requiring S3 env to be present — env is only
   * required when an operation actually runs (mirrors the factory contract that
   * `getFileStorage()` never throws on selection alone).
   */
  private client(): Bun.S3Client {
    if (!this.clientInstance) {
      this.clientInstance = new Bun.S3Client({
        accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
        bucket: process.env.S3_BUCKET,
        // S3-compat services authenticate SigV4 with a region; "auto" works for
        // R2/B2 and is ignored by MinIO/Garage. Operators may override.
        region: process.env.AWS_REGION ?? "auto",
        endpoint: requireEnv("S3_ENDPOINT"),
        virtualHostedStyle: virtualHostedStyleFromEnv(),
      });
    }
    return this.clientInstance;
  }

  async signUpload(args: {
    bucket: StorageBucket;
    key: StorageKey;
    mimeType: string;
    maxByteSize: number;
    expiresInSec: number;
  }): Promise<SignedUpload> {
    const url = this.client().presign(args.key, {
      bucket: args.bucket,
      method: "PUT",
      expiresIn: args.expiresInSec,
      type: args.mimeType,
    });
    return { method: "PUT", url, expiresAt: computeExpiresAt(args.expiresInSec) };
  }

  async signRead(args: {
    bucket: StorageBucket;
    key: StorageKey;
    expiresInSec: number;
    responseContentDisposition?: string;
  }): Promise<SignedRead> {
    const url = this.client().presign(args.key, {
      bucket: args.bucket,
      method: "GET",
      expiresIn: args.expiresInSec,
      ...(args.responseContentDisposition
        ? { contentDisposition: args.responseContentDisposition }
        : {}),
    });
    return { url, expiresAt: computeExpiresAt(args.expiresInSec) };
  }

  async stat(args: { bucket: StorageBucket; key: StorageKey }): Promise<ObjectStat | null> {
    const file = this.client().file(args.key, { bucket: args.bucket });
    // exists() gates the null-on-missing contract (behavior #4) deterministically,
    // without depending on backend-specific S3 error codes.
    if (!(await file.exists())) {
      return null;
    }
    const s = await file.stat();
    return {
      byteSize: s.size,
      mimeType: s.type,
      etag: s.etag,
      lastModified: s.lastModified.toISOString(),
    };
  }

  async delete(args: { bucket: StorageBucket; key: StorageKey }): Promise<void> {
    // S3 DELETE is idempotent (204 even when the key is absent), satisfying
    // conformance behavior #6 without an existence pre-check.
    await this.client().delete(args.key, { bucket: args.bucket });
  }

  async getObject(args: { bucket: StorageBucket; key: StorageKey }): Promise<Uint8Array> {
    // .bytes() rejects on a missing key (404), satisfying behavior #5's
    // "getObject rejects after delete".
    return await this.client().file(args.key, { bucket: args.bucket }).bytes();
  }

  async putObject(args: {
    bucket: StorageBucket;
    key: StorageKey;
    body: Uint8Array;
    mimeType: string;
  }): Promise<void> {
    await this.client().write(args.key, args.body, {
      bucket: args.bucket,
      type: args.mimeType,
    });
  }
}
