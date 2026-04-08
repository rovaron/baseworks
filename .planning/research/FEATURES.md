# Feature Research: v1.1 Polish & Extensibility

**Domain:** SaaS Starter Kit -- v1.1 new capabilities (i18n, a11y, responsive, team invites, payment abstraction)
**Researched:** 2026-04-08
**Confidence:** MEDIUM-HIGH (verified against official docs and current ecosystem state)

## Feature Landscape

### Table Stakes (Users Expect These)

For a "production-ready" SaaS starter kit in 2026, these are no longer optional -- competitors like Makerkit and Supastarter already ship them.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Responsive layouts (mobile/tablet/desktop)** | Users access SaaS from phones. Broken mobile = amateur. | LOW | shadcn sidebar component already has `useIsMobile` + Sheet (drawer). Mostly CSS/breakpoint work. |
| **Mobile sidebar drawer** | Dashboard nav must work on small screens | LOW | Sidebar component uses Sheet for mobile already. Need to wire SidebarTrigger properly + fix overlay issue noted in PROJECT.md. |
| **Collapsible desktop sidebar** | Standard dashboard pattern -- icon-only mode saves screen space | LOW | SidebarProvider already supports `expanded`/`collapsed` state. Wire toggle + persist preference. |
| **Keyboard navigation** | WCAG 2.1 Level A requirement. Tab through all interactive elements. | MEDIUM | shadcn/Radix provides baseline. Need audit: focus order, focus indicators, skip links, escape-to-close. |
| **Screen reader support** | WCAG 2.1 Level A. Semantic HTML + ARIA labels on all controls. | MEDIUM | Radix primitives add ARIA automatically. Need: aria-label on custom controls, live regions for toasts, landmark roles. |
| **Basic i18n (2 languages)** | Brazilian developer building for BR + international market. pt-BR + en is minimum. | HIGH | Touches every string in both apps. Largest single effort in v1.1. |
| **Team invite by email** | Multi-user tenants need to add members. Every B2B SaaS has this. | MEDIUM | better-auth organization plugin provides `inviteMember`, `acceptInvitation`, `rejectInvitation`, `cancelInvitation` out of the box. |
| **Role assignment on invite** | Inviter must choose role (owner/admin/member) at invite time | LOW | better-auth org plugin supports role param on `inviteMember()`. Already has owner/admin/member defaults. |
| **Invite link expiration** | Security requirement. Stale invites must not grant access. | LOW | better-auth org plugin has `invitationExpiresIn` config (default 48h). |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Payment provider abstraction (port/adapter)** | Switch between Stripe and local providers without changing business logic. No competitor offers this. | HIGH | Requires extracting current Stripe-specific code behind an interface. Major refactor of billing module. |
| **Brazilian payment provider adapter** | Serves BR market directly. Pix + boleto support via local gateway. | HIGH | Pagar.me or Mercado Pago SDK. Different API shape, different webhook format, different payment methods (Pix, boleto). |
| **Shared i18n package across SSR + SPA** | One set of translations for both frontends. No duplication, no drift. | MEDIUM | `packages/i18n` with JSON files consumed by both Next.js and Vite apps. Unique in starter kit space. |
| **Invite link (shareable URL)** | Copy a link instead of typing emails. Faster team onboarding. | LOW | Generate a signed URL with token, role, org. better-auth may support this or can be built on top of invitation hooks. |
| **i18n-ready module system** | Modules can declare their own translation namespaces | MEDIUM | Each module ships `locales/{lang}/{namespace}.json`. Module registry loads them. |
| **a11y testing in CI** | Catch accessibility regressions automatically | LOW | axe-core + Vitest integration. Differentiator vs competitors who ignore a11y entirely. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **next-intl for Next.js + react-i18next for Vite** | "Use the best tool for each framework" | Two different i18n libraries with different APIs, different interpolation syntax, different pluralization rules. Translation keys will subtly diverge. Devs must learn two systems. | Use i18next ecosystem everywhere: `react-i18next` for Vite admin, `next-i18next` (v16, wraps react-i18next) for Next.js. Same JSON files, same API, same mental model. |
| **Runtime language detection from browser** | "Auto-detect user language" | Causes SSR hydration mismatch in Next.js (server renders one locale, client detects another). Flash of wrong language. | Use URL-based locale (`/en/dashboard`, `/pt-BR/dashboard`). Detect on first visit only, then persist as user preference. |
| **Full WCAG 2.2 AAA compliance** | "Be maximally accessible" | AAA is aspirational, not legally required. Many AAA criteria (e.g., sign language for video) are irrelevant for a dashboard app. Massive effort for minimal gain. | Target WCAG 2.1 Level AA. Covers keyboard nav, screen readers, color contrast, focus indicators. This is the industry standard for web apps. |
| **Payment abstraction for 5+ providers** | "Support every gateway" | Each provider has different capabilities (subscriptions vs one-time, metered billing, refund flows, dispute handling). Abstraction becomes lowest-common-denominator. | Abstract the core operations (see below). Support Stripe + one BR provider. Design the interface so adding more is straightforward but don't over-abstract. |
| **Automatic translation via AI** | "Just run strings through GPT" | Quality issues, inconsistent terminology, no context awareness. Translations need human review for SaaS (billing terms, legal text, error messages). | Provide extraction tooling (`i18next-parser`) to find untranslated keys. Manual translations for v1.1. |
| **Full RTL (right-to-left) support** | "Support Arabic/Hebrew" | Requires mirroring entire layout, different CSS logical properties throughout, testing every component in RTL mode. Enormous effort. | Use CSS logical properties (`margin-inline-start` vs `margin-left`) from the start so RTL can be added later. Don't implement RTL now. |
| **Custom role builder UI** | "Let admins define custom roles" | Adds permission management complexity (permission inheritance, conflicts, UI for defining permissions). Custom roles are rarely needed in early SaaS. | Ship with 3 fixed roles (owner/admin/member). better-auth org plugin supports custom roles via `creatorRole` config if needed later. |

