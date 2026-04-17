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
const { createCheckoutSession } = await import("../commands/create-checkout-session");

describe("createCheckoutSession", () => {
  let mockProvider: ReturnType<typeof createMockPaymentProvider>;

  beforeEach(() => {
    resetPaymentProvider();
    mockProvider = createMockPaymentProvider();
    setPaymentProvider(mockProvider);
  });

  test("creates checkout session", async () => {
    const mockDb = createMockDb({
      select: [{ providerCustomerId: "cus_123" }],
    });
    const ctx = createMockContext({ db: mockDb });

    const result = await createCheckoutSession(
      {
        priceId: "price_abc",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      },
      ctx,
    );
    const data = assertResultOk(result);

    expect(data.sessionId).toBeDefined();
    expect(data.url).toBeDefined();
    expect(mockProvider.createCheckoutSession).toHaveBeenCalledWith({
      providerCustomerId: "cus_123",
      priceId: "price_abc",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
  });

  test("returns error when no billing customer", async () => {
    const mockDb = createMockDb({ select: [] });
    const ctx = createMockContext({ db: mockDb });

    const result = await createCheckoutSession(
      {
        priceId: "price_abc",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      },
      ctx,
    );
    const error = assertResultErr(result);

    expect(error).toBe("BILLING_NOT_CONFIGURED");
  });

  test("returns error when provider throws", async () => {
    const mockDb = createMockDb({
      select: [{ providerCustomerId: "cus_123" }],
    });
    mockProvider.createCheckoutSession = mock(() =>
      Promise.reject(new Error("Stripe API error")),
    );
    const ctx = createMockContext({ db: mockDb });

    const result = await createCheckoutSession(
      {
        priceId: "price_abc",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      },
      ctx,
    );
    const error = assertResultErr(result);

    expect(error).toBe("Stripe API error");
  });
});
