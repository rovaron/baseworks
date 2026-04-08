# Phase 7: Accessibility - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Users with disabilities can navigate and operate both applications (customer app and admin dashboard) using keyboard, screen readers, and assistive technology. Covers semantic HTML landmarks, keyboard navigation with visible focus indicators, skip-to-content links, aria-live announcements for dynamic content, form accessibility, and automated accessibility testing via vitest-axe.

</domain>

<decisions>
## Implementation Decisions

### Semantic Landmarks
- **D-01:** Mirror admin layout's existing `<header>/<main>` pattern into customer app — add `<header>`, `<nav>`, `<main>`, `<aside>` to customer app dashboard layout matching admin's structure
- **D-02:** Wrap sidebar navigation in `<nav>` element in both apps (currently neither uses `<nav>`)
- **D-03:** Heading hierarchy enforced by convention only (one h1 per page, h2 for sections, h3 for subsections) — no lint rules

### Skip-to-Content
- **D-04:** Hidden-until-focused skip-to-content link on both apps — visually hidden by default, becomes visible when user presses Tab

### Focus Indicators
- **D-05:** Keep existing shadcn focus-visible ring styles (`focus-visible:ring-2 ring-ring ring-offset-2`) — audit for gaps where interactive elements are missing focus styles, but don't restyle
- **D-06:** On route change, move focus to the `<main>` element or page heading so screen readers announce the new page context

### aria-live Regions
- **D-07:** Loading states use `aria-busy=true` on the loading container plus a visually-hidden "Loading..." text for screen readers
- **D-08:** Add `role="alert"` to the existing FormMessage component in `packages/ui` so screen readers immediately announce validation errors
- **D-09:** Toasts already handled by Sonner's built-in aria-live — no changes needed there

### Accessibility Testing
- **D-10:** Install vitest-axe and write tests for shared UI components in `packages/ui` only (not page-level layouts)
- **D-11:** Tests fail on critical and serious axe violations; minor and moderate are warnings only

### Claude's Discretion
- Exact implementation of focus management on route changes (Next.js vs React Router differ)
- Which specific components need focus style gap fixes (discovered during audit)
- How to handle Escape key for closing modals/sheets/dropdowns (Radix UI primitives may already handle this)
- aria-live region placement and politeness level for non-toast dynamic content

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — A11Y-01 through A11Y-06 define acceptance criteria for accessibility

### Existing components (audit targets)
- `packages/ui/src/components/sidebar.tsx` — Sidebar with SidebarProvider, needs `<nav>` wrapper audit
- `packages/ui/src/components/form.tsx` — FormMessage needs `role="alert"`, FormControl already has `aria-describedby` and `aria-invalid`
- `packages/ui/src/components/sonner.tsx` — Toaster component, already has aria-live via Sonner library
- `packages/ui/src/components/button.tsx` — Has focus-visible ring, reference for focus style pattern
- `packages/ui/src/components/dialog.tsx` — Modal with focus trap and close button
- `packages/ui/src/components/sheet.tsx` — Drawer component used for mobile sidebar
- `packages/ui/src/components/input.tsx` — Has focus-visible ring
- `packages/ui/src/components/select.tsx` — Has focus ring
- `packages/ui/src/components/tabs.tsx` — Has focus-visible ring
- `packages/ui/src/components/dropdown-menu.tsx` — Dropdown with keyboard nav via Radix
- `packages/ui/src/components/data-table-cards.tsx` — Mobile data table cards, needs a11y audit

### Layout files (landmark retrofit targets)
- `apps/web/app/(dashboard)/layout.tsx` — Customer dashboard layout, currently has NO semantic landmarks
- `apps/web/app/layout.tsx` — Customer root layout
- `apps/web/app/(auth)/layout.tsx` — Customer auth layout
- `apps/admin/src/layouts/admin-layout.tsx` — Admin layout, already has `<main>` and `<header>`
- `apps/web/components/sidebar-nav.tsx` — Customer sidebar nav component

### Hooks
- `packages/ui/src/hooks/use-mobile.tsx` — useIsMobile() hook, relevant for responsive a11y behavior

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/ui/src/components/form.tsx` — FormControl already wires `aria-describedby` and `aria-invalid`; FormMessage just needs `role="alert"` added
- shadcn focus-visible ring pattern is consistent across button, input, tabs, select, sidebar — can be used as reference for auditing gaps
- Radix UI primitives (dialog, dropdown-menu, sheet) have built-in keyboard navigation and focus trapping
- Sonner toaster has built-in aria-live for toast notifications

### Established Patterns
- Tailwind's `sr-only` utility class available for visually-hidden text (skip link, loading announcements)
- `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` is the standard focus pattern across all shadcn components
- Admin layout uses `<main className="flex-1 p-6">` with `<header>` — customer app should follow same pattern

### Integration Points
- Skip-to-content link should be placed in root layouts of both apps (before sidebar)
- Route change focus management: Next.js (customer app) needs different approach than React Router (admin)
- vitest-axe tests go in `packages/ui` test directory alongside existing component tests

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-accessibility*
*Context gathered: 2026-04-08*
