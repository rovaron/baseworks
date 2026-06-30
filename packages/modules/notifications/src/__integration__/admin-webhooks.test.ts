// packages/modules/notifications/src/__integration__/admin-webhooks.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { env } from "@baseworks/config";
import { getDb, notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  adminForceDisableWebhook,
  adminListAllWebhooks,
  adminListWebhookDeliveries,
  adminReenableWebhook,
} from "../commands/admin-webhooks";

const TA = "admin-wh-it-tenant-a";
const TB = "admin-wh-it-tenant-b";
const db = () => getDb(env.DATABASE_URL);
let ready = false;
let idA = "";
let idB = "";

beforeAll(async () => {
  if (!env.DATABASE_URL) return;
  try {
    await db().execute(sql`select 1`);
    const [a] = await db()
      .insert(notificationWebhook)
      // biome-ignore lint/suspicious/noExplicitAny: seed
      .values({
        tenantId: TA,
        url: "https://a.example.com/hook",
        secret: "s",
        categories: ["system"],
        status: "active",
      } as any)
      .returning();
    const [b] = await db()
      .insert(notificationWebhook)
      // biome-ignore lint/suspicious/noExplicitAny: seed
      .values({
        tenantId: TB,
        url: "https://b.example.com/hook",
        secret: "s",
        categories: ["billing"],
        status: "disabled",
      } as any)
      .returning();
    idA = a.id;
    idB = b.id;
    await db()
      .insert(notificationWebhookDelivery)
      // biome-ignore lint/suspicious/noExplicitAny: seed
      .values({
        tenantId: TA,
        webhookId: a.id,
        eventType: "system.test",
        category: "system",
        payload: { event: "system.test" },
        status: "failed",
      } as any);
    ready = true;
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  if (!ready) return;
  await db()
    .delete(notificationWebhookDelivery)
    .where(inArray(notificationWebhookDelivery.tenantId, [TA, TB]));
  await db()
    .delete(notificationWebhook)
    .where(inArray(notificationWebhook.tenantId, [TA, TB]));
});

describe("admin webhook oversight", () => {
  test("lists webhooks across tenants", async () => {
    if (!ready) return console.warn("SKIPPED");
    const res = await adminListAllWebhooks({ limit: 100, offset: 0 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    const ids = res.data.data.map((r) => r.id);
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
  }, 30000);

  test("filters by status", async () => {
    if (!ready) return console.warn("SKIPPED");
    const res = await adminListAllWebhooks({ status: "disabled", limit: 100, offset: 0 });
    if (!res.success) return;
    const ids = res.data.data.map((r) => r.id);
    expect(ids).toContain(idB);
    expect(ids).not.toContain(idA);
  }, 30000);

  test("lists a webhook's deliveries cross-tenant", async () => {
    if (!ready) return console.warn("SKIPPED");
    const res = await adminListWebhookDeliveries(idA, { limit: 100, offset: 0 });
    if (!res.success) return;
    expect(res.data.data.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  test("force-disable locks status to admin_disabled + records reason", async () => {
    if (!ready) return console.warn("SKIPPED");
    const res = await adminForceDisableWebhook(idA, "spam");
    expect(res.success).toBe(true);
    const [row] = await db()
      .select()
      .from(notificationWebhook)
      .where(eq(notificationWebhook.id, idA));
    expect(row.status).toBe("admin_disabled");
    expect(row.disabledReason).toContain("platform admin");
  }, 30000);

  test("admin re-enable lifts the lock + resets failures/reason", async () => {
    if (!ready) return console.warn("SKIPPED");
    // idA is admin_disabled from the previous test.
    const res = await adminReenableWebhook(idA);
    expect(res.success).toBe(true);
    const [row] = await db()
      .select()
      .from(notificationWebhook)
      .where(eq(notificationWebhook.id, idA));
    expect(row.status).toBe("active");
    expect(row.consecutiveFailures).toBe("0");
    expect(row.disabledReason).toBeNull();
  }, 30000);

  test("force-disable of an unknown id returns an error", async () => {
    if (!ready) return console.warn("SKIPPED");
    const res = await adminForceDisableWebhook("00000000-0000-0000-0000-000000000000", "x");
    expect(res.success).toBe(false);
  }, 30000);
});
