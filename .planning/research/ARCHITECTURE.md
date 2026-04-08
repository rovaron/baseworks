# Architecture Research

**Domain:** v1.1 Feature Integration into Existing Baseworks Monorepo
**Researched:** 2026-04-08
**Confidence:** HIGH

## System Overview: v1.1 Integration Points

```
                         EXISTING (v1.0)                    NEW (v1.1)
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Shared Packages Layer                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ @bw/ui   │  │ @bw/db   │  │@bw/shared│  │@bw/config│  │ @bw/i18n     │ │
│  │ shadcn   │  │ drizzle  │  │ types    │  │ env      │  │ (NEW)        │ │
│  │ +a11y fix│  │ +provider│  │ +payment │  │          │  │ shared JSON  │ │
│  │ +respond.│  │  columns │  │  port    │  │          │  │ translations │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│                          Module Layer                                       │
│  ┌────────────────┐  ┌──────────────────┐                                  │
│  │ auth module    │  │ billing module   │                                  │
│  │ EXTEND:        │  │ REFACTOR:        │                                  │
│  │ +invite cmds   │  │ +PaymentProvider │                                  │
│  │ +invite queries│  │  port interface  │                                  │
│  │ +invite jobs   │  │ +StripeAdapter   │                                  │
│  │ +invite events │  │ +AsaasAdapter    │                                  │
│  └────────────────┘  └──────────────────┘                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                          Application Layer                                  │
│  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────────┐  │
│  │ apps/web (Next.js) │  │ apps/admin (Vite)  │  │ apps/api (Elysia)   │  │
│  │ +next-intl         │  │ +react-i18next     │  │ (routes unchanged)  │  │
│  │ +responsive layouts│  │ +responsive layouts│  │                      │  │
│  │ +invite accept UI  │  │ +invite mgmt UI   │  │                      │  │
│  └────────────────────┘  └────────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | v1.1 Changes |
|-----------|----------------|--------------|
| `@baseworks/i18n` (NEW) | Shared translation JSON files, locale types, shared utilities | New package. Holds all `en.json` / `pt-BR.json` files and TypeScript locale type definitions |
| `@baseworks/ui` | Shared shadcn components | Fix responsive issues (sidebar overlay), add a11y attributes, touch targets. No i18n here -- components receive translated strings as props |
| `@baseworks/shared` | CQRS types, module contract | Add `PaymentProvider` port interface for billing abstraction |
| `@baseworks/db` | Drizzle schema, scoped DB | Billing schema migration: rename Stripe-specific columns to provider-agnostic names |
| `modules/auth` | Auth, tenancy, membership | EXTEND with invite commands/queries/jobs/events (NOT a new module) |
| `modules/billing` | Payment processing | REFACTOR: extract Stripe-specific code behind a `PaymentProvider` port; add adapter selection |
| `apps/web` | Customer Next.js app | Add next-intl, responsive layouts, invite accept flow |
| `apps/admin` | Admin Vite SPA | Add react-i18next, responsive layouts, invite management UI |

## Question 1: Where Do i18n Translations Live?

### Recommendation: New `packages/i18n` Package for Shared Translations

**Architecture:** Create `@baseworks/i18n` as a new shared package. Both apps import from it, but each app uses its own i18n framework.

```
packages/i18n/
├── package.json
├── src/
│   ├── index.ts              # Type exports, locale list, utility functions
│   ├── types.ts              # TypeScript type for translation keys (generated or manual)
│   └── locales/
│       ├── en/
│       │   ├── common.json   # Shared: buttons, labels, errors, navigation
│       │   ├── auth.json     # Auth-related strings
│       │   ├── billing.json  # Billing-related strings
│       │   └── admin.json    # Admin-specific strings
│       └── pt-BR/
│           ├── common.json
│           ├── auth.json
│           ├── billing.json
│           └── admin.json
```

**Why shared package, not per-app:**
- Both frontends share 60-70% of strings (auth forms, billing, navigation, error messages)
- Single source of truth avoids translation drift between apps
- Translators work in one place, not two
- Type-safe keys can be generated once and shared

**Why NOT in `@baseworks/ui`:**
- UI components should be language-agnostic. They receive translated strings as props
- Mixing translations into UI creates coupling (what if a third frontend is added?)
- Separation of concerns: `@baseworks/ui` = visual components, `@baseworks/i18n` = text content

### Per-App i18n Framework (Different Libraries, Same Translations)

**apps/web (Next.js): Use `next-intl`**
- Purpose-built for Next.js App Router + Server Components
- ~2KB bundle. Translations load on server, zero client JS for server-rendered pages
- Middleware handles locale detection and routing (`/en/dashboard`, `/pt-BR/dashboard`)
- Import translation JSONs from `@baseworks/i18n` package

**apps/admin (Vite SPA): Use `react-i18next`**
- The standard for non-Next.js React apps. Mature, well-documented
- No SSR needed in admin SPA, so next-intl's server component advantage is irrelevant
- Namespace support maps cleanly to the JSON file structure (`common`, `auth`, `billing`, `admin`)
- Import same translation JSONs from `@baseworks/i18n` package

**Why different libraries per app:** next-intl is superior for Next.js (server component support, middleware routing, smaller bundle). But next-intl is Next.js-only -- it cannot run in a Vite SPA. react-i18next is the correct choice for the admin dashboard. The shared `@baseworks/i18n` package ensures both apps consume identical translation files regardless of the i18n runtime.

### Data Flow: Translations

```
@baseworks/i18n (JSON files + types)
    |
    ├── apps/web (next-intl)
    |   ├── middleware.ts          # Locale detection, /[locale]/ routing
    |   ├── i18n/request.ts       # next-intl getRequestConfig, loads from @baseworks/i18n
    |   └── components use:       # useTranslations('common') -- server or client
    |
    └── apps/admin (react-i18next)
        ├── lib/i18n.ts           # i18next.init(), import JSONs from @baseworks/i18n
        └── components use:       # useTranslation('common') -- client only
