// packages/modules/notifications/src/commands/rotate-webhook-secret.ts
import { notificationWebhook } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { generateWebhookSecret } from "../lib/webhook-endpoint";

const Input = Type.Object({ id: Type.String() });

/** Issue a new signing secret for an endpoint and return it once. */
export const rotateWebhookSecret = defineCommand(Input, async (input, ctx) => {
  const secret = generateWebhookSecret();
  const updated = (await requireWithTenant(ctx)((tx) =>
    tx
      .update(notificationWebhook)
      .set({ secret })
      .where(
        and(eq(notificationWebhook.id, input.id), eq(notificationWebhook.tenantId, ctx.tenantId)),
      )
      .returning(),
  )) as (typeof notificationWebhook.$inferSelect)[];
  if (updated.length === 0) return err("WEBHOOK_NOT_FOUND");
  return ok({ id: input.id, secret });
});
