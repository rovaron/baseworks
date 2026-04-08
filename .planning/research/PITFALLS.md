# Pitfalls Research

**Domain:** v1.1 Polish & Extensibility -- i18n, a11y, responsive, team invites, payment abstraction
**Researched:** 2026-04-08
**Confidence:** MEDIUM (i18n and responsive patterns well-documented; better-auth org plugin and payment abstraction have fewer battle-tested references)

---

## Critical Pitfalls

### Pitfall 1: i18n Hydration Mismatches in Next.js 15 App Router

**What goes wrong:**
Translations load differently on server vs client, causing React hydration mismatches. The server renders the English fallback (or no text), the client renders the correct locale, and React throws "Text content does not match server-rendered HTML." This is especially insidious with date/number formatting where timezone and locale differences between server and client produce different output even with the same translation keys.

**Why it happens:**
Next.js 15 App Router removed the built-in i18n configuration that Pages Router provided. Developers reach for `next/navigation` out of habit instead of locale-aware routing utilities. Translation files get loaded asynchronously on the client but synchronously on the server, creating a timing mismatch. Date/number formatting with native `Intl` APIs produces different results on server (Node/Bun timezone) vs client (browser timezone).

**How to avoid:**
- Use `next-intl` for the Next.js app -- it was designed for App Router and Server Components, handles hydration correctly out of the box.
- Use `react-i18next` (i18next) for the Vite admin dashboard -- it is the standard for non-Next.js React apps.
- Share translation JSON files in a `packages/i18n` package, but use different loading mechanisms per app. The translation content is shared; the runtime integration is app-specific.
- NEVER use `next/navigation` Link, useRouter, usePathname directly -- use the locale-aware versions from `next-intl` (or your routing config) that automatically handle locale prefixes.
- For date/number formatting in Next.js, use `next-intl`'s `useFormatter` hook instead of raw `Intl.DateTimeFormat` -- it ensures server/client consistency.
- Set the `timeZone` explicitly in your i18n config so server and client agree.

**Warning signs:**
Console hydration errors mentioning text mismatch. Dates/currencies flickering on page load. Different text appearing briefly before settling. Tests passing in client-only mode but failing with SSR.

**Phase to address:**
i18n phase. Must be the foundational decision before any translation work begins. Changing i18n libraries after translating 200 strings is painful.

---

### Pitfall 2: Two i18n Libraries in One Monorepo -- Divergent APIs

**What goes wrong:**
Next.js uses `next-intl` (or similar) with Server Components support. Vite admin uses `react-i18next`. Shared UI components in `packages/ui` cannot use either library's hooks because they need to work in both apps. You end up with translation logic duplicated, or shared components that are untranslatable, or a third abstraction layer that wraps both libraries.

**Why it happens:**
`next-intl` is the best choice for Next.js App Router (Server Component support, hydration safety). `react-i18next` is the best choice for Vite SPA (framework-agnostic, mature). But shared shadcn components live in a package consumed by both apps, and those components have labels like "Search...", "No results.", "Previous", "Next" that need translation.

**How to avoid:**
- Shared UI components (`packages/ui`) must NOT import any i18n library. Instead, accept all user-facing strings as props. The `DataTable` component already takes `searchPlaceholder` as a prop -- extend this pattern to all text.
- Create a `packages/i18n` package that exports only: (1) translation JSON files, (2) TypeScript types for translation keys, (3) a `Locale` type union. No runtime code.
- Each app imports translation JSONs from `packages/i18n` and wires them through its own i18n library.
- For shared components with many strings (like a complex form), accept a `translations` object prop typed against the shared types.

**Warning signs:**
A shared component importing `useTranslation` or `useTranslations`. An i18n library appearing in `packages/ui/package.json`. Components that render differently in each app because of i18n wiring differences.

**Phase to address:**
i18n phase. Define the "no i18n imports in shared packages" rule before writing any translations.

---

### Pitfall 3: Payment Provider Abstraction That Leaks Stripe Everywhere

**What goes wrong:**
The abstraction mimics Stripe's API shape. The interface has `createCheckoutSession`, `constructWebhookEvent`, and `Customer` objects that match Stripe 1:1. When you add a Brazilian provider (Mercado Pago, PagSeguro, EBANX), nothing fits -- they use PIX (instant bank transfer), boleto (bank slip), and parcelamento (installments) which have no Stripe equivalent. The "abstraction" becomes a Stripe wrapper with adapter pain for every other provider.

