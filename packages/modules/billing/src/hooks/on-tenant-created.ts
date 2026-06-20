import { env } from "@baseworks/config";
import { getErrorTracker } from "@baseworks/observability";
import { createQueue } from "@baseworks/queue";
import type { Queue } from "bullmq";
import { provisionCustomer } from "../jobs/provision-customer";

/**
 * Auto-create a payment-provider customer when a tenant is created.
 *
 * Per D-01, D-24, BILL-07: every tenant gets a provider customer record so
 * billing operations can reference one from day one.
 *
 * Durability (billing-tenant-created-customer-no-retry /
 * eventbus-fire-and-forget-no-durability): the listener only ENQUEUES the
 * `billing-provision-customer` job (cheap, non-failing). The worker performs the
 * provider call with BullMQ retry + backoff + dead-letter, so a transient
 * Stripe/Pagar.me failure no longer leaves the tenant permanently un-billable.
 *
 * Registered as a listener on `tenant.created` via the TypedEventBus.
 */

interface TenantCreatedEvent {
  tenantId: string;
  name?: string;
}

/**
 * Lazy-initialized BullMQ queue for billing-provision-customer. Only created
 * when REDIS_URL is set; in dev/test without Redis the hook provisions inline
 * as a best-effort fallback (mirrors getEmailQueue / getFollowupQueue).
 */
let provisionQueue: Queue | null = null;
function getProvisionQueue(): Queue | null {
  if (!provisionQueue && env.REDIS_URL) {
    provisionQueue = createQueue("billing-provision-customer", env.REDIS_URL);
  }
  return provisionQueue;
}

/**
 * Register billing hooks on the event bus.
 *
 * @param eventBus - The TypedEventBus instance from the module registry.
 */
export function registerBillingHooks(eventBus: {
  on: (event: string, handler: (data: any) => Promise<void>) => void;
}): void {
  eventBus.on("tenant.created", async (data: unknown) => {
    const { tenantId, name } = data as TenantCreatedEvent;

    // Skip when the active provider's keys are not configured (e.g. tests).
    const providerName = env.PAYMENT_PROVIDER ?? "stripe";
    const hasProviderKey =
      (providerName === "stripe" && !!env.STRIPE_SECRET_KEY) ||
      (providerName === "pagarme" && !!env.PAGARME_SECRET_KEY);
    if (!hasProviderKey) {
      // biome-ignore lint/suspicious/noConsole: graceful no-provider fallback
      console.log(
        `[BILLING] Skipping provision for tenant ${tenantId} (no payment keys configured)`,
      );
      return;
    }

    try {
      const queue = getProvisionQueue();
      if (!queue) {
        // Dev/no-Redis fallback: provision inline (best-effort, no retry).
        await provisionCustomer({ tenantId, name });
        return;
      }
      // jobId keyed on tenantId so duplicate tenant.created deliveries dedupe.
      await queue.add(
        "billing-provision-customer",
        { tenantId, name },
        { jobId: `provision:${tenantId}` },
      );
    } catch (err) {
      // Enqueue/inline-fallback failure must NOT crash the tenant-creation flow
      // (emit is fire-and-forget); report it so it stays observable/alertable.
      getErrorTracker().captureException(err, {
        tenantId,
        tags: { module: "billing", hook: "tenant.created" },
      });
    }
  });
}
