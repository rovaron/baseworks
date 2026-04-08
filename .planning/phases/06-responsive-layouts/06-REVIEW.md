---
phase: 06-responsive-layouts
reviewed: 2026-04-08T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - apps/admin/src/components/data-table.tsx
  - apps/admin/src/layouts/admin-layout.tsx
  - apps/admin/src/routes/billing/overview.tsx
  - apps/admin/src/routes/tenants/detail.tsx
  - apps/admin/src/routes/tenants/list.tsx
  - apps/admin/src/routes/users/detail.tsx
  - apps/admin/src/routes/users/list.tsx
  - apps/web/app/(dashboard)/dashboard/billing/page.tsx
  - apps/web/app/(dashboard)/layout.tsx
  - apps/web/components/sidebar-nav.tsx
  - packages/ui/src/components/__tests__/data-table-cards.test.tsx
  - packages/ui/src/components/data-table-cards.tsx
  - packages/ui/src/components/sidebar.tsx
  - packages/ui/src/hooks/use-mobile.tsx
  - packages/ui/src/index.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-04-08
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

This phase delivers responsive layouts — a new `DataTableCards` component for mobile table rendering, a sidebar refactor with tablet hover-expand behavior, and updates to multiple admin and web routes. The implementation is well-structured overall, with clean mobile/desktop branching and good use of the `useBreakpoint` hook. One critical React Rules of Hooks violation was found in the billing overview route. Three warnings cover a TypeScript type mismatch in the sidebar ref, missing defensive validation for API date values across detail routes, and the uncontrolled sort Select in `DataTableCards` not reflecting current sort state.

## Critical Issues

### CR-01: Rules of Hooks violation — `useIsMobile` called after conditional early returns

**File:** `apps/admin/src/routes/billing/overview.tsx:79`
**Issue:** `useIsMobile()` is called on line 79 after two early returns at lines 34 and 54 (the error state and the loading state). React requires all hooks to be called in the same order on every render, unconditionally and before any early returns. If the component renders the error or loading branch, the hook call is skipped, causing React to throw a "Rendered fewer hooks than expected" error on subsequent renders that reach the hook.
**Fix:** Move `useIsMobile()` to the top of the component, before all conditional returns:

```tsx
export function Component() {
  const { data: result, isLoading, error, refetch } = useQuery({ ... });
  const isMobile = useIsMobile(); // Move here — before any early returns

  if (error) { ... }        // early return OK now
  // ...
  if (isLoading) { ... }    // early return OK now

  const billing = result as any;
  // isMobile is already declared above — remove duplicate declaration
```

## Warnings

### WR-01: TypeScript type mismatch on `hoverTimeoutRef` — `undefined` not assignable to `ReturnType<typeof setTimeout>`

**File:** `packages/ui/src/components/sidebar.tsx:202`
**Issue:** `React.useRef<ReturnType<typeof setTimeout>>(undefined)` passes `undefined` as the initial value, but the generic type `ReturnType<typeof setTimeout>` does not include `undefined`. In strict TypeScript mode this produces a type error. The ref is immediately used with `clearTimeout(hoverTimeoutRef.current)` on unmount and in mouse handlers; accessing `.current` when it holds `undefined` will call `clearTimeout(undefined)` which is harmless in browsers, but the type contract is broken.
**Fix:** Widen the generic to include `undefined`:

```tsx
const hoverTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
```

### WR-02: Unguarded `new Date()` on API-provided date strings across detail and list routes

**File:** `apps/admin/src/routes/tenants/detail.tsx:112`, `apps/admin/src/routes/users/detail.tsx:142`, `apps/admin/src/routes/tenants/list.tsx:90`, `apps/admin/src/routes/users/list.tsx:109`
**Issue:** `formatDistanceToNow(new Date(tenant.createdAt), ...)` and equivalent calls receive values typed as `any` from the API. If the API returns `null`, an empty string, or an unexpected format, `new Date(value)` produces an Invalid Date and `date-fns` will throw an uncaught runtime error, crashing the component tree with no error boundary to catch it.
**Fix:** Add a guard before each `formatDistanceToNow` call, either inline or as a small helper:

```tsx
// Inline guard in cell renderer (list):
cell: ({ row }) => {
  const d = row.original.createdAt ? new Date(row.original.createdAt) : null;
  return d && !isNaN(d.getTime())
    ? formatDistanceToNow(d, { addSuffix: true })
    : "—";
},

// In detail component:
const createdAt = tenant.createdAt ? new Date(tenant.createdAt) : null;
// ...
<p>{createdAt && !isNaN(createdAt.getTime())
  ? formatDistanceToNow(createdAt, { addSuffix: true })
  : "—"}</p>
```

### WR-03: Sort `Select` in `DataTableCards` is uncontrolled — active sort state is not reflected in the UI

**File:** `packages/ui/src/components/data-table-cards.tsx:103-122`
**Issue:** The `Select` component that triggers column sorting has no `value` prop, so it always renders the placeholder "Sort by" regardless of the current sort state in the table. If the user selects a sort, the dropdown shows "Sort by" again immediately (because `onValueChange` only fires and no controlled value re-renders it). Additionally, toggling sort direction is not possible — each selection always calls `col.toggleSorting()` with no `desc` argument, so clicking the same column twice alternates direction, but the user gets no visual feedback of the current sort direction from the select.
**Fix:** Derive a controlled value from the table's current sort state and pass it to the `Select`:

```tsx
const sortingState = table.getState().sorting;
const currentSortId = sortingState[0]?.id ?? "";

<Select
  value={currentSortId}
  onValueChange={(value) => {
    const col = allColumns.find((c) => c.id === value);
    if (col) col.toggleSorting();
  }}
>
  <SelectTrigger className="w-[180px]">
    <SelectValue placeholder="Sort by" />
  </SelectTrigger>
  ...
</Select>
```

## Info

### IN-01: `idx` parameter declared but never used in `DataTableCards` priority columns loop

**File:** `packages/ui/src/components/data-table-cards.tsx:164`
**Issue:** `priorityColumns.map((col, idx) => {` — the `idx` variable is declared but never referenced. The logic uses `meta.priority` to distinguish rendering style, not the loop index.
**Fix:** Remove the unused parameter:

```tsx
{priorityColumns.map((col) => {
```

### IN-02: `pageSize` prop accepted but never used in `DataTableProps`

**File:** `apps/admin/src/components/data-table.tsx:34`
**Issue:** `pageSize?: number` is declared in the `DataTableProps` interface and destructuring on line 48 omits it intentionally (it is used nowhere in the component body). It is a dead prop that adds noise to the public API and could mislead callers into thinking it has an effect.
**Fix:** Remove `pageSize` from the interface and any call sites that pass it, or implement it if it was intended to control visible rows per page.

---

_Reviewed: 2026-04-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
