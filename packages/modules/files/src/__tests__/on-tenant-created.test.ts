/**
 * Phase 26 / QUO-01 — tenant.created hook LIVE-DB tests (SC#2).
 *
 * Runs against the REAL Postgres (DATABASE_URL). `@baseworks/config` is mocked
 * only to inject the real DATABASE_URL + STORAGE_DEFAULT_QUOTA_BYTES, and
 * `@baseworks/observability` is mocked to spy on captureException; the DB layer
 * is NOT mocked, so the hook's INSERT hits Postgres.
 *
 * Cases:
 *   - emitting tenant.created creates exactly one tenant_storage_usage row with
 *     bytes_limit = STORAGE_DEFAULT_QUOTA_BYTES, bytes_used/bytes_pending = 0
 *   - re-emitting is idempotent (ON CONFLICT DO NOTHING) — still one row,
 *     unchanged bytes
 *   - resilience: a row whose insert fails (constraint violation) is reported via
 *     getErrorTracker().captureException and does NOT throw out of the handler
 */

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";
const DEFAULT_QUOTA = 1_073_741_824;

const captureExceptionSpy = mock(() => {});

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: TEST_DB_URL,
    STORAGE_DEFAULT_QUOTA_BYTES: DEFAULT_QUOTA,
  },
}));
mock.module("@baseworks/observability", () => ({
  getErrorTracker: () => ({ captureException: captureExceptionSpy }),
}));

const { registerFilesHooks } = await import("../hooks/on-tenant-created");
// Real DB layer (unmocked) for seeding/verification/cleanup.
const { createDb, tenantStorageUsage } = await import("@baseworks/db");
const { eq, inArray, sql } = await import("drizzle-orm");

let db: ReturnType<typeof createDb>;
const createdTenantIds = new Set<string>();

function newTenantId(tag: string): string {
  const id = `q26h_${tag}_${crypto.randomUUID().slice(0, 16)}`;
  createdTenantIds.add(id);
  return id;
}

/** Capture the handler registerFilesHooks attaches to "tenant.created". */
function getHandler(): (data: unknown) => Promise<void> {
  let captured: ((data: unknown) => Promise<void>) | undefined;
  registerFilesHooks({
    on: (event, handler) => {
      if (event === "tenant.created") captured = handler;
    },
  });
  if (!captured) throw new Error("tenant.created handler was not registered");
  return captured;
}

async function readUsage(tenantId: string) {
  const [row] = await db
    .select()
    .from(tenantStorageUsage)
    .where(eq(tenantStorageUsage.tenantId, tenantId));
  return row;
}

beforeAll(async () => {
  db = createDb(TEST_DB_URL);
  await db.execute(sql`SELECT 1`);
});

beforeEach(() => {
  captureExceptionSpy.mockClear();
});

afterAll(async () => {
  if (createdTenantIds.size > 0) {
    await db
      .delete(tenantStorageUsage)
      .where(inArray(tenantStorageUsage.tenantId, [...createdTenantIds]));
  }
  const handle = (db as unknown as { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } })
    .$sql;
  if (handle) await handle.end({ timeout: 5 });
});

describe("registerFilesHooks — tenant.created (live DB, SC#2)", () => {
  test("creates one tenant_storage_usage row with the default bytes_limit", async () => {
    const tenantId = newTenantId("create");
    const handler = getHandler();

    await handler({ tenantId, name: "Acme" });

    const row = await readUsage(tenantId);
    expect(row).toBeDefined();
    expect(row?.bytesLimit).toBe(DEFAULT_QUOTA);
    expect(row?.bytesUsed).toBe(0);
    expect(row?.bytesPending).toBe(0);
    expect(captureExceptionSpy).not.toHaveBeenCalled();
  });

  test("is idempotent on re-emit (ON CONFLICT DO NOTHING — still one row)", async () => {
    const tenantId = newTenantId("idem");
    const handler = getHandler();

    await handler({ tenantId, name: "Acme" });
    // Mutate the row, then re-emit — ON CONFLICT DO NOTHING must not overwrite it.
    await db
      .update(tenantStorageUsage)
      .set({ bytesUsed: 4_242 })
      .where(eq(tenantStorageUsage.tenantId, tenantId));

    await handler({ tenantId, name: "Acme-again" });

    const rows = await db
      .select()
      .from(tenantStorageUsage)
      .where(eq(tenantStorageUsage.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    // Untouched by the second emit (DO NOTHING).
    expect(rows[0]?.bytesUsed).toBe(4_242);
    expect(captureExceptionSpy).not.toHaveBeenCalled();
  });

  test("resilient: a failing insert is reported and does NOT throw", async () => {
    const handler = getHandler();
    // tenant_id is varchar(36); a >36-char id triggers a DB error inside the hook.
    const tooLong = `q26h_overflow_${"x".repeat(40)}`;

    // Must resolve, never reject — tenant creation must not crash.
    await expect(handler({ tenantId: tooLong, name: "Bad" })).resolves.toBeUndefined();
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
  });
});
