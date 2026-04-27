import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";

const CreateCheckoutSessionInput = Type.Object({
  priceId: Type.String(),
  successUrl: Type.String(),
  cancelUrl: Type.String(),
});

/**
 * Create a checkout session for subscription signup.
 *
 * Looks up the tenant's billing customer record, then delegates
 * to the configured PaymentProvider adapter to generate a
 * provider-hosted checkout page URL.
 *
 * @param input - Checkout parameters: priceId, successUrl,
 *   cancelUrl
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<{ sessionId, url }> -- redirect URL for the
 *   provider-hosted checkout page
 *
 * Per D-04: Redirects tenant to provider-hosted payment page.
 * Per T-03-10: Scoped to ctx.tenantId.
 */
export const createCheckoutSession = defineCommand(
  CreateCheckoutSessionInput,
  async (input, ctx) => {
    try {
      // Phase 20.1 Plan 02 — Option A: scopedDb.select(table) auto-injects
      // the tenantId predicate.
      const [customer] = await ctx.db.select(billingCustomers).limit(1);

      if (!customer) {
        return err("BILLING_NOT_CONFIGURED");
      }

      const provider = getPaymentProvider();
      const session = await provider.createCheckoutSession({
        providerCustomerId: customer.providerCustomerId,
        priceId: input.priceId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      });

      return ok({ sessionId: session.sessionId, url: session.url });
    } catch (error: unknown) {
      // Phase 20.1 WR-02 — narrow `unknown` so non-Error throws fall back
      // to the generic message instead of TypeError on `.message`.
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create checkout session";
      return err(message || "Failed to create checkout session");
    }
  },
);
