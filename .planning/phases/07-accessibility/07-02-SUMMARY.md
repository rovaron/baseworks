---
phase: 07-accessibility
plan: 02
subsystem: ui-accessibility
tags: [a11y, aria, focus, screen-reader]
dependency_graph:
  requires: []
  provides: [role-alert-form-message, aria-busy-loading-states, focus-indicators]
  affects: [packages/ui, apps/web, apps/admin]
tech_stack:
  added: []
  patterns: [aria-live-regions, role-alert, aria-busy, sr-only-loading-text]
key_files:
  created: []
  modified:
    - packages/ui/src/components/form.tsx
    - packages/ui/src/components/data-table-cards.tsx
    - apps/web/app/(dashboard)/dashboard/page.tsx
    - apps/web/app/(dashboard)/dashboard/billing/page.tsx
    - apps/admin/src/components/data-table.tsx
    - apps/admin/src/routes/billing/overview.tsx
    - apps/admin/src/routes/system/health.tsx
decisions:
  - Used aria-busy="true" (string) on early-return loading branches since boolean binding is unavailable in those code paths
  - Admin tenants/users loading handled via shared DataTable component rather than individual page files
metrics:
  duration: 162s
  completed: "2026-04-09T10:38:34Z"
  tasks: 2
  files: 7
---

# Phase 07 Plan 02: ARIA Live Regions, Loading States, and Focus Indicators Summary

Screen reader error announcements via role="alert" on FormMessage, aria-busy loading states across both apps, and focus indicator audit with one gap fixed.

## What Was Done

### Task 1: role="alert" on FormMessage + aria-busy loading states

**FormMessage (packages/ui/src/components/form.tsx):**
- Added `role="alert"` to the `<p>` element inside FormMessage
- The existing null guard (`if (!body) { return null }`) prevents the alert from firing on initial page load (Pitfall 4 safe)
- Screen readers now announce validation errors immediately when they appear

**Customer app loading states:**
- `apps/web/app/(dashboard)/dashboard/page.tsx` -- Added aria-busy + aria-live="polite" wrapper around the dashboard card with sr-only "Loading..." text
- `apps/web/app/(dashboard)/dashboard/billing/page.tsx` -- Added aria-busy to SubscriptionCard and BillingHistory loading skeletons with sr-only text

**Admin app loading states:**
- `apps/admin/src/components/data-table.tsx` -- Added aria-busy to both mobile skeleton and desktop table skeleton loading branches with sr-only text. This covers tenants list and users list since they delegate to this shared component.
- `apps/admin/src/routes/billing/overview.tsx` -- Added aria-busy to billing overview skeleton loading state
- `apps/admin/src/routes/system/health.tsx` -- Added aria-busy to system health skeleton loading state

**Pages skipped (no loading state):**
- `apps/web/app/(dashboard)/settings/page.tsx` -- Does not exist in the codebase
- `apps/admin/src/pages/tenants.tsx` -- Plan referenced wrong path; actual path is `apps/admin/src/routes/tenants/list.tsx` which delegates loading to the shared DataTable component (already covered)
- `apps/admin/src/pages/users.tsx` -- Same as above, delegates to DataTable
- `apps/admin/src/pages/billing.tsx` -- Actual path is `apps/admin/src/routes/billing/overview.tsx` (covered directly)
- `apps/admin/src/pages/system.tsx` -- Actual path is `apps/admin/src/routes/system/health.tsx` (covered directly)

### Task 2: Focus indicator audit

| Component | Focus Style | Status | Notes |
|-----------|-------------|--------|-------|
| button.tsx | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` | PASS | Standard pattern |
| dialog.tsx (DialogClose) | `focus:ring-2 focus:ring-ring focus:ring-offset-2` | PASS | Uses Radix `@radix-ui/react-dialog`, Escape handled natively |
| sheet.tsx (SheetClose) | `focus:ring-2 focus:ring-ring focus:ring-offset-2` | PASS | Uses Radix `@radix-ui/react-dialog`, Escape handled natively |
| dropdown-menu.tsx (items) | `focus:bg-accent focus:text-accent-foreground` | PASS | Uses Radix `@radix-ui/react-dropdown-menu`, background highlight is standard for menu items, Escape handled natively |
| data-table-cards.tsx (filter clear btn) | Was missing | FIXED | Added `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| sidebar.tsx (SidebarTrigger) | Inherits from Button | PASS | Uses Button component |
| sidebar.tsx (SidebarMenuButton) | `focus-visible:ring-2` with `ring-sidebar-ring` | PASS | Sidebar-specific ring color |
| sidebar.tsx (SidebarMenuAction) | `focus-visible:ring-2` with `ring-sidebar-ring` | PASS | |
| sidebar.tsx (SidebarMenuSubButton) | `focus-visible:ring-2` with `ring-sidebar-ring` | PASS | |
| sidebar.tsx (SidebarInput) | `focus-visible:ring-2 focus-visible:ring-sidebar-ring` | PASS | |
| sidebar.tsx (SidebarGroupLabel) | `focus-visible:ring-2` with `ring-sidebar-ring` | PASS | |
| sidebar.tsx (SidebarGroupAction) | `focus-visible:ring-2` with `ring-sidebar-ring` | PASS | |

**Escape key verification:** Dialog, Sheet, and DropdownMenu all use Radix UI primitives which handle Escape key natively. No custom handlers needed.

## Deviations from Plan

### Path Corrections

**1. [Rule 3 - Blocking] Corrected file paths from plan**
- Plan referenced `apps/web/app/(dashboard)/page.tsx` -- actual path is `apps/web/app/(dashboard)/dashboard/page.tsx`
- Plan referenced `apps/web/app/(dashboard)/billing/page.tsx` -- actual path is `apps/web/app/(dashboard)/dashboard/billing/page.tsx`
- Plan referenced `apps/web/app/(dashboard)/settings/page.tsx` -- file does not exist
- Plan referenced `apps/admin/src/pages/*.tsx` -- actual paths use `apps/admin/src/routes/` directory structure
- All actual files were found and modified correctly

### Scope Adjustments

**2. [Rule 2 - Missing critical] Added aria-busy to admin DataTable shared component**
- Instead of modifying individual admin page files (which don't handle loading directly), added aria-busy to the shared DataTable component in `apps/admin/src/components/data-table.tsx`
- This covers both tenants and users lists automatically

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | c4b0469 | feat(07-02): add role=alert to FormMessage and aria-busy to loading states |
| 2 | b916295 | feat(07-02): fix focus indicator gap on data-table-cards filter button |

## Self-Check: PASSED

All 7 modified files verified present. Both commits (c4b0469, b916295) verified in git log.