```

### JSON Namespace Strategy

| Namespace | Used By | Contents |
|-----------|---------|----------|
| `common` | Both apps | Buttons (Save, Cancel, Delete), validation errors, navigation labels, date formats |
| `auth` | Both apps | Login, signup, password reset, invite accept/reject |
| `billing` | Both apps | Subscription, payment, invoice, plan names |
| `admin` | Admin only | Admin-specific: tenant management, user management, system health |
| `dashboard` | Web only | Customer dashboard-specific strings |

**Confidence:** HIGH -- this pattern is well-established in monorepos. The separation of translation data (shared) from i18n runtime (per-app) is the standard approach.

## Question 2: Payment Provider Abstraction in CQRS Billing Module

### Recommendation: Port/Adapter Pattern Inside the Billing Module

The existing billing module has Stripe calls directly inside CQRS command handlers (e.g., `create-checkout-session.ts` calls `getStripe()` directly). The abstraction introduces a `PaymentProvider` port interface and adapter implementations.

### Architecture

```
packages/shared/src/types/
├── payment-provider.ts    # NEW: PaymentProvider port interface

packages/modules/billing/src/
├── adapters/
│   ├── index.ts           # Adapter factory (reads config/env to select provider)
│   ├── stripe.ts          # Move getStripe() + Stripe-specific logic here
│   └── asaas.ts           # NEW: Asaas adapter (Pix + boleto)
├── commands/
│   ├── create-checkout-session.ts  # REFACTORED: Uses PaymentProvider instead of getStripe()
│   ├── cancel-subscription.ts      # REFACTORED: Uses PaymentProvider
│   └── ...
├── index.ts               # Unchanged module definition
├── routes.ts              # Webhook route needs per-provider endpoints
└── schema.ts              # Re-exports provider-agnostic column names
```

### PaymentProvider Port Interface

```typescript
// packages/shared/src/types/payment-provider.ts

export interface PaymentProvider {
  readonly name: string;  // 'stripe' | 'asaas'

  // Customer management
  createCustomer(params: CreateCustomerParams): Promise<Result<ProviderCustomer>>;

  // Checkout / Payment creation
  createCheckoutSession(params: CheckoutParams): Promise<Result<CheckoutResult>>;
  createOneTimePayment(params: OneTimePaymentParams): Promise<Result<PaymentResult>>;

