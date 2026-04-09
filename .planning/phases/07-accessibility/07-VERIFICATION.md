---
phase: 07-accessibility
verified: 2026-04-09T07:55:00Z
status: gaps_found
score: 4/5 success criteria verified
overrides_applied: 0
gaps:
  - truth: "Every page uses semantic HTML landmarks (nav, main, aside) with a correct heading hierarchy (h1 through h3, no skipped levels)"
    status: partial
    reason: "Heading hierarchy gap on auth pages. Login, signup, forgot-password, reset-password, and magic-link pages in apps/web (auth layout) and the admin login page use CardTitle (rendered as <div>) instead of a semantic <h1> element. Dashboard and admin content pages all have correct h1 headings. The 'aside' landmark is not present anywhere, but this is acceptable as aside is context-dependent and not required on every page type."
    artifacts:
      - path: "apps/web/app/(auth)/login/page.tsx"
        issue: "CardTitle renders as <div>, no <h1> heading on page"
      - path: "apps/web/app/(auth)/signup/page.tsx"
        issue: "CardTitle renders as <div>, no <h1> heading on page (inferred — pattern matches login)"
      - path: "apps/admin/src/routes/login.tsx"
        issue: "CardTitle renders as <div>, no <h1> heading on page"
      - path: "packages/ui/src/components/card.tsx"
        issue: "CardTitle is a <div>, not a heading element"
    missing:
      - "Add <h1> or change CardTitle to render as <h1> on auth page cards (login, signup, forgot-password, reset-password, magic-link in web; login in admin). Simplest fix: pass 'asChild' or use 'className' on an <h1> element inside CardHeader instead of CardTitle, or modify CardTitle to accept an 'as' prop."
human_verification:
  - test: "Tab through dashboard page on page load"
    expected: "First Tab press shows SkipToContent link visually. Activating it moves focus to main content area. Subsequent Tab presses cycle through all interactive sidebar nav items, header buttons, and page content buttons with a visible focus ring on each."
    why_human: "Cannot verify visual focus ring appearance, keyboard navigation order, and skip link behavior programmatically in jsdom"
  - test: "Open a dialog/sheet/dropdown and press Escape"
    expected: "The overlay closes and focus returns to the triggering element"
    why_human: "Radix Escape handling requires a real browser event loop to test reliably"
  - test: "Submit form with empty field in customer app"
    expected: "Screen reader announces the validation error immediately (role=alert on FormMessage)"
    why_human: "Cannot verify screen reader announcement behavior programmatically"
---

# Phase 7: Accessibility Verification Report

**Phase Goal:** Users with disabilities can navigate and operate both applications using keyboard, screen readers, and assistive technology
**Verified:** 2026-04-09T07:55:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every page uses semantic HTML landmarks (nav, main, aside) with a correct heading hierarchy (h1 through h3, no skipped levels) | PARTIAL | Dashboard/admin content pages have header, nav, main, and h1 headings. Auth pages (login, signup, etc.) use CardTitle (a `<div>`) — no semantic h1 present. Aside landmark not present, but acceptable. |
| 2 | User can Tab through all interactive elements with visible focus indicator; Escape closes modals/sheets/dropdowns | VERIFIED (code) + HUMAN NEEDED (visual) | All interactive elements in Button, Dialog, Sheet, DropdownMenu, Sidebar, and data-table-cards have focus-visible ring classes. Radix primitives confirmed for Dialog, Sheet, DropdownMenu (Escape handled natively). Human must verify in browser. |
| 3 | User pressing Tab on page load can activate skip-to-content link that jumps focus to main content | VERIFIED (code) + HUMAN NEEDED (visual) | SkipToContent component uses sr-only/focus:not-sr-only pattern. Applied to dashboard layout, auth layout, and admin layout. main element has id="main-content" tabIndex={-1}. |
| 4 | Screen reader user hears meaningful announcements for toasts, loading spinners, and dynamic content via aria-live regions | VERIFIED | Sonner toast library has built-in aria-live="polite". Loading states in dashboard/billing (web) and data-table/billing/system-health (admin) have aria-busy + aria-live="polite" + sr-only "Loading..." text. FormMessage has role="alert" for form validation errors. |
| 5 | All shared UI components pass vitest-axe automated accessibility checks with zero violations | VERIFIED | 20/20 tests pass (9 test files). Zero critical/serious violations across Button, Dialog, Form, SkipToContent, Input, Select, DropdownMenu, Sheet. Test run confirmed: exit code 0. |

