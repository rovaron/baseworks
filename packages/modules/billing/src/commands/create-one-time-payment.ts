import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";

const CreateOneTimePaymentInput = Type.Object({
  priceId: Type.String(),
  quantity: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  successUrl: Type.String(),
  cancelUrl: Type.String(),
});

/**
 * Create a one-time payment checkout session.
 *
 * Generates a provider-hosted checkout page for a single charge
 * (not a subscription). Used for add-ons or one-off purchases.
 *
 * @param input - Payment parameters: priceId, quantity (default 1),
 *   successUrl, cancelUrl
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<{ sessionId, url }> -- redirect URL for the
 *   provider-hosted payment page
 *
 * Per D-06: Uses payment mode for one-off charges.
 * Per T-03-10: Scoped to ctx.tenantId.
 */
export const createOneTimePayment = defineCommand(
  CreateOneTimePaymentInput,
  async (input, ctx) => {
    try {
      // Phase 20.1 Plan 02 — Option A: scopedDb.select(table) auto-injects
      // the tenantId predicate.
      const [customer] = await ctx.db.select(billingCustomers).limit(1);

      if (!customer) {
        return err("BILLING_NOT_CONFIGURED");
      }

      const provider = getPaymentProvider();
      const session = await provider.createOneTimePayment({
        providerCustomerId: customer.providerCustomerId,
        priceId: input.priceId,
        quantity: input.quantity ?? 1,
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
          : "Failed to create payment session";
      return err(message || "Failed to create payment session");
    }
  },
);
