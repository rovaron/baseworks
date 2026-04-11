import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getStripe } from "../stripe";
import { eq } from "drizzle-orm";

const CreateOneTimePaymentInput = Type.Object({
  priceId: Type.String(),
  quantity: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  successUrl: Type.String(),
  cancelUrl: Type.String(),
});

/**
 * Create a Stripe Checkout session for one-time payment.
 *
 * Per D-06: Uses Checkout in payment mode for one-off charges.
 * Per D-09: Uses crypto.randomUUID() as idempotency key.
 * Per T-03-10: Scoped to ctx.tenantId.
 */
export const createOneTimePayment = defineCommand(
  CreateOneTimePaymentInput,
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
          mode: "payment",
          line_items: [{ price: input.priceId, quantity: input.quantity ?? 1 }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        {
          idempotencyKey: crypto.randomUUID(),
        },
      );

      return ok({ sessionId: session.id, url: session.url });
    } catch (error: any) {
      return err(error.message || "Failed to create payment session");
    }
  },
);
