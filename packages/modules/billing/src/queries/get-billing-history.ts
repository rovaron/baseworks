import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";
import { eq } from "drizzle-orm";

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
export const getBillingHistory = defineQuery(
  GetBillingHistoryInput,
  async (input, ctx) => {
    try {
      const [customer] = await ctx.db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.tenantId, ctx.tenantId))
        .limit(1);

      if (!customer) {
        return ok({ invoices: [] });
      }

      const provider = getPaymentProvider();
      const invoices = await provider.getInvoices(
        customer.providerCustomerId,
        input.limit ?? 10,
      );

      return ok({ invoices });
    } catch (error: any) {
      return err(error.message || "Failed to fetch billing history");
    }
  },
);
