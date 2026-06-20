/**
 * Phase 26 / UPL-03, CR-01 — buildStorageKey unit tests.
 *
 * Asserts the mandatory nanoid(24) segment, the structural layout, extension
 * mapping, and collision-resistance across many calls. The tenant prefix is
 * informational only (CR-01) — never an authorization source.
 */

import { describe, expect, test } from "bun:test";
import { buildStorageKey, resolveBucket } from "../lib/build-storage-key";

const base = {
  tenantId: "tnt_abc",
  ownerModule: "billing",
  kind: "invoice",
  mimeType: "image/png",
};

describe("buildStorageKey", () => {
  test("produces {tenantId}/{ownerModule}/{kind}/{nanoid(24)}{ext} structure", () => {
    const key = buildStorageKey(base);
    const parts = key.split("/");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("tnt_abc");
    expect(parts[1]).toBe("billing");
    expect(parts[2]).toBe("invoice");
  });

  test("includes a mandatory 24-char nanoid segment (before extension)", () => {
    const key = buildStorageKey(base);
    const last = key.split("/")[3] as string;
    const id = last.slice(0, 24);
    expect(id).toHaveLength(24);
    // nanoid default alphabet is url-safe: A-Za-z0-9_-
    expect(id).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  test("maps known MIME types to extensions", () => {
    expect(buildStorageKey({ ...base, mimeType: "image/jpeg" }).endsWith(".jpg")).toBe(true);
    expect(buildStorageKey({ ...base, mimeType: "image/png" }).endsWith(".png")).toBe(true);
    expect(buildStorageKey({ ...base, mimeType: "image/webp" }).endsWith(".webp")).toBe(true);
    expect(buildStorageKey({ ...base, mimeType: "image/gif" }).endsWith(".gif")).toBe(true);
    expect(buildStorageKey({ ...base, mimeType: "application/pdf" }).endsWith(".pdf")).toBe(true);
  });

  test("uses no extension for unknown MIME types (id is exactly 24 chars, never throws)", () => {
    const key = buildStorageKey({ ...base, mimeType: "application/octet-stream" });
    const last = key.split("/")[3] as string;
    expect(last).toHaveLength(24);
    expect(last).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  test("is collision-resistant across many calls (unique nanoid segment per call)", () => {
    const N = 5000;
    const ids = new Set<string>();
    for (let i = 0; i < N; i++) {
      const last = buildStorageKey(base).split("/")[3] as string;
      ids.add(last.slice(0, 24));
    }
    expect(ids.size).toBe(N);
  });
});

describe("resolveBucket", () => {
  test("defaults to 'files' when S3_BUCKET is unset", () => {
    const prev = process.env.S3_BUCKET;
    process.env.S3_BUCKET = undefined;
    delete process.env.S3_BUCKET;
    try {
      expect(resolveBucket()).toBe("files");
    } finally {
      if (prev !== undefined) process.env.S3_BUCKET = prev;
    }
  });

  test("returns S3_BUCKET when set", () => {
    const prev = process.env.S3_BUCKET;
    process.env.S3_BUCKET = "my-bucket";
    try {
      expect(resolveBucket()).toBe("my-bucket");
    } finally {
      if (prev === undefined) delete process.env.S3_BUCKET;
      else process.env.S3_BUCKET = prev;
    }
  });
});
