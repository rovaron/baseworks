/**
 * Phase 25 / FILE-02 / FILE-03 — Shared FileStorage conformance suite (D-25-04).
 *
 * One reusable, backend-agnostic test function consumed by all three adapter
 * test files (Local runs it unconditionally; S3 / S3-compat wrap it in
 * `describe.skipIf(...)`). It exercises ONLY the `FileStorage` port surface so
 * the same behavioral contract is proven against every backend.
 *
 * Named `conformance.ts` (NOT `*.test.ts`) so `bun test` never executes it
 * standalone — it has no live backend of its own and is imported by the
 * per-adapter `*.test.ts` files (contract §2 / R8).
 *
 * Behaviors 1, 7, 8, 9 are pure URL minting (no live backend). Behaviors 2–6
 * require a live backend: for Local that is the filesystem (always available);
 * for S3 / S3-compat the caller's `describe.skipIf` gate decides.
 *
 * Pitfall 1 (D-25-01 §1.4): behaviors 7 & 8 assert the typed sign result carries
 * NO raw `key` / `storageKey` property — the key only ever lives inside the URL.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { FileStorage } from "../../ports/file-storage";
import { loadFixture } from "../../test-support/fixtures";

/** Fixed bucket for the suite — created on demand for FS, pre-created for MinIO. */
const CONFORMANCE_BUCKET = "conformance";

/** Round-trip body: the committed binary baseline PNG (exercises non-text bytes). */
const FIXTURE_NAME = "baseline-100x100.png";

/** Generous upload size ceiling; the suite never approaches it. */
const MAX_BYTE_SIZE = 5 * 1024 * 1024;

/** Standard signed-URL lifetime used by the minting behaviors. */
const EXPIRES_IN_SEC = 600;

/**
 * Runs the full FileStorage behavioral contract against the storage produced by
 * `makeStorage`. `makeStorage` may be sync or async; it is resolved once per
 * suite in `beforeAll`. Every object written is tracked and deleted in
 * `afterEach` so reruns stay clean even if an assertion fails mid-test.
 */
