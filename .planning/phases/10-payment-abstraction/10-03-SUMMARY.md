---
phase: 10-payment-abstraction
plan: 03
subsystem: billing
tags: [pagarme-adapter, payment-abstraction, provider-factory, env-validation, ports-and-adapters]
dependency_graph:
  requires:
    - phase: 10-01
      provides: PaymentProvider-interface, provider-agnostic-schema
    - phase: 10-02
      provides: StripeAdapter-implementing-PaymentProvider, webhook-normalization-layer, provider-factory-singleton
  provides:
    - PagarmeAdapter-implementing-PaymentProvider
    - env-based-provider-selection
    - conditional-env-validation
    - pagarme-webhook-normalization
  affects: [billing-routes, billing-commands, billing-jobs, admin-dashboard]
tech_stack:
  added: ["@pagarme/sdk@5.8.1"]
  patterns: [adapter-pattern, raw-fetch-api, hmac-webhook-verification, conditional-env-validation]
key_files:
  created:
    - packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts
    - packages/modules/billing/src/adapters/pagarme/pagarme-webhook-mapper.ts
  modified:
    - packages/modules/billing/src/provider-factory.ts
    - packages/config/src/env.ts
    - packages/modules/billing/package.json
    - packages/modules/billing/src/__tests__/pagarme-adapter.test.ts
    - packages/modules/billing/src/__tests__/provider-factory.test.ts
    - packages/modules/billing/src/__tests__/webhook-normalization.test.ts
key-decisions:
  - "PagarmeAdapter uses raw fetch to Pagar.me REST API v5 instead of @pagarme/sdk (SDK is JS-only without TypeScript types)"
  - "Webhook HMAC-SHA256 verification uses node:crypto timingSafeEqual for constant-time comparison"
  - "createPortalSession returns null for Pagar.me (no hosted billing portal equivalent)"
  - "validatePaymentProviderEnv() is a separate function rather than Zod superRefine due to @t3-oss/env-core schema constraints"
  - "Currency defaults to BRL for Pagar.me webhook events"
requirements-completed: [PAY-04, PAY-05]
metrics:
  duration: 6m
  completed: 2026-04-11
---

# Phase 10 Plan 03: Pagar.me Adapter and Provider Factory Env Switch Summary

**PagarmeAdapter implementing full PaymentProvider interface via REST API, Pagar.me webhook normalization for 5 event types, env-based provider selection, and conditional env validation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-11T16:58:23Z
- **Completed:** 2026-04-11T17:04:19Z
- **Tasks:** 2
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- PagarmeAdapter class implementing all 12 PaymentProvider methods using Pagar.me REST API v5
- Webhook normalization mapper for 5 Pagar.me event types (subscription.created, subscription.canceled, charge.paid, charge.payment_failed, order.paid)
- HMAC-SHA256 webhook signature verification with timing-safe comparison (T-10-07)
- Provider factory updated with switch statement for stripe/pagarme selection based on PAYMENT_PROVIDER env var
- Conditional env validation: PAGARME_SECRET_KEY required when PAYMENT_PROVIDER=pagarme (T-10-09)
- 52 total billing tests passing (19 pagarme adapter + 14 webhook normalization + 6 provider factory + 13 billing)

## Task Commits

Each task was committed atomically:

1. **Task 1: PagarmeAdapter, webhook mapper, and tests** - `3518f81` (feat)
2. **Task 2: Provider factory env switch and conditional validation** - `266d72b` (feat)

## Files Created/Modified

- `adapters/pagarme/pagarme-adapter.ts` - PagarmeAdapter implementing all PaymentProvider methods via raw fetch
- `adapters/pagarme/pagarme-webhook-mapper.ts` - Maps 5 Pagar.me event types to NormalizedEvent
- `provider-factory.ts` - Updated with pagarme case in switch statement
- `packages/config/src/env.ts` - Added PAYMENT_PROVIDER, PAGARME_SECRET_KEY, PAGARME_WEBHOOK_SECRET + validatePaymentProviderEnv()
- `packages/modules/billing/package.json` - Added @pagarme/sdk@5.8.1 dependency
- `__tests__/pagarme-adapter.test.ts` - 19 tests covering adapter methods and webhook mapper
- `__tests__/provider-factory.test.ts` - 6 tests covering env-based provider selection
- `__tests__/webhook-normalization.test.ts` - Added 5 Pagar.me mapping tests (replacing todo stubs)

## Decisions Made

- **Raw fetch over SDK**: PagarmeAdapter uses raw fetch calls to Pagar.me REST API v5 instead of the @pagarme/sdk package. The SDK is a JavaScript-only library without TypeScript type definitions, making raw HTTP cleaner and fully type-safe.
- **Timing-safe HMAC verification**: Webhook signature verification uses node:crypto.timingSafeEqual for constant-time comparison, preventing timing attacks per T-10-07.
- **Portal returns null**: createPortalSession returns null for Pagar.me since there is no hosted billing portal equivalent. Frontend handles this by showing "contact support".
- **Separate validation function**: Used a standalone validatePaymentProviderEnv() function instead of Zod superRefine because @t3-oss/env-core's createEnv() doesn't support cross-field refinements on its server schema object.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used raw fetch instead of @pagarme/sdk TypeScript API**
- **Found during:** Task 1
- **Issue:** @pagarme/sdk@5.8.1 is a JavaScript-only library (no .d.ts files, no TypeScript types). Using it would require untyped `any` casts throughout the adapter.
- **Fix:** Implemented adapter using raw fetch calls to Pagar.me REST API v5, as the plan suggested as a fallback approach. Full type safety preserved.
- **Files modified:** packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts
- **Commit:** 3518f81

**2. [Rule 3 - Blocking] Used validatePaymentProviderEnv() instead of Zod superRefine**
- **Found during:** Task 2
- **Issue:** @t3-oss/env-core's createEnv() accepts a flat Record of Zod schemas for the `server` field, not a single Zod object schema. Cannot attach .superRefine() to the schema dictionary.
- **Fix:** Created a standalone validatePaymentProviderEnv() function that checks conditional requirements after env parsing. Achieves the same safety guarantee (T-10-09) with a different mechanism.
- **Files modified:** packages/config/src/env.ts
- **Commit:** 266d72b

## Issues Encountered

None beyond the deviations noted above.

## User Setup Required

None - no external service configuration required. Pagar.me keys only needed when PAYMENT_PROVIDER=pagarme is set.

---
*Phase: 10-payment-abstraction*
*Completed: 2026-04-11*