  // Subscription management
  cancelSubscription(params: CancelParams): Promise<Result<void>>;
  changeSubscription(params: ChangeParams): Promise<Result<void>>;

  // Portal (self-service billing management)
  createPortalSession(params: PortalParams): Promise<Result<PortalResult>>;

  // Usage-based billing
  recordUsage(params: UsageParams): Promise<Result<void>>;

  // Webhook verification
  verifyWebhook(rawBody: string, signature: string): Promise<Result<WebhookEvent>>;

  // Status
  getSubscriptionStatus(customerId: string): Promise<Result<SubscriptionStatus>>;
}
```

### How It Fits Existing CQRS

The CQRS pattern stays exactly the same. Command handlers still receive `(input, ctx)`. The change is internal to the handler -- instead of calling `getStripe()`, they call `getPaymentProvider()`:

```typescript
// BEFORE (v1.0): Direct Stripe coupling
import { getStripe } from "../stripe";

export const createCheckoutSession = defineCommand(schema, async (input, ctx) => {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({...});
  return ok({ sessionId: session.id, url: session.url });
});

// AFTER (v1.1): Provider-agnostic
import { getPaymentProvider } from "../adapters";

export const createCheckoutSession = defineCommand(schema, async (input, ctx) => {
  const provider = getPaymentProvider();
  const result = await provider.createCheckoutSession({...});
  return result;
});
```

### Webhook Route Changes

The webhook route (`/api/billing/webhooks`) needs provider-specific endpoints:

```
/api/billing/webhooks/stripe   -- Stripe webhooks (existing, relocated)
/api/billing/webhooks/asaas    -- Asaas webhooks (new)
```

Each route calls the correct adapter's `verifyWebhook()`. This is cleaner than header detection and allows both providers to be configured simultaneously (e.g., migrating tenants from one provider to another).

### Database Schema Changes

The current `billing_customers` table has Stripe-specific columns. Abstract them:

```typescript
// BEFORE (Stripe-coupled)
stripeCustomerId: text("stripe_customer_id").notNull().unique(),
stripeSubscriptionId: text("stripe_subscription_id"),
stripePriceId: text("stripe_price_id"),

