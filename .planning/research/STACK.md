# Stack Research: v1.1 Additions

**Domain:** SaaS Starter Kit -- i18n, a11y, responsive, payments abstraction, team invites
**Researched:** 2026-04-08
**Confidence:** MEDIUM-HIGH

**Scope:** This document covers ONLY new stack additions for v1.1. The existing v1.0 stack (Bun, Elysia, Drizzle, Next.js 15, Vite, React 19, shadcn/ui, Tailwind 4, better-auth, Stripe, BullMQ, etc.) is validated and unchanged.

---

## New Stack Additions

### 1. Internationalization (i18n)

**Strategy:** Use `next-intl` for the Next.js app and `react-i18next` for the Vite admin app. Share translation JSON files from a common `packages/i18n` workspace package. Both consume the same `{locale}/{namespace}.json` structure.

**Why two libraries instead of one:**
- `next-intl` is purpose-built for Next.js App Router with first-class Server Component support, locale-prefixed routing, and zero-hydration overhead for server-rendered pages. It is the most popular i18n library for App Router (1.8M weekly downloads, growing).
- `react-i18next` is the standard for non-Next.js React SPAs. It works perfectly with Vite + React Router. Using `next-i18next` in the admin app would require Next.js-specific infrastructure that does not exist.
- Both read the same JSON message format, so translation files are shared without conversion.

| Library | Version | Target App | Purpose | Why | Confidence |
|---------|---------|------------|---------|-----|------------|
| next-intl | ^4.0+ | apps/web | Next.js App Router i18n | Native Server Component support, locale routing, no hydration cost. Most popular App Router i18n lib. | HIGH |
| i18next | ^24.0+ | apps/admin | i18n core engine | Framework-agnostic core. 8.9M weekly downloads. Battle-tested. | HIGH |
| react-i18next | ^15.0+ | apps/admin | React bindings for i18next | Standard React integration for i18next. useTranslation() hook. | HIGH |
| i18next-browser-languagedetector | ^8.0+ | apps/admin | Auto-detect user locale | Detects from browser settings, URL, cookies. Needed for SPA. | HIGH |

**What NOT to add:**
- `i18next-http-backend` -- Unnecessary. Bundle JSON files at build time rather than fetching at runtime. Simpler, faster, no CORS issues.
- `next-i18next` -- Legacy Pages Router library. `next-intl` is the App Router standard.
- `i18next-resources-to-backend` -- Not needed if translations are statically imported.

**Shared translation structure (new package: `packages/i18n`):**
```
packages/i18n/
  messages/
    en/
      common.json      # Shared strings (buttons, labels, errors)
      auth.json         # Auth-related strings
      billing.json      # Billing-related strings
    pt-BR/
      common.json
      auth.json
      billing.json
  src/
    index.ts           # Export message loaders and locale config
    locales.ts         # Supported locales, default locale
```

**Integration notes:**
- `next-intl` supports monorepo setups natively -- merge messages from packages using TypeScript augmentation of `IntlMessages`
- For the admin app, initialize i18next once in `apps/admin/src/i18n.ts` and import shared JSONs from `@baseworks/i18n`
- Use ICU message format for plurals and interpolation (supported by both libraries)
- Store user locale preference in the session/user profile (database column)

---

### 2. Accessibility (a11y) Tooling

**Strategy:** Layer three complementary tools -- Biome's built-in a11y rules (already present), `vitest-axe` for component-level testing, and `@axe-core/react` for runtime dev auditing.

| Library | Version | Where | Purpose | Why | Confidence |
|---------|---------|-------|---------|-----|------------|
| vitest-axe | ^1.0+ | Dev dependency | Component a11y test assertions | Vitest-native version of jest-axe. Custom `toHaveNoViolations()` matcher. Works with existing Vitest + RTL setup. | MEDIUM |
| axe-core | ^4.10+ | Dev dependency | Accessibility engine | Core engine used by vitest-axe. Industry standard by Deque Labs. WCAG 2.1 AA rules. | HIGH |

**What is already available (no additions needed):**
- **Biome a11y rules** -- Biome 1.9+ includes ~35 accessibility lint rules (subset of jsx-a11y). Already configured in the project. Catches static JSX issues (missing alt text, invalid ARIA, etc.).
- **Radix UI primitives** -- All shadcn/ui components are built on Radix, which handles ARIA attributes, keyboard navigation, and focus management automatically. This is the biggest a11y win -- use shadcn components rather than custom HTML.
- **@testing-library/react** -- Already in the project. Its query hierarchy (`getByRole` > `getByLabelText` > `getByText`) naturally enforces accessible patterns.

