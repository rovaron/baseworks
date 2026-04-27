import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";

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
      // Phase 20.1 Plan 02 — Option A: scopedDb.select(table) auto-injects
      // the tenantId predicate.
      const [customer] = await ctx.db.select(billingCustomers).limit(1);

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
    } catch (error: unknown) {
      // Phase 20.1 WR-02 — narrow `unknown` so non-Error throws (e.g., a
      // thrown string or a provider error whose `.message` is undefined)
      // fall back to the generic message instead of producing
      // `undefined` / a property-access TypeError.
      const message =
        error instanceof Error ? error.message : "Failed to cancel subscription";
      return err(message || "Failed to cancel subscription");
    }
  },
);
