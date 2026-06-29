// packages/modules/notifications/src/__integration__/webhook-deliveries.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { redeliverWebhook } from "../commands/redeliver-webhook";
import { listWebhookDeliveries } from "../queries/list-webhook-deliveries";
import { makeCtx } from "./_ctx";

const T = "wh-deliveries-it-tenant";
let ok = false;
let webhookId = "";
let deliveryId = "";

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) return;
  try {
    await getDb().execute(sql`select 1`);
    const [ep] = await getDb()
      .insert(notificationWebhook)
      // biome-ignore lint/suspicious/noExplicitAny: seed
      .values({
        tenantId: T,
        url: "https://example.com/h",
        secret: "s",
        categories: ["system"],
        status: "active",
      } as any)
      .returning();
    webhookId = ep.id;
    const [del] = await getDb()
      .insert(notificationWebhookDelivery)
      // biome-ignore lint/suspicious/noExplicitAny: seed
      .values({
        tenantId: T,
        webhookId: ep.id,
        eventType: "system.test",
        category: "system",
        payload: { event: "system.test" },
        status: "failed",
      } as any)
      .returning();
    deliveryId = del.id;
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
});

describe("webhook deliveries", () => {
  test("lists deliveries for an endpoint", async () => {
    if (!ok) return console.warn("SKIPPED");
    const res = await listWebhookDeliveries({ webhookId }, makeCtx(T, "u1"));
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.length).toBeGreaterThanOrEqual(1);
    expect(res.data[0].webhookId).toBe(webhookId);
  }, 30_000);

  test("redeliver clones the payload into a new pending row", async () => {
    if (!ok) return console.warn("SKIPPED");
    const res = await redeliverWebhook({ deliveryId }, makeCtx(T, "u1"));
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.deliveryId).not.toBe(deliveryId);
    const [clone] = await getDb()
      .select()
      .from(notificationWebhookDelivery)
      .where(eq(notificationWebhookDelivery.id, res.data.deliveryId));
    expect(clone.status).toBe("pending");
    expect(clone.webhookId).toBe(webhookId);
  }, 30_000);
});
