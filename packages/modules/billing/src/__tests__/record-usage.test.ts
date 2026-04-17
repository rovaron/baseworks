import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext, createMockDb } from "../../../__test-utils__/mock-context";
import { assertResultOk } from "../../../__test-utils__/assert-result";

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: "postgres://test@localhost/test",
    NODE_ENV: "test",
  },
}));
mock.module("stripe", () => ({ default: class {} }));

const { recordUsage } = await import("../commands/record-usage");

describe("recordUsage", () => {
  test("records usage successfully", async () => {
    const mockDb = createMockDb();
    const ctx = createMockContext({ db: mockDb });

    const result = await recordUsage(
      { metric: "api_calls", quantity: 100 },
      ctx,
    );
    const data = assertResultOk(result);

    expect(data.recorded).toBe(true);
    expect(data.metric).toBe("api_calls");
    expect(data.quantity).toBe(100);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  test("records usage with minimum quantity of 1", async () => {
    const mockDb = createMockDb();
    const ctx = createMockContext({ db: mockDb });

    const result = await recordUsage(
      { metric: "storage_gb", quantity: 1 },
      ctx,
    );
    const data = assertResultOk(result);

    expect(data.recorded).toBe(true);
    expect(data.metric).toBe("storage_gb");
    expect(data.quantity).toBe(1);
  });

  test("rejects invalid quantity via validation", async () => {
    const mockDb = createMockDb();
    const ctx = createMockContext({ db: mockDb });

    const result = await recordUsage(
      { metric: "api_calls", quantity: 0 },
      ctx,
    );

    expect(result.success).toBe(false);
    expect((result as any).error).toContain("VALIDATION_ERROR");
  });
});
