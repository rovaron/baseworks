import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getStripe } from "../stripe";
import { eq } from "drizzle-orm";

const CreatePortalSessionInput = Type.Object({
  returnUrl: Type.String(),
});

/**
 * Create a Stripe Customer Portal session for self-service billing management.
 *
 * Per D-08: Tenant can access Stripe Customer Portal.
 * Per T-03-10: Scoped to ctx.tenantId.
 */
export const createPortalSession = defineCommand(
  CreatePortalSessionInput,
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
      const session = await stripe.billingPortal.sessions.create({
        customer: customer.providerCustomerId,
        return_url: input.returnUrl,
      });

      return ok({ url: session.url });
    } catch (error: any) {
      return err(error.message || "Failed to create portal session");
    }
  },
);
