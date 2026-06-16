/**
 * Phase 25 / FILE-02 / FILE-03 — shared `Bun.S3Client`-backed FileStorage logic
 * (D-25-03).
 *
 * S3 (AWS) and S3-compat (MinIO / R2 / B2 / Wasabi / Garage) are byte-for-byte
 * identical at the operation level — they differ ONLY in how the underlying
 * `Bun.S3Client` is constructed (region vs endpoint + path-style). This module
 * owns the operation logic once; both adapter classes extend
 * {@link BaseS3FileStorage}, supplying a pre-built client and their `name`
 * discriminator. No `@baseworks/config` import; `Bun.S3Client` is a runtime
 * built-in (no `@aws-sdk/*` dependency).
 *
 * Per-call bucket: every `FileStorage` method receives the logical `bucket`, so
 * each `Bun.S3Client` call passes `{ bucket }` to override the client's default
 * (verified Bun 1.3.14: `presign`/`file`/`stat`/`write`/`delete` honor a per-call
 * `bucket` option). This lets one client address the conformance bucket and the
 * configured app bucket alike.
 *
 * Presign mapping (verified this session, pure crypto — no network):
 *   - signUpload → `presign(key, { method: "PUT", expiresIn, bucket, type })`.
 *     `type` sets `response-content-type`; `method: "PUT"` per D-25-02 (POST-policy
 *     uploads are deferred, so the port's `fields?` stays unused).
 *   - signRead  → `presign(key, { method: "GET", expiresIn, bucket, contentDisposition? })`.
 *     `contentDisposition` maps to the `response-content-disposition` query param
 *     (R5 confirmed: Bun exposes `contentDisposition`, not a raw header).
 *
 * Pitfall 1 (D-25-01): the returned `SignedUpload`/`SignedRead` carry ONLY
 * `method`/`url`/`expiresAt` — never a standalone raw key. The key is embedded in
 * the presigned URL path (unavoidable + signed by SigV4), never as a typed field.
 */
import type {
  FileStorage,
  ObjectStat,
  SignedRead,
  SignedUpload,
  StorageBucket,
  StorageKey,
} from "../../ports/file-storage";

/** Normalized construction config for a `Bun.S3Client` (region OR endpoint). */
export interface S3ClientConfig {
  accessKeyId: string;
  secretAccessKey: string;
  /** Default bucket; per-call `bucket` overrides it on every operation. */
  bucket: string;
  /** AWS region (S3 adapter). Mutually informative with `endpoint`. */
  region?: string;
  /** S3-compatible endpoint URL (S3-compat adapter). */
  endpoint?: string;
  /**
   * `false` → path-style URLs `http://endpoint/{bucket}/{key}` (maps
   * `S3_FORCE_PATH_STYLE=true`); `true` → virtual-hosted style. Bun's option is
   * `virtualHostedStyle`, NOT `forcePathStyle` (R3).
   */
  virtualHostedStyle?: boolean;
}

/** Build a `Bun.S3Client` from normalized config (omitting absent optionals). */
export function createS3Client(config: S3ClientConfig): Bun.S3Client {
  return new Bun.S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    ...(config.region !== undefined ? { region: config.region } : {}),
    ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
    ...(config.virtualHostedStyle !== undefined
      ? { virtualHostedStyle: config.virtualHostedStyle }
      : {}),
  });
}

/**
 * ISO `expiresAt` mirroring the presigned URL's `X-Amz-Expires` window. Uses
 * floored epoch SECONDS + `expiresInSec` so all three adapters (Local HMAC,
 * S3, S3-compat) report expiry identically (contract §1.2 / conformance #9).
 */
function computeExpiresAt(expiresInSec: number): string {
  const expSec = Math.floor(Date.now() / 1000) + expiresInSec;
  return new Date(expSec * 1000).toISOString();
}

/**
 * True when an S3 error means "object does not exist" (so `stat` returns `null`
 * instead of throwing — conformance behavior #4). `stat` issues a HEAD; a missing
 * key surfaces as `NoSuchKey`/`NotFound`/404 across AWS and S3-compat backends.
 * Any other error (auth, network, bad bucket) propagates.
 */
function isNotFoundError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; name?: unknown; httpStatusCode?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const name = typeof e.name === "string" ? e.name : "";
  if (e.httpStatusCode === 404) return true;
  return (
    code === "NoSuchKey" ||
    code === "NotFound" ||
    code === "ENOENT" ||
    name === "NoSuchKey" ||
    name === "NotFound" ||
    /not.?found/i.test(code) ||
    /not.?found/i.test(name)
  );
}

/**
 * Shared `Bun.S3Client`-backed implementation of all six `FileStorage` methods.
 * Concrete adapters (`S3FileStorage`, `S3CompatFileStorage`) extend this, set
 * their own `name`, and pass a constructed client (D-25-03).
 */
export abstract class BaseS3FileStorage implements FileStorage {
  abstract readonly name: string;

  protected readonly client: Bun.S3Client;

  constructor(client: Bun.S3Client) {
    this.client = client;
  }

  async signUpload(args: {
    bucket: StorageBucket;
    key: StorageKey;
    mimeType: string;
    maxByteSize: number;
    expiresInSec: number;
  }): Promise<SignedUpload> {
    const url = this.client.presign(args.key, {
      method: "PUT",
      expiresIn: args.expiresInSec,
      bucket: args.bucket,
      type: args.mimeType,
    });
    const expiresAt = computeExpiresAt(args.expiresInSec);
    // No `fields`/`headers` (D-25-02); no raw key field (Pitfall 1).
    return { method: "PUT", url, expiresAt };
  }

  async signRead(args: {
    bucket: StorageBucket;
    key: StorageKey;
    expiresInSec: number;
    responseContentDisposition?: string;
  }): Promise<SignedRead> {
    const url = this.client.presign(args.key, {
      method: "GET",
      expiresIn: args.expiresInSec,
      bucket: args.bucket,
      ...(args.responseContentDisposition !== undefined
        ? { contentDisposition: args.responseContentDisposition }
        : {}),
    });
    const expiresAt = computeExpiresAt(args.expiresInSec);
    return { url, expiresAt };
  }

  async stat(args: { bucket: StorageBucket; key: StorageKey }): Promise<ObjectStat | null> {
    try {
      const s = await this.client.stat(args.key, { bucket: args.bucket });
      const stat: ObjectStat = { byteSize: s.size };
      if (s.type) stat.mimeType = s.type;
      if (s.etag) stat.etag = s.etag;
      if (s.lastModified) stat.lastModified = s.lastModified.toISOString();
      return stat;
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async delete(args: { bucket: StorageBucket; key: StorageKey }): Promise<void> {
    // S3 DELETE is idempotent (204 even when the key is absent) — behavior #6.
    await this.client.delete(args.key, { bucket: args.bucket });
  }

  async getObject(args: { bucket: StorageBucket; key: StorageKey }): Promise<Uint8Array> {
    // `S3File.bytes()` (Blob API) → full object as Uint8Array; rejects on 404.
    return await this.client.file(args.key, { bucket: args.bucket }).bytes();
  }

  async putObject(args: {
    bucket: StorageBucket;
    key: StorageKey;
    body: Uint8Array;
    mimeType: string;
  }): Promise<void> {
    await this.client.write(args.key, args.body, {
      bucket: args.bucket,
      type: args.mimeType,
    });
  }
}
