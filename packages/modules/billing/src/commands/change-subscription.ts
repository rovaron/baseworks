import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getStripe } from "../stripe";
import { eq } from "drizzle-orm";

const ChangeSubscriptionInput = Type.Object({
  newPriceId: Type.String(),
});

/**
 * Change a tenant's subscription to a different price/plan.
 *
 * Per D-05: Uses subscriptions.update to swap subscription items.
 * Per D-09: Uses crypto.randomUUID() as idempotency key.
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

      if (!customer?.stripeSubscriptionId) {
        return err("NO_ACTIVE_SUBSCRIPTION");
      }

      const stripe = getStripe();
      const subscriptionId = customer.stripeSubscriptionId;

      // Retrieve current subscription to get item ID
      const sub = await stripe.subscriptions.retrieve(subscriptionId);

      await stripe.subscriptions.update(
        subscriptionId,
        {
          items: [{ id: sub.items.data[0].id, price: input.newPriceId }],
        },
        { idempotencyKey: crypto.randomUUID() },
      );

      return ok({ subscriptionId, newPriceId: input.newPriceId });
    } catch (error: any) {
      return err(error.message || "Failed to change subscription");
    }
  },
);
