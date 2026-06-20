/**
 * Local adapter HMAC URL signing (Phase 25 / FILE-02 / FILE-03 — D-25-01).
 *
 * Pure, backend-agnostic minting + verification of HMAC-SHA256 signed URLs for
 * the Local filesystem adapter. Phase 25 only MINTS (`signLocalUrl`) and can
 * VERIFY (`verifyLocalSignature`) signatures — it does NOT serve the endpoint
 * (`/api/files/local/:bucket/:key` is wired in Phase 26).
 *
 * Security decisions (locked by 25-PLAN-CONTRACT §1):
 * - Secret comes from `STORAGE_LOCAL_SIGNING_SECRET`, falling back to a dev
 *   default literal. Safe because the Local adapter is prod-banned by
 *   `validateStorageEnv()` (D-14 / Pitfall 14). The secret is never logged.
 * - Canonical strings differ between PUT (upload) and GET (read) in BOTH the
 *   method prefix AND the field count, so an upload signature can never be
 *   replayed as a read signature or vice-versa (§1.2).
 * - The result objects carry NO raw `key`/`storageKey` field (Pitfall 1). The
 *   key only appears inside the URL path, made unforgeable by the HMAC `sig`
 *   and (from Phase 26) an unguessable `nanoid(24)` key segment (§1.4 / R2).
 * - Verification checks expiry BEFORE the signature so an expired-but-valid
 *   signature still fails, and uses `crypto.timingSafeEqual` on equal-length
 *   hex buffers to avoid timing oracles (§1.5).
 *
 * Note: `node:crypto` is imported as a namespace so the constant-time compare
 * is observable/spyable in unit tests (proves §1.5 step 4 is exercised).
 */
import * as nodeCrypto from "node:crypto";

import type { StorageBucket, StorageKey } from "../../ports/types";

/**
 * Dev fallback secret used when `STORAGE_LOCAL_SIGNING_SECRET` is unset.
 * Acceptable ONLY because the Local adapter is banned in production
 * (`validateStorageEnv` throws on STORAGE_PROVIDER=local && NODE_ENV=production).
 */
export const DEV_SIGNING_SECRET = "baseworks-dev-insecure-local-signing-secret";

/** Read the signing secret. Never logged. */
function getSigningSecret(): string {
  return process.env.STORAGE_LOCAL_SIGNING_SECRET ?? DEV_SIGNING_SECRET;
}

/**
 * Build the EXACT canonical string to sign (§1.2). Newline-joined, NO trailing
 * newline. `key`/`bucket` are raw (un-encoded) here — URL encoding is applied
 * only when assembling the path, never inside the canonical string.
 */
function buildCanonical(
  method: "PUT" | "GET",
  bucket: string,
  key: string,
  exp: number,
  max?: number,
): string {
  return method === "PUT"
    ? `PUT\n${bucket}\n${key}\n${exp}\n${max}`
    : `GET\n${bucket}\n${key}\n${exp}`;
}

/** Lowercase hex HMAC-SHA256 of `canonical` under the signing secret (§1.3). */
function hmacHex(canonical: string): string {
  return nodeCrypto
    .createHmac("sha256", getSigningSecret())
    .update(canonical, "utf8")
    .digest("hex");
}

/** Per-segment URL encoding: escape each `/`-delimited segment, preserve the `/`. */
function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Arguments to {@link signLocalUrl}. `maxByteSize` is required for PUT only. */
export type SignLocalUrlArgs =
  | {
      method: "PUT";
      bucket: StorageBucket;
      key: StorageKey;
      maxByteSize: number;
      expiresInSec: number;
      /** Epoch seconds; defaults to `Date.now()/1000`. Test seam. */
      now?: number;
    }
  | {
      method: "GET";
      bucket: StorageBucket;
      key: StorageKey;
      expiresInSec: number;
      /** Epoch seconds; defaults to `Date.now()/1000`. Test seam. */
      now?: number;
    };

/** Result of {@link signLocalUrl}. Carries NO raw key/storageKey field (Pitfall 1). */
export interface SignedLocalUrl {
  url: string;
  /** ISO 8601 timestamp at which the signed URL becomes invalid. */
  expiresAt: string;
}

/**
 * Mint an HMAC-signed local URL (§1.4).
 *
 * Path: `/api/files/local/{encodeURIComponent(bucket)}/{per-segment-encoded key}`.
 * Query: upload `?exp&max&sig`, read `?exp&sig` (params in that order).
 */
export function signLocalUrl(args: SignLocalUrlArgs): SignedLocalUrl {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const exp = now + args.expiresInSec;
  const path = `/api/files/local/${encodeURIComponent(args.bucket)}/${encodeKeyPath(args.key)}`;
  const expiresAt = new Date(exp * 1000).toISOString();

  if (args.method === "PUT") {
    const max = args.maxByteSize;
    const sig = hmacHex(buildCanonical("PUT", args.bucket, args.key, exp, max));
    return { url: `${path}?exp=${exp}&max=${max}&sig=${sig}`, expiresAt };
  }

  const sig = hmacHex(buildCanonical("GET", args.bucket, args.key, exp));
  return { url: `${path}?exp=${exp}&sig=${sig}`, expiresAt };
}

/** Arguments to {@link verifyLocalSignature}. */
export interface VerifyLocalSignatureArgs {
  method: "PUT" | "GET";
  bucket: string;
  key: string;
  /** Parsed from the `exp` query param (epoch seconds). */
  exp: number;
  /** Required for PUT, absent for GET. Parsed from the `max` query param. */
  max?: number;
  /** Hex signature from the `sig` query param. */
  sig: string;
  /** Epoch seconds; defaults to `Date.now()/1000`. Test seam. */
  now?: number;
}

/** Result of {@link verifyLocalSignature}. */
export type VerifyLocalSignatureResult =
  | { valid: true }
  | { valid: false; reason: "expired" | "bad_signature" | "malformed" };

/**
 * Verify an HMAC-signed local URL (§1.5). Steps, in order:
 *   1. shape/malformed check,
 *   2. expiry (checked BEFORE the signature),
 *   3. recompute the expected HMAC,
 *   4. constant-time compare (length-mismatch => bad_signature, never throws).
 */
export function verifyLocalSignature(args: VerifyLocalSignatureArgs): VerifyLocalSignatureResult {
  const { method, bucket, key, exp, max, sig } = args;

  // 1. Shape: exp is a finite integer; PUT requires an integer max; sig is non-empty hex.
  if (!Number.isInteger(exp)) {
    return { valid: false, reason: "malformed" };
  }
  if (method === "PUT" && !Number.isInteger(max)) {
    return { valid: false, reason: "malformed" };
  }
  if (typeof sig !== "string" || sig.length === 0 || !/^[0-9a-fA-F]+$/.test(sig)) {
    return { valid: false, reason: "malformed" };
  }

  // 2. Expiry — BEFORE signature so an expired-but-valid sig still fails.
  const now = args.now ?? Math.floor(Date.now() / 1000);
  if (now > exp) {
    return { valid: false, reason: "expired" };
  }

  // 3. Recompute expected signature.
  const expected = hmacHex(buildCanonical(method, bucket, key, exp, max));

  // 4. Constant-time compare on equal-length hex buffers. timingSafeEqual throws
  //    on unequal lengths, so guard first => bad_signature without calling it.
  const provided = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (provided.length !== expectedBuf.length) {
    return { valid: false, reason: "bad_signature" };
  }
  return nodeCrypto.timingSafeEqual(provided, expectedBuf)
    ? { valid: true }
    : { valid: false, reason: "bad_signature" };
}
