import { defineQuery, err, ok } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { getPaymentProvider } from "../provider-factory";
import { billingCustomers } from "../schema";

const GetBillingHistoryInput = Type.Object({
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 10 })),
});

/**
 * Retrieve billing history (invoices) for the requesting tenant.
 *
 * Looks up the tenant's provider customer ID, then fetches
 * invoice records from the payment provider API. Returns an
 * empty array when no billing customer exists.
 *
 * @param input - Query parameters: limit (1-100, default 10)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<{ invoices: ProviderInvoice[] }> -- list of
 *   invoice records from the payment provider
 *
 * Per T-03-12: Uses ctx.tenantId to look up providerCustomerId,
 *   then fetches only that customer's invoices.
 */
export const getBillingHistory = defineQuery(GetBillingHistoryInput, async (input, ctx) => {
  try {
    // Phase 20.1 Plan 02 — Option A: scopedDb.select(table) auto-injects
    // the tenantId predicate.
    const [customer] = await ctx.db.select(billingCustomers).limit(1);

    if (!customer) {
      return ok({ invoices: [] });
    }

    const provider = getPaymentProvider();
    const invoices = await provider.getInvoices(customer.providerCustomerId, input.limit ?? 10);

    return ok({ invoices });
  } catch (error: unknown) {
    // Phase 20.1 WR-02 — narrow `unknown` so non-Error throws fall back
    // to the generic message instead of TypeError on `.message`.
    const message = error instanceof Error ? error.message : "Failed to fetch billing history";
    return err(message || "Failed to fetch billing history");
  }
});
