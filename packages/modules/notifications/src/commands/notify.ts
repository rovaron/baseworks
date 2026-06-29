// packages/modules/notifications/src/commands/notify.ts
import { notification, notificationDelivery } from "@baseworks/db";
import { defineCommand, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import { getCatalogEntry } from "../catalog";
import type { Channel } from "../channels/channel";
import { getAdapter, registeredChannels } from "../channels/registry";
import { getDeliverQueue } from "../lib/deliver-queue";
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
  // Channel deliveries handed off to the `notifications-deliver` worker (every
  // effective channel except in-app, which is delivered inline below). Enqueued
  // AFTER the tenant tx commits so the worker can read the persisted rows.
  const channelJobs: Array<{ deliveryId: string; channel: Channel }> = [];
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

        if (channel === "in-app") {
          // In-app stays inline (fast, in-process publish over Redis pub/sub).
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
        } else {
          // All other channels (email this phase, webhook in Phase 4) are
          // delivered asynchronously by the worker. The row stays "pending"
          // until the worker records the final status.
          channelJobs.push({ deliveryId: delivery.id, channel });
        }
      }
    });
  }

  // Hand off async channel deliveries to the `notifications-deliver` worker. The
  // queue name + `{ kind: "channel-delivery", ... }` payload is the contract.
  const queue = getDeliverQueue();
  if (channelJobs.length > 0 && queue) {
    await Promise.all(
      channelJobs.map((job) =>
        queue.add("channel-delivery", {
          kind: "channel-delivery",
          deliveryId: job.deliveryId,
          channel: job.channel,
        }),
      ),
    );
  }

  ctx.emit("notification.created", { tenantId: ctx.tenantId, count: createdIds.length });
  return ok({ created: createdIds.length, ids: createdIds });
});
