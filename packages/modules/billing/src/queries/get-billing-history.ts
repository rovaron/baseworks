import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";
import { eq } from "drizzle-orm";

const GetBillingHistoryInput = Type.Object({
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 10 })),
});

/**
 * Get billing/invoice history for the requesting tenant.
 *
 * Per T-03-12: Uses ctx.tenantId to look up providerCustomerId, then
 * fetches only that customer's invoices from the payment provider API.
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
