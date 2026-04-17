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

const { getSubscriptionStatus } = await import("../queries/get-subscription-status");

describe("getSubscriptionStatus", () => {
  test("returns active subscription status when record exists", async () => {
    const periodEnd = new Date("2026-05-01");
    const mockDb = createMockDb({
      select: [{
        status: "active",
        providerSubscriptionId: "sub_123",
        providerPriceId: "price_abc",
        currentPeriodEnd: periodEnd,
      }],
    });
    const ctx = createMockContext({ db: mockDb });

    const result = await getSubscriptionStatus({}, ctx);
    const data = assertResultOk(result);

    expect(data.status).toBe("active");
    expect(data.hasSubscription).toBe(true);
    expect(data.providerSubscriptionId).toBe("sub_123");
    expect(data.providerPriceId).toBe("price_abc");
    expect(data.currentPeriodEnd).toEqual(periodEnd);
  });

  test("returns inactive status when no record found", async () => {
    const mockDb = createMockDb({ select: [] });
    const ctx = createMockContext({ db: mockDb });

    const result = await getSubscriptionStatus({}, ctx);
    const data = assertResultOk(result);

    expect(data.status).toBe("inactive");
    expect(data.hasSubscription).toBe(false);
    expect(data.providerSubscriptionId).toBeNull();
    expect(data.providerPriceId).toBeNull();
    expect(data.currentPeriodEnd).toBeNull();
  });

  test("returns hasSubscription false when record has no subscription ID", async () => {
    const mockDb = createMockDb({
      select: [{
        status: "inactive",
        providerSubscriptionId: null,
        providerPriceId: null,
        currentPeriodEnd: null,
      }],
    });
    const ctx = createMockContext({ db: mockDb });

    const result = await getSubscriptionStatus({}, ctx);
    const data = assertResultOk(result);

    expect(data.hasSubscription).toBe(false);
    expect(data.providerSubscriptionId).toBeNull();
  });
});
