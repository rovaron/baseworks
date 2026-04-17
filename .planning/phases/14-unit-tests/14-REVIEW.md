---
phase: 14-unit-tests
reviewed: 2026-04-17T14:30:00Z
depth: standard
files_reviewed: 32
files_reviewed_list:
  - apps/api/src/core/__tests__/cqrs.test.ts
  - apps/api/src/core/__tests__/event-bus.test.ts
  - apps/api/src/core/__tests__/registry.test.ts
  - packages/config/src/__tests__/env.test.ts
  - packages/config/src/index.ts
  - packages/db/src/__tests__/scoped-db.test.ts
  - packages/modules/__test-utils__/assert-result.ts
  - packages/modules/__test-utils__/mock-context.ts
  - packages/modules/__test-utils__/mock-payment-provider.ts
  - packages/modules/auth/src/__tests__/accept-invitation.test.ts
  - packages/modules/auth/src/__tests__/cancel-invitation.test.ts
  - packages/modules/auth/src/__tests__/create-invitation.test.ts
  - packages/modules/auth/src/__tests__/create-tenant.test.ts
  - packages/modules/auth/src/__tests__/delete-tenant.test.ts
  - packages/modules/auth/src/__tests__/get-invitation.test.ts
  - packages/modules/auth/src/__tests__/get-profile.test.ts
  - packages/modules/auth/src/__tests__/get-tenant.test.ts
  - packages/modules/auth/src/__tests__/list-invitations.test.ts
  - packages/modules/auth/src/__tests__/list-members.test.ts
  - packages/modules/auth/src/__tests__/list-tenants.test.ts
  - packages/modules/auth/src/__tests__/reject-invitation.test.ts
  - packages/modules/auth/src/__tests__/update-profile.test.ts
  - packages/modules/auth/src/__tests__/update-tenant.test.ts
  - packages/modules/billing/src/__tests__/cancel-subscription.test.ts
  - packages/modules/billing/src/__tests__/change-subscription.test.ts
  - packages/modules/billing/src/__tests__/create-checkout-session.test.ts
  - packages/modules/billing/src/__tests__/create-one-time-payment.test.ts
  - packages/modules/billing/src/__tests__/create-portal-session.test.ts
  - packages/modules/billing/src/__tests__/get-billing-history.test.ts
  - packages/modules/billing/src/__tests__/get-subscription-status.test.ts
  - packages/modules/billing/src/__tests__/record-usage.test.ts
  - packages/modules/billing/src/__tests__/stripe-adapter.test.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-04-17T14:30:00Z
**Depth:** standard
**Files Reviewed:** 32
**Status:** issues_found

## Summary

Reviewed 32 source files across the unit test suite for Phase 14: test utilities (`assert-result.ts`, `mock-context.ts`, `mock-payment-provider.ts`), core infrastructure tests (CQRS, event bus, registry), config/env tests, scoped-db integration tests, 16 auth module handler tests, and 9 billing module handler tests. Three files listed in config do not exist (`invitation.test.ts`, `profile.test.ts`, `tenant-crud.test.ts`) and were skipped.

Overall test quality is solid: consistent mocking patterns, good error-path coverage, and proper use of shared test utilities. However, one critical type-safety bug exists in production code (`assertRedisUrl`), and there are several warnings around incomplete mock types and a documented-but-unfixed bug in `TypedEventBus.off()`.

## Critical Issues

### CR-01: `assertRedisUrl` returns `undefined as string` for API role

**File:** `packages/config/src/env.ts:99`
**Issue:** When `role` is `"api"` and `redisUrl` is `undefined`, the function skips the guard clause and returns `undefined` cast as `string` via `return redisUrl as string`. Any caller that trusts the `string` return type will get `undefined` at runtime, causing downstream crashes when the value is used (e.g., passed to `new Redis(url)`). The env test at `packages/config/src/__tests__/env.test.ts:226-246` only validates the function does not throw -- it does not check the return value is `undefined`, masking this bug.
**Fix:**
```typescript
export function assertRedisUrl(role: string, redisUrl?: string): string | undefined {
  if ((role === "worker" || role === "all") && !redisUrl) {
    throw new Error(
      `REDIS_URL is required when INSTANCE_ROLE is "${role}". Set REDIS_URL in your environment.`,
    );
  }
  return redisUrl;
}
```
Or if the return type must remain `string`, explicitly return a sentinel or throw for undefined:
```typescript
export function assertRedisUrl(role: string, redisUrl?: string): string {
  if ((role === "worker" || role === "all") && !redisUrl) {
    throw new Error(`REDIS_URL is required when INSTANCE_ROLE is "${role}".`);
  }
  if (!redisUrl) return ""; // or: throw for all roles if redis is always needed
  return redisUrl;
}
```

## Warnings

### WR-01: `mockCtx` in cqrs.test.ts has incomplete HandlerContext shape

**File:** `apps/api/src/core/__tests__/cqrs.test.ts:6-10`
**Issue:** The inline `mockCtx` object is typed as `HandlerContext` but only provides `tenantId`, `db`, and `emit`. It is missing `userId` and `enqueue` which are present in the shared `createMockContext` utility. If `HandlerContext` is later validated (e.g., via a Zod guard or runtime check), these tests will break silently. The `db` field is an empty object `{}` rather than a properly shaped mock.
**Fix:** Use the shared `createMockContext()` from `packages/modules/__test-utils__/mock-context.ts`, or at minimum supply all required fields:
```typescript
import { createMockContext } from "somewhere"; // or inline all fields
const mockCtx: HandlerContext = {
  tenantId: "test-tenant",
  userId: "test-user",
  db: {} as any,
  emit: () => {},
  enqueue: () => Promise.resolve(),
};
```

