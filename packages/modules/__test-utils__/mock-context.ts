import { mock } from "bun:test";
import type { HandlerContext } from "@baseworks/shared";

/**
 * Create a mock database object with chainable query methods.
 *
 * Pass expected return values for select/insert/update/delete chains.
 * Each chain method returns the mockDb itself for fluent chaining,
 * and the terminal await resolves to the provided return value.
 */
export function createMockDb(returns: {
  select?: any[];
  insert?: any;
  update?: any;
  delete?: any;
} = {}) {
  const selectResult = returns.select ?? [];
  const insertResult = returns.insert ?? undefined;
  const updateResult = returns.update ?? undefined;
  const deleteResult = returns.delete ?? undefined;

  const db: any = {
    select: mock(() => db._selectChain),
    insert: mock(() => db._insertChain),
    update: mock(() => db._updateChain),
    delete: mock(() => db._deleteChain),

    _selectChain: {
      from: mock(() => db._selectChain),
      where: mock(() => db._selectChain),
      limit: mock(() => db._selectChain),
      orderBy: mock(() => db._selectChain),
      then: (resolve: (v: any) => void) => resolve(selectResult),
    },

    _insertChain: {
      values: mock(() => db._insertChain),
      returning: mock(() => db._insertChain),
      onConflictDoNothing: mock(() => db._insertChain),
      then: (resolve: (v: any) => void) => resolve(insertResult),
    },

    _updateChain: {
      set: mock(() => db._updateChain),
      where: mock(() => db._updateChain),
      returning: mock(() => db._updateChain),
      then: (resolve: (v: any) => void) => resolve(updateResult),
    },

    _deleteChain: {
      where: mock(() => db._deleteChain),
      returning: mock(() => db._deleteChain),
      then: (resolve: (v: any) => void) => resolve(deleteResult),
    },
  };

  return db;
}

/**
 * Create a mock HandlerContext for unit testing CQRS handlers.
 */
export function createMockContext(overrides: {
  tenantId?: string;
  userId?: string;
  db?: any;
  emit?: any;
  enqueue?: any;
} = {}): HandlerContext {
  return {
    tenantId: overrides.tenantId ?? "tenant_test_123",
    userId: overrides.userId ?? "user_test_456",
    db: overrides.db ?? createMockDb(),
    emit: overrides.emit ?? mock(() => {}),
    enqueue: overrides.enqueue ?? mock(() => Promise.resolve()),
  };
}
