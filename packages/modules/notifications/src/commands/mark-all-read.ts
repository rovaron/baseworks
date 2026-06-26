// packages/modules/notifications/src/commands/mark-all-read.ts
import { notification } from "@baseworks/db";
import { defineCommand, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq, isNull } from "drizzle-orm";

export const markAllRead = defineCommand(Type.Object({}), async (_input, ctx) => {
  await requireWithTenant(ctx)((tx) =>
    tx
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(eq(notification.recipientUserId, ctx.userId as string), isNull(notification.readAt)),
      ),
  );
  return ok({});
});
