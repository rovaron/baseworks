/**
 * Local HMAC signing unit tests (Phase 25 / FILE-02 / FILE-03 — D-25-01).
 *
 * Proves the mint→verify round-trip, tamper detection (key/exp/max/sig),
 * expiry enforcement (checked before signature), malformed/length-mismatch
 * handling (no throw), PUT/GET cross-replay rejection, and that the
 * constant-time compare (`crypto.timingSafeEqual`) is actually exercised.
 *
 * No live backend required — signing is pure URL crypto (§1.5).
 */

import { describe, expect, spyOn, test } from "bun:test";
import * as nodeCrypto from "node:crypto";

import { signLocalUrl, type VerifyLocalSignatureArgs, verifyLocalSignature } from "./signing";

const BUCKET = "conformance";
const KEY = "tenant_abc/2026/06/file_xyz.png";
const NOW = 1_750_000_000; // fixed epoch seconds for determinism

/** Parse a minted local URL into the fields `verifyLocalSignature` consumes. */
function parseSigned(url: string): { exp: number; max?: number; sig: string } {
  const u = new URL(url, "http://local.test");
  const exp = Number(u.searchParams.get("exp"));
  const maxRaw = u.searchParams.get("max");
  const sig = u.searchParams.get("sig") ?? "";
  return maxRaw === null ? { exp, sig } : { exp, max: Number(maxRaw), sig };
}

