import { beforeEach, describe, expect, test } from "bun:test";
import type { FileRelation, ModuleDefinition } from "@baseworks/shared";
import { collectFileRelations, fileRelationsRegistry } from "@baseworks/storage";

const validRelation: FileRelation = {
  recordType: "user",
  allowedMimeTypes: ["image/png", "image/jpeg"],
  maxByteSize: 5 * 1024 * 1024,
};

beforeEach(() => {
  fileRelationsRegistry.reset();
});

describe("fileRelationsRegistry (Phase 24 / MOD-01 / D-06..D-08)", () => {
  test("starts empty after reset", () => {
    expect(fileRelationsRegistry.getAll().size).toBe(0);
  });

  test("register/get round-trips a valid relation under (module, kind) key", () => {
    fileRelationsRegistry.register("auth", "user", validRelation);
    expect(fileRelationsRegistry.get("auth", "user")?.recordType).toBe("user");
    expect(fileRelationsRegistry.getAll().size).toBe(1);
    expect(fileRelationsRegistry.getAll().has("auth:user")).toBe(true);
  });

  test("two distinct modules with same kind stay distinct (D-08 two-level key)", () => {
    fileRelationsRegistry.register("auth", "user", validRelation);
    fileRelationsRegistry.register("billing", "user", {
      ...validRelation,
      recordType: "subscription",
    });
    expect(fileRelationsRegistry.getAll().size).toBe(2);
    expect(fileRelationsRegistry.get("auth", "user")?.recordType).toBe("user");
    expect(fileRelationsRegistry.get("billing", "user")?.recordType).toBe("subscription");
  });

  test("re-register on same key overwrites (last write wins)", () => {
    fileRelationsRegistry.register("auth", "user", validRelation);
    fileRelationsRegistry.register("auth", "user", { ...validRelation, maxByteSize: 999 });
    expect(fileRelationsRegistry.get("auth", "user")?.maxByteSize).toBe(999);
  });

  test("D-07 — empty recordType throws naming module + kind", () => {
    expect(() =>
      fileRelationsRegistry.register("auth", "user", { ...validRelation, recordType: "" }),
    ).toThrow(/auth.*user/);
  });

  test("D-07 — empty allowedMimeTypes throws", () => {
    expect(() =>
      fileRelationsRegistry.register("auth", "user", { ...validRelation, allowedMimeTypes: [] }),
    ).toThrow(/auth.*user/);
  });

  test("D-07 — non-positive maxByteSize throws", () => {
    expect(() =>
      fileRelationsRegistry.register("auth", "user", { ...validRelation, maxByteSize: -1 }),
    ).toThrow(/auth.*user/);
    expect(() =>
      fileRelationsRegistry.register("auth", "user", { ...validRelation, maxByteSize: 0 }),
    ).toThrow(/auth.*user/);
  });

  test("D-07 / T-24-03-03 — generateVariants with format=svg throws", () => {
    const bad = {
      ...validRelation,
      // biome-ignore lint/suspicious/noExplicitAny: deliberate bad input for negative test
      generateVariants: [{ name: "x", width: 100, format: "svg" as any }],
    };
    expect(() => fileRelationsRegistry.register("auth", "user", bad)).toThrow(/auth.*user/);
  });

  test("collectFileRelations walks iterable and skips modules without fileRelations", () => {
    const modules = new Map<string, ModuleDefinition>();
    modules.set("auth", {
      name: "auth",
      fileRelations: {
        user: validRelation,
        organization: { ...validRelation, recordType: "organization", maxByteSize: 1024 },
      },
    });
    modules.set("billing", { name: "billing" }); // no fileRelations — skip
    modules.set("example", {
      name: "example",
      fileRelations: { document: { ...validRelation, recordType: "document" } },
    });

    collectFileRelations(modules.entries());

    expect(fileRelationsRegistry.getAll().size).toBe(3);
    expect(fileRelationsRegistry.get("auth", "user")?.recordType).toBe("user");
    expect(fileRelationsRegistry.get("auth", "organization")?.recordType).toBe("organization");
    expect(fileRelationsRegistry.get("example", "document")?.recordType).toBe("document");
    expect(fileRelationsRegistry.get("billing", "user")).toBeUndefined();
  });

  test("collectFileRelations propagates Zod errors with module + kind context", () => {
    const modules = new Map<string, ModuleDefinition>();
    modules.set("auth", {
      name: "auth",
      fileRelations: {
        user: { recordType: "", allowedMimeTypes: ["x"], maxByteSize: 1 } as FileRelation,
      },
    });
    expect(() => collectFileRelations(modules.entries())).toThrow(/auth.*user/);
  });

  test("reset() empties the registry", () => {
    fileRelationsRegistry.register("auth", "user", validRelation);
    expect(fileRelationsRegistry.getAll().size).toBe(1);
    fileRelationsRegistry.reset();
    expect(fileRelationsRegistry.getAll().size).toBe(0);
  });
});
