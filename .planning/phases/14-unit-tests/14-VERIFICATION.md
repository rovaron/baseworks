---
phase: 14-unit-tests
verified: 2026-04-17T03:09:07Z
status: gaps_found
score: 3/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "All 8 auth command handlers have unit tests verifying success paths and error cases"
    status: partial
    reason: "14 of 20 auth command handler tests fail due to buggy assertResultOk/assertResultErr usage pattern. The functions return void (assertion narrowing) but tests assign the return to a variable and access properties on it, getting undefined."
    artifacts:
      - path: "packages/modules/auth/src/__tests__/update-tenant.test.ts"
        issue: "const data = assertResultOk(result) assigns undefined; data.* access throws TypeError"
      - path: "packages/modules/auth/src/__tests__/delete-tenant.test.ts"
        issue: "Same assertResultOk void-return bug"
      - path: "packages/modules/auth/src/__tests__/update-profile.test.ts"
        issue: "Same assertResultOk void-return bug"
      - path: "packages/modules/auth/src/__tests__/create-invitation.test.ts"
        issue: "Same assertResultOk void-return bug"
      - path: "packages/modules/auth/src/__tests__/accept-invitation.test.ts"
        issue: "Same assertResultOk void-return bug"
      - path: "packages/modules/auth/src/__tests__/cancel-invitation.test.ts"
        issue: "Same assertResultOk void-return bug"
      - path: "packages/modules/auth/src/__tests__/reject-invitation.test.ts"
        issue: "Same assertResultOk void-return bug"
    missing:
      - "Fix assertResultOk to return result.data (or fix all test files to use result.data after assertion)"
      - "Fix assertResultErr to return result.error (or fix tests to use result.error after assertion)"
  - truth: "All 6 billing command handlers and 2 billing query handlers have unit tests"
    status: partial
    reason: "23 of 24 billing handler tests fail due to the same assertResultOk/assertResultErr void-return bug as auth command tests."
    artifacts:
      - path: "packages/modules/billing/src/__tests__/cancel-subscription.test.ts"
        issue: "const data = assertResultOk(result) assigns undefined; data.cancelledAt throws TypeError"
      - path: "packages/modules/billing/src/__tests__/change-subscription.test.ts"
        issue: "Same void-return bug"
      - path: "packages/modules/billing/src/__tests__/create-checkout-session.test.ts"
        issue: "Same void-return bug"
      - path: "packages/modules/billing/src/__tests__/create-one-time-payment.test.ts"
        issue: "Same void-return bug"
      - path: "packages/modules/billing/src/__tests__/create-portal-session.test.ts"
        issue: "Same void-return bug"
      - path: "packages/modules/billing/src/__tests__/record-usage.test.ts"
        issue: "Same void-return bug"
      - path: "packages/modules/billing/src/__tests__/get-subscription-status.test.ts"
        issue: "Same void-return bug"
      - path: "packages/modules/billing/src/__tests__/get-billing-history.test.ts"
        issue: "Same void-return bug"
    missing:
      - "Fix assertResultOk to return result.data (or fix all 8 billing test files to use result.data after assertion)"
      - "Fix assertResultErr to return result.error (or fix all test files to use result.error after assertion)"
---

# Phase 14: Unit Tests Verification Report

