import { eq, and, sql } from "drizzle-orm";
import { createDb } from "@baseworks/db";
import { env } from "@baseworks/config";
import { usageRecords, billingCustomers } from "../schema";
import { getStripe } from "../stripe";
import pino from "pino";

const logger = pino({ name: "billing:sync-usage" });

/**
 * Sync unsynced usage records to Stripe.
 *
 * Per D-07: Scheduled BullMQ repeatable job (every 5 minutes default).
 * Queries all usage_records WHERE syncedToStripe = false, grouped by
 * tenantId and metric. For each group, looks up the Stripe subscription
 * and reports metered usage via subscriptionItems.createUsageRecord.
 *
 * Per D-09: Uses idempotency keys for Stripe API calls.
 * Per T-03-16: Processes all tenants (not tenant-scoped -- this is a system job).
 */
export async function syncUsage(_data: unknown): Promise<void> {
  const db = createDb(env.DATABASE_URL);

  // Query unsynced records grouped by tenantId and metric
  const unsyncedGroups = await db
    .select({
      tenantId: usageRecords.tenantId,
      metric: usageRecords.metric,
      totalQuantity: sql<number>`sum(${usageRecords.quantity})::int`,
    })
    .from(usageRecords)
    .where(eq(usageRecords.syncedToStripe, false))
    .groupBy(usageRecords.tenantId, usageRecords.metric);

  if (unsyncedGroups.length === 0) {
    logger.debug("No unsynced usage records found");
    return;
  }

  logger.info({ groupCount: unsyncedGroups.length }, "Syncing usage records to Stripe");

  const stripe = getStripe();

  for (const group of unsyncedGroups) {
    try {
      // Look up billing customer for this tenant
      const [customer] = await db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.tenantId, group.tenantId))
        .limit(1);

      if (!customer?.stripeSubscriptionId) {
        logger.warn(
          { tenantId: group.tenantId, metric: group.metric },
          "No active subscription found, skipping usage sync",
        );
        continue;
      }

      // Retrieve subscription to get the subscription item ID
      const subscription = await stripe.subscriptions.retrieve(
        customer.stripeSubscriptionId,
      );

      if (!subscription.items.data.length) {
        logger.warn(
          { tenantId: group.tenantId, subscriptionId: customer.stripeSubscriptionId },
          "Subscription has no items, skipping usage sync",
        );
        continue;
      }

      const subscriptionItemId = subscription.items.data[0].id;

      // Report usage to Stripe with idempotency key (D-09)
      const idempotencyKey = `usage-sync-${group.tenantId}-${group.metric}-${Date.now()}`;
      const usageRecord = await stripe.subscriptionItems.createUsageRecord(
        subscriptionItemId,
        {
          quantity: group.totalQuantity,
          timestamp: Math.floor(Date.now() / 1000),
          action: "increment",
        },
        {
          idempotencyKey,
        },
      );

      // Mark all matching records as synced
      await db
        .update(usageRecords)
        .set({
          syncedToStripe: true,
          stripeUsageRecordId: usageRecord.id,
        })
        .where(
          and(
            eq(usageRecords.tenantId, group.tenantId),
            eq(usageRecords.metric, group.metric),
            eq(usageRecords.syncedToStripe, false),
          ),
        );

      logger.info(
        {
          tenantId: group.tenantId,
          metric: group.metric,
          quantity: group.totalQuantity,
          stripeUsageRecordId: usageRecord.id,
        },
        "Usage synced to Stripe",
      );
    } catch (error: any) {
      logger.error(
        {
          tenantId: group.tenantId,
          metric: group.metric,
          error: error.message,
        },
        "Failed to sync usage to Stripe",
      );
      // Continue with next group -- don't fail the entire job
    }
  }
}
