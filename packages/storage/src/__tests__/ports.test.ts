import { describe, expect, test } from "bun:test";
import type {
  FileStorage,
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
      async stat(_: {
        bucket: string;
        key: string;
      }): Promise<ObjectStat | null> {
        return null;
      }
      async delete(_: { bucket: string; key: string }): Promise<void> {
        return;
      }
      async getObject(_: {
        bucket: string;
        key: string;
      }): Promise<Uint8Array> {
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
