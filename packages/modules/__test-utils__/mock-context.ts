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

  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve(selectResult)),
        })),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => Promise.resolve(insertResult)),
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
export function createMockContext(
  overrides?: Partial<HandlerContext>,
): HandlerContext {
  return {
    tenantId: "test-tenant-id",
    userId: "test-user-id",
    db: createMockDb(),
    emit: mock(() => {}),
    enqueue: mock(() => Promise.resolve()),
    ...overrides,
  };
}