## Feature Dependencies

```
Responsive Layouts
    (no dependencies -- CSS/component work on existing layouts)

i18n Infrastructure
    |
    +---> packages/i18n (shared translations JSON + config)
    |       |
    |       +---> Next.js integration (next-i18next / middleware routing)
    |       |
    |       +---> Vite admin integration (react-i18next + language detector)
    |
    +---> All UI strings externalized (depends on responsive layouts being stable first)

Accessibility (a11y)
    |
    +---> Responsive layouts must be done first (a11y audits mobile + desktop)
    |
    +---> i18n should be done first (aria-labels need to be translatable)

Team/Org Invites
    |
    +---> Depends on: existing auth module + better-auth org plugin (already used)
    |
    +---> Invite email sending ---> existing BullMQ email job infrastructure
    |
    +---> Invite UI pages ---> depends on i18n (invite strings need translation)

Payment Provider Abstraction
    |
    +---> Depends on: existing billing module (must refactor, not rewrite)
    |
    +---> PaymentProvider port interface (defined first)
    |       |
    |       +---> StripeAdapter (extract from current billing commands)
    |       |
    |       +---> BrazilianProviderAdapter (Pagar.me or Mercado Pago)
    |
    +---> Webhook normalization layer (each provider has different webhook format)
    |
    +---> Does NOT depend on i18n or a11y (backend only)
```

### Dependency Notes

- **Responsive before a11y:** Accessibility audit must cover the final responsive layouts. Doing a11y first means re-auditing after layout changes.
- **i18n before team invites UI:** Invite screens (send invite, pending invites list, accept page) need translated strings. Build i18n first so invite UI ships localized.
- **Payment abstraction is independent:** Pure backend refactor. Can run in parallel with frontend work (responsive, i18n, a11y).
- **i18n is the largest dependency bottleneck:** It touches every string in both apps. Must be done early so other features (invite UI, a11y aria-labels) build on top of it.

## v1.1 Launch Scope

### Must Build (v1.1 Core)

- [ ] **Responsive layouts** -- fix sidebar overlay, mobile drawer, tablet breakpoints for both apps
- [ ] **i18n infrastructure** -- `packages/i18n` with JSON translations, next-i18next for web, react-i18next for admin, pt-BR + en
- [ ] **Keyboard navigation audit + fixes** -- focus order, focus indicators (`:focus-visible`), skip-to-content link, escape-to-close on modals/sheets
- [ ] **Screen reader basics** -- ARIA landmarks (`nav`, `main`, `aside`), aria-labels on icon buttons, live regions for toast notifications
- [ ] **Team invite flow** -- send invite, accept/reject, pending invites list, invite link generation, role selection
- [ ] **Payment provider port interface** -- define operations, extract Stripe adapter, one BR provider adapter

