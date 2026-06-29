// packages/modules/notifications/src/commands/delete-webhook.ts
import { notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";

const Input = Type.Object({ id: Type.String() });

/** Delete an endpoint and cascade its delivery audit rows. */
export const deleteWebhook = defineCommand(Input, async (input, ctx) => {
  const deleted = await requireWithTenant(ctx)(async (tx) => {
    const rows = (await tx
      .delete(notificationWebhook)
      .where(
        and(eq(notificationWebhook.id, input.id), eq(notificationWebhook.tenantId, ctx.tenantId)),
      )
      .returning()) as (typeof notificationWebhook.$inferSelect)[];
    if (rows.length > 0) {
      await tx
        .delete(notificationWebhookDelivery)
        .where(eq(notificationWebhookDelivery.webhookId, input.id));
    }
    return rows;
  });
  if (deleted.length === 0) return err("WEBHOOK_NOT_FOUND");
  return ok({ id: input.id });
});
