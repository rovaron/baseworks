import { env } from "@baseworks/config";
import { billingCustomers, getDb } from "@baseworks/db";
import { getErrorTracker } from "@baseworks/observability";
import { eq } from "drizzle-orm";
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
 * Attaches a `tenant.created` listener that auto-provisions a
 * payment provider customer record for new tenants.
 *
 * @param eventBus - The TypedEventBus instance from the module
 *   registry
 * @returns void
 */
export function registerBillingHooks(eventBus: {
  on: (event: string, handler: (data: any) => Promise<void>) => void;
}): void {
  eventBus.on("tenant.created", async (data: unknown) => {
    const { tenantId, name } = data as TenantCreatedEvent;

    // Skip customer creation if the active provider's keys are not configured
    // (e.g., in test environments). Must check the active provider's key,
    // not just STRIPE_SECRET_KEY -- see CR-03.
    const providerName = env.PAYMENT_PROVIDER ?? "stripe";
    const hasProviderKey =
      (providerName === "stripe" && !!env.STRIPE_SECRET_KEY) ||
      (providerName === "pagarme" && !!env.PAGARME_SECRET_KEY);

    if (!hasProviderKey) {
      console.log(
        `[BILLING] Skipping payment provider customer creation for tenant ${tenantId} (no payment keys configured)`,
      );
      return;
    }

    const db = getDb(env.DATABASE_URL);

    try {
      // Idempotency: short-circuit if a billing_customers row already exists
      // for this tenant. Guards against duplicate provider customers when the
      // tenant.created event is re-delivered or this hook is retried.
      const existing = await db
        .select({ tenantId: billingCustomers.tenantId })
        .from(billingCustomers)
        .where(eq(billingCustomers.tenantId, tenantId))
        .limit(1);

      if (existing.length > 0) {
        console.log(
          `[BILLING] billing_customers row already exists for tenant ${tenantId}; skipping provider customer creation`,
        );
        return;
      }

      const provider = getPaymentProvider();

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
      // Report to the error tracker rather than swallowing the failure into a
      // single console line. Rethrow so the TypedEventBus error-isolation layer
      // logs it too -- this keeps the failure observable/alertable without
      // crashing the tenant-creation flow (emit is fire-and-forget). A durable
      // retry + dead-letter enqueue is a later stage.
      getErrorTracker().captureException(err, {
        tenantId,
        tags: { module: "billing", hook: "tenant.created" },
      });
      throw err;
    }
  });
}
