/**
 * Phase 24 / FILE-01 / Plan 24-04-03 — validateStorageEnv() tests.
 *
 * Asserts:
 *   - D-13 selective per-provider env validation (s3 / s3-compat)
 *   - D-14 production-safety crash for STORAGE_PROVIDER=local + NODE_ENV=production
 *   - T-24-04-01 secret-non-leak: error message names the missing var only,
 *     never echoes a value
 *   - NODE_ENV=test relaxation
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { validateStorageEnv } from "@baseworks/storage";

const originalEnv = { ...process.env };

beforeEach(() => {
  // Reset env to a known minimal baseline
  process.env = {
    HOME: originalEnv.HOME,
    PATH: originalEnv.PATH,
    NODE_ENV: "development",
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("validateStorageEnv (Phase 24 / D-13 / D-14)", () => {
  test("default (no STORAGE_PROVIDER, NODE_ENV=development) does not throw", () => {
    expect(() => validateStorageEnv()).not.toThrow();
  });

  test("D-14 — STORAGE_PROVIDER=local + NODE_ENV=production crashes with exact message", () => {
    process.env.STORAGE_PROVIDER = "local";
    process.env.NODE_ENV = "production";
    expect(() => validateStorageEnv()).toThrow(
      "Local storage adapter is not safe for production. Set STORAGE_PROVIDER=s3 or s3-compat.",
    );
  });

  test("STORAGE_PROVIDER=local + NODE_ENV=development is OK", () => {
    process.env.STORAGE_PROVIDER = "local";
    expect(() => validateStorageEnv()).not.toThrow();
  });

  test("STORAGE_PROVIDER=local + NODE_ENV=test is OK (isTest relaxation)", () => {
    process.env.STORAGE_PROVIDER = "local";
    process.env.NODE_ENV = "test";
    expect(() => validateStorageEnv()).not.toThrow();
  });

  test("STORAGE_PROVIDER=s3 missing AWS_ACCESS_KEY_ID throws named-var message", () => {
    process.env.STORAGE_PROVIDER = "s3";
    expect(() => validateStorageEnv()).toThrow(
      "AWS_ACCESS_KEY_ID is required when STORAGE_PROVIDER=s3. Set AWS_ACCESS_KEY_ID in your environment.",
    );
  });

  test("STORAGE_PROVIDER=s3 missing AWS_SECRET_ACCESS_KEY throws named-var message", () => {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.AWS_ACCESS_KEY_ID = "AKIA-x";
    expect(() => validateStorageEnv()).toThrow(
      "AWS_SECRET_ACCESS_KEY is required when STORAGE_PROVIDER=s3. Set AWS_SECRET_ACCESS_KEY in your environment.",
    );
  });

  test("STORAGE_PROVIDER=s3 missing AWS_REGION throws named-var message", () => {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.AWS_ACCESS_KEY_ID = "AKIA-x";
    process.env.AWS_SECRET_ACCESS_KEY = "secret-x";
    expect(() => validateStorageEnv()).toThrow(
      "AWS_REGION is required when STORAGE_PROVIDER=s3. Set AWS_REGION in your environment.",
    );
  });

  test("STORAGE_PROVIDER=s3 missing S3_BUCKET throws named-var message", () => {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.AWS_ACCESS_KEY_ID = "AKIA-x";
    process.env.AWS_SECRET_ACCESS_KEY = "secret-x";
    process.env.AWS_REGION = "us-east-1";
    expect(() => validateStorageEnv()).toThrow(
      "S3_BUCKET is required when STORAGE_PROVIDER=s3. Set S3_BUCKET in your environment.",
    );
  });

  test("STORAGE_PROVIDER=s3 with all four vars set passes", () => {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.AWS_ACCESS_KEY_ID = "AKIA-x";
    process.env.AWS_SECRET_ACCESS_KEY = "secret-x";
    process.env.AWS_REGION = "us-east-1";
    process.env.S3_BUCKET = "my-bucket";
    expect(() => validateStorageEnv()).not.toThrow();
  });

  test("STORAGE_PROVIDER=s3-compat missing S3_ENDPOINT throws named-var message", () => {
    process.env.STORAGE_PROVIDER = "s3-compat";
    process.env.AWS_ACCESS_KEY_ID = "AKIA-x";
    process.env.AWS_SECRET_ACCESS_KEY = "secret-x";
    process.env.S3_BUCKET = "my-bucket";
    process.env.S3_FORCE_PATH_STYLE = "true";
    expect(() => validateStorageEnv()).toThrow(
      "S3_ENDPOINT is required when STORAGE_PROVIDER=s3-compat. Set S3_ENDPOINT in your environment.",
    );
  });

  test("STORAGE_PROVIDER=s3-compat with all five vars set passes", () => {
    process.env.STORAGE_PROVIDER = "s3-compat";
    process.env.S3_ENDPOINT = "https://s3.example.com";
    process.env.AWS_ACCESS_KEY_ID = "AKIA-x";
    process.env.AWS_SECRET_ACCESS_KEY = "secret-x";
    process.env.S3_BUCKET = "my-bucket";
    process.env.S3_FORCE_PATH_STYLE = "true";
    expect(() => validateStorageEnv()).not.toThrow();
  });

  test("NODE_ENV=test with missing s3 keys does NOT throw (relaxation)", () => {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.NODE_ENV = "test";
    expect(() => validateStorageEnv()).not.toThrow();
  });

  test("T-24-04-01 — error message for missing AWS_SECRET_ACCESS_KEY does NOT contain any value", () => {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.AWS_ACCESS_KEY_ID = "AKIA-SUPER-SECRET-VALUE";
    process.env.AWS_REGION = "us-east-1";
    process.env.S3_BUCKET = "my-bucket";
    let err: Error | null = null;
    try {
      validateStorageEnv();
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err?.message).not.toContain("AKIA-SUPER-SECRET-VALUE");
    expect(err?.message).not.toContain("secret-x");
  });
});
