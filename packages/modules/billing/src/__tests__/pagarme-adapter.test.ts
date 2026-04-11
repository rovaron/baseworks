import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import type { RawProviderEvent } from "../ports/types";
import { mapPagarmeEvent } from "../adapters/pagarme/pagarme-webhook-mapper";

/**
 * Pagar.me adapter + webhook mapper tests (PAY-04).
 *
 * Tests the PagarmeAdapter implementation and webhook event normalization.
 * Mocks global.fetch to avoid real API calls to Pagar.me.
 */

// Store original fetch
const originalFetch = globalThis.fetch;

function mockFetchResponse(data: any, status = 200) {
  return mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

// Dynamically import after setting up mocks
async function createAdapter() {
  const { PagarmeAdapter } = await import(
    "../adapters/pagarme/pagarme-adapter"
  );
  return new PagarmeAdapter({
    secretKey: "sk_test_pagarme_123",
    webhookSecret: "whsec_test_pagarme_456",
  });
}

describe("PagarmeAdapter", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("has name 'pagarme'", async () => {
    const adapter = await createAdapter();
    expect(adapter.name).toBe("pagarme");
  });

  test("createCustomer calls Pagar.me customers endpoint", async () => {
    const mockFetch = mockFetchResponse({ id: "cus_pagarme_123" });
    globalThis.fetch = mockFetch as any;

    const adapter = await createAdapter();
    const result = await adapter.createCustomer({
      tenantId: "tenant_abc",
      name: "Test Company",
    });

    expect(result.providerCustomerId).toBe("cus_pagarme_123");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain("/customers");
    expect(callArgs[1].method).toBe("POST");

    const body = JSON.parse(callArgs[1].body);
    expect(body.name).toBe("Test Company");
  });

  test("createSubscription calls Pagar.me subscriptions endpoint", async () => {
    const mockFetch = mockFetchResponse({
      id: "sub_pagarme_789",
      status: "active",
      plan: { id: "plan_abc" },
      current_period_end: "2026-05-01T00:00:00Z",
    });
    globalThis.fetch = mockFetch as any;

    const adapter = await createAdapter();
    const result = await adapter.createSubscription({
      providerCustomerId: "cus_pagarme_123",
      priceId: "plan_abc",
    });

    expect(result.providerSubscriptionId).toBe("sub_pagarme_789");
    expect(result.status).toBe("active");
    expect(result.priceId).toBe("plan_abc");
  });

  test("cancelSubscription calls DELETE on subscriptions endpoint", async () => {
    const mockFetch = mockFetchResponse({});
    globalThis.fetch = mockFetch as any;

    const adapter = await createAdapter();
    await adapter.cancelSubscription({
      providerSubscriptionId: "sub_pagarme_789",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain("/subscriptions/sub_pagarme_789");
    expect(callArgs[1].method).toBe("DELETE");
  });

  test("createPortalSession returns null", async () => {
    const adapter = await createAdapter();
    const result = await adapter.createPortalSession({
      providerCustomerId: "cus_pagarme_123",
      returnUrl: "https://example.com/billing",
    });

    expect(result).toBeNull();
  });

  test("getSubscription returns null on error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    ) as any;

    const adapter = await createAdapter();
    const result = await adapter.getSubscription("sub_nonexistent");

    expect(result).toBeNull();
  });

  test("verifyWebhookSignature validates HMAC-SHA256", async () => {
    const adapter = await createAdapter();
    const rawBody = JSON.stringify({
      id: "hook_123",
      type: "charge.paid",
      data: { customer: { id: "cus_123" }, amount: 5000, status: "paid" },
    });

    // Generate valid HMAC signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode("whsec_test_pagarme_456"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawBody),
    );
    const validSignature = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await adapter.verifyWebhookSignature({
      rawBody,
      signature: validSignature,
    });

    expect(result.id).toBe("hook_123");
    expect(result.type).toBe("charge.paid");
  });

  test("verifyWebhookSignature throws on invalid signature", async () => {
    const adapter = await createAdapter();
    const rawBody = JSON.stringify({
      id: "hook_123",
      type: "charge.paid",
      data: {},
    });

    await expect(
      adapter.verifyWebhookSignature({
        rawBody,
        signature: "invalid_signature_hex",
      }),
    ).rejects.toThrow("Invalid Pagar.me webhook signature");
  });

  test("normalizeEvent delegates to mapPagarmeEvent", async () => {
    const adapter = await createAdapter();
    const rawEvent: RawProviderEvent = {
      id: "hook_456",
      type: "subscription.created",
      data: {
        id: "sub_789",
        customer: { id: "cus_123" },
        status: "active",
      },
    };

    const normalized = adapter.normalizeEvent(rawEvent);

    expect(normalized.type).toBe("subscription.created");
    expect(normalized.providerEventId).toBe("hook_456");
    expect(normalized.providerCustomerId).toBe("cus_123");
    expect(normalized.data.subscriptionId).toBe("sub_789");
  });

  test("getInvoices maps charges to ProviderInvoice format", async () => {
    const mockFetch = mockFetchResponse({
      data: [
        {
          id: "ch_001",
          amount: 9900,
          currency: "BRL",
          status: "paid",
          created_at: "2026-04-01T00:00:00Z",
          url: "https://pagar.me/charge/ch_001",
        },
      ],
    });
    globalThis.fetch = mockFetch as any;

    const adapter = await createAdapter();
    const invoices = await adapter.getInvoices("cus_pagarme_123", 10);

    expect(invoices).toHaveLength(1);
    expect(invoices[0].id).toBe("ch_001");
    expect(invoices[0].amount).toBe(9900);
    expect(invoices[0].currency).toBe("BRL");
    expect(invoices[0].status).toBe("paid");
    expect(invoices[0].invoiceUrl).toBe("https://pagar.me/charge/ch_001");
    expect(invoices[0].pdfUrl).toBeNull();
  });
});

