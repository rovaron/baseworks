# Phase 6: Responsive Layouts - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Users on any device see a usable, properly laid-out interface with no content hidden behind sidebars or broken by viewport size. Covers both the customer app (Next.js) and admin dashboard (Vite). Fix sidebar overlay on desktop, add mobile/tablet sidebar modes, and make data tables mobile-friendly.

</domain>

<decisions>
## Implementation Decisions

### Sidebar — Desktop
- **D-01:** Full sidebar visible by default alongside content (no overlay), with a toggle to collapse to icon-only rail
- **D-02:** Collapsed/expanded preference persisted in localStorage so it survives page reloads

### Sidebar — Mobile (<768px)
- **D-03:** Hamburger icon in top bar opens a Sheet drawer from the left side
- **D-04:** Sheet dismisses on navigation (auto-close when user taps a nav item) and on overlay tap

### Sidebar — Tablet (768px–1024px)
- **D-05:** Icon-only rail sidebar by default, expands on hover or click
- **D-06:** Tablet breakpoint range: 768px to 1024px (aligns with existing useIsMobile at 768px)

### Data Tables — Mobile
- **D-07:** Card-based layout on mobile — each table row becomes a stacked card showing top 2–3 priority columns
- **D-08:** Tap-to-expand on card to see all columns (modal or expandable detail section)
- **D-09:** Sort-by dropdown and filter chips above the card list for mobile sorting/filtering
- **D-10:** DataTableCards component built as a shared component in packages/ui alongside existing data-table.tsx

### Data Tables — Column Priority
- **D-11:** Column definitions include a priority/mobile flag so the card view auto-selects which 2–3 fields to display prominently

### Claude's Discretion
- Breakpoint strategy for page-level layouts (spacing, stacking, form layouts on mobile)
- Animation/transition details for sidebar collapse and Sheet drawer
- Exact card design for mobile data tables (spacing, typography, borders)
- Whether tablet sidebar expand is hover-triggered or click-triggered

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs — requirements fully captured in decisions above and REQUIREMENTS.md.

### Requirements
- `.planning/REQUIREMENTS.md` — RESP-01 through RESP-06 define acceptance criteria for responsive layouts

### Existing components
- `packages/ui/src/components/sidebar.tsx` — Current sidebar implementation with SidebarProvider, Sheet integration, mobile detection
- `packages/ui/src/components/sheet.tsx` — Sheet (drawer) component used for mobile sidebar
- `packages/ui/src/hooks/use-mobile.tsx` — useIsMobile() hook at 768px breakpoint
- `apps/admin/src/components/data-table.tsx` — Current TanStack React Table implementation (desktop-only)
- `apps/admin/src/layouts/admin-layout.tsx` — Admin dashboard layout with sidebar
- `apps/web/components/sidebar-nav.tsx` — Customer app sidebar navigation
- `apps/web/app/(dashboard)/layout.tsx` — Customer app dashboard layout

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/ui/src/components/sidebar.tsx` — Already has SidebarProvider with mobile detection, Sheet drawer fallback, and icon collapse variants (sidebar, floating, inset). Foundation for all three breakpoint modes.
- `packages/ui/src/components/sheet.tsx` — Sheet component ready for mobile sidebar drawer
- `packages/ui/src/hooks/use-mobile.tsx` — useIsMobile() hook at 768px, can be extended for tablet detection
- `apps/admin/src/components/data-table.tsx` — TanStack React Table with sorting/pagination, needs card view companion

### Established Patterns
- Tailwind 4 with default breakpoints (sm:640px, md:768px, lg:1024px, xl:1280px) — md aligns with useIsMobile
- shadcn/ui component library in packages/ui shared across both apps
- Both apps use SidebarProvider from the shared UI package

### Integration Points
- Both app layouts import sidebar from packages/ui — changes propagate to both apps
- data-table.tsx in admin already uses TanStack React Table — new card component needs compatible column definitions
- Customer app has its own sidebar-nav.tsx wrapper — needs to support the same responsive modes

</code_context>

<specifics>
## Specific Ideas

- Mobile data table cards should show 2–3 priority fields with tap-to-expand for full details (modal or inline expansion)
- Sidebar toggle preference persisted via localStorage — not session-based

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-responsive-layouts*
*Context gathered: 2026-04-08*
