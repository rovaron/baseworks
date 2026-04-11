import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";
import { eq } from "drizzle-orm";

const CreatePortalSessionInput = Type.Object({
  returnUrl: Type.String(),
});

/**
 * Create a billing portal session for self-service billing management.
 *
 * Per D-08: Tenant can access provider's billing portal.
 * Per T-03-10: Scoped to ctx.tenantId.
 *
 * Returns null/error if the active provider doesn't support hosted portals.
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

      const provider = getPaymentProvider();
      const session = await provider.createPortalSession({
        providerCustomerId: customer.providerCustomerId,
        returnUrl: input.returnUrl,
      });

      if (!session) {
        return err("PORTAL_NOT_SUPPORTED");
      }

      return ok({ url: session.url });
    } catch (error: any) {
      return err(error.message || "Failed to create portal session");
    }
  },
);
