---
phase: 07-accessibility
plan: 04
subsystem: ui-accessibility
tags: [a11y, headings, semantic-html, gap-closure]

# Dependency graph
requires:
  - phase: 07-accessibility plan 01-03
    provides: landmarks, ARIA attributes, a11y tests
provides:
  - Semantic h1 headings on all auth pages
affects: [apps/web, apps/admin]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - apps/web/app/(auth)/login/page.tsx
    - apps/web/app/(auth)/signup/page.tsx
    - apps/web/app/(auth)/forgot-password/page.tsx
    - apps/web/app/(auth)/reset-password/page.tsx
    - apps/web/app/(auth)/magic-link/page.tsx
    - apps/admin/src/routes/login.tsx

key-decisions:
  - "Replaced CardTitle with raw h1 elements rather than modifying CardTitle component, keeping the fix scoped to auth pages only"

requirements-completed: [A11Y-01]

# Metrics
duration: 2min
completed: 2026-04-09
---

# Phase 07 Plan 04: Auth Page Heading Hierarchy Gap Closure Summary

**Replaced div-based CardTitle with semantic h1 headings on all 6 auth pages**

## Performance

- **Duration:** 2 min
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Replaced CardTitle (renders as `<div>`) with `<h1>` on all customer app auth pages: login, signup, forgot-password, reset-password, magic-link
- Replaced CardTitle with `<h1>` on admin login page
- Removed unused CardTitle imports from all 6 files
- All h1 elements use `text-2xl font-semibold leading-none tracking-tight` matching CardTitle's base styles
- Zero visual regression — identical styling preserved

## Verification

- 8 h1 tags across customer auth pages (login: 1, signup: 1, forgot-password: 2, reset-password: 2, magic-link: 2)
- 1 h1 tag on admin login page
- Zero CardTitle references remaining in auth pages
- All 20 vitest-axe tests pass (no regressions)

## Deviations from Plan

None — plan executed exactly as written.

## Gap Closed

SC-1 heading hierarchy gap from 07-VERIFICATION.md is now fully resolved. All pages across both apps have semantic h1 headings.

---
*Phase: 07-accessibility*
*Completed: 2026-04-09*
