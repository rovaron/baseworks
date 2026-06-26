// packages/modules/notifications/src/commands/notify.ts
import { notification, notificationDelivery } from "@baseworks/db";
import { defineCommand, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import { getCatalogEntry } from "../catalog";
import { getAdapter, registeredChannels } from "../channels/registry";
import { resolveRecipients } from "../lib/recipients";

const NotifyInput = Type.Object({
  type: Type.String({ minLength: 1 }),
  recipients: Type.Object({
    userIds: Type.Optional(Type.Array(Type.String())),
    role: Type.Optional(Type.String()),
  }),
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  overrides: Type.Optional(
    Type.Object({
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      url: Type.Optional(Type.String()),
    }),
  ),
});

export const notify = defineCommand(NotifyInput, async (input, ctx) => {
  const entry = getCatalogEntry(input.type);
  const recipients = await resolveRecipients(input.recipients, ctx);
  const rendered = entry.render(input.data ?? {});
  const title = input.overrides?.title ?? rendered.title;
  const body = input.overrides?.body ?? rendered.body;
  const url = input.overrides?.url ?? rendered.url ?? null;
  const actions = rendered.actions ?? null;

  // Channels we will actually deliver this phase = catalog defaults ∩ registered adapters.
  const channels = entry.defaultChannels.filter((c) => registeredChannels().includes(c));

  const createdIds: string[] = [];
  for (const recipientUserId of recipients) {
    await requireWithTenant(ctx)(async (tx) => {
      const [row] = await tx
        .insert(notification)
        .values({
          tenantId: ctx.tenantId,
          recipientUserId,
          type: input.type,
          category: entry.category,
          severity: entry.severity,
          title,
          body,
          url,
          data: input.data ?? null,
          actions,
        } as any)
        .returning();
      createdIds.push(row.id);

      for (const channel of channels) {
        const [delivery] = await tx
          .insert(notificationDelivery)
          .values({
            tenantId: ctx.tenantId,
            notificationId: row.id,
            channel,
            status: "pending",
          } as any)
          .returning();
        const adapter = getAdapter(channel);
        const result = adapter
          ? await adapter.deliver(
              {
                id: row.id,
                tenantId: ctx.tenantId,
                recipientUserId,
                type: input.type,
                category: entry.category,
                severity: entry.severity,
                title,
                body,
                url,
                data: input.data ?? null,
                actions,
              },
              delivery.id,
            )
          : ({ status: "skipped", reason: "no adapter" } as const);
        await tx
          .update(notificationDelivery)
          .set({ status: result.status, error: result.status === "failed" ? result.error : null })
          .where(eq(notificationDelivery.id, delivery.id));
      }
    });
  }

  ctx.emit("notification.created", { tenantId: ctx.tenantId, count: createdIds.length });
  return ok({ created: createdIds.length, ids: createdIds });
});
