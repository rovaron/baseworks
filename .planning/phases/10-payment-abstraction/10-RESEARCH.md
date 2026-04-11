# Phase 10: Payment Abstraction - Research

**Researched:** 2026-04-11
**Domain:** Payment provider abstraction, port/adapter pattern, Stripe refactoring, Brazilian payment integration
**Confidence:** HIGH

## Summary

Phase 10 transforms the existing Stripe-coupled billing module into a provider-agnostic architecture using the ports and adapters (hexagonal) pattern. The current codebase has 10 files with direct Stripe SDK calls, a Stripe-specific DB schema (columns named `stripeCustomerId`, `stripeEventId`, etc.), and Stripe-specific webhook event types hardcoded in the job processor. The refactoring scope is well-contained within `packages/modules/billing/` and `packages/db/src/schema/billing.ts`.

The recommended Brazilian payment provider is **Pagar.me** (owned by Stone Co), which has an official TypeScript SDK (`@pagarme/sdk` v5.8.1), supports Pix, boleto, credit cards, subscriptions, customers, and webhooks -- covering all operations needed by the PaymentProvider interface. It is the most mature Brazilian gateway with proper Node.js SDK support.

**Primary recommendation:** Define a `PaymentProvider` TypeScript interface as the port, extract all Stripe calls into a `StripeAdapter` class implementing it, create a `PagarmeAdapter` for Brazilian payments, and use a factory function driven by `PAYMENT_PROVIDER` env var to select the active adapter at startup.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PAY-01 | PaymentProvider port interface covers: createCustomer, createSubscription, cancelSubscription, changeSubscription, getSubscription, createOneTimePayment, createCheckoutSession, createPortalSession, verifyWebhookSignature | Architecture Patterns section defines the full interface with types |
| PAY-02 | Existing Stripe code refactored into StripeAdapter implementing PaymentProvider interface | Codebase Analysis section maps all 10 Stripe-coupled files to refactoring targets |
| PAY-03 | Webhook normalization layer translates provider-specific events into unified domain events | Webhook Normalization pattern with event mapping table |
| PAY-04 | Brazilian payment provider adapter implementing PaymentProvider interface | Standard Stack recommends Pagar.me with @pagarme/sdk v5.8.1 |
| PAY-05 | Active payment provider selected via environment configuration at startup | Factory pattern with PAYMENT_PROVIDER env var |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe | ^17.7.0 | Stripe payment SDK (already installed) | Already in use, v17 is the installed version [VERIFIED: package.json] |
| @pagarme/sdk | ^5.8.1 | Pagar.me payment SDK | Official TypeScript SDK, covers customers/subscriptions/charges/Pix/boleto/webhooks. Most mature Brazilian provider with proper SDK [VERIFIED: npm registry] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | ^3.23+ | Webhook payload validation | Validate and type-narrow incoming webhook payloads before normalization [VERIFIED: already in project] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pagar.me | Asaas | Asaas has only an unofficial SDK (v0.1.0), less mature. Pagar.me (Stone Co) is larger, official SDK, more payment methods [VERIFIED: npm registry] |
| Pagar.me | AbacatePay | AbacatePay is Pix-only (no subscriptions, no boleto), simpler but insufficient for full PaymentProvider interface [VERIFIED: AbacatePay docs] |
| Pagar.me | Mercado Pago | Mercado Pago SDK is heavier, marketplace-oriented. Pagar.me is more payment-gateway focused [ASSUMED] |

**Installation:**
```bash
cd packages/modules/billing && bun add @pagarme/sdk
```

## Codebase Analysis

### Current Stripe Coupling Points

All Stripe-coupled code lives in `packages/modules/billing/src/`. Every file that imports `getStripe()` or directly uses Stripe types must be refactored.

