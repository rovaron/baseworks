/**
 * FileStorage port interface (Phase 24 / FILE-01).
 *
 * Contract for object-storage adapters. Phase 24 ships throwing-NotImplemented
 * scaffolds (LocalFileStorage, S3FileStorage, S3CompatFileStorage) per D-15;
 * Phase 25 fills the bodies and ships the conformance suite (FILE-02, FILE-03).
 *
 * Design decisions:
 * - Every method returns a typed Promise — never null, never throws synchronously
 *   at lookup time. The factory always returns a real instance (D-15 invariant).
 * - `name` is a discriminator for log lines and conformance-suite assertions.
 * - SignedUpload/SignedRead deliberately exclude raw `storage_key` from result
 *   shapes (Pitfall 1 prevention; T-24-01-01 mitigation).
 */

import type { StorageBucket, StorageKey } from "./types";

export interface FileStorage {
  /** Adapter identifier (e.g., `"local" | "s3" | "s3-compat"`). */
  readonly name: string;

  signUpload(args: {
    bucket: StorageBucket;
    key: StorageKey;
    mimeType: string;
    maxByteSize: number;
    expiresInSec: number;
  }): Promise<SignedUpload>;

  signRead(args: {
    bucket: StorageBucket;
    key: StorageKey;
    expiresInSec: number;
    responseContentDisposition?: string;
  }): Promise<SignedRead>;

  stat(args: { bucket: StorageBucket; key: StorageKey }): Promise<ObjectStat | null>;

  delete(args: { bucket: StorageBucket; key: StorageKey }): Promise<void>;

  getObject(args: { bucket: StorageBucket; key: StorageKey }): Promise<Uint8Array>;

  putObject(args: {
    bucket: StorageBucket;
    key: StorageKey;
    body: Uint8Array;
    mimeType: string;
  }): Promise<void>;
}

/**
 * Result of `signUpload`. NEVER carries a raw storage key — only the URL the
 * browser PUTs/POSTs to and any required headers/fields for that backend.
 */
export interface SignedUpload {
  method: "PUT" | "POST";
  url: string;
  fields?: Record<string, string>;
  headers?: Record<string, string>;
  /** ISO 8601 timestamp at which the signed URL becomes invalid. */
  expiresAt: string;
}

/**
 * Result of `signRead`. NEVER carries a raw storage key — only the GET URL
 * the browser fetches and its expiry.
 */
export interface SignedRead {
  url: string;
  expiresAt: string;
}

/** Result of `stat()`. `byteSize` is server-authoritative (Pitfall trust gate). */
export interface ObjectStat {
  byteSize: number;
  mimeType?: string;
  etag?: string;
  lastModified?: string;
}

export type { StorageBucket, StorageKey } from "./types";
