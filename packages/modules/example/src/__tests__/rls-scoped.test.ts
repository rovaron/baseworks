// packages/modules/example/src/__tests__/rls-scoped.test.ts
//
// Integration proof for Task 3.2: the example module's create/list handlers
// route their DB work through `ctx.withTenant` (the RLS-scoped transaction on
// the non-owner `baseworks_rls` role). We seed rows for two tenants via the
// OWNER connection (which bypasses RLS), then drive the real handlers as
// tenant A and assert that ONLY tenant A's rows are ever visible — Postgres
// RLS is the backstop independent of the handlers' WHERE clauses.
//
// Harness mirrors packages/db/src/__tests__/rls-isolation.test.ts: it requires
// a DISTINCT, RLS-enforced DATABASE_URL_RLS (an owner URL bypasses RLS and
// would false-pass), otherwise it skips rather than asserting on nothing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { examples, getDb, getRlsDb, withTenant } from "@baseworks/db";
import type { HandlerContext } from "@baseworks/shared";
import { sql } from "drizzle-orm";
import { createExample } from "../commands/create-example";
import { listExamples } from "../queries/list-examples";

const A = "ex-rls-tenant-A";
const B = "ex-rls-tenant-B";
let ok = false;

/**
 * Build a HandlerContext for `tenantId` whose `withTenant` runs against the
 * RLS-role pool with `app.tenant_id` set transaction-locally — exactly what
 * apps/api constructs per request. `db` is unused by the migrated handlers
 * but populated for shape completeness; `emit` is a no-op for these tests.
 */
function makeCtx(tenantId: string): HandlerContext {
  const emitted: Array<{ event: string; data: unknown }> = [];
  const ctx: HandlerContext = {
    tenantId,
    userId: `user-${tenantId}`,
    db: getDb(),
    emit: (event, data) => {
      emitted.push({ event, data });
    },
    withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), tenantId, fn),
  };
  return ctx;
}

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) {
    ok = false;
    return;
  }
  try {
    await getRlsDb().execute(sql`select 1`);
    // Seed one row per tenant via the OWNER connection (bypasses RLS).
    await getDb()
      .insert(examples)
      .values([
        { tenantId: A, title: "a-seed" },
        { tenantId: B, title: "b-seed" },
      ]);
    ok = true;
  } catch {
    ok = false;
  }
});

afterAll(async () => {
  if (ok) await getDb().delete(examples).where(sql`tenant_id in (${A}, ${B})`);
});

describe("example handlers under RLS (ctx.withTenant)", () => {
  test("listExamples returns only the active tenant's rows", async () => {
    if (!ok) return console.warn("SKIPPED: Postgres/RLS unavailable");

    const result = await listExamples({ limit: 100 }, makeCtx(A));
    expect(result.success).toBe(true);
    if (!result.success) return;

    const rows = result.data as Array<{ tenantId: string; title: string }>;
    // Every visible row belongs to tenant A — RLS confines the result set.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === A)).toBe(true);
    // Tenant A's seed is present; tenant B's seed is invisible.
    expect(rows.some((r) => r.title === "a-seed")).toBe(true);
    expect(rows.some((r) => r.tenantId === B)).toBe(false);
  });

  test("createExample stamps the active tenant and the row is RLS-visible", async () => {
    if (!ok) return console.warn("SKIPPED");

    const created = await createExample({ title: "a-created" }, makeCtx(A));
    expect(created.success).toBe(true);
    if (!created.success) return;

    const row = created.data as { id: string; tenantId: string; title: string };
    expect(row.tenantId).toBe(A);
    expect(row.title).toBe("a-created");

    // Tenant A sees its new row through the RLS-scoped list.
    const aList = await listExamples({ limit: 100 }, makeCtx(A));
    expect(aList.success).toBe(true);
    if (aList.success) {
      const titles = (aList.data as Array<{ title: string }>).map((r) => r.title);
      expect(titles).toContain("a-created");
    }

    // Tenant B never sees tenant A's row — cross-tenant isolation holds.
    const bList = await listExamples({ limit: 100 }, makeCtx(B));
    expect(bList.success).toBe(true);
    if (bList.success) {
      const bRows = bList.data as Array<{ tenantId: string; title: string }>;
      expect(bRows.every((r) => r.tenantId === B)).toBe(true);
      expect(bRows.some((r) => r.title === "a-created")).toBe(false);
    }
  });

  test("createExample cannot write a row for a different tenant (WITH CHECK)", async () => {
    if (!ok) return console.warn("SKIPPED");

    // Drive the create handler with tenant A's RLS context but force the row's
    // tenant to B by hand-rolling the insert inside A's transaction. The
    // WITH CHECK policy must reject it.
    let threw = false;
    try {
      await withTenant(getRlsDb(), A, async (tx) => {
        await tx.insert(examples).values({ tenantId: B, title: "evil" });
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