### Defer to v1.2+

- [ ] **Color contrast audit** -- automated contrast checking, dark mode a11y (trigger: when dark mode is added)
- [ ] **Additional languages beyond pt-BR/en** -- (trigger: user/market demand)
- [ ] **Invite link with custom expiration** -- (trigger: enterprise customers requesting longer/shorter windows)
- [ ] **Payment provider: additional adapters** -- PayPal, Mercado Pago if Pagar.me chosen, etc. (trigger: market demand)
- [ ] **a11y CI testing with axe-core** -- (trigger: after manual audit establishes baseline)
- [ ] **Translation management UI** -- (trigger: non-developer translators joining)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Responsive layouts (sidebar fix + breakpoints) | HIGH | LOW | P1 |
| i18n infrastructure + packages/i18n | HIGH | HIGH | P1 |
| pt-BR + en translations for all existing strings | HIGH | HIGH | P1 |
| Keyboard navigation + focus indicators | MEDIUM | MEDIUM | P1 |
| ARIA landmarks + screen reader basics | MEDIUM | LOW | P1 |
| Team invite flow (email + link) | HIGH | MEDIUM | P1 |
| Payment provider port interface | HIGH | HIGH | P1 |
| Stripe adapter (extract from current code) | HIGH | MEDIUM | P1 |
| Brazilian provider adapter (Pagar.me) | MEDIUM | HIGH | P2 |
| Skip-to-content link | LOW | LOW | P2 |
| a11y CI testing (axe-core) | LOW | LOW | P2 |
| Module-scoped translation namespaces | MEDIUM | MEDIUM | P2 |

**Priority key:**
- P1: Must have for v1.1 launch
- P2: Should have, add if time permits
- P3: Future consideration

## Detailed Feature Specifications

### 1. i18n Architecture

**Approach:** i18next core shared across both frontends.

| Component | Library | Role |
|-----------|---------|------|
| `packages/i18n` | i18next (core) | Shared config, JSON translation files, type-safe key definitions |
| `apps/web` | next-i18next v16 | Next.js App Router integration, SSR-safe, middleware for locale routing |
| `apps/admin` | react-i18next | Client-side SPA integration, language detector, lazy-loaded namespaces |

**Translation file structure:**
```
packages/i18n/
  locales/
    en/
      common.json      (shared: buttons, labels, errors)
      auth.json         (login, signup, password reset)
      billing.json      (plans, checkout, invoices)
      dashboard.json    (navigation, layout)
      admin.json        (admin-specific strings)
    pt-BR/
      common.json
      auth.json
      billing.json
      dashboard.json
      admin.json
  index.ts              (i18next config, type exports)
```

**Key decisions:**
- URL-based locale routing in Next.js (`/en/dashboard`, `/pt-BR/dashboard`) -- SSR-safe, SEO-friendly
- User preference stored in session/profile -- persists across devices
- Namespace-based loading -- admin app only loads `common` + `admin`, web app loads `common` + `auth` + `billing` + `dashboard`
- Type-safe keys via `i18next` TypeScript integration (declare resource type)

### 2. Accessibility Scope

**Target:** WCAG 2.1 Level AA for both frontends.

| Category | What to Do | Effort |
|----------|-----------|--------|
| **Keyboard** | Tab through all interactive elements in correct order. Visible focus ring (`:focus-visible`). Escape closes modals/sheets/dropdowns. Arrow keys in menus. | MEDIUM |
| **Screen reader** | `<nav>`, `<main>`, `<aside>` landmarks. `aria-label` on icon-only buttons. `aria-live="polite"` on toast container. `aria-current="page"` on active nav item. | LOW |
| **Forms** | All inputs have associated `<label>`. Error messages linked via `aria-describedby`. Required fields marked with `aria-required`. | LOW |
| **Focus management** | Focus moves to dialog content when opened. Focus returns to trigger when closed. Skip-to-content link as first focusable element. | MEDIUM |
| **Color** | Ensure 4.5:1 contrast ratio for text (AA standard). Don't convey info with color alone (add icons/text). | LOW (shadcn defaults are good) |

**What shadcn/Radix provides for free:** Correct `role` attributes, `aria-expanded`, `aria-haspopup`, keyboard interactions for dropdowns/dialogs/tabs/tooltips. The main work is auditing custom code, adding landmarks, and fixing focus management in layouts.

