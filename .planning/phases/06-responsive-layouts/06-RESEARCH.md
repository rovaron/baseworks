# Phase 6: Responsive Layouts - Research

**Researched:** 2026-04-08
**Domain:** Responsive UI / CSS / React component architecture
**Confidence:** HIGH

## Summary

Phase 6 requires making both the customer app (Next.js) and admin dashboard (Vite) fully responsive across three breakpoint tiers: mobile (<768px), tablet (768px-1024px), and desktop (>1024px). The existing sidebar component from shadcn/ui (`packages/ui/src/components/sidebar.tsx`) already contains substantial responsive infrastructure -- it has a `SidebarProvider` with mobile detection, Sheet drawer fallback for mobile, and icon-collapse support. The primary work is: (1) fixing the desktop sidebar to not overlay content, (2) adding a tablet breakpoint mode (icon-only rail), (3) persisting sidebar state to localStorage instead of cookies, (4) building a mobile-friendly card alternative for data tables, and (5) auditing all pages for horizontal overflow.

The existing codebase uses Tailwind 4 breakpoints (md:768px, lg:1024px) which align perfectly with the decided breakpoint strategy. The `useIsMobile` hook at 768px matches the `md` breakpoint. A new `useBreakpoint` hook (or extending `useIsMobile`) is needed to distinguish the tablet range (768px-1024px).

**Primary recommendation:** Extend the existing shadcn sidebar component with a three-tier breakpoint system and build a `DataTableCards` companion component in `packages/ui` that reads column priority metadata from TanStack React Table column definitions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Full sidebar visible by default alongside content (no overlay), with a toggle to collapse to icon-only rail
- **D-02:** Collapsed/expanded preference persisted in localStorage so it survives page reloads
- **D-03:** Hamburger icon in top bar opens a Sheet drawer from the left side
- **D-04:** Sheet dismisses on navigation (auto-close when user taps a nav item) and on overlay tap
- **D-05:** Icon-only rail sidebar by default, expands on hover or click
- **D-06:** Tablet breakpoint range: 768px to 1024px (aligns with existing useIsMobile at 768px)
- **D-07:** Card-based layout on mobile -- each table row becomes a stacked card showing top 2-3 priority columns
- **D-08:** Tap-to-expand on card to see all columns (modal or expandable detail section)
- **D-09:** Sort-by dropdown and filter chips above the card list for mobile sorting/filtering
- **D-10:** DataTableCards component built as a shared component in packages/ui alongside existing data-table.tsx
- **D-11:** Column definitions include a priority/mobile flag so the card view auto-selects which 2-3 fields to display prominently

### Claude's Discretion
- Breakpoint strategy for page-level layouts (spacing, stacking, form layouts on mobile)
- Animation/transition details for sidebar collapse and Sheet drawer
- Exact card design for mobile data tables (spacing, typography, borders)
- Whether tablet sidebar expand is hover-triggered or click-triggered

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RESP-01 | User sees sidebar that doesn't overlay page content on desktop | Sidebar component already uses `position: fixed` with a spacer div for gap. Current `collapsible="offcanvas"` hides sidebar completely. Customer app uses `collapsible="icon"` which works correctly. Admin app uses default `collapsible="offcanvas"`. Fix: admin should use `collapsible="icon"` or similar non-overlay mode. |
| RESP-02 | User can toggle sidebar via hamburger menu on mobile, sees Sheet drawer | Already partially implemented -- `Sidebar` renders a `Sheet` when `isMobile` is true. Need: hamburger trigger in top bar, auto-dismiss on nav click. |
| RESP-03 | User sees collapsible sidebar on tablet breakpoints | Need new tablet detection (768px-1024px). Sidebar should default to collapsed (icon rail) on tablet, expandable on hover/click. |
| RESP-04 | User can browse data tables on mobile via card-based layout | New `DataTableCards` component needed in packages/ui. Reads column priority metadata from TanStack column defs. |
| RESP-05 | User experiences fully responsive layouts on all customer app pages | Audit: dashboard page, billing page (plans grid, subscription card, history). Most already use responsive grid classes. |
| RESP-06 | User experiences fully responsive layouts on all admin dashboard pages | Audit: tenants list, users list, tenant detail, user detail, billing overview, system health. Detail pages already use `grid-cols-1 lg:grid-cols-2`. List pages need card view on mobile. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Runtime**: Bun -- all packages must be Bun-compatible
- **Styling**: Tailwind 4 + shadcn/ui -- no other CSS frameworks
- **Linter**: Biome
- **Package manager**: Bun workspaces
- **Frontend customer**: Next.js 15+ with App Router
- **Frontend admin**: Vite + React Router
- **UI library**: shadcn/ui in packages/ui, shared across both apps

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS | 4.x | Responsive utilities | Already used. Provides `sm:`, `md:`, `lg:`, `xl:` breakpoints out of the box. `md:768px` and `lg:1024px` align with decision D-06. [VERIFIED: codebase] |
| shadcn/ui sidebar | N/A (source) | Sidebar component | Already in `packages/ui/src/components/sidebar.tsx`. Has SidebarProvider, Sheet integration, icon collapse, mobile detection. [VERIFIED: codebase] |
| shadcn/ui sheet | N/A (source) | Drawer component | Already in `packages/ui/src/components/sheet.tsx`. Uses Radix Dialog. Has left-side variant. [VERIFIED: codebase] |
| @tanstack/react-table | 8.x | Table management | Already used in admin data-table.tsx. Column definitions support custom metadata via `meta` property. [VERIFIED: codebase] |
| @radix-ui/react-collapsible | -- | Expandable sections | May be useful for tap-to-expand card detail. Already a shadcn component that can be added via CLI. [ASSUMED] |

