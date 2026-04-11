import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";
import { eq } from "drizzle-orm";

const ChangeSubscriptionInput = Type.Object({
  newPriceId: Type.String(),
});

/**
 * Change a tenant's subscription to a different price/plan.
 *
 * Per T-03-10: Scoped to ctx.tenantId.
 */
export const changeSubscription = defineCommand(
  ChangeSubscriptionInput,
  async (input, ctx) => {
    try {
      const [customer] = await ctx.db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.tenantId, ctx.tenantId))
        .limit(1);

      if (!customer?.providerSubscriptionId) {
        return err("NO_ACTIVE_SUBSCRIPTION");
      }

      const provider = getPaymentProvider();
      await provider.changeSubscription({
        providerSubscriptionId: customer.providerSubscriptionId,
        newPriceId: input.newPriceId,
      });

      return ok({ subscriptionId: customer.providerSubscriptionId, newPriceId: input.newPriceId });
    } catch (error: any) {
      return err(error.message || "Failed to change subscription");
    }
  },
);