describe("signLocalUrl — URL shape (§1.4)", () => {
  test("PUT mints a path-style URL with ?exp&max&sig and no raw-key field", () => {
    const r = signLocalUrl({
      method: "PUT",
      bucket: BUCKET,
      key: KEY,
      maxByteSize: 10_485_760,
      expiresInSec: 600,
      now: NOW,
    });

    const u = new URL(r.url, "http://local.test");
    expect(u.pathname).toBe("/api/files/local/conformance/tenant_abc/2026/06/file_xyz.png");
    expect(u.searchParams.get("exp")).toBe(String(NOW + 600));
    expect(u.searchParams.get("max")).toBe("10485760");
    expect(u.searchParams.get("sig")).toMatch(/^[0-9a-f]{64}$/);
    expect(r.expiresAt).toBe(new Date((NOW + 600) * 1000).toISOString());

    // Pitfall 1: result object carries no raw key/storageKey field.
    expect("key" in r).toBe(false);
    expect("storageKey" in r).toBe(false);
  });

  test("GET mints a URL with ?exp&sig (no max)", () => {
    const r = signLocalUrl({
      method: "GET",
      bucket: BUCKET,
      key: KEY,
      expiresInSec: 600,
      now: NOW,
    });
    const u = new URL(r.url, "http://local.test");
    expect(u.searchParams.get("max")).toBeNull();
    expect(u.searchParams.get("sig")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("encodes path-unsafe characters per segment while preserving key '/'", () => {
    const r = signLocalUrl({
      method: "GET",
      bucket: "my bucket",
      key: "a/b c/d?e#f",
      expiresInSec: 60,
      now: NOW,
    });
    const u = new URL(r.url, "http://local.test");
    expect(u.pathname).toBe("/api/files/local/my%20bucket/a/b%20c/d%3Fe%23f");
  });
});

describe("verifyLocalSignature — round-trip (§1.5)", () => {
  test("a freshly signed PUT URL verifies", () => {
    const r = signLocalUrl({
      method: "PUT",
      bucket: BUCKET,
      key: KEY,
      maxByteSize: 4096,
      expiresInSec: 600,
      now: NOW,
    });
    const { exp, max, sig } = parseSigned(r.url);
    expect(
      verifyLocalSignature({
        method: "PUT",
        bucket: BUCKET,
        key: KEY,
        exp,
        max,
        sig,
        now: NOW,
      }),
    ).toEqual({ valid: true });
  });

  test("a freshly signed GET URL verifies", () => {
    const r = signLocalUrl({
      method: "GET",
      bucket: BUCKET,
      key: KEY,
      expiresInSec: 600,
      now: NOW,
    });
    const { exp, sig } = parseSigned(r.url);
    expect(
      verifyLocalSignature({ method: "GET", bucket: BUCKET, key: KEY, exp, sig, now: NOW }),
    ).toEqual({ valid: true });
  });
});

describe("verifyLocalSignature — tamper detection", () => {
  function freshPut(): VerifyLocalSignatureArgs {
    const r = signLocalUrl({
      method: "PUT",
      bucket: BUCKET,
      key: KEY,
      maxByteSize: 4096,
      expiresInSec: 600,
      now: NOW,
    });
    const { exp, max, sig } = parseSigned(r.url);
    return { method: "PUT", bucket: BUCKET, key: KEY, exp, max, sig, now: NOW };
  }

  test("tampered key => bad_signature", () => {
    expect(verifyLocalSignature({ ...freshPut(), key: `${KEY}.evil` })).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  test("tampered bucket => bad_signature", () => {
    expect(verifyLocalSignature({ ...freshPut(), bucket: "other" })).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  test("tampered exp (still in future) => bad_signature", () => {
    const args = freshPut();
    expect(verifyLocalSignature({ ...args, exp: args.exp + 1 })).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  test("tampered max => bad_signature", () => {
    expect(verifyLocalSignature({ ...freshPut(), max: 999_999_999 })).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  test("tampered sig (same length) => bad_signature", () => {
    const args = freshPut();
    const flipped = `${args.sig.slice(0, -1)}${args.sig.endsWith("a") ? "b" : "a"}`;
    expect(verifyLocalSignature({ ...args, sig: flipped })).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  test("a PUT signature cannot be replayed as a GET (cross-replay)", () => {
    const args = freshPut();
    // Same bucket/key/exp, but verified as GET with the PUT sig.
    expect(
      verifyLocalSignature({
        method: "GET",
        bucket: args.bucket,
        key: args.key,
        exp: args.exp,
        sig: args.sig,
        now: NOW,
      }),
    ).toEqual({ valid: false, reason: "bad_signature" });
  });

  test("a GET signature cannot be replayed as a PUT (cross-replay)", () => {
    const r = signLocalUrl({
      method: "GET",
      bucket: BUCKET,
      key: KEY,
      expiresInSec: 600,
      now: NOW,
    });
    const { exp, sig } = parseSigned(r.url);
    expect(
      verifyLocalSignature({
        method: "PUT",
        bucket: BUCKET,
        key: KEY,
        exp,
        max: 4096,
        sig,
        now: NOW,
      }),
    ).toEqual({ valid: false, reason: "bad_signature" });
  });
});

describe("verifyLocalSignature — expiry (§1.5 step 2)", () => {
  test("an expired URL => expired", () => {
    const r = signLocalUrl({
      method: "GET",
      bucket: BUCKET,
      key: KEY,
      expiresInSec: 600,
      now: NOW,
    });
    const { exp, sig } = parseSigned(r.url);
    // now strictly greater than exp.
    expect(
      verifyLocalSignature({ method: "GET", bucket: BUCKET, key: KEY, exp, sig, now: exp + 1 }),
    ).toEqual({ valid: false, reason: "expired" });
  });

  test("now === exp is still valid (boundary: only now > exp expires)", () => {
    const r = signLocalUrl({
      method: "GET",
      bucket: BUCKET,
      key: KEY,
      expiresInSec: 600,
      now: NOW,
    });
    const { exp, sig } = parseSigned(r.url);
    expect(
      verifyLocalSignature({ method: "GET", bucket: BUCKET, key: KEY, exp, sig, now: exp }),
    ).toEqual({ valid: true });
  });

  test("expiry is checked BEFORE the signature (expired + bad sig => expired)", () => {
    const r = signLocalUrl({
      method: "GET",
      bucket: BUCKET,
      key: KEY,
      expiresInSec: 600,
      now: NOW,
    });
    const { exp } = parseSigned(r.url);
    expect(
      verifyLocalSignature({
        method: "GET",
        bucket: BUCKET,
        key: KEY,
        exp,
        sig: "deadbeef".repeat(8), // 64 hex chars but wrong
        now: exp + 1,
      }),
    ).toEqual({ valid: false, reason: "expired" });
  });
});

describe("verifyLocalSignature — malformed inputs (§1.5 step 1)", () => {
  const base = { method: "GET" as const, bucket: BUCKET, key: KEY, now: NOW };

  test("non-integer exp => malformed", () => {
    expect(verifyLocalSignature({ ...base, exp: 1.5, sig: "ab" })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  test("NaN exp => malformed", () => {
    expect(verifyLocalSignature({ ...base, exp: Number.NaN, sig: "ab" })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  test("PUT without integer max => malformed", () => {
    expect(
      verifyLocalSignature({
        method: "PUT",
        bucket: BUCKET,
        key: KEY,
        exp: NOW + 600,
        sig: "ab",
        now: NOW,
      }),
    ).toEqual({ valid: false, reason: "malformed" });
  });

  test("empty sig => malformed", () => {
    expect(verifyLocalSignature({ ...base, exp: NOW + 600, sig: "" })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  test("non-hex sig => malformed", () => {
    expect(verifyLocalSignature({ ...base, exp: NOW + 600, sig: "zzzz" })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });
});

describe("verifyLocalSignature — constant-time compare (§1.5 step 4)", () => {
  test("a length-mismatched (but hex) sig => bad_signature without throwing", () => {
    const r = signLocalUrl({
      method: "GET",
      bucket: BUCKET,
      key: KEY,
      expiresInSec: 600,
      now: NOW,
    });
    const { exp } = parseSigned(r.url);
    // Valid hex but only 8 bytes vs the expected 32 → length guard must trip.
    expect(() =>
      verifyLocalSignature({
        method: "GET",
        bucket: BUCKET,
        key: KEY,
        exp,
        sig: "abcdef01abcdef01",
        now: NOW,
      }),
    ).not.toThrow();
    expect(
      verifyLocalSignature({
        method: "GET",
        bucket: BUCKET,
        key: KEY,
        exp,
        sig: "abcdef01abcdef01",
        now: NOW,
      }),
    ).toEqual({ valid: false, reason: "bad_signature" });
  });

  test("timingSafeEqual is invoked for an equal-length comparison", () => {
    const spy = spyOn(nodeCrypto, "timingSafeEqual");
    try {
      const r = signLocalUrl({
        method: "GET",
        bucket: BUCKET,
        key: KEY,
        expiresInSec: 600,
        now: NOW,
      });
      const { exp, sig } = parseSigned(r.url);
      const before = spy.mock.calls.length;
      const result = verifyLocalSignature({
        method: "GET",
        bucket: BUCKET,
        key: KEY,
        exp,
        sig,
        now: NOW,
      });
      expect(result).toEqual({ valid: true });
      expect(spy.mock.calls.length).toBe(before + 1);
      // Confirm it was called with two equal-length buffers (the constant-time path).
      const [a, b] = spy.mock.calls.at(-1) as [Buffer, Buffer];
      expect(a.length).toBe(b.length);
    } finally {
      spy.mockRestore();
    }
  });

  test("the length-mismatch guard does NOT call timingSafeEqual (it would throw)", () => {
    const spy = spyOn(nodeCrypto, "timingSafeEqual");
    try {
      const before = spy.mock.calls.length;
      verifyLocalSignature({
        method: "GET",
        bucket: BUCKET,
        key: KEY,
        exp: NOW + 600,
        sig: "abcdef01", // 4 bytes, never equal to 32-byte expected
        now: NOW,
      });
      expect(spy.mock.calls.length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });
});
