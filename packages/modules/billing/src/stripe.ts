import Stripe from "stripe";
import { env } from "@baseworks/config";

/**
 * Lazy-initialized Stripe client singleton.
 *
 * Per D-09: Uses lazy initialization so the billing module can load
 * in test environments without Stripe keys configured.
 *
 * Does NOT pin apiVersion -- lets the SDK use its bundled default for v17.
 */
let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is required for billing module");
    }
    stripeInstance = new Stripe(env.STRIPE_SECRET_KEY, {
      typescript: true,
    });
  }
  return stripeInstance;
}
