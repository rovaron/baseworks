import { env } from "@baseworks/config";
import { createDb, billingCustomers } from "@baseworks/db";
import { getPaymentProvider } from "../provider-factory";

/**
 * Auto-create payment provider customer when a tenant is created.
 *
 * Per D-01, D-24, BILL-07: Every tenant gets a provider customer record
 * automatically when the organization (tenant) is created. This ensures
 * billing operations can reference a provider customer from day one.
 *
 * Registered as a listener on the "tenant.created" event via the
 * TypedEventBus in the module registry.
 */

interface TenantCreatedEvent {
  tenantId: string;
  name?: string;
}

/**
 * Register billing hooks on the event bus.
 *
 * @param eventBus - The TypedEventBus instance from the module registry
 */
export function registerBillingHooks(eventBus: {
  on: (event: string, handler: (data: any) => Promise<void>) => void;
}): void {
  eventBus.on("tenant.created", async (data: unknown) => {
    const { tenantId, name } = data as TenantCreatedEvent;

    try {
      // Skip customer creation if payment provider keys are not configured
      // (e.g., in test environments)
      if (!env.STRIPE_SECRET_KEY) {
        console.log(
          `[BILLING] Skipping payment provider customer creation for tenant ${tenantId} (no payment keys configured)`,
        );
        return;
      }

      const provider = getPaymentProvider();
      const db = createDb(env.DATABASE_URL);

      const customer = await provider.createCustomer({
        tenantId,
        name: name ?? `Tenant ${tenantId}`,
      });

      // Insert billing_customers record linking tenant to provider customer
      await db.insert(billingCustomers).values({
        tenantId,
        providerCustomerId: customer.providerCustomerId,
        status: "inactive",
      });

      console.log(
        `[BILLING] Created ${provider.name} customer ${customer.providerCustomerId} for tenant ${tenantId}`,
      );
    } catch (err) {
      // Log error but do not crash the tenant creation flow
      console.error(
        `[BILLING] Failed to create payment provider customer for tenant ${tenantId}:`,
        err,
      );
    }
  });
}
