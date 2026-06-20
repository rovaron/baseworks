import { env } from "@baseworks/config";
import { billingCustomers, getDb } from "@baseworks/db";
import { eq } from "drizzle-orm";
import { getPaymentProvider } from "../provider-factory";

/**
 * Payload for the billing-provision-customer job.
 */
export interface ProvisionCustomerJob {
  tenantId: string;
  name?: string;
}

/**
 * Idempotently provision a payment-provider customer for a tenant.
 *
 * Runs in the BullMQ worker (billing-tenant-created-customer-no-retry /
 * eventbus-fire-and-forget-no-durability). The `tenant.created` hook enqueues
 * this job instead of calling the provider inline, so provider/network failures
 * get BullMQ's retry + exponential backoff, and a terminal failure is captured
 * to the ErrorTracker by the worker's `failed` handler (apps/api/src/worker.ts)
 * — instead of being lost in a fire-and-forget event listener.
 *
 * Idempotent: short-circuits when a billing_customers row already exists for the
 * tenant, so a retried or re-delivered job never creates a duplicate provider
 * customer.
 *
 * @param data - ProvisionCustomerJob payload ({ tenantId, name? }).
 */
export async function provisionCustomer(data: unknown): Promise<void> {
  const { tenantId, name } = data as ProvisionCustomerJob;

  // Defensive: a stale job in an environment with no provider configured is a
  // no-op rather than a crash (mirrors the hook's pre-enqueue guard).
  const providerName = env.PAYMENT_PROVIDER ?? "stripe";
  const hasProviderKey =
    (providerName === "stripe" && !!env.STRIPE_SECRET_KEY) ||
    (providerName === "pagarme" && !!env.PAGARME_SECRET_KEY);
  if (!hasProviderKey) return;

  const db = getDb(env.DATABASE_URL);

  // Idempotency: an existing row means this tenant is already provisioned.
  const existing = await db
    .select({ tenantId: billingCustomers.tenantId })
    .from(billingCustomers)
    .where(eq(billingCustomers.tenantId, tenantId))
    .limit(1);
  if (existing.length > 0) return;

  const provider = getPaymentProvider();
  const customer = await provider.createCustomer({
    tenantId,
    name: name ?? `Tenant ${tenantId}`,
  });

  await db.insert(billingCustomers).values({
    tenantId,
    providerCustomerId: customer.providerCustomerId,
    status: "inactive",
  });
}
