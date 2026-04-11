import { env } from "@baseworks/config";
import type { PaymentProvider } from "./ports/payment-provider";
import { StripeAdapter } from "./adapters/stripe/stripe-adapter";

/**
 * Payment provider singleton factory.
 *
 * Returns a lazily-initialized PaymentProvider instance.
 * Currently only supports Stripe (Plan 03 adds Pagar.me + env switch).
 *
 * Uses lazy initialization so the billing module can load in test
 * environments without payment provider keys configured.
 */
let providerInstance: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!providerInstance) {
    // For now, only Stripe is implemented. Plan 03 adds Pagar.me + env switch.
    providerInstance = new StripeAdapter({
      secretKey: env.STRIPE_SECRET_KEY!,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
    });
  }
  return providerInstance;
}

/** Reset singleton -- used in tests to inject mocks */
export function resetPaymentProvider(): void {
  providerInstance = null;
}

/** Set provider directly -- used in tests */
export function setPaymentProvider(provider: PaymentProvider): void {
  providerInstance = provider;
}
