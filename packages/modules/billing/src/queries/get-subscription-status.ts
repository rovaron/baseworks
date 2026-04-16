import { Type } from "@sinclair/typebox";
import { defineQuery, ok } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { eq } from "drizzle-orm";

const GetSubscriptionStatusInput = Type.Object({});

/**
 * Retrieve the current subscription status for the requesting
 * tenant.
 *
 * Looks up the tenant's billing customer record and returns plan
 * details, subscription status, and billing period. Returns an
 * "inactive" status with null fields when no billing record exists.
 *
 * @param input - Empty object (no additional input required)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<{ status, providerSubscriptionId,
 *   providerPriceId, currentPeriodEnd, hasSubscription }>
 *
 * Per T-03-12: Uses ctx.tenantId to scope the query -- returns
 *   only the requesting tenant's billing information.
 */
export const getSubscriptionStatus = defineQuery(
  GetSubscriptionStatusInput,
  async (_input, ctx) => {
    const [record] = await ctx.db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.tenantId, ctx.tenantId))
      .limit(1);

    if (!record) {
      return ok({
        status: "inactive" as const,
        hasSubscription: false,
        providerSubscriptionId: null,
        providerPriceId: null,
        currentPeriodEnd: null,
      });
    }

    return ok({
      status: record.status,
      providerSubscriptionId: record.providerSubscriptionId,
      providerPriceId: record.providerPriceId,
      currentPeriodEnd: record.currentPeriodEnd,
      hasSubscription: !!record.providerSubscriptionId,
    });
  },
);
