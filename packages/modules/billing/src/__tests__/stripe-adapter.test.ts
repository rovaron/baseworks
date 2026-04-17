import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { RawProviderEvent } from "../ports/types";
import { mapStripeEvent } from "../adapters/stripe/stripe-webhook-mapper";

/**
 * Stripe adapter conformance tests (TEST-05).
 *
 * Mirrors pagarme-adapter.test.ts structure. Mocks the Stripe SDK
 * at module level to avoid real API calls.
 */

// Create mock functions that will be reused across tests
const mockCustomersCreate = mock(() =>
  Promise.resolve({ id: "cus_stripe_123" }),
);
const mockSubscriptionsCreate = mock(() =>
  Promise.resolve({
    id: "sub_stripe_789",
    status: "active",
    items: { data: [{ id: "si_001", price: { id: "price_abc" } }] },
    current_period_end: Math.floor(new Date("2026-05-01").getTime() / 1000),
  }),
);
const mockSubscriptionsRetrieve = mock(() =>
  Promise.resolve({
    id: "sub_stripe_789",
    status: "active",
    items: { data: [{ id: "si_001", price: { id: "price_abc" } }] },
    current_period_end: Math.floor(new Date("2026-05-01").getTime() / 1000),
  }),
);
const mockSubscriptionsUpdate = mock(() =>
  Promise.resolve({
    id: "sub_stripe_789",
    status: "active",
    items: { data: [{ id: "si_001", price: { id: "price_new" } }] },
    current_period_end: Math.floor(new Date("2026-05-01").getTime() / 1000),
  }),
);
const mockCheckoutSessionsCreate = mock(() =>
  Promise.resolve({
    id: "cs_stripe_123",
    url: "https://checkout.stripe.com/c/pay_cs_stripe_123",
  }),
);
const mockPortalSessionsCreate = mock(() =>
  Promise.resolve({
    url: "https://billing.stripe.com/p/session_test_123",
  }),
);
const mockInvoicesList = mock(() =>
  Promise.resolve({
    data: [
      {
        id: "inv_stripe_1",
        amount_due: 9900,
        currency: "usd",
        status: "paid",
        created: 1700000000,
        hosted_invoice_url: "https://pay.stripe.com/inv/1",
        invoice_pdf: "https://pay.stripe.com/inv/1/pdf",
      },
    ],
  }),
);
const mockCreateUsageRecord = mock(() =>
  Promise.resolve({ id: "ur_stripe_123" }),
);
const mockConstructEvent = mock((rawBody: string, _sig: string, _secret: string) => {
  const parsed = JSON.parse(rawBody);
  return {
    id: parsed.id ?? "evt_stripe_123",
    type: parsed.type ?? "invoice.payment_succeeded",
    data: parsed.data ?? { object: {} },
  };
});

mock.module("stripe", () => ({
  default: class MockStripe {
    customers = { create: mockCustomersCreate };
    subscriptions = {
      create: mockSubscriptionsCreate,
      retrieve: mockSubscriptionsRetrieve,
      update: mockSubscriptionsUpdate,
    };
    checkout = { sessions: { create: mockCheckoutSessionsCreate } };
    billingPortal = { sessions: { create: mockPortalSessionsCreate } };
    invoices = { list: mockInvoicesList };
    subscriptionItems = { createUsageRecord: mockCreateUsageRecord };
    webhooks = { constructEvent: mockConstructEvent };
    constructor() {}
  },
}));

const { StripeAdapter } = await import("../adapters/stripe/stripe-adapter");

