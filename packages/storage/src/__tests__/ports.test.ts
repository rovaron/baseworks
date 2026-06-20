import { describe, expect, test } from "bun:test";
import type { ImageVariantSpec as SharedImageVariantSpec } from "@baseworks/shared";
import type {
  FileStorage,
  ImageMetadata,
  ImageTransform,
  ImageVariantSpec,
  ObjectStat,
  SignedRead,
  SignedUpload,
} from "@baseworks/storage";

describe("FileStorage port (FILE-01)", () => {
  test("interface is importable as a type", () => {
    const x = null as unknown as FileStorage;
    // Compile-time check: x.name must be string
    if (x) expect(typeof x.name).toBe("string");
    expect(true).toBe(true); // runtime sentinel
  });

  test("FileStorage requires all six methods", () => {
    // This test is structural: a class missing any method fails to compile.
    class Stub implements FileStorage {
      readonly name = "stub";
      async signUpload(_: {
        bucket: string;
        key: string;
        mimeType: string;
        maxByteSize: number;
        expiresInSec: number;
      }): Promise<SignedUpload> {
        throw new Error("nyi");
      }
      async signRead(_: {
        bucket: string;
        key: string;
        expiresInSec: number;
        responseContentDisposition?: string;
      }): Promise<SignedRead> {
        throw new Error("nyi");
      }
      async stat(_: { bucket: string; key: string }): Promise<ObjectStat | null> {
        return null;
      }
      async delete(_: { bucket: string; key: string }): Promise<void> {
        return;
      }
      async getObject(_: { bucket: string; key: string }): Promise<Uint8Array> {
        return new Uint8Array();
      }
      async putObject(_: {
        bucket: string;
        key: string;
        body: Uint8Array;
        mimeType: string;
      }): Promise<void> {
        return;
      }
    }
    const s = new Stub();
    expect(s.name).toBe("stub");
  });

  test("SignedUpload required fields", () => {
    const u: SignedUpload = {
      method: "PUT",
      url: "https://example.com",
      expiresAt: "2026-01-01T00:00:00Z",
    };
    expect(u.method).toBe("PUT");
  });
});

describe("ImageTransform port (FILE-01)", () => {
  test("ImageTransform requires resize AND metadata methods", () => {
    class Stub implements ImageTransform {
      readonly name = "stub";
      async resize(_: {
        input: Uint8Array;
        width: number;
        height?: number;
        fit?: "cover" | "contain" | "inside";
        format: "webp" | "jpeg" | "png";
        quality?: number;
      }) {
        return {
          output: new Uint8Array(),
          mimeType: "image/webp",
          width: 0,
          height: 0,
        };
      }
      async metadata(_: Uint8Array): Promise<ImageMetadata> {
        return { width: 0, height: 0, format: "png" };
      }
    }
    const s = new Stub();
    expect(s.name).toBe("stub");
  });

  test("ImageVariantSpec.format excludes SVG", () => {
    const v: ImageVariantSpec = { name: "256", width: 256, format: "webp" };
    expect(v.format).toBe("webp");
    // @ts-expect-error — "svg" not in union (T-24-01-02 mitigation; constraint enforced in @baseworks/shared)
    const bad: ImageVariantSpec = { name: "x", width: 1, format: "svg" };
    expect(bad).toBeDefined();
  });

  test("ImageMetadata returns width, height, format", () => {
    const m: ImageMetadata = { width: 100, height: 200, format: "jpeg" };
    expect(m.width).toBe(100);
  });

  test("ImageVariantSpec from @baseworks/storage is the same canonical type as from @baseworks/shared", () => {
    // Type-level identity: a value typed as the storage re-export must be assignable
    // to the shared canonical declaration and vice versa. If the re-export drifted
    // into a redeclaration, this assignment would fail compilation.
    const fromStorage: ImageVariantSpec = {
      name: "256",
      width: 256,
      format: "webp",
    };
    const asShared: SharedImageVariantSpec = fromStorage;
    const back: ImageVariantSpec = asShared;
    expect(back.name).toBe("256");
  });
});
