// packages/modules/notifications/src/__integration__/deliver-webhook.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { deliverWebhook, WEBHOOK_AUTO_DISABLE_THRESHOLD } from "../jobs/deliver-webhook";

// Verifies the ATOMIC consecutiveFailures increment + auto-disable against a
// real Postgres (the unit tests can only see SQL-expression objects, not the
// computed values). Owner db path — no RLS scoping needed.

const T = "wh-deliver-it-tenant";
let ok = false;

const failingPost = async () => ({ status: 500 });
const publicLookup = async () => [{ address: "93.184.216.34" }];

async function seed(
  consecutiveFailures: string,
): Promise<{ deliveryId: string; webhookId: string }> {
  const [ep] = await getDb()
    .insert(notificationWebhook)
    // biome-ignore lint/suspicious/noExplicitAny: minimal seed insert
    .values({
      tenantId: T,
      url: "https://hook.example/x",
      secret: "s",
      categories: ["system"],
      status: "active",
      consecutiveFailures,
    } as any)
    .returning();
  const [del] = await getDb()
    .insert(notificationWebhookDelivery)
    // biome-ignore lint/suspicious/noExplicitAny: minimal seed insert
    .values({
      tenantId: T,
      webhookId: ep.id,
      eventType: "system.test",
      category: "system",
      payload: { event: "system.test" },
      status: "pending",
      attempts: "2", // next attempt is #3 === WEBHOOK_MAX_ATTEMPTS (final)
    } as any)
    .returning();
  return { deliveryId: del.id, webhookId: ep.id };
}

beforeAll(async () => {
  try {
    await getDb().execute(sql`select 1`);
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

describe("deliverWebhook — atomic failure accounting (live DB)", () => {
  // Note: `expect(promise).rejects.toThrow()` hangs under `bun test` when the
  // promise performs live postgres.js I/O, so we assert the throw via try/catch.
  async function runFailingDelivery(deliveryId: string): Promise<boolean> {
    try {
      await deliverWebhook(
        { kind: "webhook-event", deliveryId },
        { db: () => getDb(), httpPost: failingPost, lookup: publicLookup },
      );
      return false;
    } catch {
      return true;
    }
  }

  test("final-attempt failure increments consecutiveFailures by exactly 1", async () => {
    if (!ok) return console.warn("SKIPPED");
    const { deliveryId, webhookId } = await seed("0");

    expect(await runFailingDelivery(deliveryId)).toBe(true);

    const [ep] = await getDb()
      .select()
      .from(notificationWebhook)
      .where(eq(notificationWebhook.id, webhookId));
    expect(ep.consecutiveFailures).toBe("1");
    expect(ep.status).toBe("active");
    expect(ep.lastStatus).toBe("failed");
  }, 30_000);

  test("crossing the threshold auto-disables the endpoint", async () => {
    if (!ok) return console.warn("SKIPPED");
    const { deliveryId, webhookId } = await seed(String(WEBHOOK_AUTO_DISABLE_THRESHOLD - 1));

    expect(await runFailingDelivery(deliveryId)).toBe(true);

    const [ep] = await getDb()
      .select()
      .from(notificationWebhook)
      .where(eq(notificationWebhook.id, webhookId));
    expect(ep.consecutiveFailures).toBe(String(WEBHOOK_AUTO_DISABLE_THRESHOLD));
    expect(ep.status).toBe("auto_disabled");
    expect(ep.disabledReason).toContain("consecutive failures");
  }, 30_000);
});
