# Phase 7: Accessibility - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 07-accessibility
**Areas discussed:** Semantic landmarks, Focus indicators, aria-live regions, Testing approach

---

## Semantic Landmarks

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror admin pattern (Recommended) | Add <header>, <nav>, <main>, <aside> to customer app matching admin's existing structure. Consistent across both apps. | ✓ |
| Full ARIA landmark set | Go further: add role=banner, role=contentinfo (<footer>), role=search where applicable. More thorough but more markup. | |
| You decide | Claude picks the appropriate landmark depth based on what each page needs. | |

**User's choice:** Mirror admin pattern
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Convention only (Recommended) | Document the pattern (one h1 per page, h2 for sections, h3 for subsections). Developers follow it manually. | ✓ |
| Lint rule | Add an eslint-plugin-jsx-a11y rule or custom lint to flag skipped heading levels. Stricter but more setup. | |
| You decide | Claude picks the enforcement approach. | |

**User's choice:** Convention only
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Hidden until focused (Recommended) | Visually hidden by default, becomes visible when user presses Tab. Standard pattern used by most sites. | ✓ |
| Always visible | Permanently visible link at the top. More discoverable but takes visual space. | |
| You decide | Claude picks the approach. | |

**User's choice:** Hidden until focused
**Notes:** None

---

## Focus Indicators

| Option | Description | Selected |
|--------|-------------|----------|
| Keep shadcn defaults (Recommended) | The existing focus-visible:ring-2 ring-ring pattern is already WCAG-compliant. Audit for gaps (elements missing focus styles) but don't restyle. | ✓ |
| Custom high-visibility style | Replace ring with a thicker outline (3px+) or high-contrast color for better visibility. More accessible but changes visual feel. | |
| Dual mode | Keep current for default, add a high-contrast focus mode toggle (prefers-contrast media query or manual toggle). Most inclusive but more work. | |

**User's choice:** Keep shadcn defaults
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Focus main content (Recommended) | On route change, move focus to the <main> element or page heading. Screen readers announce the new page context. | ✓ |
| Reset to top | On route change, focus moves to document body / skip-to-content link. User navigates from the top each time. | |
| You decide | Claude picks the approach based on app structure. | |

**User's choice:** Focus main content
**Notes:** None

---

## aria-live Regions

| Option | Description | Selected |
|--------|-------------|----------|
| aria-busy + sr-only text (Recommended) | Mark loading containers with aria-busy=true and include a visually-hidden 'Loading...' text. Simple and effective. | ✓ |
| Dedicated live region | A global aria-live='polite' region that announces 'Loading...' and 'Content loaded' messages. More verbose for screen readers. | |
| You decide | Claude picks based on the component context. | |

**User's choice:** aria-busy + sr-only text
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Add role=alert to FormMessage (Recommended) | The existing FormMessage component gets role='alert' so screen readers immediately announce validation errors. Minimal change, big impact. | ✓ |
| Keep aria-invalid only | Current pattern: aria-invalid + aria-describedby links to error message. Screen reader users must navigate to the field to hear errors. | |
| You decide | Claude picks the approach. | |

**User's choice:** Add role=alert to FormMessage
**Notes:** None

---

## Testing Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Shared UI components only (Recommended) | Test each shadcn component in packages/ui with vitest-axe. Covers the building blocks both apps use. Most value per test. | ✓ |
| Components + page layouts | Test shared components AND rendered page layouts from both apps. More comprehensive but harder to set up (needs app context/providers). | |
| You decide | Claude picks the scope based on effort vs coverage. | |

**User's choice:** Shared UI components only
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Critical + Serious (Recommended) | Fail on critical and serious violations. Minor and moderate are warnings. Pragmatic — catches real barriers without noise. | ✓ |
| All violations fail | Zero-tolerance: any axe violation fails the test. Strictest, may require exceptions for known false positives. | |
| You decide | Claude picks based on what makes sense. | |

**User's choice:** Critical + Serious
**Notes:** None

---

## Claude's Discretion

- Exact focus management implementation per router (Next.js vs React Router)
- Which components need focus style gap fixes (discovered during audit)
- Escape key handling for modals/sheets/dropdowns (Radix likely handles this)
- aria-live politeness levels for non-toast dynamic content

## Deferred Ideas

None — discussion stayed within phase scope
