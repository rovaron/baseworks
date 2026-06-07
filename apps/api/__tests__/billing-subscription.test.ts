/**
 * Phase 20.1 Plan 02 — RED regression test for SC#2.
 *
 * Covers the production TypeError observed in v1.3 milestone UAT:
 * `GET /api/billing/subscription` returned 500
 * (`undefined is not an object (evaluating 'table[Table.Symbol.Columns]')`)
 * for any tenant without a `billing_customers` row.
 *
 * Empirical root cause (post-D-05 probe — see 20.1-02-PLAN.md `<revision_log>`):
 * the 7 ctx.db handlers call `ctx.db.select()` with no argument. `ctx.db` is
 * `scopedDb(rawDb, tenantId)`, whose `select(table)` REQUIRES the table arg
 * (it auto-injects `WHERE tenantId = scopedDb.tenantId`). The no-arg call
 * passes `undefined` to Drizzle's `from()`, which then dies inside
 * `getTableColumns(undefined)`.
 *
 * This test mounts the real `billingRoutes` plugin against a probe Elysia
 * app whose `handlerCtx.db` is a real `scopedDb(realDb, testTenantId)` —
 * i.e., the production code path, not a mock. With NO billing_customers row
 * for the test tenant, the handler must return the inactive shape.
 *
 * The test SKIPS when Postgres is unreachable (mirrors the convention in
 * `packages/db/src/__tests__/scoped-db.test.ts`).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// Side-effect import: must run BEFORE any @baseworks/* barrel that reads
// process.env via @t3-oss/env-core.
import "../src/core/middleware/__tests__/_env-setup";

import { billingCustomers, createDb, scopedDb } from "@baseworks/db";
import billingModule from "@baseworks/module-billing";
import { eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";

const billingRoutes = billingModule.routes;

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

describe("GET /api/billing/subscription — no-billing-row tenant (Phase 20.1 SC#2)", () => {
  let canConnect = false;
  let db: ReturnType<typeof createDb>;
  let testTenantId: string;

  beforeAll(async () => {
    try {
      db = createDb(TEST_DB_URL);
      await db.execute(sql`SELECT 1`);
      canConnect = true;
      testTenantId = crypto.randomUUID();
      // Defensive: ensure no leftover billing row for this tenant. The id is
      // a fresh UUID per run so collisions are essentially impossible, but we
      // delete by tenantId to be explicit.
      await db.delete(billingCustomers).where(eq(billingCustomers.tenantId, testTenantId));
    } catch (e) {
      console.warn(
        "PostgreSQL unavailable -- billing-subscription test skipped:",
        (e as Error).message,
      );
      canConnect = false;
    }
  });

  afterAll(async () => {
    if (!canConnect) return;
    await db.delete(billingCustomers).where(eq(billingCustomers.tenantId, testTenantId));
  });

  test("returns 200 with inactive subscription shape when no billing_customers row exists", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }

    // Probe app: same handlerCtx shape as production (apps/api/src/index.ts:130-144),
    // but with the test tenant id stubbed in via .derive. We pass the REAL
    // scopedDb wrapper around a REAL Drizzle instance so the call path matches
    // production exactly (the bug is in the handler-to-scopedDb interaction —
    // mocks would hide it).
    const app = new Elysia()
      .derive({ as: "scoped" }, () => ({
        handlerCtx: {
          tenantId: testTenantId,
          userId: testTenantId,
          db: scopedDb(db, testTenantId),
          emit: () => {},
        },
      }))
      .use(billingRoutes);

    const res = await app.handle(
      new Request("http://localhost/api/billing/subscription", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        status: string;
        hasSubscription: boolean;
        providerSubscriptionId: string | null;
        providerPriceId: string | null;
        currentPeriodEnd: string | null;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.status).toBe("inactive");
    expect(body.data.hasSubscription).toBe(false);
    expect(body.data.providerSubscriptionId).toBeNull();
    expect(body.data.providerPriceId).toBeNull();
    expect(body.data.currentPeriodEnd).toBeNull();
  }, 30_000);
});
