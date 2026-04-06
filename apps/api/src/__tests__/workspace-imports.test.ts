import { describe, test, expect } from "bun:test";

describe("workspace imports", () => {
  test("@baseworks/shared exports CQRS types and helpers", async () => {
    const shared = await import("@baseworks/shared");
    expect(shared.defineCommand).toBeDefined();
    expect(shared.defineQuery).toBeDefined();
    expect(shared.ok).toBeDefined();
    expect(shared.err).toBeDefined();
  });

  test("@baseworks/config exports env", async () => {
    const config = await import("@baseworks/config");
    expect(config.env).toBeDefined();
    expect(config.env.DATABASE_URL).toBeDefined();
  });

  test("@baseworks/db exports createDb", async () => {
    const db = await import("@baseworks/db");
    expect(db.createDb).toBeDefined();
  });
});
