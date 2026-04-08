---
phase: 06-responsive-layouts
fixed_at: 2026-04-08T00:00:00Z
review_path: .planning/phases/06-responsive-layouts/06-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 06: Code Review Fix Report

**Fixed at:** 2026-04-08
**Source review:** .planning/phases/06-responsive-layouts/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: Rules of Hooks violation — useIsMobile called after conditional early returns

**Files modified:** `apps/admin/src/routes/billing/overview.tsx`
**Commit:** f7ec1be
**Applied fix:** Moved `useIsMobile()` call to immediately after the `useQuery` hook, before any conditional early returns (error and loading branches). Removed the duplicate declaration that was previously below the early returns.

### WR-01: TypeScript type mismatch on hoverTimeoutRef

**Files modified:** `packages/ui/src/components/sidebar.tsx`
**Commit:** f57bdc9
**Applied fix:** Widened the `useRef` generic type from `ReturnType<typeof setTimeout>` to `ReturnType<typeof setTimeout> | undefined` so the initial `undefined` value is assignable under strict TypeScript.

### WR-02: Unguarded new Date() on API-provided date strings across detail and list routes

**Files modified:** `apps/admin/src/routes/tenants/detail.tsx`, `apps/admin/src/routes/users/detail.tsx`, `apps/admin/src/routes/tenants/list.tsx`, `apps/admin/src/routes/users/list.tsx`
**Commit:** 9566520
**Applied fix:** Added defensive validation before each `formatDistanceToNow` call: checks that the date value is truthy, constructs a `Date` object, verifies it is not `NaN` via `getTime()`, and falls back to an em-dash if invalid.

### WR-03: Sort Select in DataTableCards is uncontrolled

**Files modified:** `packages/ui/src/components/data-table-cards.tsx`
**Commit:** 70fecc2
**Applied fix:** Added a `value` prop to the `Select` component derived from `table.getState().sorting[0]?.id`, making the sort dropdown a controlled component that reflects the current sort state.

---

_Fixed: 2026-04-08_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