| File | Stripe Usage | Refactoring Action |
|------|-------------|-------------------|
| `stripe.ts` | Stripe client singleton | Move into StripeAdapter |
| `commands/create-checkout-session.ts` | `stripe.checkout.sessions.create()` | Delegate to `provider.createCheckoutSession()` |
| `commands/cancel-subscription.ts` | `stripe.subscriptions.update()` | Delegate to `provider.cancelSubscription()` |
| `commands/change-subscription.ts` | `stripe.subscriptions.retrieve()` + `.update()` | Delegate to `provider.changeSubscription()` |
| `commands/create-one-time-payment.ts` | `stripe.checkout.sessions.create()` mode=payment | Delegate to `provider.createOneTimePayment()` |
| `commands/create-portal-session.ts` | `stripe.billingPortal.sessions.create()` | Delegate to `provider.createPortalSession()` |
| `queries/get-billing-history.ts` | `stripe.invoices.list()` | Delegate to `provider.getInvoices()` |
| `jobs/process-webhook.ts` | Stripe event types: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment.*` | Consume normalized domain events instead |
| `jobs/sync-usage.ts` | `stripe.subscriptionItems.createUsageRecord()` | Delegate to `provider.reportUsage()` |
| `hooks/on-tenant-created.ts` | `stripe.customers.create()` | Delegate to `provider.createCustomer()` |
| `routes.ts` | `stripe.webhooks.constructEvent()` for signature verification | Delegate to `provider.verifyWebhookSignature()` |

[VERIFIED: codebase read]

### DB Schema Coupling

`packages/db/src/schema/billing.ts` has Stripe-specific column names:

| Table | Column | Issue | Action |
|-------|--------|-------|--------|
| `billing_customers` | `stripeCustomerId` | Stripe-specific name | Rename to `providerCustomerId` + add DB migration |
| `billing_customers` | `stripeSubscriptionId` | Stripe-specific name | Rename to `providerSubscriptionId` |
| `billing_customers` | `stripePriceId` | Stripe-specific name | Rename to `providerPriceId` |
| `webhook_events` | `stripeEventId` | Stripe-specific name | Rename to `providerEventId` |
| `usage_records` | `syncedToStripe` | Stripe-specific name | Rename to `syncedToProvider` |
| `usage_records` | `stripeUsageRecordId` | Stripe-specific name | Rename to `providerUsageRecordId` |

**Migration strategy:** Use `drizzle-kit generate` to produce a rename-column migration. This is a non-destructive operation (column rename, no data loss). [VERIFIED: codebase read]

### Test Impact

`billing.test.ts` references Stripe-specific column names and mock structure. Tests must be updated to use the new provider-agnostic naming. The test already mocks Stripe as a class -- the mock will need to be updated to mock the provider interface instead. [VERIFIED: codebase read]

## Architecture Patterns

### Recommended Project Structure
```
packages/modules/billing/src/
  ports/
    payment-provider.ts       # PaymentProvider interface (the port)
    types.ts                  # Shared types: NormalizedEvent, CheckoutResult, etc.
  adapters/
    stripe/
      stripe-adapter.ts       # StripeAdapter implements PaymentProvider
      stripe-webhook-mapper.ts # Maps Stripe events to NormalizedEvent
    pagarme/
      pagarme-adapter.ts       # PagarmeAdapter implements PaymentProvider
      pagarme-webhook-mapper.ts # Maps Pagar.me events to NormalizedEvent
  provider-factory.ts          # Factory: reads env, returns PaymentProvider
  commands/                    # Refactored to use PaymentProvider (no direct Stripe)
  queries/
  jobs/
  hooks/
  routes.ts                    # Webhook route uses provider.verifyWebhookSignature()
  index.ts
```

### Pattern 1: PaymentProvider Port Interface

**What:** A TypeScript interface defining all payment operations the billing module needs.
**When to use:** Always -- this is the core abstraction.

```typescript
// Source: Derived from existing codebase analysis + PAY-01 requirements
export interface PaymentProvider {
  readonly name: string; // "stripe" | "pagarme" etc.

