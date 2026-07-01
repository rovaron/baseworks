// packages/modules/notifications/src/queries/list-webhook-deliveries.ts
import { notificationWebhookDelivery } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, desc, eq } from "drizzle-orm";

const Input = Type.Object({
  webhookId: Type.String(),
  status: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

/** Paginated delivery history for one of the tenant's endpoints, newest first. */
export const listWebhookDeliveries = defineQuery(Input, async (input, ctx) => {
  const rows = (await requireWithTenant(ctx)((tx) =>
    tx
      .select()
      .from(notificationWebhookDelivery)
      .where(
        and(
          eq(notificationWebhookDelivery.tenantId, ctx.tenantId),
          eq(notificationWebhookDelivery.webhookId, input.webhookId),
          input.status ? eq(notificationWebhookDelivery.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(notificationWebhookDelivery.createdAt))
      .limit(input.limit ?? 20)
      .offset(input.offset ?? 0),
  )) as (typeof notificationWebhookDelivery.$inferSelect)[];
  // Emit dates as ISO strings so the inferred type matches the over-the-wire shape.
  return ok(
    rows.map(({ deliveredAt, createdAt, updatedAt, ...rest }) => ({
      ...rest,
      deliveredAt: deliveredAt ? deliveredAt.toISOString() : null,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    })),
  );
});
