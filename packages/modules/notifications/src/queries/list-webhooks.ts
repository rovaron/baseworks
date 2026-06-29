// packages/modules/notifications/src/queries/list-webhooks.ts
import { notificationWebhook } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { desc, eq } from "drizzle-orm";
import { serializeWebhook } from "../lib/webhook-endpoint";

const Input = Type.Object({});

/** List the tenant's webhook endpoints (secret omitted), newest first. */
export const listWebhooks = defineQuery(Input, async (_input, ctx) => {
  const rows = (await requireWithTenant(ctx)((tx) =>
    tx
      .select()
      .from(notificationWebhook)
      .where(eq(notificationWebhook.tenantId, ctx.tenantId))
      .orderBy(desc(notificationWebhook.createdAt)),
  )) as (typeof notificationWebhook.$inferSelect)[];
  return ok(rows.map(serializeWebhook));
});
