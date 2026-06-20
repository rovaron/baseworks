import { defineQuery, ok } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { billingCustomers } from "../schema";

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
    // Phase 20.1 Plan 02 — Option A: scopedDb.select(table) auto-injects the
    // `WHERE tenantId = ctx.tenantId` predicate. Calling `.select()` with no
    // argument used to crash inside Drizzle's `getTableColumns(undefined)`.
    const [record] = await ctx.db.select(billingCustomers).limit(1);

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
