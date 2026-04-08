# Phase 6: Responsive Layouts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 06-responsive-layouts
**Areas discussed:** Sidebar behavior, Data table mobile

---

## Sidebar behavior

### Desktop sidebar

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed alongside content | Sidebar always visible, page content shifts right. Standard SaaS pattern. | |
| Collapsible to icons | Sidebar can collapse to icon-only rail, content expands. User toggles. | |
| Both modes with toggle | Full sidebar by default, user can collapse to icon rail. Remembers preference. | ✓ |

**User's choice:** Both modes with toggle — full sidebar by default, collapsible to icon rail, preference persisted in localStorage.

### Mobile sidebar (<768px)

| Option | Description | Selected |
|--------|-------------|----------|
| Hamburger + Sheet drawer | Hamburger icon opens Sheet from left. Dismisses on nav or overlay tap. | ✓ |
| Bottom sheet | Swipe up or tap icon for bottom drawer with nav items. | |
| Full-screen overlay | Nav takes over entire screen when opened. | |

**User's choice:** Hamburger + Sheet drawer (recommended)

### Tablet sidebar (768px–1024px)

| Option | Description | Selected |
|--------|-------------|----------|
| Icon-only rail by default | Collapsed to icons, expands on hover or click. Saves screen space. | ✓ |
| Same as mobile (Sheet drawer) | Hidden sidebar, hamburger to open. | |
| Same as desktop (full sidebar) | Show full sidebar on tablet. | |

**User's choice:** Icon-only rail by default (recommended)

### Auto-close on mobile navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, auto-close on navigation | Sheet dismisses when user taps a nav item. | ✓ |
| No, stay open | User must explicitly close. | |
| You decide | Claude picks the best approach. | |

**User's choice:** Yes, auto-close on navigation (recommended)

---

## Data table mobile

### Mobile table layout

| Option | Description | Selected |
|--------|-------------|----------|
| Card-based layout | Each row becomes a card showing key fields. Cards stack vertically. | ✓ |
| Horizontal scroll table | Keep the table but allow horizontal scrolling. | |
| Hybrid — cards below md, table above | Responsive switch per breakpoint. | |

**User's choice:** Card-based layout (recommended)

### Sort/filter on mobile

| Option | Description | Selected |
|--------|-------------|----------|
| Dropdown selectors above cards | Sort-by dropdown and filter chips above the card list. | ✓ |
| Bottom sheet with options | Tap a filter/sort icon to open a bottom sheet. | |
| You decide | Claude picks. | |

**User's choice:** Dropdown selectors above cards (recommended)

### Shared vs per-app component

| Option | Description | Selected |
|--------|-------------|----------|
| Shared in packages/ui | DataTableCards component in the shared UI package. | ✓ |
| Per-app implementation | Each app builds its own card layout. | |
| You decide | Claude picks based on overlap. | |

**User's choice:** Shared in packages/ui (recommended)

### Card field selection

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-pick primary 2–3 columns | Column definitions include a priority flag. Card shows top fields. | |
| Show all columns stacked | Every column as label:value in the card. | |
| You decide | Claude picks. | |

**User's choice:** (Custom) Auto-pick 2–3 priority columns with tap-to-expand (modal or expandable detail) to view all fields.
**Notes:** User wants priority-based display with expandable access to full data.

---

## Claude's Discretion

- Breakpoint strategy for page-level layouts
- Animation/transition details for sidebar and Sheet
- Exact card design for mobile data tables
- Tablet sidebar expand trigger (hover vs click)

## Deferred Ideas

None — discussion stayed within phase scope
