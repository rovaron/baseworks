---
phase: 16-v1-2-content-drift-fixes
plan: 03
subsystem: testing
tags: [test-convention, mock-context, bun-test, content-drift, v1.2-audit]

# Dependency graph
requires:
  - phase: 14-unit-tests
    provides: "createMockContext helper at packages/modules/__test-utils__/mock-context.ts; Phase 14 testing convention documented in docs/testing.md"
provides:
  - "get-tenant.test.ts aligned to the canonical createMockContext helper — last auth-test holdout of the pre-Phase-14 local-ctx pattern"
  - "Zero remaining drift between docs/testing.md:24-34 and the auth test suite"
affects: [future-auth-tests, test-convention-consistency]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Uniform use of createMockContext across all 14 packages/modules/auth/src/__tests__/*.test.ts files"

key-files:
  created:
    - .planning/phases/16-v1-2-content-drift-fixes/deferred-items.md
    - .planning/phases/16-v1-2-content-drift-fixes/16-03-SUMMARY.md
  modified:
    - packages/modules/auth/src/__tests__/get-tenant.test.ts

key-decisions:
  - "Used the documented import path ../../../__test-utils__/mock-context (matching 8 existing auth tests) rather than an alias — consistency over novelty."
  - "Kept the mock.module(../auth) block and the dynamic await import of ../queries/get-tenant verbatim — the migration is strictly limited to the ctx helper."

patterns-established:
  - "Convention-drift closure pattern: surgical two-edit migration (import-line + call-site replacement) with no touch to the test bodies or production-mock setup."

requirements-completed: [TEST-02]
gap_closure: true
closes_gap_from: .planning/v1.2-MILESTONE-AUDIT.md

# Metrics
duration: 3min
completed: 2026-04-19
---

# Phase 16 Plan 03: get-tenant.test.ts createMockContext Migration Summary

**Migrated `packages/modules/auth/src/__tests__/get-tenant.test.ts` from the local `createMockCtx` helper to the canonical `createMockContext` from `packages/modules/__test-utils__/mock-context.ts`, closing the last TEST-02 convention-drift holdout in the auth test suite.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-19T21:52:10Z
- **Completed:** 2026-04-19T21:55:01Z
- **Tasks:** 1
- **Files modified:** 1 (production code)

## Accomplishments

- `packages/modules/auth/src/__tests__/get-tenant.test.ts` now imports and uses `createMockContext` (matches Phase 14 convention documented in `docs/testing.md:24-34`).
- Local `createMockCtx` helper deleted entirely (lines 15-23 of the old file).
- All three test cases still pass under `bun test` (3 pass, 0 fail).
- File shrank from **83 → 74 lines** (9 helper lines removed, 1 import line added).
- `mock.module("../auth", ...)` block and `await import("../queries/get-tenant")` preserved verbatim — the migration is scoped strictly to the ctx helper.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate get-tenant.test.ts to the canonical createMockContext helper** - `c5979dc` (refactor)

## Verbatim Before/After

### Top-of-file block (lines 1-23 → lines 1-14)

**Before (83 lines total; this block = 23 lines):**

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockGetFullOrganization = mock(() => Promise.resolve(null));

mock.module("../auth", () => ({
  auth: {
    api: {
      getFullOrganization: mockGetFullOrganization,
    },
  },
}));

const { getTenant } = await import("../queries/get-tenant");

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    db: {},
    emit: mock(() => {}),
    ...overrides,
  };
}
```

**After (74 lines total; this block = 14 lines):**

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext } from "../../../__test-utils__/mock-context";

const mockGetFullOrganization = mock(() => Promise.resolve(null));

mock.module("../auth", () => ({
  auth: {
    api: {
      getFullOrganization: mockGetFullOrganization,
    },
  },
}));

const { getTenant } = await import("../queries/get-tenant");
```

### Representative call-site substitution — `returns tenant data on success` test

**Before:**

```typescript
    const result = await getTenant(
      { organizationId: "org-1" },
      createMockCtx(),
    );
```

**After:**

```typescript
    const result = await getTenant(
      { organizationId: "org-1" },
      createMockContext(),
    );
```

Identical substitution applied at the two other call sites (`returns error when tenant not found`, `returns error when auth.api throws`).

## Acceptance-Criteria Invariants — All Confirmed

| Check | Expected | Actual |
|-------|----------|--------|
| `grep -c "createMockCtx" get-tenant.test.ts` | `0` | `0` |
| `grep -c "createMockContext" get-tenant.test.ts` | `>=4` | `4` (1 import + 3 call sites) |
| `grep -c '"../../../__test-utils__/mock-context"' get-tenant.test.ts` | `1` | `1` |
| `grep -c "mock.module.*../auth" get-tenant.test.ts` | `1` | `1` |
| `grep -c 'await import("../queries/get-tenant")' get-tenant.test.ts` | `1` | `1` |
| Line count | ~74 (floor: <83, >50) | `74` |

## Test Results

### Targeted: `bun test packages/modules/auth/src/__tests__/get-tenant.test.ts`

```
 3 pass
 0 fail
 7 expect() calls
Ran 3 tests across 1 file. [1072.00ms]
```

Exit code: **0**. All three original test cases (`returns tenant data on success`, `returns error when tenant not found`, `returns error when auth.api throws`) pass.

### Broader sweep: `bun test packages/modules/auth/`

```
 48 pass
 2 fail
 2 errors
 103 expect() calls
Ran 50 tests across 16 files.
```

The 2 failures are **pre-existing environment issues confirmed on base commit `58c3844`** (verified via stash-reset-retest):

1. `auth-setup.test.ts` — `TypeError: path.length` inside Elysia's `mount` in `routes.ts:55`. Elysia API / handler integration issue, unrelated to test helpers.
2. `get-profile.test.ts` — `Invalid environment variables: DATABASE_URL, BETTER_AUTH_SECRET` from `@t3-oss/env-core`. Worktree lacks `.env`, not a code issue.

Both are out of scope for 16-03 (documented in `.planning/phases/16-v1-2-content-drift-fixes/deferred-items.md`). **The 48 tests that do run — including every other auth handler test — all pass. No regression introduced by this plan.**

## Decisions Made

- **Import path matches existing convention:** used `"../../../__test-utils__/mock-context"` (three `..` segments), exactly matching the 8 other auth tests that already import `createMockContext`. No alias, no refactor — consistency over novelty.
- **No overrides passed to `createMockContext()`:** the `getTenant` handler signature is `(input, _ctx)` — the underscore prefix in `queries/get-tenant.ts:24` confirms ctx is deliberately unused, so defaults are safe. Verified by reading the handler source.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing dependencies in worktree**
- **Found during:** Verification step (first `bun test` run)
- **Issue:** Fresh worktree had empty `node_modules`; `bun test` failed with `Cannot find module '@sinclair/typebox'` on every auth test (not only the 16-03 target — confirmed by running `accept-invitation.test.ts` unmodified).
- **Fix:** Ran `bun install` once to populate `node_modules`.
- **Files modified:** None (dependency install is side-effect; `bun.lock` drift from install was reverted via `git checkout -- bun.lock` to keep the Task 1 commit scoped to the plan).
- **Verification:** After install, `bun test packages/modules/auth/src/__tests__/get-tenant.test.ts` → `3 pass, 0 fail, exit 0`.
- **Committed in:** N/A — no files committed; worktree-scaffolding operation only.

---

**Total deviations:** 1 auto-fixed (1 blocking — worktree scaffolding)
**Impact on plan:** Zero scope creep. The blocker was a standard parallel-worktree install step, not a plan issue. The 16-03 code change is identical to what the plan specified.

## Issues Encountered

- **Worktree needed `bun install` before tests could run.** Standard parallel-worktree bootstrap — resolved immediately.
- **Pre-existing auth test failures (`auth-setup.test.ts`, `get-profile.test.ts`)** surfaced during the broader regression sweep. Confirmed by stashing the 16-03 edit and re-running against `58c3844` (same failures). Logged to `deferred-items.md`; unrelated to TEST-02 scope.

## User Setup Required

None — this is a test-file-only change.

## Next Phase Readiness

- TEST-02 convention drift is CLOSED. Every `.test.ts` file under `packages/modules/auth/src/__tests__/` that needs a handler context now imports `createMockContext` from the canonical module.
- `docs/testing.md:24-34` can be followed literally with no "except for this one file" footnote.
- No blockers for the Phase 16 wave 1 merge.

## Self-Check: PASSED

- File existence:
  - `packages/modules/auth/src/__tests__/get-tenant.test.ts` — FOUND (74 lines)
  - `.planning/phases/16-v1-2-content-drift-fixes/16-03-SUMMARY.md` — FOUND (this file)
  - `.planning/phases/16-v1-2-content-drift-fixes/deferred-items.md` — FOUND
- Commit:
  - `c5979dc` (Task 1: refactor(16-03): migrate get-tenant.test.ts to canonical createMockContext helper) — FOUND in git log

---
*Phase: 16-v1-2-content-drift-fixes*
*Completed: 2026-04-19*