  // Customer management
  createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer>;

  // Subscriptions
  createSubscription(params: CreateSubscriptionParams): Promise<ProviderSubscription>;
  cancelSubscription(params: CancelSubscriptionParams): Promise<void>;
  changeSubscription(params: ChangeSubscriptionParams): Promise<ProviderSubscription>;
  getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null>;

  // One-time payments
  createOneTimePayment(params: CreateOneTimePaymentParams): Promise<ProviderCheckoutSession>;

  // Checkout & portal sessions
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<ProviderCheckoutSession>;
  createPortalSession(params: CreatePortalSessionParams): Promise<ProviderPortalSession>;

  // Webhooks
  verifyWebhookSignature(params: VerifyWebhookParams): Promise<RawProviderEvent>;
  normalizeEvent(rawEvent: RawProviderEvent): NormalizedEvent;

  // Invoices / billing history
  getInvoices(providerCustomerId: string, limit: number): Promise<ProviderInvoice[]>;

  // Usage-based billing (optional -- not all providers support this)
  reportUsage?(params: ReportUsageParams): Promise<void>;
}
```

**Key design decisions:**
- `reportUsage` is optional (`?`) because not all Brazilian providers support usage-based billing [ASSUMED]
- `createPortalSession` returns a URL -- Stripe has a hosted portal, Brazilian providers may need to return a custom URL or throw "not supported" [CITED: REQUIREMENTS.md out-of-scope note on portal sessions]
- `normalizeEvent` is on the provider interface itself because each adapter knows its own event format

### Pattern 2: Webhook Normalization Layer

**What:** Each adapter translates provider-specific webhook events into unified domain events.
**When to use:** In the webhook route handler and process-webhook job.

```typescript
// Normalized domain events (provider-agnostic)
export type NormalizedEventType =
  | "subscription.created"
  | "subscription.updated"
  | "subscription.cancelled"
  | "payment.succeeded"
  | "payment.failed"
  | "checkout.completed";

export interface NormalizedEvent {
  type: NormalizedEventType;
  providerEventId: string;
  providerCustomerId: string;
  data: {
    subscriptionId?: string;
    priceId?: string;
    status?: string;
    currentPeriodEnd?: Date;
    amount?: number;
    currency?: string;
  };
  occurredAt: Date;
  raw: unknown; // Original provider payload for debugging
}
```

**Stripe event mapping:**
| Stripe Event | Normalized Event |
|---|---|
| `checkout.session.completed` | `checkout.completed` |
| `customer.subscription.created` | `subscription.created` |
| `customer.subscription.updated` | `subscription.updated` |
| `customer.subscription.deleted` | `subscription.cancelled` |
| `invoice.payment_succeeded` | `payment.succeeded` |
| `invoice.payment_failed` | `payment.failed` |

**Pagar.me event mapping:**
| Pagar.me Webhook Event | Normalized Event |
|---|---|
| `subscription.created` | `subscription.created` |
| `subscription.canceled` | `subscription.cancelled` |
| `charge.paid` | `payment.succeeded` |
| `charge.payment_failed` | `payment.failed` |
| `order.paid` | `checkout.completed` |

[ASSUMED: Pagar.me webhook event names based on docs.pagar.me patterns]

### Pattern 3: Provider Factory

**What:** Factory function that reads `PAYMENT_PROVIDER` env var and returns the correct adapter.
**When to use:** At module initialization (startup).

```typescript
// Source: Standard factory pattern for PAY-05
import type { PaymentProvider } from "./ports/payment-provider";

