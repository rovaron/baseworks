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
const { changeSubscription } = await import("../commands/change-subscription");

describe("changeSubscription", () => {
  let mockProvider: ReturnType<typeof createMockPaymentProvider>;

  beforeEach(() => {
    resetPaymentProvider();
    mockProvider = createMockPaymentProvider();
    setPaymentProvider(mockProvider);
  });

  test("changes subscription to new price", async () => {
    const mockDb = createMockDb({
      select: [{ providerSubscriptionId: "sub_123" }],
    });
    const ctx = createMockContext({ db: mockDb });

    const result = await changeSubscription({ newPriceId: "price_new" }, ctx);
    const data = assertResultOk(result);

    expect(data.subscriptionId).toBe("sub_123");
    expect(data.newPriceId).toBe("price_new");
    expect(mockProvider.changeSubscription).toHaveBeenCalledWith({
      providerSubscriptionId: "sub_123",
      newPriceId: "price_new",
    });
  });

  test("returns error when no active subscription", async () => {
    const mockDb = createMockDb({ select: [{}] });
    const ctx = createMockContext({ db: mockDb });

    const result = await changeSubscription({ newPriceId: "price_new" }, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("NO_ACTIVE_SUBSCRIPTION");
  });

  test("returns error when provider throws", async () => {
    const mockDb = createMockDb({
      select: [{ providerSubscriptionId: "sub_123" }],
    });
    mockProvider.changeSubscription = mock(() =>
      Promise.reject(new Error("Rate limit exceeded")),
    );
    const ctx = createMockContext({ db: mockDb });

    const result = await changeSubscription({ newPriceId: "price_new" }, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("Rate limit exceeded");
  });
});
