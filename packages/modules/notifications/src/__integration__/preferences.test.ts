// packages/modules/notifications/src/__integration__/preferences.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notificationPreference } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
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
});
afterAll(async () => {
  if (live)
    await getDb().delete(notificationPreference).where(eq(notificationPreference.tenantId, T));
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
