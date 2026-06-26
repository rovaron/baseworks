// packages/modules/notifications/src/__integration__/notify.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notification, notificationDelivery } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { InAppAdapter } from "../channels/in-app";
import { registerAdapter } from "../channels/registry";
import { notify } from "../commands/notify";
import { makeCtx } from "./_ctx";

const T = "notif-it-tenant";
let ok = false;
const published: Array<[string, string]> = [];

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) return;
  try {
    await getDb().execute(sql`select 1`);
    registerAdapter(new InAppAdapter({ publish: (c, m) => published.push([c, m]) }));
    ok = true;
  } catch {
    ok = false;
  }
});
afterAll(async () => {
  if (ok) await getDb().delete(notification).where(eq(notification.tenantId, T));
});

describe("notify() in-app", () => {
  test("creates a notification + in-app delivery and publishes", async () => {
    if (!ok) return console.warn("SKIPPED");
    const res = await notify(
      { type: "system.test", recipients: { userIds: ["u1"] }, data: { message: "hi" } },
      makeCtx(T, "u1"),
    );
    expect(res.success).toBe(true);
    const rows = await getDb().select().from(notification).where(eq(notification.tenantId, T));
    expect(rows.length).toBe(1);
    expect(rows[0].body).toContain("hi");
    const deliveries = await getDb()
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.notificationId, rows[0].id));
    expect(deliveries.find((d) => d.channel === "in-app")?.status).toBe("sent");
    expect(published.some(([ch]) => ch === `notif:${T}:u1`)).toBe(true);
  }, 30_000);
});