export function runFileStorageConformance(
  label: string,
  makeStorage: () => FileStorage | Promise<FileStorage>,
): void {
  describe(`FileStorage conformance — ${label}`, () => {
    let storage: FileStorage;
    let baseline: Uint8Array;
    // Keys written during the current test; swept (idempotently) in afterEach.
    const writtenKeys = new Set<string>();

    /** Per-test unique key (crypto.randomUUID — never Math.random). */
    const uniqueKey = (): string => `${crypto.randomUUID()}.png`;

    /** Mark a key as written so afterEach removes it. */
    const track = (key: string): string => {
      writtenKeys.add(key);
      return key;
    };

    beforeAll(async () => {
      storage = await makeStorage();
      baseline = loadFixture(FIXTURE_NAME);
    });

    afterEach(async () => {
      for (const key of writtenKeys) {
        // delete is contractually idempotent (behavior #6), so a key that a
        // failing test never actually wrote is safe to sweep here.
        await storage.delete({ bucket: CONFORMANCE_BUCKET, key });
      }
      writtenKeys.clear();
    });

    // (1) Pure — adapter identity present for log lines.
    test("name discriminator is a non-empty string", () => {
      expect(typeof storage.name).toBe("string");
      expect(storage.name.length).toBeGreaterThan(0);
    });

    // (2) Live backend — round-trip byte-equality incl. binary PNG.
    test("putObject then getObject returns byte-identical content", async () => {
      const key = track(uniqueKey());
      await storage.putObject({
        bucket: CONFORMANCE_BUCKET,
        key,
        body: baseline,
        mimeType: "image/png",
      });

      const got = await storage.getObject({ bucket: CONFORMANCE_BUCKET, key });
      expect(got.byteLength).toBe(baseline.byteLength);
      expect(Buffer.compare(Buffer.from(got), Buffer.from(baseline))).toBe(0);
    });

    // (3) Live backend — stat returns authoritative byteSize + mimeType.
    test("stat returns authoritative byteSize and mimeType", async () => {
      const key = track(uniqueKey());
      await storage.putObject({
        bucket: CONFORMANCE_BUCKET,
        key,
        body: baseline,
        mimeType: "image/png",
      });

      const stat = await storage.stat({ bucket: CONFORMANCE_BUCKET, key });
      expect(stat).not.toBeNull();
      expect(stat?.byteSize).toBe(baseline.byteLength);
      expect(stat?.mimeType).toBe("image/png");
    });

    // (4) Live backend — stat of a never-written key resolves to null (no throw).
    test("stat of a missing key returns null", async () => {
      const stat = await storage.stat({ bucket: CONFORMANCE_BUCKET, key: uniqueKey() });
      expect(stat).toBeNull();
    });

    // (5) Live backend — delete removes (stat null AND getObject rejects).
    test("delete removes the object", async () => {
      const key = track(uniqueKey());
      await storage.putObject({
        bucket: CONFORMANCE_BUCKET,
        key,
        body: baseline,
        mimeType: "image/png",
      });

      await storage.delete({ bucket: CONFORMANCE_BUCKET, key });

      expect(await storage.stat({ bucket: CONFORMANCE_BUCKET, key })).toBeNull();
      expect(storage.getObject({ bucket: CONFORMANCE_BUCKET, key })).rejects.toThrow();
    });

    // (6) Live backend — delete of a never-written key is idempotent.
    test("delete of a missing key is idempotent", async () => {
      expect(
        storage.delete({ bucket: CONFORMANCE_BUCKET, key: uniqueKey() }),
      ).resolves.toBeUndefined();
    });

    // (7) Pure — signUpload returns a PUT url with future expiry and NO raw key.
    test("signUpload returns a PUT url with future expiry and no raw key", async () => {
      const before = Date.now();
      const result = await storage.signUpload({
        bucket: CONFORMANCE_BUCKET,
        key: uniqueKey(),
        mimeType: "image/png",
        maxByteSize: MAX_BYTE_SIZE,
        expiresInSec: EXPIRES_IN_SEC,
      });

      expect(result.method).toBe("PUT");
      expect(typeof result.url).toBe("string");
      expect(result.url.length).toBeGreaterThan(0);

      const expiresAt = new Date(result.expiresAt);
      expect(Number.isNaN(expiresAt.getTime())).toBe(false);
      expect(expiresAt.getTime()).toBeGreaterThan(before);

      // Pitfall 1: the typed result must never expose a standalone raw key.
      expect("storageKey" in result).toBe(false);
      expect("key" in result).toBe(false);
    });

    // (8) Pure — signRead returns a url with future expiry and NO raw key.
    test("signRead returns a url with future expiry and no raw key", async () => {
      const before = Date.now();
      const result = await storage.signRead({
        bucket: CONFORMANCE_BUCKET,
        key: uniqueKey(),
        expiresInSec: EXPIRES_IN_SEC,
      });

      expect(typeof result.url).toBe("string");
      expect(result.url.length).toBeGreaterThan(0);

      const expiresAt = new Date(result.expiresAt);
      expect(Number.isNaN(expiresAt.getTime())).toBe(false);
      expect(expiresAt.getTime()).toBeGreaterThan(before);

      expect("storageKey" in result).toBe(false);
      expect("key" in result).toBe(false);
    });

    // (9) Pure — expiry honors expiresInSec within ±5s (catches ms-vs-s bugs).
    test("expiry honors expiresInSec (±5s)", async () => {
      const nowSec = Date.now() / 1000;
      const result = await storage.signRead({
        bucket: CONFORMANCE_BUCKET,
        key: uniqueKey(),
        expiresInSec: EXPIRES_IN_SEC,
      });

      const expSec = new Date(result.expiresAt).getTime() / 1000;
      expect(Math.abs(expSec - (nowSec + EXPIRES_IN_SEC))).toBeLessThanOrEqual(5);
    });
  });
}
