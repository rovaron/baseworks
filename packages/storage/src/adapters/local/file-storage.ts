/**
 * LocalFileStorage adapter (Phase 25 / FILE-02 / FILE-03 — D-25-01 / D-25-02).
 *
 * Filesystem-backed `FileStorage` implementation for local development. Object
 * bytes live under `{STORAGE_LOCAL_PATH ?? "./storage"}/{bucket}/{key}`; an
 * authoritative `mimeType` is persisted in a sidecar `{...}.meta.json` because
 * the filesystem stores none (contract §1.6). Signed upload/read URLs are
 * HMAC-minted by `signing.ts` — the adapter only MINTS them; the matching
 * `/api/files/local/:bucket/:key` endpoint is served in Phase 26.
 *
 * Security decisions (locked by 25-PLAN-CONTRACT §1.6):
 * - This adapter is BANNED in production by `validateStorageEnv()` (D-14 /
 *   Pitfall 14); the HMAC dev-default secret is only safe under that ban.
 * - Path-traversal guard: every I/O method rejects a `bucket`/`key` that is
 *   absolute or contains `..` segments, AND re-checks that the fully resolved
 *   path stays inside the storage root (defense in depth) before touching disk.
 * - Sign results carry NO raw `key`/`storageKey` field (Pitfall 1) — the key
 *   only lives inside the signed URL path, made unforgeable by the HMAC `sig`.
 */
import { stat as fsStat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";

import type { FileStorage, ObjectStat, SignedRead, SignedUpload } from "../../ports/file-storage";
import type { StorageBucket, StorageKey } from "../../ports/types";
import { signLocalUrl } from "./signing";

/** Suffix for the sidecar JSON that carries the authoritative `mimeType`. */
const META_SUFFIX = ".meta.json";

/** Shape of the sidecar metadata file written alongside each object. */
interface SidecarMeta {
  mimeType: string;
}

/** Storage root: `STORAGE_LOCAL_PATH` or `./storage`, resolved to an absolute path. */
function storageRoot(): string {
  return resolve(process.env.STORAGE_LOCAL_PATH ?? "./storage");
}

/**
 * Resolve `{root}/{bucket}/{key}` with a path-traversal guard (§1.6). Rejects an
 * absolute or `..`-bearing `bucket`/`key`, then verifies the resolved path is
 * still contained by the storage root before any disk access.
 */
function resolveObjectPath(bucket: string, key: string): string {
  for (const [label, value] of [
    ["bucket", bucket],
    ["key", key],
  ] as const) {
    if (value.length === 0) {
      throw new Error(`LocalFileStorage: ${label} must be non-empty.`);
    }
    if (isAbsolute(value)) {
      throw new Error(`LocalFileStorage: ${label} must not be an absolute path.`);
    }
    if (value.split(/[/\\]/).includes("..")) {
      throw new Error(`LocalFileStorage: ${label} must not contain ".." segments.`);
    }
  }

  const root = storageRoot();
  const target = resolve(root, bucket, key);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error("LocalFileStorage: resolved path escapes the storage root.");
  }
  return target;
}

export class LocalFileStorage implements FileStorage {
  readonly name = "local";

  async signUpload(args: {
    bucket: StorageBucket;
    key: StorageKey;
    mimeType: string;
    maxByteSize: number;
    expiresInSec: number;
  }): Promise<SignedUpload> {
    const { url, expiresAt } = signLocalUrl({
      method: "PUT",
      bucket: args.bucket,
      key: args.key,
      maxByteSize: args.maxByteSize,
      expiresInSec: args.expiresInSec,
    });
    return { method: "PUT", url, expiresAt };
  }

  async signRead(args: {
    bucket: StorageBucket;
    key: StorageKey;
    expiresInSec: number;
    responseContentDisposition?: string;
  }): Promise<SignedRead> {
    const { url, expiresAt } = signLocalUrl({
      method: "GET",
      bucket: args.bucket,
      key: args.key,
      expiresInSec: args.expiresInSec,
    });
    return { url, expiresAt };
  }

  async stat(args: { bucket: StorageBucket; key: StorageKey }): Promise<ObjectStat | null> {
    const path = resolveObjectPath(args.bucket, args.key);
    let stats: Awaited<ReturnType<typeof fsStat>>;
    try {
      stats = await fsStat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }

    const mimeType = await this.readSidecarMime(path);
    return {
      byteSize: stats.size,
      mimeType,
      lastModified: stats.mtime.toISOString(),
    };
  }

  async delete(args: { bucket: StorageBucket; key: StorageKey }): Promise<void> {
    const path = resolveObjectPath(args.bucket, args.key);
    await Promise.all([this.unlinkIfExists(path), this.unlinkIfExists(path + META_SUFFIX)]);
  }

  async getObject(args: { bucket: StorageBucket; key: StorageKey }): Promise<Uint8Array> {
    const path = resolveObjectPath(args.bucket, args.key);
    const buf = await readFile(path);
    return new Uint8Array(buf);
  }

  async putObject(args: {
    bucket: StorageBucket;
    key: StorageKey;
    body: Uint8Array;
    mimeType: string;
  }): Promise<void> {
    const path = resolveObjectPath(args.bucket, args.key);
    await mkdir(dirname(path), { recursive: true });
    const meta: SidecarMeta = { mimeType: args.mimeType };
    await Promise.all([
      writeFile(path, args.body),
      writeFile(path + META_SUFFIX, JSON.stringify(meta), "utf8"),
    ]);
  }

  /** Read the sidecar `mimeType`; returns `undefined` if the sidecar is absent/unreadable. */
  private async readSidecarMime(objectPath: string): Promise<string | undefined> {
    try {
      const raw = await readFile(objectPath + META_SUFFIX, "utf8");
      const parsed = JSON.parse(raw) as Partial<SidecarMeta>;
      return typeof parsed.mimeType === "string" ? parsed.mimeType : undefined;
    } catch {
      return undefined;
    }
  }

  /** Unlink a file, treating a missing file as success (idempotent delete, §1.6). */
  private async unlinkIfExists(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
}