**What NOT to add:**
- `@axe-core/react` -- Deprecated for React 18+. Deque recommends axe Developer Hub (paid) or vitest-axe (free) instead.
- `eslint-plugin-jsx-a11y` -- Would require adding ESLint back alongside Biome. Biome covers the most important rules. Not worth the tooling complexity.
- `pa11y` or `lighthouse` -- E2E a11y testing tools. Overkill for a starter kit. Add later if needed for CI.

**Testing pattern:**
```typescript
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

it('has no a11y violations', async () => {
  const { container } = render(<MyComponent />);
  expect(await axe(container)).toHaveNoViolations();
});
```

**Manual a11y checklist (no library needed, just conventions):**
- All interactive elements must be keyboard-accessible (Tab, Enter, Escape)
- Focus trapping in modals/dialogs (Radix handles this)
- Skip-to-content link on main layouts
- Sufficient color contrast (4.5:1 minimum for WCAG AA)
- `aria-live` regions for dynamic content updates (toasts, form errors)
- Semantic HTML: `<main>`, `<nav>`, `<header>`, `<aside>`, `<section>` with headings

---

### 3. Responsive Design (Tailwind 4)

**Strategy:** No new libraries needed. Tailwind 4 ships everything required -- viewport breakpoints, container queries, and responsive utilities. The work is CSS/component architecture, not library additions.

**Built-in Tailwind 4 features to leverage:**

| Feature | Syntax | Use Case |
|---------|--------|----------|
| Viewport breakpoints | `sm:`, `md:`, `lg:`, `xl:`, `2xl:` | Page-level layout changes |
| Container queries | `@container` + `@sm:`, `@md:`, `@lg:` | Component-level responsiveness (cards, sidebar, tables) |
| Custom containers | `@container/sidebar` | Named containers for specific components |

**Container queries are the key addition for v1.1.** They let components respond to their parent's width rather than the viewport. This is critical for:
- Sidebar that collapses to icon-only on narrow viewports
- Dashboard cards that reflow based on grid cell size
- Admin tables that switch between table and card views

**Container query breakpoints (different from viewport):**
| Name | Container | Viewport |
|------|-----------|----------|
| @sm | 320px | 640px |
| @md | 448px | 768px |
| @lg | 576px | 1024px |

**What NOT to add:**
- `@tailwindcss/container-queries` plugin -- Was needed for Tailwind 3. Container queries are native in Tailwind 4.
- Any CSS-in-JS responsive library -- Tailwind handles everything.
- `react-responsive` or `use-media-query` hooks -- Use Tailwind CSS classes instead of JS-based media queries. Avoids hydration mismatches in Next.js.

**Sidebar fix pattern (the specific issue from PROJECT.md):**
```html
<!-- Mobile: overlay with backdrop -->
<!-- Desktop: persistent sidebar -->
<aside class="fixed inset-y-0 left-0 z-40 w-64 -translate-x-full md:translate-x-0 md:static">
  ...
</aside>
```

---

### 4. Payment Provider Abstraction

**Strategy:** Define a `PaymentProvider` TypeScript interface in `@baseworks/shared`, implement a `StripeAdapter` that wraps the existing Stripe code, and add a `MercadoPagoAdapter` for Brazil. Use the Adapter pattern (not Strategy) because providers have fundamentally different APIs that must be normalized.

| Library | Version | Purpose | Why | Confidence |
|---------|---------|---------|-----|------------|
| mercadopago | ^2.0+ | Mercado Pago Node.js SDK | Official SDK by MercadoLibre. Supports PIX, boleto, credit cards, installments. Most widely used Brazilian payment gateway. Has Node.js 16+ support. | MEDIUM |

**Why Mercado Pago over alternatives:**
- **Pagar.me**: Good API, but smaller ecosystem and recently acquired by Stone. SDK maintenance uncertain.
- **Asaas**: Community SDK only (unofficial). Not suitable for a starter kit that needs reliability.
- **PagSeguro**: Legacy API design, poor TypeScript support.
- **Mercado Pago**: Official SDK (`mercadopago` npm), 70K+ weekly downloads, backed by MercadoLibre (MELI), supports PIX natively, best Brazilian payment coverage.

