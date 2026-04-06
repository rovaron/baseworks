import { env } from "@baseworks/config";
import { createDb, billingCustomers } from "@baseworks/db";
import { getStripe } from "../stripe";

/**
 * Auto-create Stripe customer when a tenant is created.
 *
 * Per D-01, D-24, BILL-07: Every tenant gets a Stripe customer record
 * automatically when the organization (tenant) is created. This ensures
 * billing operations can reference a Stripe customer from day one.
 *
 * Per D-09: Uses crypto.randomUUID() as idempotency key on the Stripe
 * API call to prevent duplicate customer creation on retries.
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
      // Skip Stripe customer creation if STRIPE_SECRET_KEY is not configured
      // (e.g., in test environments)
      if (!env.STRIPE_SECRET_KEY) {
        console.log(
          `[BILLING] Skipping Stripe customer creation for tenant ${tenantId} (no STRIPE_SECRET_KEY)`,
        );
        return;
      }

      const stripe = getStripe();
      const db = createDb(env.DATABASE_URL);

      // Create Stripe customer with idempotency key (D-09)
      const idempotencyKey = crypto.randomUUID();
      const customer = await stripe.customers.create(
        {
          metadata: {
            tenantId,
          },
          name: name ?? `Tenant ${tenantId}`,
        },
        {
          idempotencyKey,
        },
      );

      // Insert billing_customers record linking tenant to Stripe customer
      await db.insert(billingCustomers).values({
        tenantId,
        stripeCustomerId: customer.id,
        status: "inactive",
      });

      console.log(
        `[BILLING] Created Stripe customer ${customer.id} for tenant ${tenantId}`,
      );
    } catch (err) {
      // Log error but do not crash the tenant creation flow
      console.error(
        `[BILLING] Failed to create Stripe customer for tenant ${tenantId}:`,
        err,
      );
    }
  });
}