### No New Dependencies Required

This phase requires zero new npm packages. Everything is achievable with existing Tailwind utilities, the existing shadcn components, and small custom hooks. This is a CSS/component architecture task, not a library integration task.

## Architecture Patterns

### Recommended Changes to Project Structure
```
packages/ui/src/
  hooks/
    use-mobile.tsx          # MODIFY: extend to useBreakpoint or add useIsTablet
  components/
    sidebar.tsx             # MODIFY: add tablet mode, localStorage persistence
    data-table-cards.tsx    # NEW: mobile card view for data tables
```

### Pattern 1: Three-Tier Breakpoint Hook
**What:** Extend the existing `useIsMobile` hook to support mobile/tablet/desktop detection
**When to use:** Any component that needs to render differently per breakpoint tier
**Example:**
```typescript
// Source: custom pattern based on existing useIsMobile
const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

type Breakpoint = "mobile" | "tablet" | "desktop";

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = React.useState<Breakpoint>("desktop");

  React.useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      if (width < MOBILE_BREAKPOINT) setBreakpoint("mobile");
      else if (width < TABLET_BREAKPOINT) setBreakpoint("tablet");
      else setBreakpoint("desktop");
    };

    // Use matchMedia for efficient change detection
    const mobileMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const tabletMql = window.matchMedia(`(max-width: ${TABLET_BREAKPOINT - 1}px)`);
    
    mobileMql.addEventListener("change", update);
    tabletMql.addEventListener("change", update);
    update();

    return () => {
      mobileMql.removeEventListener("change", update);
      tabletMql.removeEventListener("change", update);
    };
  }, []);

  return breakpoint;
}

// Keep useIsMobile for backward compatibility
export function useIsMobile() {
  return useBreakpoint() === "mobile";
}
```

### Pattern 2: Sidebar State Persistence via localStorage
**What:** Replace the current cookie-based persistence with localStorage
**When to use:** SidebarProvider initialization
**Current behavior:** Uses `document.cookie` with `sidebar_state` cookie (line 93 of sidebar.tsx) [VERIFIED: codebase]
**New behavior:** Read/write `localStorage.getItem("sidebar_state")` / `localStorage.setItem("sidebar_state", ...)`. Simpler, no expiry concerns, purely client-side.
```typescript
// In SidebarProvider:
const [_open, _setOpen] = React.useState(() => {
  if (typeof window === "undefined") return true; // SSR fallback
  const stored = localStorage.getItem("sidebar_state");
  return stored !== null ? stored === "true" : true; // default open
});

// In setOpen callback:
localStorage.setItem("sidebar_state", String(openState));
// Remove the cookie line
```

### Pattern 3: Column Priority Metadata for Mobile Cards
**What:** Extend TanStack React Table column definitions with a `meta.priority` field
**When to use:** Any table that needs mobile card rendering
**Example:**
```typescript
// Source: TanStack React Table meta property [ASSUMED]
const columns: ColumnDef<User, any>[] = [
  {
    accessorKey: "name",
    header: "Name",
    meta: { priority: 1 }, // shown on card summary
  },
  {
    accessorKey: "email",
    header: "Email",
    meta: { priority: 2 }, // shown on card summary
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    meta: { priority: 3 }, // hidden on card, shown in expand
  },
  {
    id: "status",
    header: "Status",
    meta: { priority: 1 }, // shown on card summary (badges are compact)
  },
  {
    id: "actions",
    header: "",
    meta: { priority: 0, cardHidden: true }, // never show in card, handled separately
  },
];
```

