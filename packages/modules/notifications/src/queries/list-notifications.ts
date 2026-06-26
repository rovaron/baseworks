// packages/modules/notifications/src/queries/list-notifications.ts
import { notification } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, desc, eq, isNull } from "drizzle-orm";

const Input = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  unreadOnly: Type.Optional(Type.Boolean()),
});

export const listNotifications = defineQuery(Input, async (input, ctx) => {
  const rows = (await requireWithTenant(ctx)((tx) =>
    tx
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.recipientUserId, ctx.userId as string),
          input.unreadOnly ? isNull(notification.readAt) : undefined,
        ),
      )
      .orderBy(desc(notification.createdAt))
      .limit(input.limit ?? 20)
      .offset(input.offset ?? 0),
  )) as (typeof notification.$inferSelect)[];
  return ok(rows);
});