export function createPaymentProvider(): PaymentProvider {
  const provider = env.PAYMENT_PROVIDER ?? "stripe";

  switch (provider) {
    case "stripe":
      return new StripeAdapter({
        secretKey: env.STRIPE_SECRET_KEY!,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
      });
    case "pagarme":
      return new PagarmeAdapter({
        secretKey: env.PAGARME_SECRET_KEY!,
        webhookSecret: env.PAGARME_WEBHOOK_SECRET!,
      });
    default:
      throw new Error(`Unknown payment provider: ${provider}`);
  }
}
```

### Anti-Patterns to Avoid
- **Leaking provider types into commands/queries:** Commands must NEVER import `stripe` or `@pagarme/sdk` directly. They receive the `PaymentProvider` interface via dependency injection or module-level singleton.
- **Mapping Stripe concepts 1:1 to the interface:** Stripe's `checkout.sessions` is Stripe-specific. The interface should model the *intent* (create a payment page) not the *mechanism* (Stripe Checkout).
- **Making the interface too abstract:** Don't try to abstract away payment-method-specific flows (Pix QR code vs credit card form). The interface covers backend operations; frontend differences are handled by the frontend.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook signature verification | Custom HMAC/SHA verification | `stripe.webhooks.constructEvent()` / Pagar.me SDK verify | Crypto verification has subtle timing-attack vulnerabilities |
| Idempotency | Custom dedup logic per provider | Keep existing DB-level dedup (webhook_events table) | Already works, provider-agnostic by design |
| Subscription lifecycle state machine | Custom state tracker | Trust the provider's subscription status field | Provider is the source of truth for subscription state |
| Retry logic for webhook processing | Custom retry queue | Keep BullMQ job retry (already implemented) | Already battle-tested in the codebase |

## Common Pitfalls

### Pitfall 1: Portal Session Not Supported by All Providers
**What goes wrong:** The `createPortalSession` method assumes a Stripe-like hosted billing portal exists for every provider.
**Why it happens:** Stripe's Customer Portal is a unique feature with no equivalent in most Brazilian providers.
**How to avoid:** Make `createPortalSession` return `{ url: string } | null`. Brazilian adapters return `null`, and the frontend shows a "contact support" message instead.
**Warning signs:** Runtime error when Brazilian tenant tries to access billing portal.

### Pitfall 2: Column Rename Migration Breaks Running Queries
**What goes wrong:** Renaming `stripeCustomerId` to `providerCustomerId` in the schema while the old column name is still referenced somewhere.
**Why it happens:** Drizzle schema references are scattered across commands, queries, jobs, hooks, tests, and routes.
**How to avoid:** Do the migration in a single atomic plan: rename schema + update ALL references + generate migration + run tests.
**Warning signs:** TypeScript compilation errors (Drizzle will error on unknown column names).

### Pitfall 3: Different Webhook Payload Structures
**What goes wrong:** Assuming all providers nest data the same way (e.g., Stripe's `event.data.object`).
**Why it happens:** Each provider has a completely different webhook JSON structure.
**How to avoid:** The `normalizeEvent` method on each adapter handles its own parsing. The `process-webhook` job ONLY works with `NormalizedEvent`.
**Warning signs:** `undefined` fields in normalized events during testing.

### Pitfall 4: Env Var Validation Incomplete
**What goes wrong:** App starts with `PAYMENT_PROVIDER=pagarme` but no `PAGARME_SECRET_KEY`, crashes at first API call.
**Why it happens:** Current env validation only has Stripe vars as optional.
**How to avoid:** Make env validation conditional: if `PAYMENT_PROVIDER=stripe`, require `STRIPE_SECRET_KEY`; if `pagarme`, require `PAGARME_SECRET_KEY`. Use Zod discriminated union or refinement.
**Warning signs:** App starts without errors but crashes on first billing operation.

### Pitfall 5: Brazilian Provider API Differences
**What goes wrong:** Trying to use Stripe patterns (price IDs, checkout sessions) with Brazilian providers that use different concepts.
**Why it happens:** Pagar.me uses plans/items/charges instead of Stripe's prices/checkout-sessions model.
**How to avoid:** The PaymentProvider interface must be designed around *intents* (create a subscription for this customer at this price), not Stripe-specific concepts.
**Warning signs:** Awkward adapter code that creates intermediate objects just to map to Stripe concepts.

## Code Examples

### Adapter Implementation Pattern (StripeAdapter excerpt)

```typescript
// Source: Refactoring existing create-checkout-session.ts into adapter pattern
import Stripe from "stripe";
import type { PaymentProvider, CreateCheckoutSessionParams, ProviderCheckoutSession } from "../ports/payment-provider";