**Why it happens:**
The existing billing module has 12+ files that directly call `getStripe()`. The natural refactoring instinct is to replace `getStripe()` with `getPaymentProvider()` and make the interface match the current call sites. This produces an interface shaped exactly like Stripe, which is not an abstraction -- it is an indirection.

**How to avoid:**
- Design the interface from business operations, not from Stripe's API: `createPayment(amount, currency, method)`, `createSubscription(plan, interval)`, `handleWebhook(rawBody, headers)`, `getPaymentStatus(paymentId)`.
- Accept that webhook shapes differ fundamentally between providers. The abstraction handles webhook verification and normalization internally, emitting standardized domain events (`payment.succeeded`, `subscription.created`) regardless of provider.
- PIX and boleto are not "checkout sessions." They produce a QR code or bank slip that the customer pays asynchronously. The abstraction must support async payment methods where payment confirmation comes minutes/hours later via webhook.
- Stripe Customer Portal has no equivalent in Brazilian providers. Self-service billing management must be built custom for non-Stripe providers.
- Do NOT abstract away Stripe-specific features that other providers lack (usage-based billing, metered subscriptions). Keep those as Stripe-only capabilities with a clear "provider supports X" capability check.

**Warning signs:**
The payment interface has a method called `createCheckoutSession`. The Brazilian adapter has methods that throw `NotSupported`. The interface has Stripe-specific types (`PriceId`, `CustomerPortalUrl`). Tests mock Stripe SDK methods directly instead of the abstraction.

**Phase to address:**
Payment abstraction phase. Design the interface BEFORE refactoring the existing Stripe code. Write the Brazilian adapter interface first (even as stubs) to validate the abstraction covers non-Stripe patterns.

---

### Pitfall 4: better-auth Organization Plugin -- Assuming It Handles Full Invite Flow

**What goes wrong:**
Developers assume the better-auth organization plugin provides a complete team invite system (UI, email, accept flow, role picker, invite link page). In reality, the plugin provides the data model and API endpoints, but requires significant custom implementation for a production-ready invite experience.

**Why it happens:**
The plugin documentation shows clean API examples (`inviteMember`, `acceptInvitation`, `rejectInvitation`) that look turnkey. But the critical gap is in the details: you must provide `sendInvitationEmail` yourself, build the invitation acceptance page, handle the "user doesn't have an account yet" flow, and manage `activeOrganizationId` which starts as `null` after invitation acceptance.

**How to avoid:**
- **What the plugin handles:** Creating invitations (with role, team, expiration), accepting/rejecting invitations, listing pending invitations, canceling invitations, invitation deduplication, membership limits, role assignment on accept.
- **What you MUST build custom:**
  1. `sendInvitationEmail` callback -- wire this to your existing BullMQ email queue + React Email templates
  2. Invitation acceptance page UI -- a page at `/invite/[invitationId]` that calls `acceptInvitation`
  3. Handling unregistered users -- the plugin requires authentication before accepting. You need a "sign up then accept" flow where the invitation ID persists through signup.
  4. Setting `activeOrganizationId` after acceptance -- it does NOT auto-switch. You must call `setActiveOrganization` after `acceptInvitation`.
  5. Invitation link generation -- construct the URL yourself with the invitation ID
  6. Invitation status page (pending, expired, already accepted) for good UX
- Configure `invitationExpiresIn` explicitly (default is 48 hours, which may be too short for email-based workflows).
- Set `cancelPendingInvitationsOnReInvite: true` to avoid confusion when re-inviting the same email.

**Warning signs:**
Invitations created but no emails sent (missing `sendInvitationEmail`). Users accept invitations but stay in their old organization (missing `setActiveOrganization` call). Unregistered users get a blank error page when clicking invite links. Expired invitations show no useful message.

**Phase to address:**
Team invites phase. Map out the full user journey (happy path + edge cases) before writing code. The plugin's API is the easy part; the UX flows around it are the hard part.

---

### Pitfall 5: Responsive Retrofitting That Breaks Desktop Layout

**What goes wrong:**
Adding responsive classes (`md:`, `lg:` breakpoint prefixes) to existing fixed-width layouts introduces regressions on desktop. The sidebar that worked at 1024px+ starts collapsing unexpectedly. Tables that had fixed column widths now overflow or squish. Cards that were in a 3-column grid jump to single-column at breakpoints where 2 columns would fit better.

