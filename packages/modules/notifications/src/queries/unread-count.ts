// packages/modules/notifications/src/queries/unread-count.ts
import { notification } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, count, eq, isNull } from "drizzle-orm";

export const unreadCount = defineQuery(Type.Object({}), async (_input, ctx) => {
  const [r] = (await requireWithTenant(ctx)((tx) =>
    tx
      .select({ count: count() })
      .from(notification)
      .where(
        and(eq(notification.recipientUserId, ctx.userId as string), isNull(notification.readAt)),
      ),
  )) as Array<{ count: number }>;
  return ok({ unread: r?.count ?? 0 });
});
