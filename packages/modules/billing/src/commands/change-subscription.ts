import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";

const ChangeSubscriptionInput = Type.Object({
  newPriceId: Type.String(),
});

/**
 * Change the current tenant's subscription to a different plan.
 *
 * Looks up the tenant's active subscription, then delegates the
 * plan change to the configured PaymentProvider adapter. Proration
 * behavior is determined by the provider.
 *
 * @param input - Change parameters: newPriceId (target plan)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<{ subscriptionId, newPriceId }> -- confirms
 *   the updated subscription and target price
 *
 * Per T-03-10: Scoped to ctx.tenantId.
 */
export const changeSubscription = defineCommand(
  ChangeSubscriptionInput,
  async (input, ctx) => {
    try {
      // Phase 20.1 Plan 02 — Option A: scopedDb.select(table) auto-injects
      // the tenantId predicate.
      const [customer] = await ctx.db.select(billingCustomers).limit(1);

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