### 3. Responsive Layout Patterns

**Current state:** Both apps use shadcn's Sidebar component which already has:
- `useIsMobile()` hook for breakpoint detection
- Sheet (drawer) for mobile sidebar
- Collapsible mode with icon-only state
- Cookie-based state persistence

**What needs fixing (per PROJECT.md: "fix sidebar overlay"):**
- Mobile drawer likely has z-index or overlay backdrop issues
- Tablet breakpoint may not exist (need md: breakpoint between mobile drawer and desktop sidebar)
- Content area may not reflow properly when sidebar collapses

**Responsive breakpoint strategy:**
| Breakpoint | Sidebar Behavior | Content |
|------------|-----------------|---------|
| < 768px (mobile) | Hidden, triggered by hamburger, renders as Sheet/drawer overlay | Full width |
| 768-1024px (tablet) | Collapsed (icon-only), expandable on hover or click | Fills remaining space |
| > 1024px (desktop) | Expanded by default, collapsible via toggle | Fills remaining space |

### 4. Team Invite Flow

**better-auth organization plugin provides:**
- `inviteMember({ email, role, organizationId })` -- sends invite
- `acceptInvitation({ invitationId })` -- accept
- `rejectInvitation({ invitationId })` -- reject
- `cancelInvitation({ invitationId })` -- cancel pending
- Hooks: `beforeCreateInvitation`, `afterCreateInvitation`, `beforeAcceptInvitation`, `afterAcceptInvitation`
- Config: `invitationExpiresIn` (default 48h), `invitationLimit` (default 100)
- DB tables: `invitation` (status, email, role, expiration, inviter)
- `sendInvitationEmail` callback -- we wire this to existing BullMQ email job

**What we need to build on top:**
| Component | What | Effort |
|-----------|------|--------|
| Invite sending UI | Form with email input + role selector. In web app tenant settings. | LOW |
| Pending invites list | Table showing pending/accepted/rejected invites with cancel button | LOW |
| Accept/reject page | Public page at `/invite/[token]` -- shows org name, role, accept/reject buttons | LOW |
| Invite link generation | Generate shareable URL (not email-based). May need custom endpoint on top of better-auth. | MEDIUM |
| Email template | React Email template for invite notification. Uses existing BullMQ email job. | LOW |
| Admin view | Admin dashboard: see all invitations across tenants | LOW |

**Flow:**
1. Owner/admin opens tenant settings -> "Invite Member"
2. Enters email + selects role -> `inviteMember()` called
3. `sendInvitationEmail` hook fires -> enqueues BullMQ email job
4. Recipient gets email with link to `/invite/[token]`
5. If logged in: accept/reject. If new user: signup then accept.
6. On accept: added as member with assigned role

### 5. Payment Provider Abstraction

**Port interface operations (what the abstraction must cover):**

```typescript
interface PaymentProvider {
  // Identity
  readonly name: string;  // "stripe" | "pagarme" | etc.

  // Customer management
  createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer>;
  getCustomer(customerId: string): Promise<ProviderCustomer | null>;
  deleteCustomer(customerId: string): Promise<void>;

  // Checkout / payment initiation
  createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult>;
  createOneTimePayment(params: OneTimePaymentParams): Promise<PaymentResult>;

  // Subscriptions
  createSubscription(params: SubscriptionParams): Promise<SubscriptionResult>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  changeSubscription(params: ChangeSubscriptionParams): Promise<SubscriptionResult>;
  getSubscription(subscriptionId: string): Promise<SubscriptionResult | null>;

  // Usage-based billing
  recordUsage(params: UsageParams): Promise<void>;

  // Portal / self-service
  createPortalSession(params: PortalParams): Promise<PortalResult>;

  // Webhooks
  verifyWebhookSignature(payload: string | Buffer, signature: string): Promise<boolean>;
  normalizeWebhookEvent(rawEvent: unknown): Promise<NormalizedWebhookEvent>;
}
```

**Normalized webhook event types:**
```typescript
type NormalizedWebhookEvent =
  | { type: "checkout.completed"; data: CheckoutCompletedData }
  | { type: "subscription.created"; data: SubscriptionData }
  | { type: "subscription.updated"; data: SubscriptionData }
  | { type: "subscription.deleted"; data: SubscriptionData }
  | { type: "payment.succeeded"; data: PaymentData }
  | { type: "payment.failed"; data: PaymentData };
```