### WR-02: TypedEventBus.off() is non-functional -- documented but not fixed

**File:** `apps/api/src/core/__tests__/event-bus.test.ts:93-106`
**Issue:** The test at line 93 explicitly documents that `off()` does not work because `on()` wraps the handler, so `off()` can never match the original reference. This is not a test issue per se -- the test correctly documents the behavior -- but it means the production `TypedEventBus.off()` method is dead code that gives callers a false sense of unsubscription. If any module relies on `off()` to stop receiving events (e.g., during module teardown), event handlers will leak.
**Fix:** In `apps/api/src/core/event-bus.ts`, store the mapping between original handler and wrapped handler:
```typescript
private handlerMap = new Map<Function, Function>();

on(event: string, handler: (data: any) => void | Promise<void>): void {
  const wrapped = (data: unknown) => { /* ... existing wrapping logic ... */ };
  this.handlerMap.set(handler, wrapped);
  this.emitter.on(event, wrapped);
}

off(event: string, handler: (...args: any[]) => void): void {
  const wrapped = this.handlerMap.get(handler);
  if (wrapped) {
    this.emitter.off(event, wrapped as any);
    this.handlerMap.delete(handler);
  }
}
```

### WR-03: Multiple auth query tests use inline `createMockCtx` instead of shared utility

**File:** `packages/modules/auth/src/__tests__/get-invitation.test.ts:15-23`
**File:** `packages/modules/auth/src/__tests__/get-profile.test.ts:40-48`
**File:** `packages/modules/auth/src/__tests__/get-tenant.test.ts:15-23`
**File:** `packages/modules/auth/src/__tests__/list-invitations.test.ts:15-23`
**File:** `packages/modules/auth/src/__tests__/list-members.test.ts:15-23`
**File:** `packages/modules/auth/src/__tests__/list-tenants.test.ts:15-23`
**Issue:** Six test files define a local `createMockCtx()` function that produces an incomplete `HandlerContext` (missing `userId` in some, missing `enqueue` in all) instead of using the shared `createMockContext()` from `__test-utils__/mock-context.ts`. This duplication means if `HandlerContext` gains new required fields, these tests will need individual updates rather than a single fix in the shared utility.
**Fix:** Replace inline `createMockCtx` with the shared utility:
```typescript
import { createMockContext } from "../../../__test-utils__/mock-context";
// Then use createMockContext({ ...overrides }) in each test
```

### WR-04: `assertResultOk` redundantly calls `expect` after an early throw

**File:** `packages/modules/__test-utils__/assert-result.ts:15-23`
**Issue:** When `result.success` is `false`, the function throws immediately on line 17-19. The `expect(result.success).toBe(true)` on line 21 only executes on the success path, making it a no-op (it will always pass). This means test failures from `assertResultOk` show a generic `throw new Error(...)` stack trace instead of a proper `bun:test` assertion diff. The intent was likely to have the `expect` as the primary assertion mechanism.
**Fix:** Remove the early throw and let `expect` handle the assertion:
```typescript
export function assertResultOk<T>(result: Result<T>): T {
  expect(result.success).toBe(true);
  if (!result.success) {
    // Unreachable -- expect above will throw -- but satisfies TypeScript
    throw new Error(`Expected Result to be ok, but got error: ${result.error}`);
  }
  return result.data;
}
```
This preserves the same runtime behavior but makes `expect` the primary failure mechanism, producing better test output with bun:test's diff formatting.

## Info

### IN-01: Three listed files do not exist

**File:** `packages/modules/auth/src/__tests__/invitation.test.ts`
**File:** `packages/modules/auth/src/__tests__/profile.test.ts`
**File:** `packages/modules/auth/src/__tests__/tenant-crud.test.ts`
**Issue:** These three files were listed in the review config but do not exist on disk. They may have been renamed or consolidated into the individual command/query test files (e.g., `invitation.test.ts` was likely split into `accept-invitation.test.ts`, `cancel-invitation.test.ts`, etc.).
**Fix:** Remove these entries from any test manifest or CI configuration that references them.

### IN-02: Billing tests duplicate mock.module boilerplate for @baseworks/config and stripe

**File:** `packages/modules/billing/src/__tests__/cancel-subscription.test.ts:6-12`
**File:** `packages/modules/billing/src/__tests__/change-subscription.test.ts:6-12`
**File:** (and 7 more billing test files)
**Issue:** Every billing test file repeats the same `mock.module("@baseworks/config", ...)` and `mock.module("stripe", ...)` blocks verbatim. While not a bug, this means adding a new env variable to billing config requires updating 9+ files.
**Fix:** Consider extracting a shared `__test-utils__/mock-billing-deps.ts` that sets up the common module mocks, similar to how `mock-context.ts` centralizes context creation.

### IN-03: `createMockDb` does not support chaining patterns used in some handlers

**File:** `packages/modules/__test-utils__/mock-context.ts:24-42`
**Issue:** The mock db's `select` chain is `select() -> from() -> where() -> limit()`, but some handlers may use different chain patterns (e.g., `select().from().where()` without `.limit()`, or `select().from().limit()`). The mock resolves at the `.limit()` level, so any handler that does not call `.limit()` will receive a mock object `{ limit: fn }` instead of query results. This has not caused test failures yet because current handlers align with the mock chain, but it is fragile.
**Fix:** Make intermediate chain methods also resolve as thenables, or use a more flexible mock that resolves at any chain depth.

---

_Reviewed: 2026-04-17T14:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