**Score:** 4/5 success criteria verified (SC-1 partial, SC-2 and SC-3 verified programmatically but require human confirmation)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/ui/src/components/skip-link.tsx` | Shared SkipToContent component | VERIFIED | Exports SkipToContent, uses sr-only/focus:not-sr-only, href="#main-content", "Skip to content" text |
| `apps/web/hooks/use-focus-on-navigate.ts` | Next.js route change focus hook | VERIFIED | Uses usePathname, isFirstRender guard, getElementById("main-content").focus() |
| `apps/admin/src/hooks/use-focus-on-navigate.ts` | React Router route change focus hook | VERIFIED | Uses useLocation, isFirstRender guard, getElementById("main-content").focus() |
| `packages/ui/src/components/__tests__/button.a11y.test.tsx` | Button a11y test | VERIFIED | Contains violations.filter for critical/serious, expect(serious).toHaveLength(0) |
| `packages/ui/src/components/__tests__/dialog.a11y.test.tsx` | Dialog a11y test | VERIFIED | Contains violations.filter, tests open dialog with title+description |
| `packages/ui/src/components/__tests__/form.a11y.test.tsx` | Form a11y test with role=alert check | VERIFIED | Tests role=alert on FormMessage, uses useEffect for error injection |
| `packages/ui/src/components/__tests__/skip-link.a11y.test.tsx` | SkipToContent a11y test | VERIFIED | Tests href, custom targetId, and no violations |
| `packages/ui/src/components/__tests__/input.a11y.test.tsx` | Input a11y test | VERIFIED | Tests with label and with aria-label |
| `packages/ui/src/components/__tests__/select.a11y.test.tsx` | Select a11y test | VERIFIED | Tests trigger with label |
| `packages/ui/src/components/__tests__/dropdown-menu.a11y.test.tsx` | DropdownMenu a11y test | VERIFIED | Tests trigger with content |
| `packages/ui/src/components/__tests__/sheet.a11y.test.tsx` | Sheet a11y test | VERIFIED | Tests open sheet with title |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `apps/web/app/(dashboard)/layout.tsx` | `packages/ui/src/components/skip-link.tsx` | `import SkipToContent from @baseworks/ui` | WIRED | SkipToContent used as first child in SidebarProvider |
| `apps/admin/src/layouts/admin-layout.tsx` | `packages/ui/src/components/skip-link.tsx` | `import SkipToContent from @baseworks/ui` | WIRED | SkipToContent first child in SidebarProvider |
| `apps/web/app/(dashboard)/layout.tsx` | `apps/web/hooks/use-focus-on-navigate.ts` | `useFocusOnNavigate()` call | WIRED | Called inside DashboardContent component |
| `packages/ui/src/index.ts` | `packages/ui/src/components/skip-link.tsx` | `export * from "./components/skip-link"` | WIRED | Re-exported from package index |
| `packages/ui/src/test-setup.ts` | `vitest-axe/extend-expect` | `import "vitest-axe/extend-expect"` | WIRED | Confirmed at line 2 |
| `packages/ui/src/components/__tests__/*.a11y.test.tsx` | `vitest-axe` | `import { axe } from "vitest-axe"` | WIRED | All 8 test files import axe from vitest-axe |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `apps/web/app/(dashboard)/dashboard/page.tsx` | isLoading | React Query | Yes — aria-busy={isLoading} bound to real query state | FLOWING |
| `apps/admin/src/components/data-table.tsx` | isLoading prop | Passed from parent page | Yes — prop driven by real query loading state | FLOWING |
| Sonner Toaster | toast messages | User-triggered events | Yes — aria-live="polite" in sonner's own implementation | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 20 vitest-axe tests pass | `cd packages/ui && bun run vitest run` | "Test Files 9 passed, Tests 20 passed" | PASS |
| Commits from summaries exist in git history | `git log --oneline \| grep commit-hashes` | 0176424, 3d2d301, c4b0469, b916295, 2bf32f2 all found | PASS |
| Skip link href points to correct target | File read of skip-link.tsx | `href={\`#${targetId}\`}` with default "main-content" | PASS |
| main element has id="main-content" in dashboard layout | File read | `<main id="main-content" tabIndex={-1}>` confirmed | PASS |
| role=alert present on FormMessage | `grep 'role="alert"' form.tsx` | Found at line 158 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| A11Y-01 | 07-01 | User navigates pages with proper semantic HTML landmarks (nav, main, aside, headings) | PARTIAL | nav, main, header landmarks present. Heading hierarchy gap on auth pages (CardTitle is div, not h1). |
| A11Y-02 | 07-02 | User can navigate all interactive elements via keyboard with visible focus indicators | VERIFIED (code) | focus-visible ring confirmed on all audited components. Focus audit table in SUMMARY documented all PASS results plus one fix (data-table-cards filter button). |
| A11Y-03 | 07-01 | User can use skip-to-content links on both apps | VERIFIED (code) | SkipToContent applied to 3 layouts. sr-only/focus:not-sr-only pattern. main-content target with tabIndex=-1. |
| A11Y-04 | 07-02 | Screen reader user hears meaningful announcements for toasts, loading states, and dynamic content via aria-live regions | VERIFIED | Sonner aria-live="polite" confirmed in source. aria-busy + aria-live on loading states. role=alert on FormMessage. |
| A11Y-05 | 07-02 | Screen reader user can understand all forms with proper labels, descriptions, and error announcements | VERIFIED | FormMessage has role=alert. Form a11y test confirms label+control+error have no violations. FormControl has aria-describedby and aria-invalid (shadcn default). |
| A11Y-06 | 07-03 | All components pass automated vitest-axe accessibility checks | VERIFIED | 20/20 tests pass. Zero critical/serious violations. |

**All 6 requirement IDs from plans accounted for.** No orphaned requirements found in REQUIREMENTS.md for Phase 7.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/web/app/(auth)/login/page.tsx` | 73 | `<CardTitle>` (renders as div) used as visual page heading with no semantic h1 | Warning | Screen readers cannot identify the page heading on login page |
| `apps/admin/src/routes/login.tsx` | 82 | `<CardTitle>` (renders as div) used as visual page heading with no semantic h1 | Warning | Screen readers cannot identify the page heading on admin login page |

**Note:** These are warnings that directly contribute to the SC-1 heading hierarchy gap. Auth pages in both apps lack semantic h1 headings. This is not a false positive — axe tests do not catch this because the tests render isolated components with correct wrapper context, not full pages.

### Human Verification Required

#### 1. Skip Link Visual Behavior

**Test:** Open the customer app dashboard in a browser. Press Tab immediately on page load.
**Expected:** A "Skip to content" link appears visually at the top-left of the page. Press Enter/Space — focus jumps to the main content area (below the sidebar/header).
**Why human:** jsdom cannot render CSS (sr-only/focus:not-sr-only uses CSS transforms) or test Tab key navigation order reliably.

#### 2. Focus Indicator Visibility and Contrast

**Test:** Tab through the customer app dashboard and admin dashboard. Observe every interactive element (nav links, buttons, dropdowns, form fields).
**Expected:** Every element shows a clearly visible focus ring that meets WCAG 2.1 AA contrast (3:1 minimum against adjacent colors). No element Tab-stops without a visible indicator.
**Why human:** WCAG contrast of focus rings against their background requires visual inspection and color contrast tooling in a real browser.

#### 3. Escape Key Dismissal

**Test:** Open a dialog (e.g., a confirmation modal), a Sheet, and a DropdownMenu in each app. Press Escape on each.
**Expected:** Each overlay closes and focus returns to the trigger element.
**Why human:** Radix Escape handling requires a real browser keyboard event dispatch that jsdom cannot fully simulate.

#### 4. Screen Reader Announcement of Loading States

**Test:** Using a screen reader (NVDA/VoiceOver), navigate to a page with loading data (dashboard overview, billing page). Trigger a refresh.
**Expected:** Screen reader announces "Loading..." when spinner appears, then announces new content when data loads.
**Why human:** Cannot test screen reader verbalization programmatically.

### Gaps Summary

**1 gap blocking full SC-1 achievement:**

**Heading hierarchy gap on auth pages.** The roadmap SC-1 requires "correct heading hierarchy (h1 through h3, no skipped levels)" on every page. Auth pages in both apps (`apps/web/app/(auth)/login`, `/signup`, `/forgot-password`, `/reset-password`, `/magic-link`, and `apps/admin/src/routes/login.tsx`) use `CardTitle` which renders as a `<div>` element, not a semantic heading. Screen reader users cannot navigate to the page heading via heading navigation (H key in NVDA/JAWS).

**Fix:** In each auth page, replace `<CardTitle>Sign in</CardTitle>` with `<CardTitle asChild><h1>Sign in</h1></CardTitle>` (if shadcn CardTitle supports asChild) or wrap content in `<h1>` directly inside `CardHeader`. Alternatively, modify `packages/ui/src/components/card.tsx` to render CardTitle as `<h2>` by default (since it's a card section heading, not a page heading) and add explicit `<h1>` page headings outside the card where needed.

**Root cause:** This gap was not caught by the vitest-axe tests because each component test renders in isolation with the component as the root element, preventing axe from flagging missing page-level headings.

**SC-2, SC-3 are verified programmatically but require human browser testing** to confirm visual appearance and keyboard navigation flow. These are not gaps — they are expected human verification items for a UI phase.

---

_Verified: 2026-04-09T07:55:00Z_
_Verifier: Claude (gsd-verifier)_