**Key design decisions:**
- Each adapter maps provider-specific events to normalized events
- Webhook handler calls `provider.normalizeWebhookEvent()` then processes normalized events (existing switch/case logic stays)
- Provider selection via config: `PAYMENT_PROVIDER=stripe` or `PAYMENT_PROVIDER=pagarme`
- Multiple providers can coexist (different tenants can use different providers if needed later)
- The Stripe adapter is extracted from existing code (not rewritten) -- `getStripe()` calls become `stripeAdapter.method()` calls

**Brazilian provider recommendation: Pagar.me**
- Best developer experience among BR gateways
- REST API with good TypeScript support
- Supports: credit card, boleto, Pix
- Subscription management built in
- Better suited for SaaS than Mercado Pago (which is more marketplace-oriented)

## Feature Dependencies (Ordered for Implementation)

```
Phase 1: Responsive + Payment Abstraction (parallel tracks)
    |
    +---> [Frontend] Fix sidebar overlay, add breakpoints, test mobile/tablet
    |
    +---> [Backend] Define PaymentProvider interface, extract StripeAdapter
    |
Phase 2: i18n Infrastructure
    |
    +---> packages/i18n setup, JSON files, type-safe keys
    +---> Next.js middleware for locale routing
    +---> Vite admin language switcher
    +---> Externalize ALL existing UI strings to translation files
    |
Phase 3: a11y + Team Invites (parallel tracks)
    |
    +---> [a11y] Audit with translated strings, fix focus, landmarks, ARIA
    |
    +---> [Invites] Wire better-auth org plugin invite methods, build UI pages, email template
    |
Phase 4: Brazilian Provider Adapter + Polish
    |
    +---> Pagar.me adapter implementing PaymentProvider interface
    +---> Final a11y audit pass
    +---> Translation review for pt-BR quality
```

## Competitor Feature Analysis (v1.1 specific features)

| Feature | Makerkit | Supastarter | Baseworks v1.1 Plan |
|---------|----------|-------------|---------------------|
| **i18n** | Yes (next-intl, Next.js only) | Yes (next-intl, Next.js only) | Yes (i18next ecosystem, shared across Next.js + Vite admin -- unique) |
| **Responsive** | Yes | Yes | Yes (fixing existing shadcn sidebar) |
| **a11y** | Basic | Basic | WCAG 2.1 AA target (more thorough than competitors) |
| **Team invites** | Yes (custom) | Yes (Supabase-based) | Yes (better-auth org plugin -- less custom code) |
| **Payment abstraction** | No (Stripe + Lemon Squeezy, separate code paths) | No (Stripe only) | Yes (port/adapter pattern -- unique differentiator) |
| **Brazilian provider** | No | No | Yes (Pagar.me adapter -- unique for BR market) |

## Sources

- [better-auth Organization Plugin](https://better-auth.com/docs/plugins/organization) -- invitation API, roles, hooks, config (HIGH confidence)
- [next-intl vs next-i18next comparison](https://i18nexus.com/posts/i18next-vs-next-intl) -- ecosystem comparison (HIGH confidence)
- [next-intl App Router docs](https://next-intl.dev/docs/getting-started/app-router) -- Next.js i18n patterns (HIGH confidence)
- [WCAG 2.1 Guidelines](https://www.w3.org/TR/WCAG21/) -- accessibility standards (HIGH confidence)
- [shadcn/ui and Radix accessibility](https://eastondev.com/blog/en/posts/dev/20260330-shadcn-radix-accessibility/) -- component a11y baseline (MEDIUM confidence)
- [Adapter Pattern for Payment Gateways](https://endgrate.com/blog/adapter-pattern-use-cases-payment-gateway-integration) -- port/adapter pattern (HIGH confidence)
- [Brazilian Payment Gateways comparison](https://www.rebill.com/en/blog/pasarelas-pago-brasil) -- BR provider landscape (MEDIUM confidence)
- [i18next monorepo shared translations](https://github.com/i18next/i18next/discussions/1604) -- monorepo i18n patterns (MEDIUM confidence)
- Existing codebase: sidebar component, billing module, auth module, admin layout (HIGH confidence -- verified by reading source)

---
*Feature research for: Baseworks v1.1 Polish & Extensibility*
*Researched: 2026-04-08*
