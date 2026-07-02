// packages/modules/notifications/src/__tests__/categories.test.ts
import { describe, expect, test } from "bun:test";
import { getCategories, getCategory, registerCategory } from "../categories";

describe("category registry", () => {
  test("seeds the five built-ins with correct mutable flags", () => {
    const cats = getCategories();
    expect(cats.map((c) => c.key).sort()).toEqual([
      "billing",
      "files",
      "security",
      "system",
      "team",
    ]);
    expect(cats.find((c) => c.key === "security")?.mutable).toBe(false);
    for (const key of ["system", "team", "billing", "files"] as const) {
      expect(getCategory(key)?.mutable).toBe(true);
    }
  });

  test("getCategory returns the full def", () => {
    expect(getCategory("security")).toEqual({ label: "Security", mutable: false });
  });

  test("registerCategory overrides an existing def and is idempotent", () => {
    registerCategory("system", { label: "System", mutable: true });
    registerCategory("system", { label: "System", mutable: true });
    expect(getCategory("system")).toEqual({ label: "System", mutable: true });
    expect(getCategories().filter((c) => c.key === "system")).toHaveLength(1);
  });
});
