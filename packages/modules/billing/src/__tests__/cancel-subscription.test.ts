import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext, createMockDb } from "../../../__test-utils__/mock-context";
import { createMockPaymentProvider } from "../../../__test-utils__/mock-payment-provider";
import { assertResultOk, assertResultErr } from "../../../__test-utils__/assert-result";

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: "postgres://test@localhost/test",
    NODE_ENV: "test",
  },
}));
mock.module("stripe", () => ({ default: class {} }));

const { setPaymentProvider, resetPaymentProvider } = await import("../provider-factory");
const { cancelSubscription } = await import("../commands/cancel-subscription");

describe("cancelSubscription", () => {
  let mockProvider: ReturnType<typeof createMockPaymentProvider>;

  beforeEach(() => {
    resetPaymentProvider();
    mockProvider = createMockPaymentProvider();
    setPaymentProvider(mockProvider);
  });

  test("cancels subscription at period end", async () => {
    const periodEnd = new Date("2026-05-01");
    const mockDb = createMockDb({
      select: [{ providerSubscriptionId: "sub_123", currentPeriodEnd: periodEnd }],
    });
    const ctx = createMockContext({ db: mockDb });

    const result = await cancelSubscription({}, ctx);
    const data = assertResultOk(result);

    expect(data.cancelledAt).toBe("period_end");
    expect(data.currentPeriodEnd).toEqual(periodEnd);
    expect(mockProvider.cancelSubscription).toHaveBeenCalledWith({
      providerSubscriptionId: "sub_123",
      cancelAtPeriodEnd: true,
    });
  });

  test("returns error when no active subscription", async () => {
    const mockDb = createMockDb({ select: [{}] });
    const ctx = createMockContext({ db: mockDb });

    const result = await cancelSubscription({}, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("NO_ACTIVE_SUBSCRIPTION");
  });

  test("returns error when provider throws", async () => {
    const mockDb = createMockDb({
      select: [{ providerSubscriptionId: "sub_123", currentPeriodEnd: new Date() }],
    });
    mockProvider.cancelSubscription = mock(() =>
      Promise.reject(new Error("Provider unavailable")),
    );
    const ctx = createMockContext({ db: mockDb });

    const result = await cancelSubscription({}, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("Provider unavailable");
  });
});
