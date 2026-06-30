// packages/modules/notifications/src/commands/delete-webhook.ts
import { notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";

const Input = Type.Object({ id: Type.String() });

/**
 * Delete an endpoint and cascade its delivery audit rows. An endpoint a platform
 * admin has force-disabled (`admin_disabled`) is locked — a tenant cannot delete
 * it (which would also erase the abuse audit trail and let them recreate it).
 */
export const deleteWebhook = defineCommand(Input, async (input, ctx) => {
  const where = and(
    eq(notificationWebhook.id, input.id),
    eq(notificationWebhook.tenantId, ctx.tenantId),
  );
  const result = await requireWithTenant(ctx)(async (tx) => {
    const [current] = (await tx
      .select({ status: notificationWebhook.status })
      .from(notificationWebhook)
      .where(where)
      .limit(1)) as { status: string }[];
    if (!current) return { kind: "not_found" as const };
    if (current.status === "admin_disabled") return { kind: "locked" as const };
    await tx.delete(notificationWebhook).where(where);
    await tx
      .delete(notificationWebhookDelivery)
      .where(eq(notificationWebhookDelivery.webhookId, input.id));
    return { kind: "ok" as const };
  });
  if (result.kind === "not_found") return err("WEBHOOK_NOT_FOUND");
  if (result.kind === "locked") return err("WEBHOOK_ADMIN_LOCKED");
  return ok({ id: input.id });
});
