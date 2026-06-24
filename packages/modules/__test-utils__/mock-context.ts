import { mock } from "bun:test";
import type { HandlerContext } from "@baseworks/shared";

/**
 * Create a mock database object matching the ScopedDb chainable API.
 *
 * Each method returns a mock that chains to the next level.
 * Override default resolved values via the `results` parameter.
 *
 * @param results - Optional overrides for default resolved values
 * @returns Mock database with select/insert/update/delete chains
 *
 * KNOWN LIMITATION (Phase 20.1 WR-03) — the `select` thenable resolves to
 * the SAME `results.select` array regardless of chain shape. Calls like
 * `await db.select(table)`, `await db.select(table).limit(1)`, and
 * `await db.select().from(t).where(p).limit(n)` all return the same array.
 * This is fine for handlers that issue a single select-by-tenant (the
 * Phase 20.1 billing handler shape) but will produce phantom data for
 * handlers that issue two structurally different selects in sequence.
 *
 * If you need per-chain control (different tables / different limits
 * returning different rows), reach for an integration-scope test against
 * a real `scopedDb` (see the SC#2 pattern in
 * `apps/api/__tests__/billing-subscription.test.ts`) rather than trying
 * to extend this mock — the integration test caught a real bug that the
 * mock-shaped tests could not have surfaced.
 */
export function createMockDb(results?: {
  select?: any[];
  insert?: any[];
  update?: any;
  delete?: any;
}) {
  const selectResult = results?.select ?? [];
  const insertResult = results?.insert ?? [];
  const updateResult = results?.update ?? {};
  const deleteResult = results?.delete;

  // Phase 20.1 Plan 02 — `select` mock supports BOTH the post-Option-A shape
  // `scoped.select(table).limit(n)` (the canonical scopedDb API) AND the
  // legacy raw-Drizzle chain `db.select().from(t).where(p).limit(n)` for any
  // module that still uses raw db access. The returned thenable resolves to
  // `selectResult` for `await` AND exposes `.limit`, `.from`, etc., that
  // also resolve to the same `selectResult`.
  const buildSelectThenable = () => {
    const thenableResult: any = {
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable that mocks Drizzle's awaitable query-builder
      then: (onFulfilled?: (value: any[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(selectResult).then(onFulfilled, onRejected),
      limit: mock(() => Promise.resolve(selectResult)),
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve(selectResult)),
        })),
      })),
      where: mock(() => ({
        limit: mock(() => Promise.resolve(selectResult)),
      })),
    };
    return thenableResult;
  };

  // `values` returns a thenable that resolves to `insertResult` for `await`
  // (legacy scopedDb shape: `await db.insert(t).values(d)`) AND exposes
  // `.returning()` for the raw-Drizzle shape used inside `withTenant` txs
  // (`tx.insert(t).values(d).returning()`). Both resolve to `insertResult`.
  const buildInsertThenable = () => {
    const thenable: any = {
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable that mocks Drizzle's awaitable insert builder
      then: (onFulfilled?: (value: any[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(insertResult).then(onFulfilled, onRejected),
      returning: mock(() => Promise.resolve(insertResult)),
    };
    return thenable;
  };

  return {
    select: mock(() => buildSelectThenable()),
    insert: mock(() => ({
      values: mock(() => buildInsertThenable()),
    })),
    update: mock(() => ({
      set: mock(() => Promise.resolve(updateResult)),
    })),
    delete: mock(() => Promise.resolve(deleteResult)),
    tenantId: "test-tenant-id",
    raw: {},
  };
}

/**
 * Create a fully typed HandlerContext with sensible test defaults.
 *
 * All fields are pre-populated with mock values. Pass `overrides`
 * to customize specific fields per test.
 *
 * @param overrides - Optional partial HandlerContext to override defaults
 * @returns Complete HandlerContext suitable for unit tests
 */
export function createMockContext(overrides?: Partial<HandlerContext>): HandlerContext {
  // Resolve the mock db once so the default `withTenant` runs the handler's
  // fn against the SAME db instance the test configured via `overrides.db`.
  const db = overrides?.db ?? createMockDb();
  return {
    tenantId: "test-tenant-id",
    userId: "test-user-id",
    db,
    emit: mock(() => {}),
    enqueue: mock(() => Promise.resolve()),
    // Default RLS executor for unit tests: invoke the handler's fn with the
    // mock db acting as the transaction. Tests can override per-case.
    withTenant: <T>(fn: (tx: any) => Promise<T>) => fn(db),
    ...overrides,
  };
}
