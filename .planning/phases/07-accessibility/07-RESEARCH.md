# Phase 7: Accessibility - Research

**Researched:** 2026-04-08
**Domain:** Web accessibility (WCAG 2.1 AA), semantic HTML, keyboard navigation, screen reader support, automated a11y testing
**Confidence:** HIGH

## Summary

Phase 7 retrofits accessibility into the existing Baseworks customer app (Next.js) and admin dashboard (Vite + React Router). The codebase already has strong foundations: shadcn/ui components use Radix UI primitives with built-in focus trapping, keyboard navigation, and Escape key handling for dialogs, dropdowns, and sheets. The focus-visible ring pattern (`focus-visible:ring-2 ring-ring ring-offset-2`) is consistently applied across button, input, tabs, and select components. Sonner toasts already have aria-live support.

The gaps are well-scoped: the customer app dashboard layout lacks semantic landmarks (`<nav>`, `<main>`, `<header>`), neither app has skip-to-content links, FormMessage lacks `role="alert"`, loading states lack `aria-busy` / screen reader text, and there are no automated accessibility tests. Route change focus management requires custom hooks in both apps since neither Next.js App Router nor React Router provide it out of the box.

**Primary recommendation:** Implement in layers -- semantic landmarks first, then skip-to-content, then focus/keyboard audit, then aria-live regions, then automated tests. This order lets each layer build on the previous.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Mirror admin layout's existing `<header>/<main>` pattern into customer app -- add `<header>`, `<nav>`, `<main>`, `<aside>` to customer app dashboard layout matching admin's structure
- **D-02:** Wrap sidebar navigation in `<nav>` element in both apps (currently neither uses `<nav>`)
- **D-03:** Heading hierarchy enforced by convention only (one h1 per page, h2 for sections, h3 for subsections) -- no lint rules
- **D-04:** Hidden-until-focused skip-to-content link on both apps -- visually hidden by default, becomes visible when user presses Tab
- **D-05:** Keep existing shadcn focus-visible ring styles -- audit for gaps where interactive elements are missing focus styles, but don't restyle
- **D-06:** On route change, move focus to the `<main>` element or page heading so screen readers announce the new page context
- **D-07:** Loading states use `aria-busy=true` on the loading container plus a visually-hidden "Loading..." text for screen readers
- **D-08:** Add `role="alert"` to the existing FormMessage component in `packages/ui` so screen readers immediately announce validation errors
- **D-09:** Toasts already handled by Sonner's built-in aria-live -- no changes needed there
- **D-10:** Install vitest-axe and write tests for shared UI components in `packages/ui` only (not page-level layouts)
- **D-11:** Tests fail on critical and serious axe violations; minor and moderate are warnings only

