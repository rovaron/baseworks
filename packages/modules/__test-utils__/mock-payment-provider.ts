import { mock } from "bun:test";
import type { PaymentProvider } from "../billing/src/ports/payment-provider";

/**
 * Create a mock PaymentProvider for unit testing billing handlers.
 *
 * All methods are bun:test mocks with sensible default return values.
 * Override individual methods by passing them in the overrides parameter.
 */
export function createMockPaymentProvider(
  overrides: Partial<PaymentProvider> = {},
): PaymentProvider {
  return {
    name: "mock",
    createCustomer: mock(() =>
      Promise.resolve({ providerCustomerId: "cus_mock_123" }),
    ),
    createSubscription: mock(() =>
      Promise.resolve({
        providerSubscriptionId: "sub_mock_123",
        status: "active",
        priceId: "price_mock_abc",
        currentPeriodEnd: new Date("2026-05-01"),
      }),
    ),
    cancelSubscription: mock(() => Promise.resolve()),
    changeSubscription: mock(() =>
      Promise.resolve({
        providerSubscriptionId: "sub_mock_123",
        status: "active",
        priceId: "price_mock_new",
        currentPeriodEnd: new Date("2026-05-01"),
      }),
    ),
    getSubscription: mock(() =>
      Promise.resolve({
        providerSubscriptionId: "sub_mock_123",
        status: "active",
        priceId: "price_mock_abc",
        currentPeriodEnd: new Date("2026-05-01"),
      }),
    ),
    createOneTimePayment: mock(() =>
      Promise.resolve({ sessionId: "cs_mock_123", url: "https://checkout.mock/session" }),
    ),
    createCheckoutSession: mock(() =>
      Promise.resolve({ sessionId: "cs_mock_456", url: "https://checkout.mock/sub-session" }),
    ),
    createPortalSession: mock(() =>
      Promise.resolve({ url: "https://portal.mock/session" }),
    ),
    verifyWebhookSignature: mock(() =>
      Promise.resolve({ id: "evt_mock_123", type: "test.event", data: {} }),
    ),
    normalizeEvent: mock(() => ({
      type: "payment.succeeded" as const,
      providerEventId: "evt_mock_123",
      providerCustomerId: "cus_mock_123",
      data: { amount: 1000, currency: "USD" },
      occurredAt: new Date(),
      raw: {},
    })),
    getInvoices: mock(() =>
      Promise.resolve([
        {
          id: "inv_mock_1",
          amount: 1000,
          currency: "USD",
          status: "paid",
          created: 1700000000,
          invoiceUrl: "https://mock.com/inv/1",
          pdfUrl: null,
        },
      ]),
    ),
    reportUsage: mock(() =>
      Promise.resolve({ providerUsageRecordId: "ur_mock_123" }),
    ),
    ...overrides,
  };
}
