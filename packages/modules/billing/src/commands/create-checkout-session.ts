import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";
import { eq } from "drizzle-orm";

const CreateCheckoutSessionInput = Type.Object({
  priceId: Type.String(),
  successUrl: Type.String(),
  cancelUrl: Type.String(),
});

/**
 * Create a checkout session for subscription.
 *
 * Per D-04: Redirects tenant to provider-hosted payment page.
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

      const provider = getPaymentProvider();
      const session = await provider.createCheckoutSession({
        providerCustomerId: customer.providerCustomerId,
        priceId: input.priceId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      });

      return ok({ sessionId: session.sessionId, url: session.url });
    } catch (error: any) {
      return err(error.message || "Failed to create checkout session");
    }
  },
);