describe("mapPagarmeEvent", () => {
  function makePagarmeEvent(
    type: string,
    data: Record<string, unknown> = {},
  ): RawProviderEvent {
    return {
      id: `hook_test_${type.replace(/\./g, "_")}`,
      type,
      data,
    };
  }

  test("maps subscription.created to subscription.created", () => {
    const raw = makePagarmeEvent("subscription.created", {
      id: "sub_123",
      customer: { id: "cus_456" },
      plan: { id: "plan_789" },
      status: "active",
    });
    const normalized = mapPagarmeEvent(raw);

    expect(normalized.type).toBe("subscription.created");
    expect(normalized.providerEventId).toBe("hook_test_subscription_created");
    expect(normalized.providerCustomerId).toBe("cus_456");
    expect(normalized.data.subscriptionId).toBe("sub_123");
    expect(normalized.data.priceId).toBe("plan_789");
    expect(normalized.data.status).toBe("active");
  });

  test("maps subscription.canceled to subscription.cancelled", () => {
    const raw = makePagarmeEvent("subscription.canceled", {
      id: "sub_123",
      customer: { id: "cus_456" },
      status: "canceled",
    });
    const normalized = mapPagarmeEvent(raw);

    expect(normalized.type).toBe("subscription.cancelled");
    expect(normalized.providerCustomerId).toBe("cus_456");
    expect(normalized.data.status).toBe("canceled");
  });

  test("maps charge.paid to payment.succeeded", () => {
    const raw = makePagarmeEvent("charge.paid", {
      id: "ch_123",
      customer: { id: "cus_456" },
      amount: 5000,
      currency: "BRL",
      status: "paid",
    });
    const normalized = mapPagarmeEvent(raw);

    expect(normalized.type).toBe("payment.succeeded");
    expect(normalized.providerCustomerId).toBe("cus_456");
    expect(normalized.data.amount).toBe(5000);
    expect(normalized.data.currency).toBe("BRL");
  });

  test("maps charge.payment_failed to payment.failed", () => {
    const raw = makePagarmeEvent("charge.payment_failed", {
      id: "ch_456",
      customer: { id: "cus_789" },
      amount: 3000,
      status: "failed",
    });
    const normalized = mapPagarmeEvent(raw);

    expect(normalized.type).toBe("payment.failed");
    expect(normalized.providerCustomerId).toBe("cus_789");
    expect(normalized.data.amount).toBe(3000);
  });

  test("maps order.paid to checkout.completed", () => {
    const raw = makePagarmeEvent("order.paid", {
      id: "ord_123",
      customer: { id: "cus_456" },
      amount: 10000,
      status: "paid",
    });
    const normalized = mapPagarmeEvent(raw);

    expect(normalized.type).toBe("checkout.completed");
    expect(normalized.providerCustomerId).toBe("cus_456");
    expect(normalized.data.amount).toBe(10000);
  });

  test("throws on unhandled event type", () => {
    const raw = makePagarmeEvent("unknown.event", {});

    expect(() => mapPagarmeEvent(raw)).toThrow(
      "Unhandled Pagar.me event type: unknown.event",
    );
  });

  test("handles missing customer gracefully", () => {
    const raw = makePagarmeEvent("charge.paid", {
      amount: 1000,
    });
    const normalized = mapPagarmeEvent(raw);

    expect(normalized.providerCustomerId).toBe("");
  });

  test("uses last_transaction amount as fallback", () => {
    const raw = makePagarmeEvent("charge.paid", {
      customer: { id: "cus_123" },
      last_transaction: { amount: 7500 },
    });
    const normalized = mapPagarmeEvent(raw);

    expect(normalized.data.amount).toBe(7500);
  });

  test("defaults currency to BRL", () => {
    const raw = makePagarmeEvent("charge.paid", {
      customer: { id: "cus_123" },
      amount: 5000,
    });
    const normalized = mapPagarmeEvent(raw);

    expect(normalized.data.currency).toBe("BRL");
  });
});
