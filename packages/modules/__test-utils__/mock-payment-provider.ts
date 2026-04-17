import { mock } from "bun:test";
import type { PaymentProvider } from "../billing/src/ports/payment-provider";

/**
 * Create a mock PaymentProvider with all 13 interface methods.
 *
 * Each method is a bun:mock that resolves to a reasonable default.
 * Pass `overrides` to replace specific methods per test.
 *
 * @param overrides - Optional partial PaymentProvider to override defaults
 * @returns Fully mocked PaymentProvider instance
 */
export function createMockPaymentProvider(
  overrides?: Partial<PaymentProvider>,
): PaymentProvider {
  return {
    name: "mock",
    createCustomer: mock(() =>
      Promise.resolve({ providerCustomerId: "cus_mock" }),
    ),
    createSubscription: mock(() =>
      Promise.resolve({
        providerSubscriptionId: "sub_mock",
        status: "active",
        priceId: "price_mock",
        currentPeriodEnd: new Date(),
      }),
    ),
    cancelSubscription: mock(() => Promise.resolve()),
    changeSubscription: mock(() =>
      Promise.resolve({
        providerSubscriptionId: "sub_mock",
        status: "active",
        priceId: "price_new",
        currentPeriodEnd: new Date(),
      }),
    ),
    getSubscription: mock(() => Promise.resolve(null)),
    createOneTimePayment: mock(() =>
      Promise.resolve({
        sessionId: "sess_mock",
        url: "https://mock.co/checkout",
      }),
    ),
    createCheckoutSession: mock(() =>
      Promise.resolve({
        sessionId: "sess_mock",
        url: "https://mock.co/checkout",
      }),
    ),
    createPortalSession: mock(() =>
      Promise.resolve({ url: "https://mock.co/portal" }),
    ),
    verifyWebhookSignature: mock(() =>
      Promise.resolve({ id: "evt_mock", type: "test", data: {} }),
    ),
    normalizeEvent: mock(() => ({
      type: "checkout.completed" as const,
      providerEventId: "evt_mock",
      providerCustomerId: "cus_mock",
      data: {},
      occurredAt: new Date(),
      raw: {} as unknown,
    })),
    getInvoices: mock(() => Promise.resolve([])),
    reportUsage: mock(() =>
      Promise.resolve({ providerUsageRecordId: "ur_mock" }),
    ),
    ...overrides,
  };
}
