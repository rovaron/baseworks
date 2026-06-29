// packages/modules/notifications/src/jobs/prune-webhook-deliveries.ts
import { env } from "@baseworks/config";
import { getDb, notificationWebhookDelivery } from "@baseworks/db";
import { lt } from "drizzle-orm";
import pino from "pino";

const logger = pino({ name: "notifications-webhook-prune" });

export interface PruneDeps {
  // biome-ignore lint/suspicious/noExplicitAny: owner Drizzle client (worker maintenance)
  db: () => any;
  retentionDays: number;
  now: () => number;
}

const defaultDeps: PruneDeps = {
  db: () => getDb(env.DATABASE_URL),
  retentionDays: env.WEBHOOK_DELIVERY_RETENTION_DAYS,
  now: () => Date.now(),
};

/**
 * Daily maintenance: delete notification_webhook_delivery rows older than the
 * retention window. Owner db (cross-tenant maintenance — bypasses RLS by design).
 */
export async function pruneWebhookDeliveries(
  _payload: unknown,
  deps: Partial<PruneDeps> = {},
): Promise<void> {
  const db = (deps.db ?? defaultDeps.db)();
  const retentionDays = deps.retentionDays ?? defaultDeps.retentionDays;
  const now = deps.now ?? defaultDeps.now;

  const cutoff = new Date(now() - retentionDays * 24 * 60 * 60 * 1000);
  await db
    .delete(notificationWebhookDelivery)
    .where(lt(notificationWebhookDelivery.createdAt, cutoff));
  logger.info({ cutoff: cutoff.toISOString(), retentionDays }, "pruned webhook delivery rows");
}
