// packages/modules/notifications/src/__tests__/catalog.test.ts
import { describe, expect, test } from "bun:test";
import { getCatalogEntry, notificationCatalog } from "../catalog";

describe("notification catalog", () => {
  test("every entry has channels, category, severity, and a render()", () => {
    for (const [type, entry] of Object.entries(notificationCatalog)) {
      expect(entry.defaultChannels.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe("string");
      expect(["info", "success", "warning", "error"]).toContain(entry.severity);
      expect(typeof entry.render).toBe("function");
      expect(type.length).toBeGreaterThan(0);
    }
  });

  test("render() returns title + body from data", () => {
    const entry = getCatalogEntry("system.test");
    const rendered = entry.render({ message: "hello" });
    expect(rendered.title.length).toBeGreaterThan(0);
    expect(rendered.body).toContain("hello");
  });
});