**Why it happens:**
The existing admin layout uses the shadcn `Sidebar` component which already has mobile support via `Sheet` overlay, but the current layout (based on the codebase) uses fixed `SidebarProvider` without explicit responsive behavior for the main content area. The `DataTable` component renders a full HTML table with no responsive adaptation. Adding responsive classes piecemeal (fixing one page at a time) creates inconsistency.

**How to avoid:**
- Define responsive breakpoints ONCE in a shared location before touching any component: `sm` (mobile), `md` (tablet), `lg` (desktop). Document what layout each breakpoint uses.
- The shadcn `Sidebar` already supports `isMobile` state and `Sheet` overlay for mobile. Verify this works correctly before adding custom responsive code -- the existing sidebar component may already handle the mobile case, you just need to ensure `SidebarTrigger` is visible on mobile.
- For the admin `DataTable`: do NOT try to make HTML tables responsive with CSS alone. For mobile, switch to a card/list layout below `md:` breakpoint. Use a `useMediaQuery` hook to conditionally render table vs cards, not CSS `display: none` which still renders the DOM.
- Tackle responsive layout in this order: (1) app shell/sidebar, (2) page-level grid, (3) individual components (tables, forms, cards). Never start with components -- the container layout must be right first.
- Test at exactly 768px, 1024px, and 375px (iPhone SE). These are the three breakpoints where layouts most commonly break.

**Warning signs:**
Horizontal scrollbar appearing on any viewport. Content hidden behind the sidebar. Touch targets smaller than 44x44px on mobile. Text truncating with no tooltip/expansion option.

**Phase to address:**
Responsive phase. Should be done BEFORE i18n because translated strings (especially pt-BR, which tends to be 20-30% longer than English) will affect responsive layouts.

---

### Pitfall 6: a11y Retrofitting -- Fixing Symptoms Not Structure

**What goes wrong:**
Developers add `aria-label` attributes and `role` props to existing components without fixing the underlying HTML structure. Screen readers still cannot navigate the page because the heading hierarchy is broken (h1 -> h3 -> h2), interactive elements are `div` with `onClick` instead of `button`, and focus management is nonexistent. The ARIA attributes technically pass automated tools but the actual screen reader experience is terrible.

**Why it happens:**
shadcn/ui components are built on Radix UI which provides good accessibility primitives (keyboard navigation, focus trapping in dialogs, proper ARIA roles). But the APPLICATION code that composes these components often breaks accessibility: custom click handlers on `div` elements, missing heading hierarchy, no skip links, tables without proper headers, forms without associated labels.

**How to avoid:**
- Start with an automated audit (axe-core/Lighthouse) to find low-hanging fruit, but do NOT stop there. Automated tools catch ~30% of a11y issues.
- Manual testing protocol: Tab through every page start-to-finish. Every interactive element must be reachable. Focus must be visible (shadcn v2 with Tailwind 4 has a known issue with missing `focus-visible` styles on `TabsContent`).
- Fix HTML structure FIRST, ARIA attributes SECOND:
  1. Every page has exactly one `h1`. Headings descend in order (h1 -> h2 -> h3).
  2. All clickable elements are `button` or `a` (not `div onClick`). The admin layout already uses `a` tags in the sidebar -- good.
  3. All form inputs have associated `label` elements (not just placeholder text).
  4. Data tables have `th` with `scope="col"` (the shared `Table` component may already handle this via shadcn).
- Add a skip link ("Skip to main content") as the first focusable element in both app shells.
- Test with an actual screen reader (NVDA on Windows is free). Automated tools will not catch "this is technically accessible but unusable" patterns.

**Warning signs:**
Lighthouse accessibility score above 90 but actual keyboard navigation is broken. `aria-label` on elements that are already labeled by visible text (redundant, confusing). `tabIndex` values greater than 0 (breaks natural tab order). `role="button"` on `div` elements instead of using actual `button`.

