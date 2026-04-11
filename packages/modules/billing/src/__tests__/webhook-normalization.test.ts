import { describe, test, expect } from "bun:test";
import { mapStripeEvent } from "../adapters/stripe/stripe-webhook-mapper";
import type { RawProviderEvent } from "../ports/types";

/**
 * Webhook normalization tests (PAY-03).
 *
 * Verifies that Stripe-specific webhook events are correctly mapped
 * to provider-agnostic NormalizedEvent types.
 */

function makeStripeEvent(
  type: string,
  object: Record<string, unknown> = {},
): RawProviderEvent {
  return {
    id: `evt_test_${type.replace(/\./g, "_")}`,
    type,
    data: { object },
  };
}

describe("Webhook Normalization", () => {
  describe("Stripe", () => {
    test("maps checkout.session.completed to checkout.completed", () => {
      const raw = makeStripeEvent("checkout.session.completed", {
        customer: "cus_123",
        subscription: "sub_456",
        status: "complete",
      });
      const normalized = mapStripeEvent(raw);

      expect(normalized.type).toBe("checkout.completed");
      expect(normalized.providerEventId).toBe("evt_test_checkout_session_completed");
      expect(normalized.providerCustomerId).toBe("cus_123");
      expect(normalized.data.subscriptionId).toBe("sub_456");
      expect(normalized.raw).toBe(raw);
    });

    test("maps customer.subscription.created to subscription.created", () => {
      const raw = makeStripeEvent("customer.subscription.created", {
        id: "sub_789",
        customer: "cus_123",
        status: "active",
        current_period_end: 1700000000,
        items: {
          data: [{ price: { id: "price_abc" } }],
        },
      });
      const normalized = mapStripeEvent(raw);

      expect(normalized.type).toBe("subscription.created");
      expect(normalized.providerCustomerId).toBe("cus_123");
      expect(normalized.data.subscriptionId).toBe("sub_789");
      expect(normalized.data.priceId).toBe("price_abc");
      expect(normalized.data.status).toBe("active");
      expect(normalized.data.currentPeriodEnd).toEqual(new Date(1700000000 * 1000));
    });

    test("maps customer.subscription.updated to subscription.updated", () => {
      const raw = makeStripeEvent("customer.subscription.updated", {
        id: "sub_789",
        customer: "cus_123",
        status: "past_due",
        current_period_end: 1700100000,
        items: {
          data: [{ price: { id: "price_def" } }],
        },
      });
      const normalized = mapStripeEvent(raw);

      expect(normalized.type).toBe("subscription.updated");
      expect(normalized.providerCustomerId).toBe("cus_123");
      expect(normalized.data.status).toBe("past_due");
      expect(normalized.data.priceId).toBe("price_def");
    });

    test("maps customer.subscription.deleted to subscription.cancelled", () => {
      const raw = makeStripeEvent("customer.subscription.deleted", {
        id: "sub_789",
        customer: "cus_123",
        status: "canceled",
      });
      const normalized = mapStripeEvent(raw);

      expect(normalized.type).toBe("subscription.cancelled");
      expect(normalized.providerCustomerId).toBe("cus_123");
      expect(normalized.data.status).toBe("canceled");
    });

    test("maps invoice.payment_succeeded to payment.succeeded", () => {
      const raw = makeStripeEvent("invoice.payment_succeeded", {
        customer: "cus_123",
        subscription: "sub_789",
        amount_due: 2999,
        currency: "usd",
        status: "paid",
      });
      const normalized = mapStripeEvent(raw);

      expect(normalized.type).toBe("payment.succeeded");
      expect(normalized.providerCustomerId).toBe("cus_123");
      expect(normalized.data.amount).toBe(2999);
      expect(normalized.data.currency).toBe("usd");
    });

    test("maps invoice.payment_failed to payment.failed", () => {
      const raw = makeStripeEvent("invoice.payment_failed", {
        customer: "cus_456",
        subscription: "sub_789",
        amount_due: 4999,
        currency: "brl",
        status: "open",
      });
      const normalized = mapStripeEvent(raw);

      expect(normalized.type).toBe("payment.failed");
      expect(normalized.providerCustomerId).toBe("cus_456");
      expect(normalized.data.amount).toBe(4999);
      expect(normalized.data.currency).toBe("brl");
    });

    test("throws on unhandled Stripe event type", () => {
      const raw = makeStripeEvent("some.unknown.event", {
        customer: "cus_123",
      });

      expect(() => mapStripeEvent(raw)).toThrow("Unhandled Stripe event type: some.unknown.event");
    });

    test("handles missing customer gracefully", () => {
      const raw = makeStripeEvent("checkout.session.completed", {});
      const normalized = mapStripeEvent(raw);

      expect(normalized.type).toBe("checkout.completed");
      expect(normalized.providerCustomerId).toBe("");
    });

    test("handles missing optional fields", () => {
      const raw = makeStripeEvent("customer.subscription.created", {
        id: "sub_minimal",
        customer: "cus_minimal",
      });
      const normalized = mapStripeEvent(raw);

      expect(normalized.type).toBe("subscription.created");
      expect(normalized.data.priceId).toBeUndefined();
      expect(normalized.data.currentPeriodEnd).toBeUndefined();
    });
  });

  describe("Pagar.me", () => {
    test.todo("maps subscription.created to subscription.created");
    test.todo("maps subscription.canceled to subscription.cancelled");
    test.todo("maps charge.paid to payment.succeeded");
    test.todo("maps charge.payment_failed to payment.failed");
    test.todo("maps order.paid to checkout.completed");
  });
});