### Pattern 4: DataTableCards Component
**What:** A companion to `DataTable` that renders rows as cards on mobile
**When to use:** Automatically via a responsive wrapper, or manually with `useIsMobile()`
**Design:**
```typescript
// packages/ui/src/components/data-table-cards.tsx
interface DataTableCardsProps<TData> {
  table: ReactTable<TData>;          // same TanStack table instance
  priorityCount?: number;            // how many priority columns to show (default: 3)
  onRowClick?: (row: TData) => void; // optional tap handler
  renderActions?: (row: TData) => React.ReactNode; // row action menu
  sortOptions?: { label: string; value: string }[];
  onSortChange?: (value: string) => void;
  currentSort?: string;
}
```
The component reads `column.columnDef.meta?.priority` to decide which fields appear in the card summary vs. the expandable detail section.

### Pattern 5: Auto-Close Sheet on Navigation
**What:** Dismiss the mobile sidebar Sheet when a nav item is clicked
**Admin app:** Call `setOpenMobile(false)` in the nav item click handler via `useSidebar()` context [VERIFIED: useSidebar exposes setOpenMobile]
**Customer app:** Use Next.js `usePathname()` in a `useEffect` to close Sheet on route change
```typescript
// In SidebarNav or a wrapper:
const pathname = usePathname();
const { setOpenMobile } = useSidebar();

React.useEffect(() => {
  setOpenMobile(false);
}, [pathname, setOpenMobile]);
```

### Anti-Patterns to Avoid
- **Using CSS `display: none` for responsive switching:** Renders both views in the DOM. Instead, use the JS hook to conditionally render only the active view (table OR cards, not both).
- **Duplicating sidebar logic per app:** Both apps import from `packages/ui`. All breakpoint logic belongs in the shared sidebar component.
- **Hardcoded breakpoint values in CSS and JS:** Define breakpoint constants once in the hook, use Tailwind's built-in `md:` and `lg:` for CSS. Do not create custom Tailwind breakpoints -- the defaults align perfectly.
- **Using `overflow-x: auto` as a fix for mobile tables:** This technically works but creates a poor mobile UX. Card-based layout is the correct solution per D-07.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sheet/drawer component | Custom slide-in panel | shadcn/ui Sheet (Radix Dialog) | Animation, overlay, focus trap, keyboard dismiss already handled [VERIFIED: codebase] |
| Responsive detection | CSS-only media queries for component logic | `useBreakpoint()` hook with `matchMedia` | Need JS-level branching for conditional rendering (table vs cards) |
| Collapsible card sections | Custom expand/collapse with state | Radix Collapsible or simple `useState` + CSS transition | Radix handles animation, accessibility; but for simple expand a `useState` is fine |
| Tooltip on icon-only sidebar | Custom tooltip | shadcn/ui Tooltip (already wired in SidebarMenuButton) | Already integrated in sidebar.tsx [VERIFIED: codebase] |

## Common Pitfalls

### Pitfall 1: SSR Hydration Mismatch with Breakpoint Hooks
**What goes wrong:** `useBreakpoint()` returns "desktop" on server (no `window`), but client renders "mobile" -- React hydration error.
**Why it happens:** Next.js renders on server where `window.innerWidth` is unavailable.
**How to avoid:** Initialize state as `undefined` or a safe default, render a consistent skeleton/loading state until client-side hydration completes. The existing `useIsMobile` already handles this by initializing as `undefined` and casting with `!!isMobile`. Follow the same pattern.
**Warning signs:** "Hydration mismatch" console errors, content flash on load.

### Pitfall 2: Sidebar State Cookie vs localStorage in SSR
**What goes wrong:** Current sidebar uses cookies so Next.js server can read the state. Switching to localStorage means server cannot read it.
**Why it happens:** localStorage is client-only.
**How to avoid:** Accept a brief flash or default state on first server render. Since the sidebar starts expanded by default, this is acceptable -- the user sees the default, then localStorage adjusts if needed. For the admin dashboard (Vite SPA, no SSR), this is a non-issue.
**Warning signs:** Sidebar flickers between states on page load in the customer app.

### Pitfall 3: Fixed Sidebar Width Not Accounted in Main Content
**What goes wrong:** Sidebar is `position: fixed` but main content doesn't have matching padding/margin, causing content to render behind the sidebar.
**Why it happens:** The sidebar.tsx spacer div (line 237-244) creates a gap, but only when the sidebar is mounted. If the spacer width doesn't match the actual sidebar width, content overlaps.
**How to avoid:** The existing pattern uses a spacer div with `w-[--sidebar-width]` that transitions to `w-[--sidebar-width-icon]` when collapsed. This is correct. Verify the admin layout uses `SidebarInset` (it does) which handles the flex layout properly. [VERIFIED: codebase]

