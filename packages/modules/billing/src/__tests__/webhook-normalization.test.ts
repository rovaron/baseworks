import { describe, test } from "bun:test";

describe("Webhook Normalization", () => {
  describe("Stripe", () => {
    test.todo("maps checkout.session.completed to checkout.completed");
    test.todo("maps customer.subscription.created to subscription.created");
    test.todo("maps customer.subscription.updated to subscription.updated");
    test.todo("maps customer.subscription.deleted to subscription.cancelled");
    test.todo("maps invoice.payment_succeeded to payment.succeeded");
    test.todo("maps invoice.payment_failed to payment.failed");
  });

  describe("Pagar.me", () => {
    test.todo("maps subscription.created to subscription.created");
    test.todo("maps subscription.canceled to subscription.cancelled");
    test.todo("maps charge.paid to payment.succeeded");
    test.todo("maps charge.payment_failed to payment.failed");
    test.todo("maps order.paid to checkout.completed");
  });
});
