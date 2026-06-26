// packages/modules/notifications/src/commands/mark-read.ts
import { notification } from "@baseworks/db";
import { defineCommand, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";

export const markRead = defineCommand(Type.Object({ id: Type.String() }), async (input, ctx) => {
  await requireWithTenant(ctx)((tx) =>
    tx
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(eq(notification.id, input.id), eq(notification.recipientUserId, ctx.userId as string)),
      ),
  );
  return ok({ id: input.id });
});
