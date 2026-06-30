// packages/modules/notifications/src/commands/admin-webhooks.ts
import { env } from "@baseworks/config";
import {
  getDb,
  notificationWebhook,
  notificationWebhookDelivery,
  organization,
} from "@baseworks/db";
import { err, ok } from "@baseworks/shared";
import { and, count, desc, eq, like, or, type SQL } from "drizzle-orm";

/** Escape LIKE meta-characters to prevent search injection. */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export interface AdminWebhookRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  url: string;
  categories: string[] | null;
  status: string;
  consecutiveFailures: string;
  lastStatus: string | null;
  lastDeliveryAt: Date | null;
  disabledReason: string | null;
  createdAt: Date;
}

/**
 * Cross-tenant list of every webhook endpoint for platform oversight. Owner db
 * (no RLS); authorization is enforced at the route by requirePlatformAdmin().
 * LEFT JOINs organization for the tenant name so an orphan tenantId still shows.
 */
export async function adminListAllWebhooks(opts: {
  search?: string;
  status?: string;
  limit: number;
  offset: number;
}) {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant oversight — gated by requirePlatformAdmin
  const conds: SQL[] = [];
  if (opts.status) conds.push(eq(notificationWebhook.status, opts.status));
  if (opts.search) {
    const s = `%${escapeLike(opts.search)}%`;
    const m = or(like(notificationWebhook.url, s), like(organization.name, s));
    if (m) conds.push(m);
  }
  const where = conds.length ? and(...conds) : undefined;

  const rows = (await db
    .select({
      id: notificationWebhook.id,
      tenantId: notificationWebhook.tenantId,
      tenantName: organization.name,
      url: notificationWebhook.url,
      categories: notificationWebhook.categories,
      status: notificationWebhook.status,
      consecutiveFailures: notificationWebhook.consecutiveFailures,
      lastStatus: notificationWebhook.lastStatus,
      lastDeliveryAt: notificationWebhook.lastDeliveryAt,
      disabledReason: notificationWebhook.disabledReason,
      createdAt: notificationWebhook.createdAt,
    })
    .from(notificationWebhook)
    .leftJoin(organization, eq(organization.id, notificationWebhook.tenantId))
    .where(where)
    .orderBy(desc(notificationWebhook.createdAt))
    .limit(opts.limit)
    .offset(opts.offset)) as AdminWebhookRow[];

  const [totalRow] = await db
    .select({ value: count() })
    .from(notificationWebhook)
    .leftJoin(organization, eq(organization.id, notificationWebhook.tenantId))
    .where(where);

  return ok({ data: rows, total: totalRow?.value ?? 0 });
}

/** Cross-tenant delivery history for one webhook (owner db, gated at the route). */
export async function adminListWebhookDeliveries(
  webhookId: string,
  opts: { limit: number; offset: number },
) {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant oversight — gated by requirePlatformAdmin
  const rows = await db
    .select()
    .from(notificationWebhookDelivery)
    .where(eq(notificationWebhookDelivery.webhookId, webhookId))
    .orderBy(desc(notificationWebhookDelivery.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  const [totalRow] = await db
    .select({ value: count() })
    .from(notificationWebhookDelivery)
    .where(eq(notificationWebhookDelivery.webhookId, webhookId));
  return ok({ data: rows, total: totalRow?.value ?? 0 });
}

/**
 * Force-disable a webhook (abuse response). Sets status='auto_disabled' and
 * records the operator reason. Owner db; gated at the route. Keys on the global
 * webhook id (uuid PK), so no tenant param is required.
 */
export async function adminForceDisableWebhook(webhookId: string, reason: string) {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant moderation — gated by requirePlatformAdmin
  const trimmed = (reason ?? "").trim();
  const disabledReason = trimmed
    ? `Force-disabled by platform admin: ${trimmed}`
    : "Force-disabled by platform admin";
  const updated = await db
    .update(notificationWebhook)
    .set({ status: "auto_disabled", disabledReason })
    .where(eq(notificationWebhook.id, webhookId))
    .returning({ id: notificationWebhook.id });
  if (updated.length === 0) return err("WEBHOOK_NOT_FOUND");
  return ok({ id: webhookId });
}