**Phase Goal:** CQRS handlers and core infrastructure have unit tests that verify behavior contracts, with test runner boundaries documented and test utilities established
**Verified:** 2026-04-17T03:09:07Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 8 auth command handlers have unit tests verifying success paths and error cases | PARTIAL | 8 test files exist with correct describe blocks, but 14/20 tests fail at runtime due to assertResultOk returning void. create-tenant (Plan 01) passes; Plan 03 files fail. |
| 2 | All 6 auth query handlers have unit tests verifying data retrieval and not-found cases | VERIFIED | 6 test files exist with 18/18 tests passing. Plan 04 used inline mock helpers avoiding the void-return bug. |
| 3 | All 6 billing command handlers and 2 billing query handlers have unit tests | PARTIAL | 9 test files exist with correct describe blocks, but 23/24 handler tests fail due to same assertResultOk void-return bug. |
| 4 | Stripe adapter has conformance tests at parity with existing Pagar.me adapter test suite | VERIFIED | stripe-adapter.test.ts has 13 tests covering all PaymentProvider methods. All 13 pass. Pagarme has 10 adapter tests (plus 9 event-mapping tests). Parity met. |
| 5 | Scoped-db edge cases and core infrastructure edge cases (registry, CQRS bus, event bus) are tested | VERIFIED | cqrs.test.ts (10 pass), event-bus.test.ts (pass), registry.test.ts (pass), scoped-db.test.ts (10 pass), env.test.ts (10 pass). All edge cases present: duplicate registration, handler throws, concurrent execution, multi-subscriber, no-subscriber, error isolation, empty tenantId, raw access, payment provider env, Redis URL assertion. |