### Claude's Discretion
- Exact implementation of focus management on route changes (Next.js vs React Router differ)
- Which specific components need focus style gap fixes (discovered during audit)
- How to handle Escape key for closing modals/sheets/dropdowns (Radix UI primitives may already handle this)
- aria-live region placement and politeness level for non-toast dynamic content

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| A11Y-01 | User navigates pages with proper semantic HTML landmarks (nav, main, aside, headings) | D-01, D-02, D-03: Landmark retrofit pattern documented; admin already has `<header>` and `<main>`, customer app needs full retrofit |
| A11Y-02 | User can navigate all interactive elements via keyboard with visible focus indicators | D-05: shadcn focus-visible ring already consistent; Radix primitives handle Escape for dialog/sheet/dropdown; audit needed for gaps |
| A11Y-03 | User can use skip-to-content links on both apps | D-04: Skip link pattern documented with sr-only + focus-visible approach |
| A11Y-04 | Screen reader user hears meaningful announcements for toasts, loading states, and dynamic content via aria-live regions | D-07, D-08, D-09: Loading states need aria-busy, FormMessage needs role="alert", Sonner already covered |
| A11Y-05 | Screen reader user can understand all forms with proper labels, descriptions, and error announcements | D-08: FormControl already wires aria-describedby/aria-invalid; FormMessage just needs role="alert" |
| A11Y-06 | All components pass automated vitest-axe accessibility checks | D-10, D-11: vitest-axe setup and test patterns documented |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest-axe | 0.1.0 | Automated a11y testing | Only maintained vitest fork of jest-axe; integrates axe-core into vitest test suite [VERIFIED: npm registry] |
| axe-core | 4.11.2 (transitive) | Accessibility rule engine | Industry standard engine used by vitest-axe under the hood [VERIFIED: npm registry] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @testing-library/react | 16.3.2 | Component rendering in tests | Already installed in packages/ui -- renders components for axe scanning [VERIFIED: packages/ui/package.json] |
| vitest | 4.1.3 | Test runner | Already installed in packages/ui [VERIFIED: packages/ui/package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vitest-axe | @axe-core/react | @axe-core/react is a dev-time browser overlay, not a test runner matcher -- different purpose |
| vitest-axe | pa11y | pa11y requires a running browser, heavier setup -- vitest-axe is lighter for component testing |

**Installation:**
```bash
cd packages/ui && bun add -d vitest-axe
```

**Version verification:**
- vitest-axe: 0.1.0 (latest on npm as of 2026-04-08) [VERIFIED: npm registry]
- axe-core: 4.11.2 (latest on npm) [VERIFIED: npm registry]

## Architecture Patterns

### Recommended Changes Structure
```
packages/ui/
  src/
    components/
      form.tsx                    # Add role="alert" to FormMessage
      skip-link.tsx               # NEW: SkipToContent component
      __tests__/
        button.a11y.test.tsx      # NEW: axe tests
        dialog.a11y.test.tsx      # NEW: axe tests
        form.a11y.test.tsx        # NEW: axe tests
        ...
    test-setup.ts                 # Add vitest-axe/extend-expect

apps/web/
  app/
    (dashboard)/layout.tsx        # Add <header>, <nav>, <main> landmarks
    layout.tsx                    # Add SkipToContent link
  hooks/
    use-focus-on-navigate.ts      # NEW: focus management on route change

apps/admin/
  src/
    layouts/admin-layout.tsx      # Wrap sidebar in <nav>, add skip link
    hooks/
      use-focus-on-navigate.ts    # NEW: focus management on route change
```

### Pattern 1: Skip-to-Content Link
**What:** A visually-hidden link that becomes visible on focus, allowing keyboard users to jump past navigation
**When to use:** Every page layout in both apps
**Example:**
```tsx
// packages/ui/src/components/skip-link.tsx
// Source: WCAG 2.4.1 standard pattern
export function SkipToContent({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:shadow-md focus:ring-2 focus:ring-ring"
    >
      Skip to content
    </a>
  );
}
```

### Pattern 2: Route Change Focus Management (Next.js)
**What:** Custom hook that moves focus to main content area after Next.js client-side navigation
**When to use:** Customer app dashboard layout
**Example:**
```tsx
// apps/web/hooks/use-focus-on-navigate.ts
// Source: https://github.com/vercel/next.js/issues/49386 community pattern
"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function useFocusOnNavigate() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Focus the main element after route change
    const main = document.getElementById("main-content");
    if (main) {
      main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: false });
    }
  }, [pathname]);
}
```

### Pattern 3: Route Change Focus Management (React Router)
**What:** Same concept for the admin dashboard using React Router's useLocation
**When to use:** Admin dashboard layout
**Example:**
```tsx
// apps/admin/src/hooks/use-focus-on-navigate.ts
// Source: https://gomakethings.com/shifting-focus-on-route-change-with-react-router/
import { useLocation } from "react-router";
import { useEffect, useRef } from "react";

export function useFocusOnNavigate() {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const main = document.getElementById("main-content");
    if (main) {
      main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: false });
    }
  }, [location.pathname]);
}
```

### Pattern 4: FormMessage with role="alert"
**What:** Add `role="alert"` so screen readers immediately announce validation errors
**When to use:** Already exists in packages/ui, just needs the attribute
**Example:**
```tsx
// Change in packages/ui/src/components/form.tsx line ~155
<p
  ref={ref}
  id={formMessageId}
  role="alert"
  className={cn("text-sm font-medium text-destructive", className)}
  {...props}
>
  {body}
</p>
```

### Pattern 5: Loading State with aria-busy
**What:** Mark loading containers with `aria-busy="true"` and provide visually-hidden text
**When to use:** Any component that shows a loading spinner or skeleton
**Example:**
```tsx
// Generic loading container pattern
<div aria-busy={isLoading} aria-live="polite">
  {isLoading ? (
    <>
      <Spinner />
      <span className="sr-only">Loading...</span>
    </>
  ) : (
    children
  )}
</div>
```

### Pattern 6: vitest-axe Test with Impact Filtering
**What:** Run axe on rendered components, fail only on critical/serious violations
**When to use:** All component a11y tests in packages/ui
**Example:**
```tsx
// Source: https://github.com/chaance/vitest-axe + jest-axe docs
import { render } from "@testing-library/react";
import { axe, configureAxe } from "vitest-axe";
import { Button } from "../button";

// Configure to only fail on critical and serious
const axeCheck = configureAxe({
  impactLevels: ["critical", "serious"],
});

describe("Button accessibility", () => {
  it("should have no critical/serious violations", async () => {
    const { container } = render(<Button>Click me</Button>);
    const results = await axeCheck(container);
    expect(results).toHaveNoViolations();
  });
});
```

### Anti-Patterns to Avoid
- **Using `tabindex > 0`:** Never use positive tabindex values -- they break natural tab order. Only use `tabindex="0"` (add to tab order) or `tabindex="-1"` (programmatic focus only). [CITED: WCAG 2.4.3]
- **Hiding focus outlines globally:** Never add `*:focus { outline: none }` -- the existing shadcn `focus-visible` approach is correct. [CITED: WCAG 2.4.7]
- **Using `aria-live="assertive"` broadly:** Only use assertive for urgent errors. Loading states and route changes should use `polite`. [ASSUMED]
- **Duplicate IDs for landmarks:** Each landmark should have a unique label if there are multiple of the same type (e.g., two `<nav>` elements need `aria-label` to differentiate). [CITED: WCAG best practices]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Accessibility testing engine | Custom DOM assertion library | vitest-axe (wraps axe-core) | axe-core has 100+ rules maintained by Deque, covers WCAG 2.1 AA |
| Dialog/modal focus trapping | Custom focus trap implementation | Radix UI Dialog (already used) | Radix handles focus trap, Escape key, click-outside, aria attributes |
| Dropdown keyboard navigation | Custom arrow key handlers | Radix UI DropdownMenu (already used) | Radix handles arrow keys, Home/End, type-ahead, focus management |
| Sheet/drawer a11y | Custom slide-out a11y | Radix UI Dialog (Sheet is built on it) | Already includes focus trap and Escape handling |
| Toast announcements | Custom aria-live region for toasts | Sonner (already used) | Sonner already manages aria-live region internally |

**Key insight:** Radix UI primitives already handle the hardest accessibility problems (focus trapping, keyboard navigation, Escape dismissal). This phase is primarily about semantic landmarks, skip links, and filling gaps -- NOT building accessibility infrastructure from scratch.

## Common Pitfalls

### Pitfall 1: vitest-axe Requires JSDOM, Not Happy DOM
**What goes wrong:** Tests fail silently or throw cryptic errors about `isConnected`
**Why it happens:** axe-core relies on `Node.prototype.isConnected` which Happy DOM implements incorrectly
**How to avoid:** Vitest config already uses `environment: "jsdom"` -- do not change it [VERIFIED: packages/ui/vitest.config.ts]
**Warning signs:** `TypeError: Cannot read properties of undefined` from axe-core internals

### Pitfall 2: Focus Ring Disappearing After Route Change Focus
**What goes wrong:** After programmatically focusing `<main>`, a visible focus ring appears on the main element
**Why it happens:** `tabindex="-1"` elements show focus rings on programmatic focus
**How to avoid:** Add `outline: none` only on the `<main>` element that receives programmatic focus (via `focus:outline-none` class), since it is not an interactive element
**Warning signs:** Large blue/black outline around the entire main content area after navigation

### Pitfall 3: aria-live Region Not Announcing on First Render
**What goes wrong:** Screen reader doesn't announce content injected into aria-live region on mount
**Why it happens:** aria-live regions only announce changes AFTER the region is in the DOM. If the region is rendered with content already inside, the screen reader won't read it.
**How to avoid:** Ensure the aria-live container is rendered in the DOM first (empty), then content is injected via state change
**Warning signs:** Toast announcements work (Sonner does this correctly) but custom aria-live regions are silent

### Pitfall 4: FormMessage role="alert" Fires on Page Load
**What goes wrong:** Screen reader announces all form field messages as errors when the page loads
**Why it happens:** `role="alert"` is announced immediately when the element appears in the DOM
**How to avoid:** FormMessage already returns `null` when there's no error (line 151-153 in form.tsx), so this is safe. But be careful not to render the `<p>` element with empty content -- always return null when no error [VERIFIED: packages/ui/src/components/form.tsx]
**Warning signs:** Screen reader reads "alert" on form page load even though no validation has run

### Pitfall 5: Multiple nav Elements Without Labels
**What goes wrong:** Screen readers announce "navigation" multiple times with no way to distinguish them
**Why it happens:** Both sidebar nav and any header nav use `<nav>` but screen readers can't differentiate
**How to avoid:** Add `aria-label` to each `<nav>` element (e.g., `aria-label="Main navigation"`, `aria-label="User navigation"`)
**Warning signs:** VoiceOver landmark menu shows multiple unlabeled "navigation" entries

### Pitfall 6: Skip Link Target Without tabindex
**What goes wrong:** Clicking the skip link scrolls to the target but focus doesn't move there
**Why it happens:** Non-interactive elements can't receive focus unless they have `tabindex="-1"`
**How to avoid:** Add `id="main-content"` and `tabindex="-1"` to the `<main>` element
**Warning signs:** Skip link appears to work visually but Tab key still starts from the top of navigation

## Code Examples

### Semantic Landmark Retrofit for Customer App Dashboard
```tsx
// apps/web/app/(dashboard)/layout.tsx
// Current: No semantic landmarks
// Target: Match admin's <header>/<main> pattern, add <nav>
"use client";

import { SidebarProvider, SidebarInset } from "@baseworks/ui/components/sidebar";
import { TenantProvider } from "@/components/tenant-provider";
import { SidebarNav } from "@/components/sidebar-nav";
import { useFocusOnNavigate } from "@/hooks/use-focus-on-navigate";

function DashboardContent({ children }: { children: React.ReactNode }) {
  useFocusOnNavigate();
  
  return (
    <SidebarProvider>
      <SidebarNav />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          {/* SidebarTrigger and breadcrumbs */}
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 p-6 focus:outline-none">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <TenantProvider>
      <DashboardContent>{children}</DashboardContent>
    </TenantProvider>
  );
}
```

### vitest-axe Test Setup
```typescript
// packages/ui/src/test-setup.ts -- updated
import "@testing-library/jest-dom/vitest";
import "vitest-axe/extend-expect";
```

### vitest-axe Component Test
```tsx
// packages/ui/src/components/__tests__/button.a11y.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { configureAxe } from "vitest-axe";
import { Button } from "../button";

const axe = configureAxe({
  impactLevels: ["critical", "serious"],
});

describe("Button a11y", () => {
  it("has no critical/serious violations", async () => {
    const { container } = render(<Button>Click me</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("icon-only button requires aria-label", async () => {
    const { container } = render(
      <Button aria-label="Close" size="icon">X</Button>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jest-axe for a11y testing | vitest-axe (fork for vitest) | 2023 | Direct vitest integration, no Jest type conflicts |
| Manual focus management in SPAs | Still manual -- no framework provides it | Ongoing | Must implement custom hooks for both Next.js and React Router |
| aria-live for toasts (custom) | Sonner/Radix Toast handle it | 2024+ | No custom implementation needed for toast a11y |
| tabindex for focus order | focus-visible CSS pseudo-class | 2022+ | Browser-native distinction between mouse and keyboard focus |

**Deprecated/outdated:**
- `outline: none` on all focusable elements: Was common in CSS resets, now understood as accessibility violation
- `role="application"`: Almost never appropriate, breaks screen reader navigation mode

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `aria-live="polite"` is correct politeness for loading state announcements | Architecture Patterns / Anti-Patterns | Low -- assertive would just be more interruptive, not broken |
| A2 | configureAxe `impactLevels` option works the same in vitest-axe as jest-axe | Code Examples | Medium -- if API differs, test filtering approach needs adjustment |
| A3 | Next.js App Router does not auto-manage focus on client navigation in v15 | Architecture Patterns | Low -- if Next.js added this, the custom hook is just redundant, not harmful |

## Open Questions

1. **Which components have focus style gaps?**
   - What we know: Button, input, tabs, select, sidebar all have focus-visible rings. Dialog close button has focus ring.
   - What's unclear: Whether data-table-cards, avatar buttons, or custom interactive elements in page content are missing focus styles
   - Recommendation: Perform manual keyboard audit during implementation -- this is a discovery task

2. **Does Radix handle Escape key for all overlays?**
   - What we know: Radix Dialog, DropdownMenu, and Sheet (built on Dialog) all handle Escape. Select also handles Escape.
   - What's unclear: Whether the Sidebar mobile Sheet overlay responds to Escape (it uses the Sheet component from Radix Dialog, so it likely does)
   - Recommendation: Verify during implementation with a quick keyboard test -- likely already working

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 + vitest-axe 0.1.0 |
| Config file | packages/ui/vitest.config.ts |
| Quick run command | `cd packages/ui && bun run vitest run --reporter=verbose` |
| Full suite command | `cd packages/ui && bun run vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| A11Y-01 | Semantic landmarks in layouts | manual-only | Manual keyboard/screen reader audit | N/A |
| A11Y-02 | Keyboard navigation with focus indicators | manual-only | Manual Tab-through audit | N/A |
| A11Y-03 | Skip-to-content link works | unit | `cd packages/ui && bun run vitest run src/components/__tests__/skip-link.a11y.test.tsx` | Wave 0 |
| A11Y-04 | aria-live for loading/dynamic content | unit | `cd packages/ui && bun run vitest run src/components/__tests__/form.a11y.test.tsx` | Wave 0 |
| A11Y-05 | Form labels, descriptions, errors | unit | `cd packages/ui && bun run vitest run src/components/__tests__/form.a11y.test.tsx` | Wave 0 |
| A11Y-06 | Components pass vitest-axe | unit | `cd packages/ui && bun run vitest run --reporter=verbose` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd packages/ui && bun run vitest run --reporter=verbose`
- **Per wave merge:** `cd packages/ui && bun run vitest run`
- **Phase gate:** Full vitest suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `vitest-axe` package installation in packages/ui
- [ ] `packages/ui/src/test-setup.ts` -- add `import "vitest-axe/extend-expect"`
- [ ] `packages/ui/src/components/__tests__/button.a11y.test.tsx` -- covers A11Y-06
- [ ] `packages/ui/src/components/__tests__/form.a11y.test.tsx` -- covers A11Y-04, A11Y-05
- [ ] `packages/ui/src/components/__tests__/dialog.a11y.test.tsx` -- covers A11Y-06
- [ ] `packages/ui/src/components/__tests__/skip-link.a11y.test.tsx` -- covers A11Y-03

## Security Domain

No security-relevant changes in this phase. Accessibility modifications are UI-only: semantic HTML elements, ARIA attributes, CSS focus styles, and test infrastructure. No authentication, data access, or input validation changes.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | no | N/A (form.tsx change is display-only role="alert") |
| V6 Cryptography | no | N/A |

## Sources

### Primary (HIGH confidence)
- packages/ui/package.json -- existing dependencies and versions verified
- packages/ui/vitest.config.ts -- test environment is jsdom (required for vitest-axe)
- packages/ui/src/components/form.tsx -- FormMessage structure, FormControl aria attributes verified
- apps/web/app/(dashboard)/layout.tsx -- current layout structure verified (no landmarks)
- apps/admin/src/layouts/admin-layout.tsx -- existing `<header>` and `<main>` verified
- npm registry -- vitest-axe@0.1.0, axe-core@4.11.2 versions verified

### Secondary (MEDIUM confidence)
- [vitest-axe README](https://github.com/chaance/vitest-axe/blob/main/README.md) -- API usage, JSDOM requirement, setup patterns
- [jest-axe docs](https://github.com/nickcolley/jest-axe) -- configureAxe impactLevels option (vitest-axe shares implementation)
- [Next.js focus management issue #49386](https://github.com/vercel/next.js/issues/49386) -- confirms Next.js does not auto-manage focus on navigation
- [React Router focus discussion #9555](https://github.com/remix-run/react-router/discussions/9555) -- confirms React Router does not manage focus
- [Shifting focus on route change](https://gomakethings.com/shifting-focus-on-route-change-with-react-router/) -- pattern for React Router focus management

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- vitest-axe is the only maintained vitest axe matcher, version verified on npm
- Architecture: HIGH -- patterns based on verified codebase structure and established WCAG techniques
- Pitfalls: HIGH -- all based on documented axe-core/Radix/JSDOM behaviors with verified codebase state

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable domain, accessibility standards don't change frequently)
