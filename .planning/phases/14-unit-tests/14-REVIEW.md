---
phase: 14-unit-tests
reviewed: 2026-04-16T12:00:00Z
depth: standard
files_reviewed: 33
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
  warning: 2
  info: 2
  total: 5
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-04-16T12:00:00Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

Reviewed 33 files comprising the unit test suite for core infrastructure (CQRS, event bus, module registry), configuration validation, scoped DB tenant isolation, test utilities, auth module handlers, and billing module handlers. The test code is generally well-structured with good use of mock.module for dependency isolation and consistent patterns across similar test files.

The most significant issue is that the shared `assertResultOk` and `assertResultErr` utilities return `void`, but 12+ test files assign their return values and then assert on those values, meaning those assertions silently pass against `undefined` rather than validating actual data. This undermines test reliability across the auth and billing test suites.

## Critical Issues

### CR-01: assertResultOk/assertResultErr return void but tests use return values for assertions

**File:** `packages/modules/__test-utils__/assert-result.ts:14-42`
**Issue:** `assertResultOk` is a TypeScript assertion function that returns `void`. However, at least 12 test files assign its return value (e.g., `const data = assertResultOk(result)`) and then assert on `data`. Since the return is `void`, `data` is `undefined`, and subsequent assertions like `expect(data).toEqual({ accepted: true })` will always fail. The same issue applies to `assertResultErr` -- tests assign `const error = assertResultErr(result)` and then `expect(error).toBe("...")`, which asserts against `undefined`.

Affected test files (non-exhaustive):
- `accept-invitation.test.ts:30,61` -- `const data = assertResultOk(result)`, `const error = assertResultErr(result)`
- `cancel-invitation.test.ts:30,49`
- `create-invitation.test.ts:50,115`
- `reject-invitation.test.ts:30,63`
- `update-profile.test.ts:30,68`
- `update-tenant.test.ts:30,50`
- `delete-tenant.test.ts:29,48`
- `cancel-subscription.test.ts:34,49,65`
- `change-subscription.test.ts:34,49,64`
- `create-checkout-session.test.ts:40,65,87`
- `create-one-time-payment.test.ts:41,67,89`
- `create-portal-session.test.ts:36,55,69`
- `get-billing-history.test.ts:46,61,75`
- `record-usage.test.ts:24,39`

**Fix:** Modify `assertResultOk` to return the data and `assertResultErr` to return the error:
```typescript
export function assertResultOk<T>(
  result: Result<T>,
): T {
  if (!result.success) {
    throw new Error(
      `Expected Result to be ok, but got error: ${result.error}`,
    );
  }
  expect(result.success).toBe(true);
  return result.data;
}

export function assertResultErr(
  result: Result<unknown>,
  expectedError?: string,
): string {
  expect(result.success).toBe(false);
  if (!result.success) {
    if (expectedError) {
      expect(result.error).toContain(expectedError);
    }
    return result.error;
  }
  throw new Error("Expected Result to be error");
}
```

## Warnings

### WR-01: Local createMockCtx missing enqueue field from HandlerContext

**File:** `packages/modules/auth/src/__tests__/get-invitation.test.ts:15-23`
**Issue:** Six auth query test files define a local `createMockCtx` function that omits the `enqueue` field present in the shared `createMockContext` from `__test-utils__/mock-context.ts`. If handler code ever accesses `ctx.enqueue`, it will be `undefined` and cause runtime errors. The shared utility already handles this correctly. These files duplicate context creation instead of reusing the shared utility.

Also found in:
- `get-tenant.test.ts:15-23`
- `list-members.test.ts:15-23`
- `list-invitations.test.ts:15-23`
- `get-profile.test.ts:40-48`
- `list-tenants.test.ts:15-23`

**Fix:** Replace local `createMockCtx` with the shared `createMockContext` import:
```typescript
import { createMockContext } from "../../../__test-utils__/mock-context";
// Then replace createMockCtx(...) with createMockContext(...)
```

### WR-02: Event bus off() method is broken due to handler wrapping

**File:** `apps/api/src/core/__tests__/event-bus.test.ts:93-106`
**Issue:** The test at line 93-106 documents that `TypedEventBus.off()` cannot remove subscribers because `on()` wraps handlers. While the test correctly documents the behavior, this is a bug in the production `TypedEventBus` code -- event listeners can never be removed once registered. This could lead to memory leaks and unintended side effects in long-running processes. The test should be marked as a known issue or the `off()` method should be fixed.

**Fix:** The `TypedEventBus.on()` method should store the mapping between original and wrapped handlers so `off()` can look up the correct reference. Alternatively, `on()` should return the wrapped handler reference for use with `off()`.

## Info

### IN-01: Hardcoded test credentials in stripe adapter test

**File:** `packages/modules/billing/src/__tests__/stripe-adapter.test.ts:111-113`
**Issue:** The Stripe adapter test uses `secretKey: "sk_test_stripe_123"` and `webhookSecret: "whsec_test_stripe_456"`. While these are clearly fake test values (not real secrets), they follow the real Stripe key format pattern. This is acceptable for test code but worth noting for awareness.

**Fix:** No action required. These are mock values in test-only code.

### IN-02: scoped-db integration tests silently skip when PostgreSQL unavailable

**File:** `packages/db/src/__tests__/scoped-db.test.ts:53-57`
**Issue:** Each integration test in the scoped-db suite checks `if (!canConnect)` and returns early with a console.warn, effectively silently passing. In CI, if PostgreSQL is not available, all 5 integration tests will appear to pass but actually skip. Bun's test runner does not have a built-in `test.skip()` with conditional logic, but the current pattern makes it hard to distinguish passing vs skipped tests in CI output.

**Fix:** Consider using `test.skipIf(!canConnect)` if available in the Bun test runner version, or add a dedicated "connectivity check" test at the top of the suite that explicitly fails in CI when PostgreSQL is expected to be available:
```typescript
test("PostgreSQL is reachable (required in CI)", () => {
  if (process.env.CI) {
    expect(canConnect).toBe(true);
  }
});
```

---

_Reviewed: 2026-04-16T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
