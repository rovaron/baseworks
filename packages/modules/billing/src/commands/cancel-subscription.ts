import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";
import { eq } from "drizzle-orm";

const CancelSubscriptionInput = Type.Object({});

/**
 * Cancel the active subscription for the current tenant.
 *
 * Delegates cancellation to the configured PaymentProvider adapter
 * with `cancelAtPeriodEnd: true` so the tenant retains access
 * until the current billing cycle ends.
 *
 * @param input - Empty object (no additional input required)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<{ cancelledAt, currentPeriodEnd }> -- confirms
 *   cancellation timing and remaining access period
 *
 * Per D-05: Uses cancel_at_period_end to avoid immediate
 *   cancellation.
 * Per T-03-10: Scoped to ctx.tenantId.
 */
export const cancelSubscription = defineCommand(
  CancelSubscriptionInput,
  async (_input, ctx) => {
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
      await provider.cancelSubscription({
        providerSubscriptionId: customer.providerSubscriptionId,
        cancelAtPeriodEnd: true,
      });

      return ok({
        cancelledAt: "period_end" as const,
        currentPeriodEnd: customer.currentPeriodEnd,
      });
    } catch (error: any) {
      return err(error.message || "Failed to cancel subscription");
    }
  },
);