export class StripeAdapter implements PaymentProvider {
  readonly name = "stripe";
  private stripe: Stripe;

  constructor(private config: { secretKey: string; webhookSecret: string }) {
    this.stripe = new Stripe(config.secretKey, { typescript: true });
  }

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<ProviderCheckoutSession> {
    const session = await this.stripe.checkout.sessions.create(
      {
        customer: params.providerCustomerId,
        mode: "subscription",
        line_items: [{ price: params.priceId, quantity: 1 }],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
      { idempotencyKey: crypto.randomUUID() },
    );
    return { sessionId: session.id, url: session.url! };
  }

  // ... other methods
}
```

### Command After Refactoring

```typescript
// Source: Pattern for refactored commands using injected provider
import { getPaymentProvider } from "../provider-factory";

export const createCheckoutSession = defineCommand(
  CreateCheckoutSessionInput,
  async (input, ctx) => {
    try {
      const [customer] = await ctx.db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.tenantId, ctx.tenantId))
        .limit(1);

      if (!customer) return err("BILLING_NOT_CONFIGURED");

      const provider = getPaymentProvider();
      const session = await provider.createCheckoutSession({
        providerCustomerId: customer.providerCustomerId,
        priceId: input.priceId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      });

      return ok(session);
    } catch (error: any) {
      return err(error.message || "Failed to create checkout session");
    }
  },
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct Stripe SDK calls in commands | Port/adapter with provider interface | This phase | All billing code becomes provider-agnostic |
| `stripeCustomerId` columns | `providerCustomerId` columns | This phase | DB schema supports any provider |
| Stripe event types in process-webhook | Normalized domain events | This phase | Webhook processor works with any provider |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Pagar.me SDK supports webhook signature verification | Standard Stack | Would need manual HMAC verification -- low risk, can be implemented |
| A2 | Pagar.me webhook event names follow pattern shown in mapping table | Architecture Patterns | Incorrect event mapping -- fixable during adapter implementation |
| A3 | `reportUsage` is not supported by Pagar.me | Architecture Patterns | May need to add usage reporting to Pagar.me adapter |
| A4 | Pagar.me is the best choice for the Brazilian adapter | Standard Stack | User may prefer a different provider -- needs confirmation |
| A5 | Mercado Pago is more marketplace-oriented than gateway-oriented | Alternatives | May be equally suitable, different trade-offs |

## Open Questions (RESOLVED)

1. **Which Brazilian payment provider to use?**
   - What we know: Pagar.me has the most mature SDK (v5.8.1, official, TypeScript). Asaas has unofficial SDK (v0.1.0). AbacatePay is Pix-only.
   - RESOLVED: Pagar.me selected — best SDK maturity, official TypeScript support, covers all required payment methods (Pix, boleto, credit card).

2. **Should portal session throw or return null for unsupported providers?**
   - What we know: Requirements note portal sessions are out of scope for the payment interface. But the existing code has a `createPortalSession` command.
   - RESOLVED: Keep in interface, return `null` for unsupported providers. Frontend conditionally shows the portal button based on provider capability.