**Interface design:**
```typescript
// packages/shared/src/types/payment-provider.ts
interface PaymentProvider {
  readonly name: string;
  createCustomer(params: CreateCustomerParams): Promise<Result<Customer>>;
  createCheckoutSession(params: CheckoutParams): Promise<Result<CheckoutSession>>;
  createSubscription(params: SubscriptionParams): Promise<Result<Subscription>>;
  cancelSubscription(subscriptionId: string): Promise<Result<void>>;
  verifyWebhook(payload: string, signature: string): Promise<Result<WebhookEvent>>;
  getPortalUrl?(customerId: string): Promise<Result<string>>;  // Optional: not all providers have portals
}
```

**Key abstraction decisions:**
- `getPortalUrl` is optional -- Stripe has Customer Portal, Mercado Pago does not. UI must handle this gracefully.
- Webhook event types must be normalized to a common enum (`subscription.created`, `payment.succeeded`, etc.)
- Provider-specific data (e.g., PIX QR codes from Mercado Pago) goes in a `metadata` field
- The billing module config specifies which provider to use per tenant or globally
- Idempotency handling stays in the adapter (Stripe uses idempotency keys, Mercado Pago uses its own mechanism)

**Migration path from current code:**
The current billing module calls `getStripe()` directly in command handlers. The refactor:
1. Define `PaymentProvider` interface in `@baseworks/shared`
2. Move existing Stripe logic into `packages/modules/billing/src/adapters/stripe.ts` implementing the interface
3. Create `packages/modules/billing/src/adapters/mercado-pago.ts`
4. Replace `getStripe()` calls with `getPaymentProvider()` that returns the configured adapter
5. Command handlers call `provider.createCheckoutSession()` instead of `stripe.checkout.sessions.create()`

---

### 5. Team/Org Invite Flow

**Strategy:** No new libraries needed. better-auth's organization plugin already includes invitation infrastructure. The work is configuration, UI, and email templates.

**What better-auth organization plugin provides out-of-the-box:**
- `auth.api.createInvitation({ email, role, organizationId })` -- Create invites
- `auth.api.acceptInvitation({ invitationId })` -- Accept invites
- `auth.api.rejectInvitation({ invitationId })` -- Decline invites
- `auth.api.cancelInvitation({ invitationId })` -- Cancel pending invites
- `auth.api.getInvitation({ id })` -- Get invite details
- Invitation expiration (`invitationExpiresIn`, default 48 hours)
- Invitation limits per org (`invitationLimit`)
- Role assignment on invite (`role: "admin" | "member" | "owner"`)
- Auto-cancel old invites on re-invite (`cancelPendingInvitationsOnReInvite`)

**Configuration additions to existing auth.ts:**
```typescript
organization({
  allowUserToCreateOrganization: true,
  creatorRole: "owner",
  organizationLimit: 5,
  // NEW for v1.1:
  invitationExpiresIn: 60 * 60 * 48,  // 48 hours
  invitationLimit: 20,                  // Max pending invites per org
  sendInvitationEmail: async ({ invitation, organization, inviter }) => {
    const queue = getEmailQueue();
    if (queue) {
      await queue.add("org-invite", {
        to: invitation.email,
        template: "org-invite",
        data: {
          orgName: organization.name,
          inviterName: inviter.name,
          role: invitation.role,
          acceptUrl: `${env.WEB_URL}/invites/${invitation.id}/accept`,
        },
      });
    }
  },
}),
```

**What to build (not library additions):**
- Invite email template (React Email, already in stack)
- `/invites/[id]/accept` page in Next.js app
- Team management UI in admin dashboard (list members, send invites, revoke)
- Invite link generation (shareable URL with token)

---

## Installation (v1.1 additions only)

```bash
# i18n -- Next.js app
cd apps/web && bun add next-intl

# i18n -- Admin app
cd apps/admin && bun add i18next react-i18next i18next-browser-languagedetector

# i18n -- Shared translations package
mkdir -p packages/i18n && cd packages/i18n && bun init

# a11y testing
cd . && bun add -D vitest-axe  # root or packages/ui

# Payment abstraction -- Brazilian provider
cd packages/modules/billing && bun add mercadopago

# Responsive: Nothing to install (Tailwind 4 native)
# Team invites: Nothing to install (better-auth native)
```

---