// AFTER (provider-agnostic)
provider: text("provider").notNull().default("stripe"),       // 'stripe' | 'asaas'
providerCustomerId: text("provider_customer_id").notNull(),
providerSubscriptionId: text("provider_subscription_id"),
providerPriceId: text("provider_price_id"),
providerMetadata: text("provider_metadata"),  // JSON for provider-specific data
```

The `webhook_events` table similarly needs `stripeEventId` renamed to `providerEventId` with a `provider` column added.

### Brazilian Provider Recommendation: Asaas

**Why Asaas over alternatives (EBANX, PagSeguro, MercadoPago):**
- REST API, no SDK needed (HTTP calls from adapter). Works with any runtime including Bun
- Supports Pix, Boleto, and Credit Card
- Sandbox environment for testing
- Well-documented API with English docs available
- Reasonable pricing for SaaS. No minimum volume requirements
- Pix Automatico support coming for recurring payments

**Confidence:** MEDIUM on Asaas adapter specifics (needs real integration testing). HIGH on the port/adapter pattern design.

## Question 3: Team Invitations -- Extend Auth Module, Not New Module

### Recommendation: Extend the Existing Auth Module

**Why NOT a separate `invitations` module:**
- better-auth's organization plugin ALREADY has built-in invitation support (`inviteMember`, `acceptInvitation`, `rejectInvitation`, `cancelInvitation`)
- Invitations are intrinsically tied to organizations (tenants) and membership -- they are auth/tenancy concerns
- A separate module would need to import from auth anyway, creating circular dependencies
- The auth module already has `member.added` and `member.removed` events

**What better-auth provides out of the box:**
- `invitation` table in DB (auto-managed by better-auth org plugin)
- Client methods: `organization.inviteMember()`, `organization.acceptInvitation()`, etc.
- Server API: `auth.api.createInvitation()`, `auth.api.acceptInvitation()`, etc.
- Configurable: `sendInvitationEmail`, `invitationExpiresIn`, role assignment
- Built-in roles: owner, admin, member (plus custom roles)

### New CQRS Commands/Queries in Auth Module

```typescript
// packages/modules/auth/src/index.ts -- EXTENDED
export default {
  name: "auth",
  routes: authRoutes,
  commands: {
    // Existing
    "auth:create-tenant": createTenant,
    "auth:update-tenant": updateTenant,
    "auth:delete-tenant": deleteTenant,
    "auth:update-profile": updateProfile,
    // NEW v1.1
    "auth:invite-member": inviteMember,
    "auth:accept-invitation": acceptInvitation,
    "auth:reject-invitation": rejectInvitation,
    "auth:cancel-invitation": cancelInvitation,
    "auth:remove-member": removeMember,
    "auth:update-member-role": updateMemberRole,
  },
  queries: {
    // Existing
    "auth:get-tenant": getTenant,
    "auth:list-tenants": listTenants,
    "auth:list-members": listMembers,
    "auth:get-profile": getProfile,
    // NEW v1.1
    "auth:list-invitations": listInvitations,
    "auth:list-user-invitations": listUserInvitations,
    "auth:get-invitation": getInvitation,
  },
  jobs: {
    // NEW v1.1 -- reuses existing email:send queue
    "auth:send-invite-email": {
      queue: "email:send",
      handler: sendInviteEmail,
    },
  },
  events: [
    // Existing
    "user.created", "tenant.created", "member.added", "member.removed", "tenant.deleted",
    // NEW v1.1
    "invitation.sent", "invitation.accepted", "invitation.rejected", "invitation.expired",
  ],
} satisfies ModuleDefinition;
```

### better-auth Configuration Changes

```typescript
// packages/modules/auth/src/auth.ts -- ADD to organization plugin config
organization({
  allowUserToCreateOrganization: true,
  creatorRole: "owner",
  organizationLimit: 5,
  // NEW v1.1
  invitationExpiresIn: 60 * 60 * 48, // 48 hours
  sendInvitationEmail: async ({ invitation, organization, inviter }) => {
    const queue = getEmailQueue();
    if (queue) {
      await queue.add("invite-email", {
        to: invitation.email,
        template: "organization-invite",
        data: {
          organizationName: organization.name,
          inviterName: inviter.name,
          inviteUrl: `${env.WEB_URL}/invitations/${invitation.id}`,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        },
      });
    }
  },
}),
```

### Invite Accept Flow

```
1. Owner clicks "Invite Member" in web/admin UI
2. Frontend calls auth:invite-member command
3. Command wraps auth.api.createInvitation()
4. better-auth creates invitation record in DB
5. sendInvitationEmail fires -> BullMQ email:send queue
6. Worker sends email via Resend with invite link
7. Invitee clicks link -> /invitations/[id] in Next.js app
8. Page calls auth:accept-invitation command
9. better-auth adds member to organization
10. Events "invitation.accepted" + "member.added" emitted
```

**Confidence:** HIGH -- better-auth's organization plugin has first-class invitation support. The CQRS wrapping follows the exact same pattern as existing auth commands.

## Question 4: Responsive Breakpoints with Existing Tailwind 4 + shadcn

### Current State

The existing setup already has responsive foundations:
- `useIsMobile()` hook in `@baseworks/ui` (768px breakpoint)
- shadcn `Sidebar` component uses `Sheet` for mobile (slide-over overlay)
- Tailwind 4 includes default breakpoints: `sm:640px`, `md:768px`, `lg:1024px`, `xl:1280px`
- The sidebar already uses `md:block` / `md:flex` for desktop, Sheet for mobile

### What Needs Fixing

The PROJECT.md mentions "fix sidebar overlay" -- the sidebar Sheet overlay likely does not dismiss on navigation or the overlay covers content incorrectly. The sidebar component already handles mobile via Sheet; the fix is behavioral, not structural.

### Responsive Strategy

**No new breakpoints needed.** Tailwind 4's defaults align with shadcn's conventions:

| Breakpoint | Target | Usage |
|------------|--------|-------|
| `< 640px` (default) | Mobile phones | Single column, hamburger menu, stacked cards |
| `sm:` (640px+) | Large phones / small tablets | Minor spacing adjustments |
| `md:` (768px+) | Tablets / small laptops | Sidebar visible, 2-column layouts |
| `lg:` (1024px+) | Laptops | Full sidebar + content, data tables comfortable |
| `xl:` (1280px+) | Desktops | Max-width containers, extra whitespace |

### Changes Required

**`@baseworks/ui` (shared):**
- Fix sidebar overlay dismiss behavior (likely Sheet `onOpenChange` not firing on route change)
- Ensure all interactive elements have minimum 44x44px touch targets on mobile
- Verify Sheet, Dialog, DropdownMenu work on touch devices
- Add `sr-only` labels and ARIA attributes where missing

**`apps/web` dashboard layout:**
```typescript
// CURRENT (v1.0)
<main className="flex-1 overflow-auto">
  <div className="mx-auto max-w-4xl p-6">{children}</div>
