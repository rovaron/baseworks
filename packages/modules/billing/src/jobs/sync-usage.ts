import { eq, and, sql } from "drizzle-orm";
import { createDb } from "@baseworks/db";
import { env } from "@baseworks/config";
import { usageRecords, billingCustomers } from "../schema";
import { getPaymentProvider } from "../provider-factory";
import pino from "pino";

const logger = pino({ name: "billing-sync-usage" });

/**
 * Synchronize recorded usage events to the payment provider.
 *
 * Scheduled BullMQ repeatable job (every 5 minutes default).
 * Queries all usage_records where syncedToProvider = false,
 * grouped by tenantId and metric. For each group, reports
 * metered usage via the provider's reportUsage() method.
 *
 * @param _data - Job data (unused -- job is self-contained)
 * @returns void
 *
 * Per D-07: Write-then-sync pattern for reliability.
 * Per T-03-16: Processes all tenants (system-level job).
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
    .where(eq(usageRecords.syncedToProvider, false))
    .groupBy(usageRecords.tenantId, usageRecords.metric);

  if (unsyncedGroups.length === 0) {
    logger.debug("No unsynced usage records found");
    return;
  }

  logger.info({ groupCount: unsyncedGroups.length }, "Syncing usage records to payment provider");

  const provider = getPaymentProvider();

  if (!provider.reportUsage) {
    logger.warn("Current payment provider does not support usage reporting");
    return;
  }

  for (const group of unsyncedGroups) {
    try {
      // Look up billing customer for this tenant
      const [customer] = await db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.tenantId, group.tenantId))
        .limit(1);

      if (!customer?.providerSubscriptionId) {
        logger.warn(
          { tenantId: group.tenantId, metric: group.metric },
          "No active subscription found, skipping usage sync",
        );
        continue;
      }

      const result = await provider.reportUsage({
        providerSubscriptionId: customer.providerSubscriptionId,
        quantity: group.totalQuantity,
        timestamp: Math.floor(Date.now() / 1000),
      });

      // Mark all matching records as synced
      await db
        .update(usageRecords)
        .set({
          syncedToProvider: true,
          providerUsageRecordId: result.providerUsageRecordId,
        })
        .where(
          and(
            eq(usageRecords.tenantId, group.tenantId),
            eq(usageRecords.metric, group.metric),
            eq(usageRecords.syncedToProvider, false),
          ),
        );

      logger.info(
        {
          tenantId: group.tenantId,
          metric: group.metric,
          quantity: group.totalQuantity,
          providerUsageRecordId: result.providerUsageRecordId,
        },
        "Usage synced to payment provider",
      );
    } catch (error: any) {
      logger.error(
        {
          tenantId: group.tenantId,
          metric: group.metric,
          error: error.message,
        },
        "Failed to sync usage to payment provider",
      );
      // Continue with next group -- don't fail the entire job
    }
  }
}
