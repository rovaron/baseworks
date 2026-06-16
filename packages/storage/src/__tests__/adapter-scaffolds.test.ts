/**
 * Phase 24 / FILE-01 / Plan 24-04-01 — Adapter scaffold tests.
 *
 * Asserts D-16 parallel-form message for ImageTransform scaffolds:
 *   `ImageTransform.{method}: not yet implemented in Phase 24; arriving in Phase 28`
 *
 * Phase 25 (FILE-02/FILE-03) replaced ALL three throwing FileStorage scaffolds
 * (Local, S3, S3-compat) with real adapters, so the FileStorage scaffold section
 * was removed — adapter identity (`name`) is now covered by the conformance
 * suite (behavior #1). Only the ImageTransform scaffolds (Phase 28) remain.
 */
import { describe, expect, test } from "bun:test";
import { ImagescriptImageTransform, SharpImageTransform } from "@baseworks/storage";

// Path separator differs between platforms; Bun on Windows produces back-slashes
// in stack frames, POSIX produces forward slashes. Use the OS-native separator
// for the substring assertion.
const separator = process.platform === "win32" ? "\\" : "/";

const imageMethods = ["resize", "metadata"] as const;

const imageScaffolds = [
  { ctor: SharpImageTransform, name: "sharp", className: "SharpImageTransform", dirSlug: "sharp" },
  {
    ctor: ImagescriptImageTransform,
    name: "imagescript",
    className: "ImagescriptImageTransform",
    dirSlug: "imagescript",
  },
];

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