</main>

// AFTER (v1.1): Responsive padding
<main className="flex-1 overflow-auto">
  <div className="mx-auto max-w-4xl px-4 py-4 md:px-6 md:py-6">{children}</div>
</main>
```

**`apps/admin` data tables:**
- Tables need horizontal scroll on mobile: `<div className="overflow-x-auto">`
- Consider card view for list pages on mobile (users, tenants) as alternative to tables
- Admin is less critical for mobile (admins typically use desktops), but should not break

**No custom breakpoint configuration needed.** Tailwind 4 uses CSS-first configuration. If custom breakpoints were needed (they are not), they would go in the CSS `@theme` block.

**Confidence:** HIGH -- Tailwind 4 defaults + shadcn's built-in responsive patterns cover all needs. The work is applying responsive classes to existing layouts, not configuring new infrastructure.

## Question 5: Suggested Build Order

### Dependency Analysis

```
                    [Responsive + a11y]
                         |
                         |  (no backend deps, pure UI)
                         |
                    [i18n infrastructure]
                         |
                         |  (needs responsive layouts done first so
                         |   translated strings fit in responsive containers)
                         |
              ┌──────────┴──────────┐
              |                     |
    [Team Invitations]    [Payment Abstraction]
              |                     |
              |  (uses i18n for     |  (uses i18n for
              |   invite emails)    |   payment status strings)
              └──────────┬──────────┘
                         |
                    [Integration Testing]
