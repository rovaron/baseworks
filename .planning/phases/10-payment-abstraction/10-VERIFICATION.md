---
phase: 10-payment-abstraction
verified: 2026-04-11T17:30:00Z
status: gaps_found
score: 9/10 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Env validation conditionally requires PAGARME_SECRET_KEY when PAYMENT_PROVIDER=pagarme (at startup)"
    status: failed
    reason: "validatePaymentProviderEnv() is exported from packages/config/src/env.ts but is never called. It does not run at startup (not called in apps/api/src/index.ts, apps/api/src/worker.ts, or packages/modules/billing/src/index.ts). The app can start with PAYMENT_PROVIDER=pagarme and no PAGARME_SECRET_KEY, then crash on the first billing operation."
    artifacts:
      - path: "packages/config/src/env.ts"
        issue: "validatePaymentProviderEnv() defined but never invoked"
      - path: "apps/api/src/index.ts"
        issue: "Does not call validatePaymentProviderEnv() during startup"
    missing:
      - "Call validatePaymentProviderEnv() in apps/api/src/index.ts at startup (before app.listen)"
      - "Call validatePaymentProviderEnv() in apps/api/src/worker.ts at startup (if it exists and boots independently)"
---

# Phase 10: Payment Abstraction Verification Report

**Phase Goal:** Billing module operates through a provider-agnostic interface, with Stripe and one Brazilian provider as concrete adapters
**Verified:** 2026-04-11T17:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | PaymentProvider interface exists with all required methods (createCustomer, createSubscription, cancelSubscription, changeSubscription, getSubscription, createOneTimePayment, createCheckoutSession, createPortalSession, verifyWebhookSignature) | VERIFIED | `packages/modules/billing/src/ports/payment-provider.ts` — all 9 PAY-01 methods present plus normalizeEvent, getInvoices, optional reportUsage |
| 2  | DB schema uses provider-agnostic column names (providerCustomerId, providerSubscriptionId, etc.) | VERIFIED | `packages/db/src/schema/billing.ts` — all 6 columns renamed; zero Stripe-specific names remain anywhere in billing or db packages |
| 3  | A Drizzle migration file exists for the column renames | VERIFIED | `packages/db/migrations/0001_rename_stripe_to_provider.sql` — 6 RENAME COLUMN statements present |
| 4  | StripeAdapter implements the full PaymentProvider interface | VERIFIED | `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts` — 207 lines, `class StripeAdapter implements PaymentProvider`, all 12 methods implemented |
| 5  | No command, query, job, or hook imports getStripe() or Stripe SDK directly | VERIFIED | grep of commands/, queries/, jobs/, hooks/, routes.ts yields zero matches for getStripe or Stripe SDK imports; stripe.ts deleted |
| 6  | Webhook events are normalized into NormalizedEvent before processing | VERIFIED | `routes.ts` calls `provider.verifyWebhookSignature()` then `provider.normalizeEvent()`, passes full NormalizedEvent to BullMQ job data; `process-webhook.ts` switches on `normalizedEvent.type` (not raw Stripe event strings) |
| 7  | PagarmeAdapter implements PaymentProvider interface | VERIFIED | `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts` — 313 lines, `class PagarmeAdapter implements PaymentProvider`, all methods implemented; createPortalSession returns null; reportUsage not implemented (interface method is optional) |
| 8  | Setting PAYMENT_PROVIDER=pagarme returns PagarmeAdapter from getPaymentProvider() | VERIFIED | `packages/modules/billing/src/provider-factory.ts` — switch statement on `env.PAYMENT_PROVIDER`, "pagarme" case returns `new PagarmeAdapter(...)`, 6 passing provider-factory tests confirm behavior |
| 9  | Pagar.me webhook events are normalized to NormalizedEvent | VERIFIED | `packages/modules/billing/src/adapters/pagarme/pagarme-webhook-mapper.ts` — maps 5 events (subscription.created, subscription.canceled, charge.paid, charge.payment_failed, order.paid); 5 real tests confirm mappings |
| 10 | Env validation conditionally requires PAGARME_SECRET_KEY when PAYMENT_PROVIDER=pagarme | FAILED | `validatePaymentProviderEnv()` is defined in env.ts but is NEVER CALLED. It is not invoked in apps/api/src/index.ts, apps/api/src/worker.ts, or packages/modules/billing/src/index.ts. The protection against startup with missing keys does not run. |

