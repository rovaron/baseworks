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
  // Emit dates as ISO strings and narrow `severity` so the inferred type matches the
  // over-the-wire shape the HTTP client receives.
  return ok(
    rows.map(({ severity, readAt, createdAt, updatedAt, ...rest }) => ({
      ...rest,
      severity: severity as "info" | "success" | "warning" | "error",
      readAt: readAt ? readAt.toISOString() : null,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    })),
  );
});
