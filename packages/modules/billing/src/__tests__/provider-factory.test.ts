import { describe, test } from "bun:test";

describe("Provider Factory", () => {
  test.todo("returns StripeAdapter when PAYMENT_PROVIDER=stripe");
  test.todo("returns StripeAdapter when PAYMENT_PROVIDER is unset (default)");
  test.todo("returns PagarmeAdapter when PAYMENT_PROVIDER=pagarme");
  test.todo("throws on unknown PAYMENT_PROVIDER value");
});