## Alternatives Considered (v1.1 specific)

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| i18n (Next.js) | next-intl | next-i18next | next-i18next was Pages Router era. next-intl is built for App Router with Server Component support. |
| i18n (Next.js) | next-intl | lingui | Smaller community, compile-time extraction adds build complexity. |
| i18n (Vite) | react-i18next | react-intl (FormatJS) | react-i18next has better ecosystem (plugins, tools). react-intl requires more boilerplate. |
| i18n (shared) | Two libs + shared JSON | Single i18next everywhere | next-intl's Server Component integration is too good to give up. The JSON format is the same, so sharing works. |
| a11y testing | vitest-axe | @axe-core/react | @axe-core/react is deprecated for React 18+. vitest-axe integrates with existing test setup. |
| a11y linting | Biome (existing) | eslint-plugin-jsx-a11y | Would require re-adding ESLint. Biome covers core rules. Not worth the tooling split. |
| Responsive | Tailwind 4 native | react-responsive | JS-based media queries cause hydration mismatches in SSR. CSS-only approach is simpler and faster. |
| BR Payments | Mercado Pago | Pagar.me | Official SDK, largest market share in Brazil, PIX native. Pagar.me SDK maintenance uncertain post-Stone acquisition. |
| BR Payments | Mercado Pago | Asaas | Asaas only has unofficial community SDK. Not production-grade for a starter kit. |
| Invite flow | better-auth org plugin | Custom implementation | Plugin already has full invite CRUD + expiration + role assignment. Building custom would duplicate existing code. |

---

## What NOT to Add for v1.1

| Technology | Why Not | What to Use Instead |
|------------|---------|---------------------|
| next-i18next | Legacy Pages Router library | next-intl |
| @axe-core/react | Deprecated for React 18+ | vitest-axe |
| eslint-plugin-jsx-a11y | Would require ESLint alongside Biome | Biome's built-in a11y rules |
| @tailwindcss/container-queries | Tailwind 3 plugin, built-in to v4 | Native Tailwind 4 container queries |
| react-responsive / use-media-query | JS-based, SSR hydration issues | Tailwind CSS responsive classes |
| i18next-http-backend | Runtime fetching adds latency and CORS complexity | Static imports of JSON at build time |
| Custom invite system | Duplicates better-auth functionality | better-auth organization plugin |
| Pagar.me SDK | Uncertain maintenance post-acquisition | Mercado Pago official SDK |

---

## Version Compatibility (v1.1 additions)

| New Package | Compatible With | Notes |
|-------------|-----------------|-------|
| next-intl ^4.0 | Next.js 15+, React 19+, App Router | Requires `createNavigation` and `NextIntlClientProvider` setup |
| i18next ^24.0 | Any React version | Framework-agnostic core |
| react-i18next ^15.0 | React 18+ or 19+ | Uses hooks API (useTranslation) |
| vitest-axe ^1.0 | Vitest 2.0+, axe-core 4.x | Fork of jest-axe adapted for Vitest |
| mercadopago ^2.0 | Node.js 16+, Bun 1.0+ | Official Mercado Pago SDK |

---

## Sources

- [next-intl official docs](https://next-intl.dev/docs/getting-started/app-router) -- App Router setup, monorepo support
- [next-intl vs i18next comparison](https://i18nexus.com/posts/i18next-vs-next-intl) -- Feature comparison, download stats
- [next-intl complete guide 2026](https://intlpull.com/blog/next-intl-complete-guide-2026) -- Current best practices
- [react-i18next quick start](https://react.i18next.com/guides/quick-start) -- Vite + React setup
- [vitest-axe GitHub](https://github.com/chaance/vitest-axe) -- Vitest accessibility matcher
- [Biome linter docs](https://biomejs.dev/linter/) -- Built-in a11y rules
- [Biome 2026 roadmap](https://biomejs.dev/blog/roadmap-2026/) -- Planned a11y improvements
- [Tailwind CSS responsive design docs](https://tailwindcss.com/docs/responsive-design) -- Viewport + container queries
- [Tailwind 4 container queries guide](https://www.sitepoint.com/tailwind-css-v4-container-queries-modern-layouts/) -- Native container query usage
- [better-auth organization plugin](https://better-auth.com/docs/plugins/organization) -- Invitation API, config options
- [better-auth organization deep wiki](https://deepwiki.com/better-auth/better-auth/5.2-organization-plugin) -- Members, roles, invitations detail
- [Mercado Pago Node.js SDK](https://github.com/mercadopago/sdk-nodejs) -- Official SDK repository
- [Payment gateway strategy pattern](https://medium.com/@anayshri/implementing-a-multi-payment-gateway-system-with-strategy-pattern-7750e86f1f65) -- Abstraction pattern reference
- [Payment gateways in Brazil 2026](https://www.rebill.com/en/blog/pasarelas-pago-brasil) -- Market overview

---
*Stack research for: Baseworks v1.1 additions*
*Researched: 2026-04-08*
