import { describe, test, expect, mock, beforeEach } from "bun:test";

/**
 * Provider factory tests (PAY-05).
 *
 * Verifies that getPaymentProvider() returns the correct adapter
 * based on the PAYMENT_PROVIDER environment variable.
 *
 * Uses mock.module to intercept @baseworks/config before
 * provider-factory.ts evaluates its import.
 */

// Mock env values -- mutable for per-test configuration
const mockEnv: Record<string, any> = {
  PAYMENT_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_test_stripe_xxx",
  STRIPE_WEBHOOK_SECRET: "whsec_stripe_xxx",
  PAGARME_SECRET_KEY: "sk_test_pagarme_xxx",
  PAGARME_WEBHOOK_SECRET: "whsec_pagarme_xxx",
};

// Mock @baseworks/config BEFORE any module that imports it is loaded
mock.module("@baseworks/config", () => ({
  env: mockEnv,
}));

// Mock Stripe SDK to avoid real initialization
mock.module("stripe", () => ({
  default: class MockStripe {
    constructor() {}
    webhooks = { constructEvent: () => ({}) };
  },
}));

// Now import provider-factory -- it will get our mocked @baseworks/config
const { getPaymentProvider, resetPaymentProvider } = await import(
  "../provider-factory"
);

describe("Provider Factory", () => {
  beforeEach(() => {
    resetPaymentProvider();
    // Reset to defaults
    mockEnv.PAYMENT_PROVIDER = "stripe";
    mockEnv.STRIPE_SECRET_KEY = "sk_test_stripe_xxx";
    mockEnv.STRIPE_WEBHOOK_SECRET = "whsec_stripe_xxx";
    mockEnv.PAGARME_SECRET_KEY = "sk_test_pagarme_xxx";
    mockEnv.PAGARME_WEBHOOK_SECRET = "whsec_pagarme_xxx";
  });

  test("returns StripeAdapter when PAYMENT_PROVIDER=stripe", () => {
    mockEnv.PAYMENT_PROVIDER = "stripe";
    const provider = getPaymentProvider();
    expect(provider.name).toBe("stripe");
  });

  test("returns StripeAdapter when PAYMENT_PROVIDER is undefined (default)", () => {
    mockEnv.PAYMENT_PROVIDER = undefined;
    const provider = getPaymentProvider();
    expect(provider.name).toBe("stripe");
  });

  test("returns PagarmeAdapter when PAYMENT_PROVIDER=pagarme", () => {
    mockEnv.PAYMENT_PROVIDER = "pagarme";
    const provider = getPaymentProvider();
    expect(provider.name).toBe("pagarme");
  });

  test("throws on unknown PAYMENT_PROVIDER value", () => {
    mockEnv.PAYMENT_PROVIDER = "unknown";
    expect(() => getPaymentProvider()).toThrow(
      "Unknown payment provider: unknown",
    );
  });

  test("caches provider instance (singleton)", () => {
    mockEnv.PAYMENT_PROVIDER = "stripe";
    const first = getPaymentProvider();
    const second = getPaymentProvider();
    expect(first).toBe(second);
  });

  test("resetPaymentProvider clears cached instance", () => {
    mockEnv.PAYMENT_PROVIDER = "stripe";
    const first = getPaymentProvider();

    resetPaymentProvider();
    mockEnv.PAYMENT_PROVIDER = "pagarme";
    const second = getPaymentProvider();

    expect(first.name).toBe("stripe");
    expect(second.name).toBe("pagarme");
  });
});
