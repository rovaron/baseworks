import { describe, expect, test } from "bun:test";
import type { FileRelation, ImageVariantSpec, ModuleDefinition } from "@baseworks/shared";

describe("ModuleDefinition.fileRelations (Phase 24 / MOD-01 / D-06)", () => {
  test("module without fileRelations still type-checks", () => {
    const def: ModuleDefinition = { name: "minimal" };
    expect(def.name).toBe("minimal");
  });

  test("module with valid fileRelations type-checks", () => {
    const def: ModuleDefinition = {
      name: "test-mod",
      fileRelations: {
        user: {
          recordType: "user",
          allowedMimeTypes: ["image/jpeg", "image/png"],
          maxByteSize: 5 * 1024 * 1024,
          generateVariants: [{ name: "128", width: 128, format: "webp" }],
          onDelete: "cascade",
          canRead: async () => true,
          canWrite: async () => true,
        },
      },
    };
    expect(def.fileRelations?.user.recordType).toBe("user");
  });

  test("FileRelation requires recordType, allowedMimeTypes, maxByteSize", () => {
    const r: FileRelation = {
      recordType: "user",
      allowedMimeTypes: ["image/png"],
      maxByteSize: 1024,
    };
    expect(r.recordType).toBe("user");
  });

  test("ImageVariantSpec format excludes SVG", () => {
    const v: ImageVariantSpec = { name: "256", width: 256, format: "webp" };
    expect(v.format).toBe("webp");
    // @ts-expect-error — SVG is not in the format union (Pitfall 10 / IDA-02 prevention)
    const bad: ImageVariantSpec = { name: "x", width: 1, format: "svg" };
    expect(bad).toBeDefined();
  });
});
