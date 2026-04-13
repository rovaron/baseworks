import { env } from "@baseworks/config";
import type { PaymentProvider } from "./ports/payment-provider";
import { StripeAdapter } from "./adapters/stripe/stripe-adapter";
import { PagarmeAdapter } from "./adapters/pagarme/pagarme-adapter";

/**
 * Payment provider singleton factory (PAY-05).
 *
 * Returns a lazily-initialized PaymentProvider instance based on the
 * PAYMENT_PROVIDER environment variable. Defaults to Stripe if unset.
 *
 * Uses lazy initialization so the billing module can load in test
 * environments without payment provider keys configured.
 *
 * Supported providers:
 * - "stripe" (default): Uses StripeAdapter with STRIPE_SECRET_KEY
 * - "pagarme": Uses PagarmeAdapter with PAGARME_SECRET_KEY
 */
let providerInstance: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!providerInstance) {
    const providerName = env.PAYMENT_PROVIDER ?? "stripe";

    switch (providerName) {
      case "stripe": {
        // Runtime guards -- TypeScript's ! is erased at runtime (CR-04).
        const secretKey = env.STRIPE_SECRET_KEY;
        const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
        if (!secretKey) {
          throw new Error(
            "STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe",
          );
        }
        if (!webhookSecret) {
          throw new Error(
            "STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe",
          );
        }
        providerInstance = new StripeAdapter({ secretKey, webhookSecret });
        break;
      }
      case "pagarme": {
        const secretKey = env.PAGARME_SECRET_KEY;
        const webhookSecret = env.PAGARME_WEBHOOK_SECRET;
        if (!secretKey) {
          throw new Error(
            "PAGARME_SECRET_KEY is required when PAYMENT_PROVIDER=pagarme",
          );
        }
        if (!webhookSecret) {
          throw new Error(
            "PAGARME_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=pagarme",
          );
        }
        providerInstance = new PagarmeAdapter({ secretKey, webhookSecret });
        break;
      }
      default:
        throw new Error(`Unknown payment provider: ${providerName}`);
    }
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