describe("StripeAdapter", () => {
  let adapter: InstanceType<typeof StripeAdapter>;

  beforeEach(() => {
    mockCustomersCreate.mockClear();
    mockSubscriptionsCreate.mockClear();
    mockSubscriptionsRetrieve.mockClear();
    mockSubscriptionsUpdate.mockClear();
    mockCheckoutSessionsCreate.mockClear();
    mockPortalSessionsCreate.mockClear();
    mockInvoicesList.mockClear();
    mockCreateUsageRecord.mockClear();
    mockConstructEvent.mockClear();

    adapter = new StripeAdapter({
      secretKey: "sk_test_stripe_123",
      webhookSecret: "whsec_test_stripe_456",
    });
  });

  test("has name 'stripe'", () => {
    expect(adapter.name).toBe("stripe");
  });

  test("createCustomer calls Stripe customers.create", async () => {
    const result = await adapter.createCustomer({
      tenantId: "tenant_abc",
      name: "Test Company",
    });

    expect(result.providerCustomerId).toBe("cus_stripe_123");
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockCustomersCreate.mock.calls[0];
    expect(callArgs[0].metadata.tenantId).toBe("tenant_abc");
    expect(callArgs[0].name).toBe("Test Company");
  });

  test("createSubscription calls Stripe subscriptions.create", async () => {
    const result = await adapter.createSubscription({
      providerCustomerId: "cus_stripe_123",
      priceId: "price_abc",
    });

    expect(result.providerSubscriptionId).toBe("sub_stripe_789");
    expect(result.status).toBe("active");
    expect(result.priceId).toBe("price_abc");
    expect(result.currentPeriodEnd).toBeInstanceOf(Date);
    expect(mockSubscriptionsCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockSubscriptionsCreate.mock.calls[0];
    expect(callArgs[0].customer).toBe("cus_stripe_123");
    expect(callArgs[0].items[0].price).toBe("price_abc");
  });

  test("cancelSubscription calls subscriptions.update with cancel_at_period_end", async () => {
    await adapter.cancelSubscription({
      providerSubscriptionId: "sub_stripe_789",
      cancelAtPeriodEnd: true,
    });

    expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1);
    const callArgs = mockSubscriptionsUpdate.mock.calls[0];
    expect(callArgs[0]).toBe("sub_stripe_789");
    expect(callArgs[1].cancel_at_period_end).toBe(true);
  });

  test("changeSubscription retrieves then updates subscription", async () => {
    const result = await adapter.changeSubscription({
      providerSubscriptionId: "sub_stripe_789",
      newPriceId: "price_new",
    });

    expect(mockSubscriptionsRetrieve).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionsRetrieve.mock.calls[0][0]).toBe("sub_stripe_789");
    expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1);

    const updateArgs = mockSubscriptionsUpdate.mock.calls[0];
    expect(updateArgs[0]).toBe("sub_stripe_789");
    expect(updateArgs[1].items[0].price).toBe("price_new");

    expect(result.providerSubscriptionId).toBe("sub_stripe_789");
    expect(result.priceId).toBe("price_new");
  });

  test("getSubscription returns null on error", async () => {
    mockSubscriptionsRetrieve.mockImplementationOnce(() =>
      Promise.reject(new Error("Not found")),
    );

    const result = await adapter.getSubscription("sub_nonexistent");
    expect(result).toBeNull();
  });

  test("createCheckoutSession creates subscription-mode session", async () => {
    const result = await adapter.createCheckoutSession({
      providerCustomerId: "cus_stripe_123",
      priceId: "price_abc",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    expect(result.sessionId).toBe("cs_stripe_123");
    expect(result.url).toContain("checkout.stripe.com");
    expect(mockCheckoutSessionsCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockCheckoutSessionsCreate.mock.calls[0];
    expect(callArgs[0].mode).toBe("subscription");
    expect(callArgs[0].customer).toBe("cus_stripe_123");
  });

  test("createOneTimePayment creates payment-mode session", async () => {
    const result = await adapter.createOneTimePayment({
      providerCustomerId: "cus_stripe_123",
      priceId: "price_addon",
      quantity: 2,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    expect(result.sessionId).toBe("cs_stripe_123");
    expect(result.url).toBeDefined();
    expect(mockCheckoutSessionsCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockCheckoutSessionsCreate.mock.calls[0];
    expect(callArgs[0].mode).toBe("payment");
    expect(callArgs[0].line_items[0].quantity).toBe(2);
  });

  test("createPortalSession returns portal URL", async () => {
    const result = await adapter.createPortalSession({
      providerCustomerId: "cus_stripe_123",
      returnUrl: "https://example.com/billing",
    });

    expect(result).not.toBeNull();
    expect(result!.url).toContain("billing.stripe.com");
    expect(mockPortalSessionsCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockPortalSessionsCreate.mock.calls[0];
    expect(callArgs[0].customer).toBe("cus_stripe_123");
    expect(callArgs[0].return_url).toBe("https://example.com/billing");
  });

  test("verifyWebhookSignature uses constructEvent", async () => {
    const rawBody = JSON.stringify({
      id: "evt_stripe_456",
      type: "invoice.payment_succeeded",
      data: { object: { customer: "cus_123", amount_due: 5000 } },
    });

    const result = await adapter.verifyWebhookSignature({
      rawBody,
      signature: "t=1234,v1=abcdef",
    });

    expect(mockConstructEvent).toHaveBeenCalledTimes(1);
    expect(mockConstructEvent.mock.calls[0][0]).toBe(rawBody);
    expect(mockConstructEvent.mock.calls[0][1]).toBe("t=1234,v1=abcdef");
    expect(result.id).toBe("evt_stripe_456");
    expect(result.type).toBe("invoice.payment_succeeded");
  });

  test("normalizeEvent delegates to mapStripeEvent", () => {
    const rawEvent: RawProviderEvent = {
      id: "evt_stripe_789",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_789",
          customer: "cus_123",
          status: "active",
          items: { data: [{ price: { id: "price_abc" } }] },
          current_period_end: 1777000000,
        },
      },
    };

    const normalized = adapter.normalizeEvent(rawEvent);

    expect(normalized.type).toBe("subscription.created");
    expect(normalized.providerEventId).toBe("evt_stripe_789");
    expect(normalized.providerCustomerId).toBe("cus_123");
    expect(normalized.data.subscriptionId).toBe("sub_789");
    expect(normalized.data.priceId).toBe("price_abc");
    expect(normalized.data.status).toBe("active");
  });

  test("getInvoices maps to ProviderInvoice format", async () => {
    const invoices = await adapter.getInvoices("cus_stripe_123", 10);

    expect(invoices).toHaveLength(1);
    expect(invoices[0].id).toBe("inv_stripe_1");
    expect(invoices[0].amount).toBe(9900);
    expect(invoices[0].currency).toBe("usd");
    expect(invoices[0].status).toBe("paid");
    expect(invoices[0].invoiceUrl).toBe("https://pay.stripe.com/inv/1");
    expect(invoices[0].pdfUrl).toBe("https://pay.stripe.com/inv/1/pdf");

    expect(mockInvoicesList).toHaveBeenCalledWith({
      customer: "cus_stripe_123",
      limit: 10,
    });
  });

  test("reportUsage creates usage record", async () => {
    const result = await adapter.reportUsage({
      providerSubscriptionId: "sub_stripe_789",
      quantity: 50,
      timestamp: 1700000000,
    });

    expect(result.providerUsageRecordId).toBe("ur_stripe_123");
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledTimes(1);
    expect(mockCreateUsageRecord).toHaveBeenCalledTimes(1);

    const callArgs = mockCreateUsageRecord.mock.calls[0];
    expect(callArgs[0]).toBe("si_001"); // subscription item ID
    expect(callArgs[1].quantity).toBe(50);
    expect(callArgs[1].timestamp).toBe(1700000000);
    expect(callArgs[1].action).toBe("increment");
  });
});
