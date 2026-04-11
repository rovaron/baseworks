import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getStripe } from "../stripe";
import { eq } from "drizzle-orm";

const CreateCheckoutSessionInput = Type.Object({
  priceId: Type.String(),
  successUrl: Type.String(),
  cancelUrl: Type.String(),
});

/**
 * Create a Stripe Checkout session for subscription.
 *
 * Per D-04: Redirects tenant to Stripe-hosted payment page.
 * Per D-09: Uses crypto.randomUUID() as idempotency key.
 * Per T-03-10: Scoped to ctx.tenantId.
 */
export const createCheckoutSession = defineCommand(
  CreateCheckoutSessionInput,
  async (input, ctx) => {
    try {
      const [customer] = await ctx.db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.tenantId, ctx.tenantId))
        .limit(1);

      if (!customer) {
        return err("BILLING_NOT_CONFIGURED");
      }

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create(
        {
          customer: customer.providerCustomerId,
          mode: "subscription",
          line_items: [{ price: input.priceId, quantity: 1 }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        {
          idempotencyKey: crypto.randomUUID(),
        },
      );

      return ok({ sessionId: session.id, url: session.url });
    } catch (error: any) {
      return err(error.message || "Failed to create checkout session");
    }
  },
);
