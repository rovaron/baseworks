// packages/modules/notifications/src/__integration__/preferences.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notification, notificationDelivery, notificationPreference } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { type CatalogEntry, notificationCatalog } from "../catalog";
import { registerAdapter } from "../channels/registry";
import { notify } from "../commands/notify";
import { setPreferences } from "../commands/set-preferences";
import { listPreferences } from "../queries/list-preferences";
import { makeCtx } from "./_ctx";

const T = "notif-pref-tenant";
let live = false;

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) return;
  try {
    await getDb().execute(sql`select 1`);
    live = true;
  } catch {
    live = false;
  }
  if (live) {
    // Fake adapters so both channels are "registered" (no real send / publish).
    registerAdapter({ name: "in-app", deliver: async () => ({ status: "sent" as const }) });
    registerAdapter({ name: "email", deliver: async () => ({ status: "sent" as const }) });
    // Temporary catalog types: one plain billing-email type, one required billing
    // type (isolates the required-bypass path from the category-mutable path).
    const cat = notificationCatalog as Record<string, CatalogEntry>;
    cat["test.billing.email"] = {
      category: "billing",
      severity: "info",
      defaultChannels: ["in-app", "email"],
      render: () => ({ title: "t", body: "b" }),
    };
    cat["test.billing.required"] = {
      category: "billing",
      severity: "info",
      defaultChannels: ["in-app", "email"],
      required: true,
      render: () => ({ title: "t", body: "b" }),
    };
  }
});
afterAll(async () => {
  if (live) {
    await getDb().delete(notificationPreference).where(eq(notificationPreference.tenantId, T));
    await getDb().delete(notification).where(eq(notification.tenantId, T));
    const cat = notificationCatalog as Record<string, CatalogEntry>;
    delete cat["test.billing.email"];
    delete cat["test.billing.required"];
  }
});

describe("setPreferences", () => {
  test("upserts an opt-out row, then flips it back", async () => {
    if (!live) return console.warn("SKIPPED (no live DATABASE_URL_RLS)");
    const ctx = makeCtx(T, "u1");

    const r1 = await setPreferences(
      { preferences: [{ category: "billing", channel: "email", enabled: false }] },
      ctx,
    );
    expect(r1.success).toBe(true);

    let rows = await getDb()
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.tenantId, T));
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);

    // Same unique key → update, not a second row.
    await setPreferences(
      { preferences: [{ category: "billing", channel: "email", enabled: true }] },
      ctx,
    );
    rows = await getDb()
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.tenantId, T));
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
  }, 30_000);

  test("rejects unknown category", async () => {
    if (!live) return console.warn("SKIPPED");
    const r = await setPreferences(
      { preferences: [{ category: "nope", channel: "email", enabled: false }] },
      makeCtx(T, "u1"),
    );
    expect(r.success).toBe(false);
  }, 30_000);

  test("rejects muting a non-mutable (security) category", async () => {
    if (!live) return console.warn("SKIPPED");
    const r = await setPreferences(
      { preferences: [{ category: "security", channel: "email", enabled: false }] },
      makeCtx(T, "u1"),
    );
    expect(r.success).toBe(false);
  }, 30_000);
});

describe("listPreferences", () => {
  test("returns every registered category with effective email + mutable", async () => {
    if (!live) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "u-list");
    // Mute billing for this user.
    await setPreferences(
      { preferences: [{ category: "billing", channel: "email", enabled: false }] },
      ctx,
    );

    const res = await listPreferences({}, ctx);
    expect(res.success).toBe(true);
    if (!res.success) return;
    const prefs = res.data.preferences;

    // All five registered categories present.
    expect(prefs.map((p) => p.category).sort()).toEqual([
      "billing",
      "files",
      "security",
      "system",
      "team",
    ]);
    // billing muted, others default-enabled.
    expect(prefs.find((p) => p.category === "billing")?.email).toBe(false);
    expect(prefs.find((p) => p.category === "system")?.email).toBe(true);
    // security is locked.
    expect(prefs.find((p) => p.category === "security")?.mutable).toBe(false);
    expect(prefs.find((p) => p.category === "billing")?.mutable).toBe(true);
    // labels come through.
    expect(prefs.find((p) => p.category === "security")?.label).toBe("Security");
  }, 30_000);
});

async function emailDeliveries(tenantId: string, notificationId: string) {
  return getDb()
    .select()
    .from(notificationDelivery)
    .where(eq(notificationDelivery.notificationId, notificationId));
}

describe("notify() email gating", () => {
  test("muted category → in-app row created but NO email delivery row", async () => {
    if (!live) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "gate-1");
    await setPreferences(
      { preferences: [{ category: "billing", channel: "email", enabled: false }] },
      ctx,
    );

    const res = await notify(
      { type: "test.billing.email", recipients: { userIds: ["gate-1"] } },
      ctx,
    );
    expect(res.success).toBe(true);
    if (!res.success) return;

    const rows = await getDb().select().from(notification).where(eq(notification.tenantId, T));
    const mine = rows.filter((r) => r.recipientUserId === "gate-1");
    expect(mine).toHaveLength(1); // in-app row still created
    const deliveries = await emailDeliveries(T, mine[0].id);
    expect(deliveries.some((d) => d.channel === "email")).toBe(false); // no email row
    expect(deliveries.some((d) => d.channel === "in-app")).toBe(true);
  }, 30_000);

  test("required type bypasses the opt-out (email delivery row IS created)", async () => {
    if (!live) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "gate-2");
    await setPreferences(
      { preferences: [{ category: "billing", channel: "email", enabled: false }] },
      ctx,
    );

    const res = await notify(
      { type: "test.billing.required", recipients: { userIds: ["gate-2"] } },
      ctx,
    );
    expect(res.success).toBe(true);
    if (!res.success) return;

    const rows = await getDb().select().from(notification).where(eq(notification.tenantId, T));
    const mine = rows.filter((r) => r.recipientUserId === "gate-2");
    const deliveries = await emailDeliveries(T, mine[0].id);
    expect(deliveries.some((d) => d.channel === "email")).toBe(true);
  }, 30_000);

  test("no opt-out → email delivery row created", async () => {
    if (!live) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "gate-3");
    const res = await notify(
      { type: "test.billing.email", recipients: { userIds: ["gate-3"] } },
      ctx,
    );
    expect(res.success).toBe(true);
    if (!res.success) return;

    const rows = await getDb().select().from(notification).where(eq(notification.tenantId, T));
    const mine = rows.filter((r) => r.recipientUserId === "gate-3");
    const deliveries = await emailDeliveries(T, mine[0].id);
    expect(deliveries.some((d) => d.channel === "email")).toBe(true);
  }, 30_000);
});
