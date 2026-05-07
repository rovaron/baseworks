/**
 * Phase 24 / FILE-01 / Plan 24-04-02 — Factory tests.
 *
 * Asserts env-driven adapter selection per D-10 (default local) and D-12
 * (default sharp), the unknown-provider error path with the supported list,
 * singleton behavior, and set/reset trio for test injection.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getFileStorage,
  getImageTransform,
  ImagescriptImageTransform,
  LocalFileStorage,
  resetFileStorage,
  resetImageTransform,
  S3CompatFileStorage,
  S3FileStorage,
  setFileStorage,
  setImageTransform,
  SharpImageTransform,
} from "@baseworks/storage";

const originalEnv = { ...process.env };

beforeEach(() => {
  resetFileStorage();
  resetImageTransform();
  // Clean storage env between tests
  delete process.env.STORAGE_PROVIDER;
  delete process.env.IMAGE_TRANSFORM_PROVIDER;
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetFileStorage();
  resetImageTransform();
});

describe("getFileStorage (D-10 default local)", () => {
  test("defaults to LocalFileStorage when STORAGE_PROVIDER unset", () => {
    expect(getFileStorage()).toBeInstanceOf(LocalFileStorage);
  });

  test("STORAGE_PROVIDER=s3 returns S3FileStorage", () => {
    process.env.STORAGE_PROVIDER = "s3";
    expect(getFileStorage()).toBeInstanceOf(S3FileStorage);
  });

  test("STORAGE_PROVIDER=s3-compat returns S3CompatFileStorage", () => {
    process.env.STORAGE_PROVIDER = "s3-compat";
    expect(getFileStorage()).toBeInstanceOf(S3CompatFileStorage);
  });

  test("unknown STORAGE_PROVIDER throws with supported list", () => {
    process.env.STORAGE_PROVIDER = "foo";
    expect(() => getFileStorage()).toThrow(
      "Unknown STORAGE_PROVIDER: foo. Supported: local, s3, s3-compat.",
    );
  });

  test("singleton — two calls return same instance", () => {
    const a = getFileStorage();
    const b = getFileStorage();
    expect(a).toBe(b);
  });

  test("setFileStorage + resetFileStorage", () => {
    const stub = new LocalFileStorage();
    setFileStorage(stub);
    expect(getFileStorage()).toBe(stub);
    resetFileStorage();
    expect(getFileStorage()).not.toBe(stub);
  });
});

describe("getImageTransform (D-12 default sharp)", () => {
  test("defaults to SharpImageTransform when IMAGE_TRANSFORM_PROVIDER unset", () => {
    expect(getImageTransform()).toBeInstanceOf(SharpImageTransform);
  });

  test("IMAGE_TRANSFORM_PROVIDER=imagescript returns ImagescriptImageTransform", () => {
    process.env.IMAGE_TRANSFORM_PROVIDER = "imagescript";
    expect(getImageTransform()).toBeInstanceOf(ImagescriptImageTransform);
  });

  test("unknown IMAGE_TRANSFORM_PROVIDER throws with supported list", () => {
    process.env.IMAGE_TRANSFORM_PROVIDER = "bar";
    expect(() => getImageTransform()).toThrow(
      "Unknown IMAGE_TRANSFORM_PROVIDER: bar. Supported: sharp, imagescript.",
    );
  });

  test("setImageTransform + resetImageTransform", () => {
    const stub = new ImagescriptImageTransform();
    setImageTransform(stub);
    expect(getImageTransform()).toBe(stub);
    resetImageTransform();
    expect(getImageTransform()).not.toBe(stub);
  });
});
