---
phase: 07-accessibility
plan: 01
subsystem: ui
tags: [accessibility, a11y, landmarks, skip-link, focus-management, wcag, aria]

# Dependency graph
requires:
  - phase: 06-responsive-layouts
    provides: responsive sidebar and layout structure for both apps
provides:
  - SkipToContent shared component in packages/ui
  - useFocusOnNavigate hook for Next.js (customer app)
  - useFocusOnNavigate hook for React Router (admin dashboard)
  - Semantic HTML landmarks in both app layouts
affects: [07-accessibility]

# Tech tracking
tech-stack:
  added: []
  patterns: [sr-only focus:not-sr-only skip link pattern, route-change focus management, semantic landmark structure]

key-files:
  created:
    - packages/ui/src/components/skip-link.tsx
    - apps/web/hooks/use-focus-on-navigate.ts
    - apps/admin/src/hooks/use-focus-on-navigate.ts
  modified:
    - packages/ui/src/index.ts
    - apps/web/app/(dashboard)/layout.tsx
    - apps/web/app/(auth)/layout.tsx
    - apps/web/components/sidebar-nav.tsx
    - apps/admin/src/layouts/admin-layout.tsx

key-decisions:
  - "SkipToContent uses anchor element with sr-only/focus:not-sr-only pattern for maximum compatibility"
  - "Focus hooks skip first render to avoid stealing focus on initial page load"

patterns-established:
  - "Skip link pattern: sr-only focus:not-sr-only with fixed positioning on focus"
  - "Route change focus: isFirstRender ref guard + getElementById main-content + focus()"
  - "Main content target: id=main-content with tabIndex={-1} and focus:outline-none"

requirements-completed: [A11Y-01, A11Y-03]

# Metrics
duration: 3min
completed: 2026-04-09
---

# Phase 07 Plan 01: Landmarks & Skip Links Summary

**Semantic HTML landmarks, skip-to-content links, and route-change focus management added to both customer app and admin dashboard**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-09T10:35:41Z
- **Completed:** 2026-04-09T10:38:25Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created shared SkipToContent component with sr-only/focus:not-sr-only pattern for screen reader and keyboard users
- Retrofitted customer app dashboard with header, nav, and main landmarks plus skip link and focus management
- Retrofitted admin dashboard with nav landmark around sidebar, skip link, and focus management on route changes
- Both apps now move focus to main content on route changes (skipping initial render)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create SkipToContent component and retrofit customer app layouts** - `0176424` (feat)
2. **Task 2: Retrofit admin dashboard layout with landmarks, skip link, and focus hook** - `3d2d301` (feat)

## Files Created/Modified
- `packages/ui/src/components/skip-link.tsx` - Shared SkipToContent component with configurable targetId
- `packages/ui/src/index.ts` - Added skip-link export
- `apps/web/hooks/use-focus-on-navigate.ts` - Next.js route change focus hook using usePathname
- `apps/web/app/(dashboard)/layout.tsx` - Added header, main landmarks, SkipToContent, DashboardContent wrapper with focus hook
- `apps/web/app/(auth)/layout.tsx` - Added SkipToContent and main landmark
- `apps/web/components/sidebar-nav.tsx` - Wrapped Sidebar in nav element with aria-label
- `apps/admin/src/hooks/use-focus-on-navigate.ts` - React Router route change focus hook using useLocation
- `apps/admin/src/layouts/admin-layout.tsx` - Added SkipToContent, nav landmark around sidebar, id/tabIndex/focus:outline-none on main

## Decisions Made
- SkipToContent uses a plain anchor element (not button) with sr-only/focus:not-sr-only for maximum assistive technology compatibility
- Focus hooks use isFirstRender ref to skip initial mount and avoid stealing focus on page load
- Dashboard layout extracted DashboardContent inner component to call hooks inside SidebarProvider context

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Landmark structure and skip links are in place for both apps
- Ready for plan 02 (ARIA attributes and form accessibility) and plan 03 (focus trapping and keyboard navigation)

---
*Phase: 07-accessibility*
*Completed: 2026-04-09*
