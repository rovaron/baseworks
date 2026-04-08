---
phase: 06-responsive-layouts
plan: 02
subsystem: ui
tags: [react-table, cards, responsive, mobile, shadcn, vitest, testing-library]

# Dependency graph
requires:
  - phase: 05-admin-dashboard
    provides: admin DataTable component and list pages (tenants, users)
provides:
  - DataTableCards shared component in packages/ui with priority-based column rendering
  - Mobile card view switching in admin DataTable
  - Column priority metadata on tenants and users list pages
  - Vitest + testing-library test infrastructure for packages/ui
affects: [06-responsive-layouts, admin-dashboard, ui-package]

# Tech tracking
tech-stack:
  added: [vitest, "@testing-library/react", "@testing-library/jest-dom", jsdom]
  patterns: [column-meta-priority, responsive-table-card-switching, tdd-component-testing]

key-files:
  created:
    - packages/ui/src/components/data-table-cards.tsx
    - packages/ui/src/components/__tests__/data-table-cards.test.tsx
    - packages/ui/vitest.config.ts
    - packages/ui/src/test-setup.ts
  modified:
    - packages/ui/src/index.ts
    - packages/ui/package.json
    - apps/admin/src/components/data-table.tsx
    - apps/admin/src/routes/tenants/list.tsx
    - apps/admin/src/routes/users/list.tsx

key-decisions:
  - "Used getSortedRowModel (not getSortingRowModel) matching @tanstack/react-table v8.21 API"
  - "Added @tanstack/react-table as both peer dependency (for consumers) and dev dependency (for tests)"
  - "Filter chip test asserts combined 'Status: active' text to avoid ambiguity with data values"

patterns-established:
  - "Column meta priority: meta.priority (1=prominent, 2=secondary, 3+=detail), meta.cardHidden for hidden columns"
  - "Responsive table switching: useIsMobile() hook conditionally renders DataTableCards vs Table"
  - "TDD in packages/ui: vitest + jsdom + testing-library with test-setup.ts for jest-dom matchers"

requirements-completed: [RESP-04]

# Metrics
duration: 6min
completed: 2026-04-08
---

# Phase 06 Plan 02: Mobile Data Table Cards Summary

**DataTableCards component with priority-based column rendering, tap-to-expand, sort dropdown, and filter chips -- wired into admin tenants/users lists with responsive mobile/desktop switching**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-08T12:18:55Z
- **Completed:** 2026-04-08T12:25:11Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Created DataTableCards shared component that renders table rows as stacked cards with priority-based column display
- Implemented tap-to-expand with chevron indicator, sort dropdown, and filter chips with clear buttons
- Wired responsive switching in admin DataTable: cards on mobile, table on desktop
- Added column priority metadata to tenants list (Name/Status=1, Created=2, Slug=3) and users list (Name/Status=1, Email=2, Created=3)
- Set up vitest + testing-library infrastructure for packages/ui with 5 passing tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Create DataTableCards shared component with unit tests** - `44e71c8` (test: TDD RED) + `3865938` (feat: TDD GREEN)
2. **Task 2: Add column priority metadata and wire responsive switching** - `c10b9ac` (feat)

_Note: Task 1 used TDD workflow with separate RED and GREEN commits._

## Files Created/Modified
- `packages/ui/src/components/data-table-cards.tsx` - DataTableCards component with priority columns, expand, sort, filter chips
- `packages/ui/src/components/__tests__/data-table-cards.test.tsx` - 5 unit tests covering priority rendering, expand, sort, filter chips
- `packages/ui/vitest.config.ts` - Vitest configuration for packages/ui with jsdom environment
- `packages/ui/src/test-setup.ts` - Test setup importing jest-dom matchers
- `packages/ui/src/index.ts` - Added DataTableCards export
- `packages/ui/package.json` - Added @tanstack/react-table peer dep, test dev dependencies
- `apps/admin/src/components/data-table.tsx` - Responsive switching via useIsMobile + DataTableCards
- `apps/admin/src/routes/tenants/list.tsx` - Column priority metadata for card view
- `apps/admin/src/routes/users/list.tsx` - Column priority metadata for card view

## Decisions Made
- Used `getSortedRowModel` (not `getSortingRowModel`) to match the actual @tanstack/react-table v8.21 export name
- Added @tanstack/react-table as both peerDependency (consumers provide it) and devDependency (for running tests)
- Used `data-card` attribute on Card elements to enable test querying for card expand/collapse

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed @tanstack/react-table API name mismatch**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** Plan referenced `getSortingRowModel` but @tanstack/react-table v8.21 exports `getSortedRowModel`
- **Fix:** Updated test imports and usage to use `getSortedRowModel`
- **Files modified:** packages/ui/src/components/__tests__/data-table-cards.test.tsx
- **Verification:** All 5 tests pass
- **Committed in:** 3865938 (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] Set up missing test infrastructure for packages/ui**
- **Found during:** Task 1 (TDD RED phase)
- **Issue:** No vitest config, no testing-library, no jsdom environment existed for packages/ui
- **Fix:** Installed vitest, @testing-library/react, @testing-library/jest-dom, jsdom; created vitest.config.ts and test-setup.ts
- **Files modified:** packages/ui/package.json, packages/ui/vitest.config.ts, packages/ui/src/test-setup.ts
- **Verification:** Tests run successfully in jsdom environment
- **Committed in:** 44e71c8 (Task 1 RED commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary to unblock test execution. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DataTableCards component ready for use in any list page with column priority metadata
- Test infrastructure established for packages/ui -- future UI components can add tests
- Plan 03 (page-level responsive rules) can proceed; data table responsive view is complete

## Self-Check: PASSED

All 8 created/modified files verified present. All 3 task commits verified in git log.

---
*Phase: 06-responsive-layouts*
*Completed: 2026-04-08*
