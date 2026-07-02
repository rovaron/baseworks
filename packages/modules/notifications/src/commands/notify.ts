// packages/modules/notifications/src/commands/notify.ts
import {
  notification,
  notificationDelivery,
  notificationPreference,
  notificationWebhook,
  notificationWebhookDelivery,
} from "@baseworks/db";
import { defineCommand, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq, inArray } from "drizzle-orm";
import { getCatalogEntry } from "../catalog";
import { getCategory } from "../categories";
import type { Channel } from "../channels/channel";
import { getAdapter, registeredChannels } from "../channels/registry";
import { getDeliverQueue } from "../lib/deliver-queue";
import { mutedUserSet } from "../lib/preferences";
import { resolveRecipients } from "../lib/recipients";
import { buildWebhookDeliveries } from "../lib/webhook-dispatch";
import { getWebhookQueue } from "../lib/webhook-queue";

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

  // Email preference gate. Bypassed entirely for `required` types or for
  // categories that are not `mutable` (always-on, e.g. security). An unregistered
  // category resolves to undefined → treated as non-mutable → delivered (safe:
  // never silently drop). Otherwise fetch this category's email opt-outs for the
  // resolved recipients, once, before the per-recipient loop.
  const emailBypass = entry.required === true || getCategory(entry.category)?.mutable !== true;
  let mutedEmail = new Set<string>();
  if (!emailBypass && channels.includes("email") && recipients.size > 0) {
    const optOut = await requireWithTenant(ctx)((tx) =>
      tx
        .select({
          userId: notificationPreference.userId,
          enabled: notificationPreference.enabled,
        })
        .from(notificationPreference)
        .where(
          and(
            eq(notificationPreference.category, entry.category),
            eq(notificationPreference.channel, "email"),
            eq(notificationPreference.enabled, false),
            inArray(notificationPreference.userId, [...recipients]),
          ),
        ),
    );
    mutedEmail = mutedUserSet(optOut as Array<{ userId: string; enabled: boolean }>);
  }

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
        if (channel === "email" && mutedEmail.has(recipientUserId)) continue;
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

  // Webhook fan-out — ONCE per event (not per recipient). Eligible endpoints are
  // this tenant's active endpoints subscribed to the notification's category,
  // unless the catalog entry opts out via `webhookable: false`.
  // Only persist+dispatch when a queue exists — without REDIS_URL the worker can
  // never run, so writing "pending" rows would orphan them forever.
  const webhookQueue = entry.webhookable !== false ? getWebhookQueue() : null;
  if (webhookQueue) {
    const deliveryIds = await requireWithTenant(ctx)(async (tx) => {
      const endpoints = await tx
        .select()
        .from(notificationWebhook)
        .where(
          and(
            eq(notificationWebhook.tenantId, ctx.tenantId),
            eq(notificationWebhook.status, "active"),
          ),
        );
      const rows = buildWebhookDeliveries(endpoints, {
        tenantId: ctx.tenantId,
        eventType: input.type,
        category: entry.category,
        recipientUserIds: [...recipients],
        data: input.data ?? null,
        occurredAt: new Date().toISOString(),
      });
      const ids: string[] = [];
      for (const values of rows) {
        // biome-ignore lint/suspicious/noExplicitAny: insert values are validated by buildWebhookDeliveries
        const [row] = await tx
          .insert(notificationWebhookDelivery)
          .values(values as any)
          .returning();
        ids.push(row.id);
      }
      return ids;
    });

    if (deliveryIds.length > 0) {
      await Promise.all(
        deliveryIds.map((deliveryId) =>
          webhookQueue.add("webhook-event", { kind: "webhook-event", deliveryId }),
        ),
      );
    }
  }

  ctx.emit("notification.created", { tenantId: ctx.tenantId, count: createdIds.length });
  return ok({ created: createdIds.length, ids: createdIds });
});
