/**
 * Phase 24 / FILE-01 / Plan 24-04-01 — Adapter scaffold tests.
 *
 * Asserts D-15 verbatim message format for FileStorage scaffolds:
 *   `FileStorage.{method}: not yet implemented in Phase 24; arriving in Phase 25`
 * (NO parenthetical adapter discriminator — adapter identity is preserved via
 * the throwing class name in the stack trace.)
 *
 * Asserts D-16 parallel-form message for ImageTransform scaffolds:
 *   `ImageTransform.{method}: not yet implemented in Phase 24; arriving in Phase 28`
 */
import { describe, expect, test } from "bun:test";
import {
  ImagescriptImageTransform,
  LocalFileStorage,
  S3CompatFileStorage,
  S3FileStorage,
  SharpImageTransform,
} from "@baseworks/storage";

// Path separator differs between platforms; Bun on Windows produces back-slashes
// in stack frames, POSIX produces forward slashes. Use the OS-native separator
// for the substring assertion.
const separator = process.platform === "win32" ? "\\" : "/";

const fileStorageMethods = [
  "signUpload",
  "signRead",
  "stat",
  "delete",
  "getObject",
  "putObject",
] as const;
const imageMethods = ["resize", "metadata"] as const;

// Adapter identity is preserved in stack traces via the unique source-file path
// (e.g., `adapters/local/file-storage.ts`). Bun/V8 stack frames for instance
// methods do NOT include the class name (only method name + file path), so we
// assert the directory slug instead — this is the reliable identity carrier.
const fileStorageScaffolds = [
  { ctor: LocalFileStorage, name: "local", className: "LocalFileStorage", dirSlug: "local" },
  { ctor: S3FileStorage, name: "s3", className: "S3FileStorage", dirSlug: "s3" },
  {
    ctor: S3CompatFileStorage,
    name: "s3-compat",
    className: "S3CompatFileStorage",
    dirSlug: "s3-compat",
  },
];

const imageScaffolds = [
  { ctor: SharpImageTransform, name: "sharp", className: "SharpImageTransform", dirSlug: "sharp" },
  {
    ctor: ImagescriptImageTransform,
    name: "imagescript",
    className: "ImagescriptImageTransform",
    dirSlug: "imagescript",
  },
];

describe("FileStorage scaffolds (Phase 24 / D-15 verbatim message)", () => {
  for (const { ctor, name, className, dirSlug } of fileStorageScaffolds) {
    test(`${className}.name === "${name}"`, () => {
      // biome-ignore lint/suspicious/noExplicitAny: scaffold ctors take no args; loop drives ergonomically
      const a = new (ctor as any)();
      expect(a.name).toBe(name);
    });

    for (const method of fileStorageMethods) {
      test(`${className}.${method}() throws verbatim D-15 phase-pointer error`, async () => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic method invocation in scaffold smoke
        const a = new (ctor as any)() as any;
        let err: Error | null = null;
        try {
          await a[method]({
            bucket: "b",
            key: "k",
            mimeType: "x",
            maxByteSize: 1,
            expiresInSec: 1,
            body: new Uint8Array(),
          });
        } catch (e) {
          err = e as Error;
        }
        expect(err).not.toBeNull();
        // EXACT verbatim D-15 message — NO parenthetical adapter discriminator.
        expect(err?.message).toBe(
          `FileStorage.${method}: not yet implemented in Phase 24; arriving in Phase 25`,
        );
      });

      test(`${className}.${method}() preserves adapter identity in stack-trace file path`, async () => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic method invocation in scaffold smoke
        const a = new (ctor as any)() as any;
        let err: Error | null = null;
        try {
          await a[method]({
            bucket: "b",
            key: "k",
            mimeType: "x",
            maxByteSize: 1,
            expiresInSec: 1,
            body: new Uint8Array(),
          });
        } catch (e) {
          err = e as Error;
        }
        // Adapter identity preserved in stack via the per-adapter source dir
        // (`adapters/{dirSlug}/file-storage.ts`). Bun stack frames omit class
        // names for instance methods, so dir slug is the reliable carrier.
        expect(err?.stack ?? "").toContain(
          `adapters${separator}${dirSlug}${separator}file-storage`,
        );
      });
    }
  }
});

describe("ImageTransform scaffolds (Phase 24 / D-16 parallel form)", () => {
  for (const { ctor, name, className, dirSlug } of imageScaffolds) {
    test(`${className}.name === "${name}"`, () => {
      // biome-ignore lint/suspicious/noExplicitAny: scaffold ctors take no args; loop drives ergonomically
      const a = new (ctor as any)();
      expect(a.name).toBe(name);
    });

    for (const method of imageMethods) {
      test(`${className}.${method}() throws parallel-form phase-pointer error`, async () => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic method invocation in scaffold smoke
        const a = new (ctor as any)() as any;
        let err: Error | null = null;
        try {
          if (method === "resize") {
            await a.resize({ input: new Uint8Array(), width: 1, format: "webp" });
          } else {
            await a.metadata(new Uint8Array());
          }
        } catch (e) {
          err = e as Error;
        }
        expect(err).not.toBeNull();
        // Parallel form to D-15: NO parenthetical adapter discriminator.
        expect(err?.message).toBe(
          `ImageTransform.${method}: not yet implemented in Phase 24; arriving in Phase 28`,
        );
      });

      test(`${className}.${method}() preserves adapter identity in stack-trace file path`, async () => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic method invocation in scaffold smoke
        const a = new (ctor as any)() as any;
        let err: Error | null = null;
        try {
          if (method === "resize") {
            await a.resize({ input: new Uint8Array(), width: 1, format: "webp" });
          } else {
            await a.metadata(new Uint8Array());
          }
        } catch (e) {
          err = e as Error;
        }
        expect(err?.stack ?? "").toContain(
          `adapters${separator}${dirSlug}${separator}image-transform`,
        );
      });
    }
  }
});
