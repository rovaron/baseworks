// packages/modules/notifications/src/__integration__/notify-webhook.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  getDb,
  notification,
  notificationWebhook,
  notificationWebhookDelivery,
} from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { notify } from "../commands/notify";
import { makeCtx } from "./_ctx";

const T = "notif-webhook-it-tenant";
let ok = false;

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) return;
  try {
    await getDb().execute(sql`select 1`);
    // Seed one active endpoint subscribed to the "system" category.
    await getDb()
      .insert(notificationWebhook)
      // biome-ignore lint/suspicious/noExplicitAny: minimal seed insert
      .values({
        tenantId: T,
        url: "https://hook.example/x",
        secret: "s",
        categories: ["system"],
        status: "active",
      } as any);
    ok = true;
  } catch {
    ok = false;
  }
});
afterAll(async () => {
  if (!ok) return;
  await getDb()
    .delete(notificationWebhookDelivery)
    .where(eq(notificationWebhookDelivery.tenantId, T));
  await getDb().delete(notificationWebhook).where(eq(notificationWebhook.tenantId, T));
  await getDb().delete(notification).where(eq(notification.tenantId, T));
});

describe("notify() webhook dispatch", () => {
  test("creates one pending webhook delivery per matching endpoint, once per event", async () => {
    if (!ok) return console.warn("SKIPPED");
    // Two recipients → 2 notification rows, but webhooks fire ONCE per event.
    const res = await notify(
      { type: "system.test", recipients: { userIds: ["u1", "u2"] }, data: { message: "hi" } },
      makeCtx(T, "u1"),
    );
    expect(res.success).toBe(true);

    const deliveries = await getDb()
      .select()
      .from(notificationWebhookDelivery)
      .where(eq(notificationWebhookDelivery.tenantId, T));
    expect(deliveries).toHaveLength(1); // once per event, not per recipient
    expect(deliveries[0].status).toBe("pending");
    expect(deliveries[0].eventType).toBe("system.test");
    expect((deliveries[0].payload as { recipientUserIds: string[] }).recipientUserIds).toEqual([
      "u1",
      "u2",
    ]);
  }, 30_000);
});