```

### Recommended Phase Order

**Phase 1: Responsive + Accessibility**
- Zero backend changes. Pure frontend work
- Fix sidebar overlay bug in `@baseworks/ui`
- Add responsive classes to all layouts and pages in both apps
- Add a11y: keyboard navigation, ARIA labels, focus management, semantic HTML
- Touch targets on mobile for all interactive elements
- This phase produces a solid UI foundation that all subsequent features build on

**Phase 2: i18n Infrastructure**
- Create `@baseworks/i18n` package with JSON translation files
- Set up `next-intl` in `apps/web` with locale routing middleware
- Set up `react-i18next` in `apps/admin`
- Translate all existing UI strings to `en` + `pt-BR`
- Add locale switcher component to both apps
- Must come after responsive because pt-BR strings are ~30% longer than English and need to fit in responsive containers

**Phase 3: Team/Org Invitations**
- Configure better-auth organization plugin with `sendInvitationEmail`
- Add CQRS commands/queries/jobs/events to auth module
- Build invite email template (React Email, already in the stack)
- Build invite accept page in `apps/web`
- Build invite management UI in `apps/admin`
- Depends on i18n being ready (invite emails and UI should be translated from day one)

**Phase 4: Payment Provider Abstraction**
- Define `PaymentProvider` port interface in `@baseworks/shared`
- Extract existing Stripe code into `StripeAdapter`
- Refactor all billing commands to use adapter
- Database migration (Stripe-specific columns to provider-agnostic)
- Build `AsaasAdapter` (Pix + boleto)
- Add provider-specific webhook routes
- This is the highest-risk phase (refactoring working code + new external integration)

### Phase Ordering Rationale

1. **Responsive/a11y first** because it is pure frontend, zero backend risk, and creates the visual foundation everything else builds on
2. **i18n second** because all subsequent features (invite emails, payment status messages, new UI pages) should be born translated rather than retrofitted
3. **Invitations third** because it extends existing better-auth patterns with moderate complexity and produces visible new functionality
4. **Payment abstraction last** because it is the highest-risk refactor (changing working billing code), involves external API integration (Asaas), and has the fewest dependencies on other v1.1 features

## Anti-Patterns to Avoid

### Anti-Pattern 1: i18n in Shared UI Components

**What people do:** Put `useTranslation()` calls inside `@baseworks/ui` components
**Why it's wrong:** Couples UI components to i18n runtime. Breaks reusability. Forces both apps to use the same i18n library. Components cannot be used without i18n context
**Do this instead:** UI components accept translated strings as props. The calling app handles translation

### Anti-Pattern 2: Separate Invitations Module

**What people do:** Create `packages/modules/invitations/` as a standalone module
**Why it's wrong:** Invitations are a sub-feature of the organization/tenancy system. Separate module creates circular dependencies with auth (needs org context, needs user context). Duplicates auth middleware setup
**Do this instead:** Extend `packages/modules/auth/` with invite commands/queries/jobs

### Anti-Pattern 3: Single PaymentProvider Per Tenant (Too Early)

**What people do:** Allow each tenant to configure their own payment provider
**Why it's wrong:** Massively increases complexity (multi-provider webhooks per request, provider-specific onboarding flows, mixed reporting). Premature for a starter kit
**Do this instead:** Single payment provider per deployment (set via env var). The port interface makes swapping providers easy, but one deployment = one provider

### Anti-Pattern 4: Translating Database Content

**What people do:** Try to i18n dynamic content (plan names, tenant names, user-generated text)
**Why it's wrong:** i18n is for static UI strings, not user content. Dynamic content translation requires a completely different system
**Do this instead:** Only translate static strings (buttons, labels, messages). Predefined plan names can use translation keys; user-generated content stays as-is

## Integration Points

### Internal Boundaries

| Boundary | Communication | v1.1 Changes |
|----------|---------------|-------------|
| `@baseworks/i18n` -> `apps/web` | JSON import at build time | NEW: next-intl loads translations from shared package |
| `@baseworks/i18n` -> `apps/admin` | JSON import at bundle time | NEW: react-i18next loads translations from shared package |
| `modules/auth` -> `better-auth` | Direct API calls | EXTENDED: invitation methods added to org plugin config |
| `modules/auth` -> `email:send` queue | BullMQ job enqueue | EXTENDED: invite email template added to email worker |
| `modules/billing` -> `PaymentProvider` | Port interface | NEW: commands call adapter instead of Stripe SDK directly |
| `PaymentProvider` -> Stripe/Asaas | HTTP via SDKs | NEW: adapter pattern isolates provider-specific code |

### External Services

| Service | Integration Pattern | v1.1 Notes |
|---------|---------------------|------------|
| Stripe | StripeAdapter wraps SDK | Existing code relocated into adapter. No functional change |
| Asaas | AsaasAdapter wraps REST API | NEW: HTTP calls, no SDK needed. Pix + Boleto support |
| Resend (email) | Existing BullMQ worker | EXTENDED: New invite email template added |

## Sources

- [better-auth Organization Plugin Docs](https://better-auth.com/docs/plugins/organization) -- invitation API, schema, configuration
- [better-auth Organization DeepWiki](https://deepwiki.com/better-auth/better-auth/5.2-organization-plugin) -- members, roles, invitations
- [next-intl Monorepo Discussion](https://github.com/amannn/next-intl/discussions/1688) -- shared translations in monorepo
- [Best i18n Libraries for Next.js 2026](https://dev.to/erayg/best-i18n-libraries-for-nextjs-react-react-native-in-2026-honest-comparison-3m8f) -- next-intl vs react-i18next comparison
- [Asaas API Documentation](https://docs.asaas.com/docs/visao-geral) -- Brazilian payment provider REST API
- [Asaas Pix Overview](https://docs.asaas.com/docs/pix-overview) -- Pix payment integration details
- [Stripe Pix Guide](https://stripe.com/resources/more/pix-replacing-cards-cash-brazil) -- Stripe also supports Pix
- Existing codebase analysis: billing module, auth module, UI components, layouts

---
*Architecture research for: Baseworks v1.1 Feature Integration*
*Researched: 2026-04-08*