**Score:** 9/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/modules/billing/src/ports/payment-provider.ts` | PaymentProvider interface with all methods | VERIFIED | Exists, substantive (105 lines), imported by stripe-adapter, pagarme-adapter, provider-factory |
| `packages/modules/billing/src/ports/types.ts` | Shared types: NormalizedEvent, NormalizedEventType, param types | VERIFIED | Exists, 125 lines, all required types exported |
| `packages/db/src/schema/billing.ts` | Provider-agnostic column names | VERIFIED | providerCustomerId, providerSubscriptionId, providerPriceId, providerEventId, syncedToProvider, providerUsageRecordId all present |
| `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts` | StripeAdapter implementing PaymentProvider | VERIFIED | Exists, 207 lines, `class StripeAdapter implements PaymentProvider` |
| `packages/modules/billing/src/adapters/stripe/stripe-webhook-mapper.ts` | Stripe-to-NormalizedEvent mapping | VERIFIED | Exists, 58 lines, exports `mapStripeEvent`, maps 6 event types |
| `packages/modules/billing/src/provider-factory.ts` | Singleton provider instance getter | VERIFIED | Exists, exports getPaymentProvider(), resetPaymentProvider(), setPaymentProvider() |
| `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts` | PagarmeAdapter implementing PaymentProvider | VERIFIED | Exists, 313 lines, implements PaymentProvider via REST API |
| `packages/modules/billing/src/adapters/pagarme/pagarme-webhook-mapper.ts` | Pagar.me to NormalizedEvent mapping | VERIFIED | Exists, 59 lines, exports `mapPagarmeEvent`, maps 5 event types |
| `packages/config/src/env.ts` | PAYMENT_PROVIDER and PAGARME_* env vars | VERIFIED | PAYMENT_PROVIDER, PAGARME_SECRET_KEY, PAGARME_WEBHOOK_SECRET all defined; validatePaymentProviderEnv() exported |
| `packages/db/migrations/0001_rename_stripe_to_provider.sql` | Column rename migration | VERIFIED | 6 ALTER TABLE RENAME COLUMN statements |
| `packages/modules/billing/src/__tests__/provider-factory.test.ts` | Provider factory tests | VERIFIED | 6 real tests (not todos) covering stripe, pagarme, unknown, singleton, reset |
| `packages/modules/billing/src/__tests__/webhook-normalization.test.ts` | Webhook normalization tests | VERIFIED | 9 Stripe tests + 5 Pagar.me tests, all real (not todos) |
| `packages/modules/billing/src/__tests__/pagarme-adapter.test.ts` | PagarmeAdapter tests | VERIFIED | 19 real tests covering adapter methods and webhook mapper |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `commands/create-checkout-session.ts` | `provider-factory.ts` | import getPaymentProvider | VERIFIED | `getPaymentProvider` found in file |
| `routes.ts` | `provider-factory.ts` | provider.verifyWebhookSignature | VERIFIED | `getPaymentProvider`, `verifyWebhookSignature`, `normalizeEvent` all found in routes.ts |
| `jobs/process-webhook.ts` | `ports/types.ts` | NormalizedEvent type | VERIFIED | `import type { NormalizedEvent } from "../ports/types"` at line 8 |
| `provider-factory.ts` | `adapters/pagarme/pagarme-adapter.ts` | dynamic import based on env | VERIFIED | `PagarmeAdapter` imported and used in switch case "pagarme" |
| `config/src/env.ts` | `provider-factory.ts` | PAYMENT_PROVIDER env var | PARTIAL | PAYMENT_PROVIDER defined in env.ts and read by provider-factory.ts, but validatePaymentProviderEnv() not called at startup |
| `payment-provider.ts` | `ports/types.ts` | import types | VERIFIED | `import type {...} from "./types"` present |
| `on-tenant-created.ts` | `provider-factory.ts` | getPaymentProvider | VERIFIED | `getPaymentProvider` found in hook |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces interfaces, adapters, and infrastructure code, not components that render dynamic data. The key data flows are API call chains verified through key link checks.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| PaymentProvider interface exports all required types | `grep "createCustomer\|createSubscription\|cancelSubscription\|changeSubscription\|getSubscription\|createOneTimePayment\|createCheckoutSession\|createPortalSession\|verifyWebhookSignature" ports/payment-provider.ts` | 9 method matches | PASS |
| DB schema has zero Stripe-specific column names | `grep -r "stripeCustomerId\|stripeEventId\|syncedToStripe" packages/` | 0 matches | PASS |
| stripe.ts singleton deleted | `ls packages/modules/billing/src/stripe.ts` | File not found | PASS |
| PagarmeAdapter has 80+ lines (substantive) | File line count | 313 lines | PASS |
| validatePaymentProviderEnv is called at startup | `grep -r "validatePaymentProviderEnv" apps/ packages/` excluding definition | 0 call sites found | FAIL |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PAY-01 | 10-01-PLAN.md | PaymentProvider port interface covers: createCustomer, createSubscription, cancelSubscription, changeSubscription, getSubscription, createOneTimePayment, createCheckoutSession, createPortalSession, verifyWebhookSignature | SATISFIED | All 9 methods present in payment-provider.ts interface |
| PAY-02 | 10-02-PLAN.md | Existing Stripe code refactored into StripeAdapter implementing PaymentProvider interface | SATISFIED | StripeAdapter exists with 12 methods; zero direct Stripe imports outside adapters/; stripe.ts deleted |
| PAY-03 | 10-02-PLAN.md | Webhook normalization layer translates provider-specific events into unified domain events | SATISFIED | mapStripeEvent normalizes 6 events; mapPagarmeEvent normalizes 5 events; routes.ts pipeline: verify -> normalize -> enqueue NormalizedEvent; process-webhook.ts switches on NormalizedEventType |
| PAY-04 | 10-03-PLAN.md | Brazilian payment provider adapter implementing PaymentProvider interface | SATISFIED | PagarmeAdapter implements PaymentProvider via raw fetch to Pagar.me REST API v5; 19 tests pass |
| PAY-05 | 10-03-PLAN.md | Active payment provider selected via environment configuration at startup -- no code changes | PARTIAL | Factory selection works (env.PAYMENT_PROVIDER switch); but validatePaymentProviderEnv() is not called at startup, so the startup guard against misconfiguration is inert |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/config/src/env.ts` | 49 | `validatePaymentProviderEnv()` exported but never called | Warning | App can start with PAYMENT_PROVIDER=pagarme and no PAGARME_SECRET_KEY; first billing call will throw a runtime error instead of a startup error |
| `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts` | 102-114 | cancelSubscription with cancelAtPeriodEnd=true still does immediate cancel (both branches are identical) | Info | Behavioral difference from Stripe documented in comments, not a blocking issue |

### Human Verification Required

None — all verification was achievable programmatically.

### Gaps Summary

One gap blocks complete goal achievement:

**validatePaymentProviderEnv() is defined but never called at startup.** The function correctly implements the startup guard (PAGARME_SECRET_KEY required when PAYMENT_PROVIDER=pagarme), but it is exported from `packages/config/src/env.ts` without ever being invoked. The main API entrypoint (`apps/api/src/index.ts`) and worker entrypoint do not call it. As a result, the protection against T-10-09 (app starting with missing provider keys) is dead code — the app can start cleanly with a misconfigured payment provider and crash on the first billing operation.

**Fix:** Add `validatePaymentProviderEnv()` call to `apps/api/src/index.ts` at startup (before `app.listen()`), and to `apps/api/src/worker.ts` if the worker boots independently.

All other phase goals are fully achieved:
- PaymentProvider port interface is complete and covers all 9 PAY-01 methods plus extras
- Stripe code is fully extracted into StripeAdapter; zero direct SDK imports remain outside adapters/
- Webhook normalization pipeline works end-to-end for both providers
- PagarmeAdapter implements the full interface via raw REST API calls
- Provider factory correctly selects adapters based on PAYMENT_PROVIDER env var

---

_Verified: 2026-04-11T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