**Phase to address:**
a11y phase. Should come AFTER responsive (because responsive changes will alter focus order and layout) but BEFORE i18n (because translated strings need proper a11y treatment from the start).

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoding English strings in shared UI components | Ship faster, no abstraction overhead | Every string needs extraction later when adding i18n; easy to miss strings buried in component logic | Never for v1.1 -- extraction is the point |
| Using CSS `display: none` for responsive instead of conditional rendering | Simpler code, one component handles all sizes | Full DOM rendered at all sizes, screen readers read hidden content, bundle includes unused code | Acceptable for hiding decorative elements only (icons, dividers) |
| Skipping the payment abstraction and hardcoding Brazilian provider alongside Stripe | Faster to ship, no abstraction design needed | Two parallel billing codepaths with no shared interface, bug fixes needed in both places, third provider requires a third codebase | Never -- the abstraction is the deliverable |
| Using `suppressHydrationWarning` to fix i18n hydration mismatches | Silences the console error immediately | Hides real bugs, content flashes visibly even though React is silent, SEO impact from wrong initial render | Only on leaf elements with known-different content (timestamps) |
| Adding `aria-hidden="true"` to fix duplicate announcement issues | Passes automated audit | Content invisible to screen reader users who may need it, masks structural problems | Only on truly decorative elements (icons next to text labels) |
| Using browser `navigator.language` for locale detection | Works immediately, respects user preference | Causes hydration mismatch (server doesn't have `navigator`), locale changes on hydration create flash | Never in SSR -- use URL-based locale (path prefix or cookie) |

## Integration Gotchas

Common mistakes when connecting v1.1 features to the existing system.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| next-intl + existing Next.js middleware | Adding i18n middleware that conflicts with the existing auth middleware in `middleware.ts` | Chain middleware functions: auth check first, then i18n locale resolution. next-intl provides `createMiddleware` that can be composed with existing middleware. |
| react-i18next + Vite admin | Loading all translation namespaces upfront, blocking initial render | Use lazy namespace loading. Split translations by route/page. The admin dashboard loads fewer pages than a customer app -- namespace-per-route is fine here. |
| Payment abstraction + existing webhook route | Refactoring the webhook endpoint to be generic but breaking Stripe signature verification (which needs raw body + Stripe-specific header) | Each payment provider gets its own webhook endpoint (`/api/billing/webhooks/stripe`, `/api/billing/webhooks/mercadopago`). The provider adapter handles signature verification internally. Normalize to domain events after verification. |
| better-auth org invitations + existing BullMQ email system | Building a separate email sending mechanism for invitations instead of using the existing email queue | Wire `sendInvitationEmail` to enqueue a job on the existing `email:send` BullMQ queue. Add an "invitation" React Email template alongside existing password-reset and magic-link templates. |
| Responsive sidebar + existing shadcn Sidebar component | Replacing the shadcn Sidebar with a custom responsive implementation | The shadcn `SidebarProvider` already tracks `isMobile` state and the `Sidebar` component uses `Sheet` for mobile overlay. The existing admin layout likely just needs the trigger button to be always visible on mobile and the sidebar `collapsible` prop configured correctly. |
| a11y + existing DataTable sorting | Sort buttons (the existing `ArrowUpDown` buttons in column headers) not announcing sort state to screen readers | Add `aria-sort="ascending"` / `"descending"` / `"none"` to `th` elements. Update the sort button to include `aria-label="Sort by {column}, currently {direction}"`. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading all translations for all locales on every page | Slow initial load, large bundle, wasted bandwidth for unused locale | Use namespace splitting + dynamic import per locale. Only load the active locale's translations. next-intl handles this with Server Components (translations stay on server). | Noticeable at 500+ translation keys per locale |
| Responsive images/cards rendering full desktop DOM on mobile then hiding with CSS | High memory usage on mobile devices, slow Time to Interactive | Use conditional rendering based on `useMediaQuery` for structurally different layouts (table vs card list). CSS-only for minor style adjustments. | Mobile devices with limited RAM, tables with 50+ rows |
| Payment abstraction adding a database lookup per API call to determine provider | Added latency on every billing operation | Cache the tenant's payment provider in the session/context. Resolve provider once at request start, not per operation. | At 100+ concurrent billing operations |
| Running axe-core accessibility checks in production builds | Build time increases, CI slows down | Run a11y checks only in dev/test. Use `@axe-core/react` in dev mode only, behind `process.env.NODE_ENV` check. In CI, run lighthouse on built pages. | Large component libraries with 50+ pages |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Invitation links containing the organization ID or role in URL params (not just invitation ID) | Attacker modifies URL to accept invitation with elevated role or different org | Invitation link contains ONLY the invitation ID. Role and org are stored server-side in the invitation record. The `acceptInvitation` endpoint looks up the invitation by ID and uses the stored role/org. |
| Payment webhook endpoints for new providers not verifying signatures | Attacker sends fake payment confirmation webhooks, grants unpaid subscriptions | Every payment provider adapter MUST implement signature verification. Make the interface require it: `verifyWebhook(rawBody, headers): VerifiedEvent`. No adapter passes code review without this method. |
| i18n translation files containing user-generated content or HTML | XSS through translated strings -- attacker submits malicious content that ends up in translation files | Translation files contain ONLY static strings authored by developers. Dynamic user content is interpolated at render time, not stored in translation files. Sanitize any HTML in translations (or better: avoid HTML in translations entirely, use component composition). |
| Locale parameter used in file path without sanitization | Path traversal attack via crafted locale string (`../../etc/passwd`) | Validate locale against a strict allowlist (`['en', 'pt-BR']`). Never use locale string in file paths, `import()`, or database queries without validation. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Switching locale reloads the entire page | Jarring experience, loses form state, scroll position, modal state | For Next.js: use `next-intl`'s locale switching which preserves route. For Vite admin: update i18next locale in memory, re-render without navigation. |
| Invitation acceptance page requires login first (no context) | Invited user lands on a login page with no indication why. They may not even have an account. | Show the invitation details (org name, inviter name, role) on the acceptance page BEFORE requiring login. Provide both "Sign in to accept" and "Create account to accept" paths. Persist invitation ID through the auth flow. |
| Tables become horizontal scroll on mobile | Unusable on phone, users abandon the page | Below `md:` breakpoint, render data as stacked cards instead of table rows. Prioritize 2-3 key columns, hide secondary data behind "expand" actions. |
| a11y focus indicator invisible on dark backgrounds | Keyboard users cannot tell which element is focused, effectively locked out | Use a focus ring color that contrasts against both light and dark backgrounds. Tailwind's `ring-offset` pattern works: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. Test in both themes. |
| pt-BR translations 30% longer than English breaking layouts | Buttons overflow, text truncates, cards grow inconsistently | Design with pt-BR as the default length target. Use `truncate` + tooltip for constrained spaces. Test every page with the longest locale first. Never set fixed `width` on text containers. |

## "Looks Done But Isn't" Checklist

- [ ] **i18n:** All user-facing strings extracted -- verify by grep for English strings in JSX (`grep -r '"[A-Z][a-z]' --include="*.tsx"` in both apps, excluding component library internals)
- [ ] **i18n:** Locale switching works without page reload -- verify by filling a form, switching locale, confirming form state preserved
- [ ] **i18n:** Server-rendered HTML matches client locale -- verify by viewing page source (not DevTools) and comparing text to what renders after hydration
- [ ] **i18n:** Pluralization works for both en and pt-BR -- verify edge cases (0 items, 1 item, 2 items, 100 items)
- [ ] **Responsive:** No horizontal scrollbar at any standard viewport (375px, 768px, 1024px, 1440px) -- verify in browser device toolbar
- [ ] **Responsive:** Tables switch to card layout on mobile -- verify DataTable component at 375px viewport
- [ ] **Responsive:** Touch targets minimum 44x44px on mobile -- verify with browser accessibility overlay
- [ ] **a11y:** Complete keyboard navigation possible on every page -- verify by unplugging mouse and using Tab/Enter/Escape only
- [ ] **a11y:** Screen reader reads page in logical order -- verify with NVDA or VoiceOver, not just automated tools
- [ ] **a11y:** Focus is never lost after modal close, dialog dismiss, or dynamic content update -- verify by closing every dialog and confirming focus returns to trigger element
- [ ] **a11y:** Color contrast ratio meets WCAG AA (4.5:1 for text, 3:1 for large text) -- verify with browser DevTools contrast checker
- [ ] **Team invites:** Unregistered user can accept invitation (sign up flow preserves invite ID) -- verify full flow from email link to org membership
- [ ] **Team invites:** Expired invitation shows clear message (not a blank page or error) -- verify by creating invitation, waiting for expiry (use short test expiry), clicking link
- [ ] **Team invites:** `activeOrganizationId` switches to new org after accept -- verify session state after accepting invitation
- [ ] **Payment abstraction:** Switching provider does not affect existing Stripe subscriptions -- verify by toggling provider config and confirming existing billing still works
- [ ] **Payment abstraction:** Webhook endpoints for each provider are separately secured -- verify by sending unsigned webhook to each endpoint, confirm rejection

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Hydration mismatches from i18n | LOW | Switch to `next-intl` if using custom setup. Add `timeZone` to config. Replace `Intl.*` calls with library formatters. |
| Shared components importing i18n library | MEDIUM | Extract all strings to props. Create wrapper components in each app that pass translated strings. Takes 1-2 days for 18 components. |
| Leaky payment abstraction (Stripe-shaped interface) | HIGH | Redesign interface from business operations. Requires touching every billing command/query handler. Plan 3-5 days. |
| a11y: Broken heading hierarchy across pages | LOW | Audit each page, fix heading levels. Usually 1-2 hours per page. |
| a11y: Interactive divs instead of buttons | MEDIUM | Replace `div onClick` with `button`. May require CSS adjustments for button reset styles. |
| Responsive: Tables unreadable on mobile | MEDIUM | Build a responsive `DataCard` variant of `DataTable`. Swap rendering below breakpoint. 1-2 days. |
| Team invites: Users stuck after accepting (wrong activeOrganizationId) | LOW | Add `setActiveOrganization` call after `acceptInvitation`. Hotfix-level change. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| i18n hydration mismatch | i18n (first) | View page source vs rendered DOM -- text must match for translated content |
| Two i18n libraries diverging | i18n (first) | Shared UI package has zero i18n imports (`grep -r "i18n\|useTranslat" packages/ui/`) |
| Payment abstraction leaking Stripe | Payment abstraction | Interface has no Stripe-specific types. Brazilian adapter implements all required methods without `NotSupported`. |
| better-auth invite assumptions | Team invites | Full E2E test: create invite -> email sent -> unregistered user signs up -> accepts -> lands in correct org with correct role |
| Responsive breaking desktop | Responsive | Visual regression test at 1440px viewport shows no layout changes from pre-responsive baseline |
| a11y fixing symptoms not structure | a11y | Keyboard-only navigation test passes on every page. NVDA reading order matches visual order. |
| pt-BR string length breaking layouts | i18n + responsive | Every page tested with pt-BR active at 375px viewport -- no overflow, no truncation without tooltip |
| Locale in file path without validation | i18n | Locale validation middleware rejects any value not in allowlist. Test with `../../etc/passwd` as locale param. |
| Invitation link parameter tampering | Team invites | Invite link contains only invitation ID. Role/org verified server-side on accept. Test by modifying URL params. |
| Unverified payment webhooks for new providers | Payment abstraction | Send unsigned/tampered webhook to each provider endpoint -- all return 400. No database changes from unsigned webhooks. |

## Recommended Phase Ordering Based on Pitfalls

Based on pitfall dependencies:

1. **Responsive** first -- because i18n (longer strings) and a11y (focus order) both depend on layout being correct
2. **a11y** second -- because responsive changes alter focus order and DOM structure; a11y fixes must happen on the final DOM
3. **i18n** third -- because translated strings must fit in responsive layouts and have proper a11y attributes from the start
4. **Team invites** fourth -- depends on i18n being in place for invite emails and acceptance pages to be bilingual
5. **Payment abstraction** fifth -- most isolated from other features, can be developed in parallel if needed

## Sources

- [Next.js hydration error documentation](https://nextjs.org/docs/messages/react-hydration-error) -- official docs on hydration mismatch causes and fixes
- [next-intl App Router guide](https://next-intl.dev/docs/getting-started/app-router) -- official next-intl documentation for App Router integration
- [better-auth Organization plugin documentation](https://better-auth.com/docs/plugins/organization) -- official docs on invitation APIs, configuration, limitations
- [better-auth invitation workflow issue #4223](https://github.com/better-auth/better-auth/issues/4223) -- community discussion on invitation flow gaps
- [better-auth active organization issue #3452](https://github.com/better-auth/better-auth/issues/3452) -- known issue with activeOrganizationId after invitation acceptance
- [better-auth unregistered user invitation issue #6716](https://github.com/better-auth/better-auth/issues/6716) -- limitation where unregistered users cannot accept invitations
- [shadcn/ui TabsContent focus styles issue #7128](https://github.com/shadcn-ui/ui/issues/7128) -- known a11y issue with Tailwind v4 missing focus-visible styles
- [Strategy pattern for multi-payment gateways](https://blog.stackademic.com/implementing-a-multi-payment-gateway-system-with-strategy-pattern-7750e86f1f65) -- pattern for payment provider abstraction
- [i18next monorepo shared translations discussion](https://github.com/i18next/i18next/discussions/1604) -- community patterns for shared translation files
- [Brazil payment methods ecosystem 2025](https://www.wooshpay.com/resources/knowledge/2025/11/24/brazil-payment-methods-ecosystem-pix-on-top-local-cards-still-critical-boleto-not-dead/) -- PIX, boleto, parcelamento landscape

---
*Pitfalls research for: Baseworks v1.1 Polish & Extensibility*
*Researched: 2026-04-08*