### Pitfall 4: Touch Target Size on Mobile
**What goes wrong:** Buttons and nav items are too small to tap comfortably on mobile (< 44px).
**Why it happens:** Desktop-optimized sizing.
**How to avoid:** Both sidebar nav implementations already use `min-h-11` (44px) or `min-h-[44px]` for touch targets. Maintain this in card action buttons. [VERIFIED: codebase]

### Pitfall 5: Horizontal Overflow from Fixed-Width Elements
**What goes wrong:** Page has horizontal scroll on mobile due to elements with fixed widths exceeding viewport.
**Why it happens:** Common culprits: tables with many columns, pre/code blocks, badges with long text, images without max-width.
**How to avoid:** Audit each page at 375px viewport. Use `overflow-hidden` on the root layout and `max-w-full` / `truncate` on text-heavy elements. The card view for tables eliminates the main culprit.

## Code Examples

### Existing Sidebar Desktop Behavior (Current State)
```typescript
// Source: packages/ui/src/components/sidebar.tsx [VERIFIED: codebase]
// The Sidebar component already handles three rendering paths:
// 1. collapsible="none" -- always visible, no collapse
// 2. isMobile -- renders Sheet drawer
// 3. Desktop -- renders fixed sidebar with spacer div

// Customer app uses collapsible="icon" -- collapses to icon rail
// Admin app uses default collapsible="offcanvas" -- hides completely (the overlay issue)
```

### Admin Layout Fix (RESP-01)
```typescript
// Source: apps/admin/src/layouts/admin-layout.tsx [VERIFIED: codebase]
// Current: <Sidebar> (defaults to collapsible="offcanvas")
// Fix: <Sidebar collapsible="icon"> to match customer app behavior
// This single prop change fixes the desktop overlay issue.
```

### Mobile Nav Auto-Close (RESP-02 / D-04)
```typescript
// For admin (React Router):
const { setOpenMobile } = useSidebar();
const location = useLocation();

React.useEffect(() => {
  setOpenMobile(false);
}, [location.pathname, setOpenMobile]);

// For customer app (Next.js):
const { setOpenMobile } = useSidebar();
const pathname = usePathname();

React.useEffect(() => {
  setOpenMobile(false);
}, [pathname, setOpenMobile]);
```

### Tablet Sidebar Behavior (RESP-03)
```typescript
// Approach: In the Sidebar component, detect tablet and force collapsed state
// The sidebar already supports data-state="collapsed" with icon mode
// For tablet: default to collapsed, allow expand on hover

// In SidebarProvider, add tablet awareness:
const breakpoint = useBreakpoint();
const isTablet = breakpoint === "tablet";

// When tablet, force sidebar to collapsed state by default
// and add hover behavior to temporarily expand
```