**Score:** 3/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/modules/__test-utils__/mock-context.ts` | createMockContext and createMockDb factories | VERIFIED | 64 lines, exports both functions, typed to HandlerContext |
| `packages/modules/__test-utils__/assert-result.ts` | Result type assertion helpers | VERIFIED (with bug) | 42 lines, exports assertResultOk/assertResultErr. Functions work as type narrowers but return void, causing failures when callers assign the return value. |
| `packages/modules/__test-utils__/mock-payment-provider.ts` | Mock PaymentProvider factory | VERIFIED | 71 lines, all 13 PaymentProvider methods mocked |
| `packages/modules/auth/src/__tests__/create-tenant.test.ts` | Behavioral tests for create-tenant | VERIFIED | 3 tests, all pass |
| `apps/api/src/core/__tests__/cqrs.test.ts` | CQRS bus edge case tests | VERIFIED | 10 tests pass, includes handler throws + concurrent execution |
| `apps/api/src/core/__tests__/event-bus.test.ts` | Event bus edge case tests | VERIFIED | Tests for multi-subscriber, no-subscriber, error isolation |
| `apps/api/src/core/__tests__/registry.test.ts` | Registry edge case tests | VERIFIED | Tests for empty commands, duplicate module, loaded names |
| `packages/db/src/__tests__/scoped-db.test.ts` | Scoped-db edge case tests | VERIFIED | 10 tests pass, includes raw access and empty tenantId |
| `packages/config/src/__tests__/env.test.ts` | Config validation tests | VERIFIED | 10 tests pass, covers validatePaymentProviderEnv and assertRedisUrl |
| Auth command test files (7 files) | Behavioral tests for 7 remaining auth commands | FAILING | All 7 files exist with correct structure but 14/20 tests fail |
| Auth query test files (6 files) | Behavioral tests for 6 auth queries | VERIFIED | All 6 files, 18/18 pass |
| Billing handler test files (8 files) | Behavioral tests for 8 billing handlers | FAILING | All 8 files exist with correct structure but 23/24 tests fail |
| `packages/modules/billing/src/__tests__/stripe-adapter.test.ts` | Stripe adapter conformance tests | VERIFIED | 13 tests, all pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| mock-context.ts | @baseworks/shared HandlerContext | type import | WIRED | Verified via grep |
| create-tenant.test.ts | mock-context.ts | import createMockContext | WIRED | 8 auth command test files import from __test-utils__ |
| Auth query tests | mock context | inline createMockCtx | WIRED | Plan 04 used inline helpers (worktree isolation) |
| Billing handler tests | mock-context.ts | import | WIRED | All 8 billing test files import from __test-utils__ |
| Billing handler tests | provider-factory.ts | setPaymentProvider | WIRED | 6 of 8 billing handler tests use setPaymentProvider |
| get-profile.test.ts | @baseworks/db | mock.module | WIRED | Special mocking pattern validated, 3/3 tests pass |
| cqrs.test.ts | cqrs-bus.ts | import | WIRED | Direct import verified |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Plan 01: create-tenant tests pass | `bun test ./packages/modules/auth/src/__tests__/create-tenant.test.ts` | 3 pass, 0 fail | PASS |
| Plan 02: core infrastructure edge cases | `bun test ./apps/api/src/core/__tests__/cqrs.test.ts` | 10 pass, 0 fail | PASS |
| Plan 02: scoped-db edge cases | `bun test ./packages/db/src/__tests__/scoped-db.test.ts` | 10 pass, 0 fail | PASS |
| Plan 02: config env validation | `bun test ./packages/config/src/__tests__/env.test.ts` | 10 pass, 0 fail | PASS |
| Plan 03: auth command handler tests | `bun test` on 7 Plan 03 files | 6 pass, 14 fail | FAIL |
| Plan 04: auth query handler tests | `bun test` on 5 Plan 04 files | 18 pass, 0 fail | PASS |
| Plan 05: billing handler tests | `bun test` on 8 Plan 05 handler files | 1 pass, 23 fail | FAIL |
| Plan 05: stripe adapter tests | `bun test ./packages/modules/billing/src/__tests__/stripe-adapter.test.ts` | 13 pass, 0 fail | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TEST-01 | 14-01, 14-03 | Auth command handler unit tests (8 handlers) | PARTIAL | 8 test files exist but 14/20 tests in Plan 03 files fail |
| TEST-02 | 14-04 | Auth query handler unit tests (6 handlers) | SATISFIED | 6 test files, 18/18 pass |
| TEST-03 | 14-05 | Billing command handler unit tests (6 handlers) | PARTIAL | 6 test files exist but all 18 tests fail |
| TEST-04 | 14-05 | Billing query handler unit tests (2 handlers) | PARTIAL | 2 test files exist but 5/6 tests fail |
| TEST-05 | 14-05 | Stripe adapter conformance test parity | SATISFIED | 13 tests, all pass, mirrors Pagarme structure |
| TEST-06 | 14-02 | Scoped-db edge case tests | SATISFIED | 10 tests, all pass, covers raw access and empty tenantId |
| TEST-07 | 14-02 | Core infrastructure test expansion | SATISFIED | CqrsBus, EventBus, Registry all have new edge case tests, all pass |
| TEST-08 | 14-02 | Config/env validation tests | SATISFIED | 10 tests for validatePaymentProviderEnv and assertRedisUrl, all pass |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `__test-utils__/assert-result.ts` | 14-23 | assertResultOk returns void via `asserts` but callers assign return value | BLOCKER | Root cause of 37 test failures across Plan 03 and Plan 05 |
| `__test-utils__/assert-result.ts` | 34-42 | assertResultErr returns void but callers assign return value | BLOCKER | Same pattern; error checks like `expect(error).toBe("...")` get undefined |

### Human Verification Required

None -- all verifications were performed programmatically.

### Gaps Summary

**Root cause: A single bug in assert-result.ts causes 37 test failures across two plans.**

The `assertResultOk` function uses TypeScript's `asserts result is { success: true; data: T }` return type, which means it returns `void`. Test files from Plan 03 (auth commands) and Plan 05 (billing handlers) use the pattern `const data = assertResultOk(result)` and then access `data.someProperty`, which throws `TypeError: undefined is not an object`.

**Fix options (choose one):**
1. **Change assertResultOk to return `result.data`** -- add `return result.data as T` after the assertion, change return type to `T`. Similarly make assertResultErr return `result.error`.
2. **Fix all 15 test files** to use `assertResultOk(result); expect(result.data.something)...` instead of `const data = assertResultOk(result); expect(data.something)...`.

Option 1 is simpler (1 file change vs 15 files).

Plan 01 (create-tenant) and Plan 04 (auth queries) are unaffected because:
- Plan 01's create-tenant test accesses `result.data` directly after assertion
- Plan 04 uses inline helpers and direct `result.success` checks

---

_Verified: 2026-04-17T03:09:07Z_
_Verifier: Claude (gsd-verifier)_
