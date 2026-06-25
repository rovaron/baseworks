// packages/db/src/__tests__/notifications-rls.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getDb, getRlsDb } from "../connection";
import { withTenant } from "../helpers/with-tenant";
import { notification } from "../schema/notifications";

const A = "notif-tenant-A";
const B = "notif-tenant-B";
let ok = false;

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) {
    ok = false;
    return;
  }
  try {
    await getRlsDb().execute(sql`select 1`);
    await getDb()
      .insert(notification)
      .values([
        {
          tenantId: A,
          recipientUserId: "u1",
          type: "t",
          category: "c",
          severity: "info",
          title: "a",
          body: "a",
        } as any,
        {
          tenantId: B,
          recipientUserId: "u2",
          type: "t",
          category: "c",
          severity: "info",
          title: "b",
          body: "b",
        } as any,
      ]);
    ok = true;
  } catch {
    ok = false;
  }
});

afterAll(async () => {
  if (ok) await getDb().delete(notification).where(sql`tenant_id in (${A}, ${B})`);
});

describe("notification RLS isolation", () => {
  test("RLS role sees only the active tenant's rows", async () => {
    if (!ok) return console.warn("SKIPPED: Postgres/RLS unavailable");
    const rows = await withTenant(getRlsDb(), A, (tx) =>
      tx.execute(sql`select tenant_id from notification`),
    );
    const tenants = new Set(
      (rows as unknown as Array<{ tenant_id: string }>).map((r) => r.tenant_id),
    );
    expect(tenants.has(A)).toBe(true);
    expect(tenants.has(B)).toBe(false);
  });

  test("RLS role cannot INSERT for another tenant (WITH CHECK)", async () => {
    if (!ok) return console.warn("SKIPPED");
    let threw = false;
    try {
      await withTenant(getRlsDb(), A, (tx) =>
        tx.execute(
          sql`insert into notification (tenant_id, recipient_user_id, type, category, severity, title, body) values (${B}, 'x', 't', 'c', 'info', 'evil', 'evil')`,
        ),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