3. **Should usage-based billing be in the PaymentProvider interface?**
   - What we know: Usage recording is local (DB insert), but sync-usage job pushes to Stripe. This is explicitly out of scope per REQUIREMENTS.md.
   - RESOLVED: Mark `reportUsage` as optional method (`reportUsage?`). StripeAdapter implements it; others skip.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | none (Bun's built-in test runner, no config file needed) |
| Quick run command | `bun test packages/modules/billing/src/__tests__/billing.test.ts` |
| Full suite command | `bun test packages/modules/billing/src/__tests__/` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAY-01 | PaymentProvider interface has all required methods | unit (type check) | `bun run tsc --noEmit` | Wave 0 |
| PAY-02 | StripeAdapter implements PaymentProvider and passes existing billing tests | unit | `bun test packages/modules/billing/src/__tests__/billing.test.ts` | Exists (needs update) |
| PAY-03 | Webhook normalization maps Stripe events to unified events | unit | `bun test packages/modules/billing/src/__tests__/webhook-normalization.test.ts` | Wave 0 |
| PAY-04 | PagarmeAdapter implements PaymentProvider interface | unit | `bun test packages/modules/billing/src/__tests__/pagarme-adapter.test.ts` | Wave 0 |
| PAY-05 | Factory returns correct adapter based on PAYMENT_PROVIDER env var | unit | `bun test packages/modules/billing/src/__tests__/provider-factory.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test packages/modules/billing/src/__tests__/`
- **Per wave merge:** `bun test` (full monorepo)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/modules/billing/src/__tests__/webhook-normalization.test.ts` -- covers PAY-03
- [ ] `packages/modules/billing/src/__tests__/pagarme-adapter.test.ts` -- covers PAY-04
- [ ] `packages/modules/billing/src/__tests__/provider-factory.test.ts` -- covers PAY-05
- [ ] Update existing `billing.test.ts` to use provider-agnostic column names

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A (billing uses existing auth middleware) |
| V3 Session Management | no | N/A |
| V4 Access Control | yes | Tenant-scoping via ctx.tenantId on all commands/queries (already enforced) |
| V5 Input Validation | yes | TypeBox schema validation on command inputs (already enforced via defineCommand) |
| V6 Cryptography | yes | Webhook signature verification via provider SDK (never hand-roll HMAC) |

### Known Threat Patterns for Payment Processing

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook spoofing | Spoofing | Verify webhook signatures using provider SDK |
| Webhook replay | Tampering | Idempotency check via webhook_events table (already implemented) |
| Out-of-order webhooks | Tampering | lastEventAt ordering protection (already implemented) |
| Secret key exposure in logs | Information Disclosure | Never log provider secret keys; use pino redaction |
| Cross-tenant billing access | Elevation of Privilege | All commands scoped to ctx.tenantId (already enforced) |

## Sources

### Primary (HIGH confidence)
- Codebase read: All 10 billing module source files analyzed directly
- [npm registry] @pagarme/sdk v5.8.1, stripe v17.7.0 (installed), abacatepay-nodejs-sdk v1.6.0, asaas-node-sdk v0.1.0
- REQUIREMENTS.md -- PAY-01 through PAY-05 definitions and out-of-scope items

### Secondary (MEDIUM confidence)
- [Pagar.me official docs](https://docs.pagar.me/docs/overview-principal) -- Webhooks, Pix, subscriptions
- [Pagar.me GitHub SDK](https://github.com/pagarme/pagarme-nodejs-sdk) -- TypeScript SDK with Subscriptions, Customers, Charges controllers
- [dev.to article](https://dev.to/devdoido/gateways-de-pagamento-no-nodejs-de-forma-generica-woovi-stripe-e-pagarme-12k8) -- Generic payment gateway pattern in Node.js with Stripe + Pagar.me adapters

### Tertiary (LOW confidence)
- Pagar.me webhook event names (inferred from docs pattern, not verified against actual payload)
- AbacatePay capabilities (based on docs overview, not hands-on testing)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Stripe already in codebase, Pagar.me SDK verified on npm
- Architecture: HIGH - Port/adapter pattern is well-established, codebase analysis complete
- Pitfalls: HIGH - All derived from actual codebase analysis of current coupling points
- Brazilian provider: MEDIUM - Pagar.me recommended but webhook event names assumed

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (stable domain, payment provider APIs change infrequently)
