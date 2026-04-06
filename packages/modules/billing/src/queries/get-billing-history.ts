import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { billingCustomers } from "../schema";
import { getStripe } from "../stripe";
import { eq } from "drizzle-orm";

const GetBillingHistoryInput = Type.Object({
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 10 })),
});

/**
 * Get billing/invoice history for the requesting tenant from Stripe.
 *
 * Per T-03-12: Uses ctx.tenantId to look up stripeCustomerId, then
 * fetches only that customer's invoices from the Stripe API.
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

      const stripe = getStripe();
      const invoiceList = await stripe.invoices.list({
        customer: customer.stripeCustomerId,
        limit: input.limit ?? 10,
      });

      const invoices = invoiceList.data.map((inv) => ({
        id: inv.id,
        amount: inv.amount_due,
        currency: inv.currency,
        status: inv.status,
        created: inv.created,
        invoiceUrl: inv.hosted_invoice_url,
        pdfUrl: inv.invoice_pdf,
      }));

      return ok({ invoices });
    } catch (error: any) {
      return err(error.message || "Failed to fetch billing history");
    }
  },
);