### DataTableCards Mobile View (RESP-04)
```typescript
// Skeleton of the card component:
function DataTableCards<TData>({ table, priorityCount = 3 }: Props<TData>) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rows = table.getRowModel().rows;
  const allColumns = table.getAllColumns();
  
  // Split columns by priority
  const priorityCols = allColumns
    .filter(col => {
      const priority = (col.columnDef.meta as any)?.priority;
      return priority !== undefined && priority > 0 && priority <= priorityCount;
    })
    .sort((a, b) => 
      ((a.columnDef.meta as any)?.priority ?? 99) - ((b.columnDef.meta as any)?.priority ?? 99)
    );
  
  const detailCols = allColumns.filter(col => {
    const meta = col.columnDef.meta as any;
    return !meta?.cardHidden && (meta?.priority === undefined || meta.priority > priorityCount);
  });

  return (
    <div className="space-y-3">
      {rows.map(row => (
        <Card key={row.id} onClick={() => setExpandedId(
          expandedId === row.id ? null : row.id
        )}>
          <CardContent className="p-4">
            {/* Priority fields */}
            {priorityCols.map(col => (
              <div key={col.id}>
                <span className="text-xs text-muted-foreground">{col.columnDef.header as string}</span>
                <span>{flexRender(col.columnDef.cell, row.getAllCells().find(c => c.column.id === col.id)!.getContext())}</span>
              </div>
            ))}
            {/* Expanded details */}
            {expandedId === row.id && detailCols.map(col => (
              /* render remaining columns */
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CSS media queries only | CSS + JS hooks for conditional rendering | Standard practice | Avoids rendering unused DOM; better for table-to-card switch |
| `position: absolute` sidebars | `position: fixed` + flex spacer | shadcn sidebar pattern | Sidebar stays visible during scroll, content naturally fills remaining space |
| Cookie-based UI state | localStorage for client-only state | General best practice | Simpler, no server concerns for purely cosmetic preferences |
| Responsive tables via horizontal scroll | Card-based mobile views | ~2020+ | Better mobile UX, no horizontal scrolling |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TanStack React Table `ColumnDef.meta` property accepts arbitrary metadata including custom `priority` field | Architecture Patterns - Pattern 3 | LOW -- meta is a well-known escape hatch, but exact typing needs verification |
| A2 | Radix Collapsible component is available via shadcn CLI for tap-to-expand cards | Standard Stack | LOW -- can use simple useState + CSS transition instead |

## Open Questions

1. **Tablet sidebar: hover or click to expand?**
   - What we know: D-05 says "expands on hover or click" -- user left this to Claude's discretion
   - Recommendation: Use **hover** with a 200ms delay on desktop/tablet (via CSS `group-hover`), plus click as fallback for touch devices. The sidebar already supports hover via CSS `group-data-[collapsible=icon]` selectors. Hover is more natural on tablet with mouse; for touch tablets, the tap on the icon rail item navigates directly (tooltip shows label).

2. **Should DataTableCards live in packages/ui or stay in admin?**
   - What we know: D-10 explicitly says "built as a shared component in packages/ui"
   - Recommendation: Place in `packages/ui/src/components/data-table-cards.tsx`. Even though only admin currently uses data tables, the customer app may add them later, and packages/ui is the shared location.

3. **Billing overview page has a raw `<Table>` (not DataTable component)**
   - What we know: `apps/admin/src/routes/billing/overview.tsx` uses `<Table>` directly for recent subscriptions, not the DataTable component
   - Recommendation: Either wrap it in DataTable for consistency and mobile card view, or make it responsive with a simpler stacked layout since it only shows 4 columns and max 10 rows.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (frontend), bun test (backend) |
| Config file | Existing in each app |
| Quick run command | `bun run test` in respective app |
| Full suite command | `bun run test` from root |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RESP-01 | Sidebar doesn't overlay content on desktop | manual | Visual inspection at 1440px | N/A |
| RESP-02 | Mobile sidebar via hamburger, Sheet drawer | manual | Visual inspection at 375px | N/A |
| RESP-03 | Collapsible sidebar on tablet | manual | Visual inspection at 768px-1024px | N/A |
| RESP-04 | Data tables show cards on mobile | unit | Test DataTableCards renders priority cols | Wave 0 |
| RESP-05 | Customer app responsive | manual | Visual inspection at 375px, 768px, 1440px | N/A |
| RESP-06 | Admin dashboard responsive | manual | Visual inspection at 375px, 768px, 1440px | N/A |

### Sampling Rate
- **Per task commit:** Visual check at 3 viewports (375px, 768px, 1440px)
- **Per wave merge:** Full page audit across both apps
- **Phase gate:** No horizontal overflow at any viewport, all sidebar modes functional

### Wave 0 Gaps
- [ ] `packages/ui/src/components/__tests__/data-table-cards.test.tsx` -- covers RESP-04 priority column rendering
- Note: Most RESP requirements are visual/layout and require manual inspection rather than automated tests

## Security Domain

No security implications for this phase. All changes are purely presentational (CSS, component rendering logic). No new API endpoints, no data access changes, no auth modifications.

## Sources

### Primary (HIGH confidence)
- Codebase inspection of `packages/ui/src/components/sidebar.tsx` -- full sidebar implementation with SidebarProvider, Sheet, mobile detection, icon collapse
- Codebase inspection of `packages/ui/src/hooks/use-mobile.tsx` -- breakpoint hook at 768px
- Codebase inspection of `apps/admin/src/layouts/admin-layout.tsx` -- admin layout using SidebarProvider with default offcanvas mode
- Codebase inspection of `apps/web/components/sidebar-nav.tsx` -- customer sidebar using `collapsible="icon"`
- Codebase inspection of `apps/admin/src/components/data-table.tsx` -- current desktop-only table component
- Codebase inspection of all admin routes and customer app pages -- full inventory of pages requiring responsive treatment

### Secondary (MEDIUM confidence)
- TanStack React Table `meta` property documentation -- column metadata is a standard feature [ASSUMED but well-known]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries verified in codebase
- Architecture: HIGH -- patterns derive from existing component analysis and established responsive patterns
- Pitfalls: HIGH -- based on direct codebase inspection (SSR patterns, sidebar implementation details)

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable -- pure CSS/component work, no rapidly evolving dependencies)
