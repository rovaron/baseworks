// packages/modules/notifications/src/commands/redeliver-webhook.ts
import { notificationWebhookDelivery } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { getWebhookQueue } from "../lib/webhook-queue";

const Input = Type.Object({ deliveryId: Type.String() });

/**
 * Re-send a past delivery. Clones the source delivery's stored payload into a
 * NEW pending row (preserving the original audit row) and enqueues it.
 */
export const redeliverWebhook = defineCommand(Input, async (input, ctx) => {
  const queue = getWebhookQueue();
  if (!queue) return err("QUEUE_UNAVAILABLE");

  const newId = await requireWithTenant(ctx)(async (tx) => {
    const [src] = (await tx
      .select()
      .from(notificationWebhookDelivery)
      .where(
        and(
          eq(notificationWebhookDelivery.id, input.deliveryId),
          eq(notificationWebhookDelivery.tenantId, ctx.tenantId),
        ),
      )
      .limit(1)) as (typeof notificationWebhookDelivery.$inferSelect)[];
    if (!src) return null;

    const [clone] = (await tx
      .insert(notificationWebhookDelivery)
      .values({
        tenantId: ctx.tenantId,
        webhookId: src.webhookId,
        eventType: src.eventType,
        category: src.category,
        payload: src.payload,
        status: "pending",
        // biome-ignore lint/suspicious/noExplicitAny: insert shape narrowed by schema
      } as any)
      .returning()) as (typeof notificationWebhookDelivery.$inferSelect)[];
    return clone.id;
  });

  if (!newId) return err("DELIVERY_NOT_FOUND");
  await queue.add("webhook-event", { kind: "webhook-event", deliveryId: newId });
  return ok({ deliveryId: newId });
});
