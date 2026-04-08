---
phase: 03-billing-background-jobs
plan: 03
subsystem: payments
tags: [stripe, cqrs, billing, checkout, subscriptions, portal]

requires:
  - phase: 03-billing-background-jobs/01
    provides: "BullMQ infrastructure and job queue setup"
  - phase: 03-billing-background-jobs/02
    provides: "Billing schema, Stripe client, webhook processing, billing routes"
provides:
  - "5 billing CQRS commands: checkout, cancel, change, one-time, portal"
  - "2 billing CQRS queries: subscription status, billing history"
  - "Full billing module wired into API server with tenant.created hooks"
affects: [frontend-billing-ui, admin-dashboard, api-routes]

tech-stack:
  added: []
  patterns: ["Billing commands with idempotency keys", "Tenant-scoped Stripe API queries"]

key-files:
  created:
    - packages/modules/billing/src/commands/create-checkout-session.ts
    - packages/modules/billing/src/commands/cancel-subscription.ts
    - packages/modules/billing/src/commands/change-subscription.ts
    - packages/modules/billing/src/commands/create-one-time-payment.ts
    - packages/modules/billing/src/commands/create-portal-session.ts
    - packages/modules/billing/src/queries/get-subscription-status.ts
    - packages/modules/billing/src/queries/get-billing-history.ts
  modified:
    - packages/modules/billing/src/index.ts
    - apps/api/src/index.ts

key-decisions:
  - "All billing commands use ctx.db (tenant-scoped) for billing_customers lookup"
  - "Idempotency keys via crypto.randomUUID() on all Stripe mutation calls"

patterns-established:
  - "Billing command pattern: lookup billing_customers by tenantId, call Stripe API with idempotency"
  - "Billing query pattern: tenant-scoped DB lookup, optional Stripe API fetch for live data"

requirements-completed: [BILL-01, BILL-02, BILL-03, BILL-05]

duration: 2min
completed: 2026-04-06
---

# Phase 03 Plan 03: Billing CQRS Commands & Queries Summary

**Stripe billing commands (checkout, cancel, change, one-time, portal) and queries (subscription status, invoice history) with full module wiring into API server**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-06T10:14:58Z
- **Completed:** 2026-04-06T10:17:17Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Implemented 5 billing commands covering subscription checkout, cancellation, plan changes, one-time payments, and Customer Portal access
- Implemented 2 billing queries for subscription status and invoice history from Stripe
- Registered all commands and queries in billing ModuleDefinition and wired billing module into API server

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement billing commands** - `82cea57` (feat)
2. **Task 2: Billing queries and module wiring** - `7010cb2` (feat)

## Files Created/Modified
- `packages/modules/billing/src/commands/create-checkout-session.ts` - Stripe Checkout session in subscription mode
- `packages/modules/billing/src/commands/cancel-subscription.ts` - Cancel subscription with cancel_at_period_end
- `packages/modules/billing/src/commands/change-subscription.ts` - Swap subscription to new price via subscriptions.update
- `packages/modules/billing/src/commands/create-one-time-payment.ts` - Stripe Checkout in payment mode
- `packages/modules/billing/src/commands/create-portal-session.ts` - Stripe Customer Portal session
- `packages/modules/billing/src/queries/get-subscription-status.ts` - Tenant subscription status from billing_customers
- `packages/modules/billing/src/queries/get-billing-history.ts` - Invoice history from Stripe API
- `packages/modules/billing/src/index.ts` - Updated with all command/query registrations
- `apps/api/src/index.ts` - Added billing module and registerBillingHooks call

## Decisions Made
- All billing commands use ctx.db (tenant-scoped database) for billing_customers lookup since billing_customers has a tenantId column and is properly scoped
- Idempotency keys (crypto.randomUUID()) applied to all Stripe mutation API calls per D-09 threat mitigation
- get-billing-history fetches live invoice data from Stripe API rather than caching locally

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Billing module is fully wired: webhook processing (Plan 02) + CQRS commands/queries (Plan 03)
- Ready for frontend integration to call billing commands via Eden Treaty
- Ready for Plan 04 (BullMQ worker infrastructure) as billing jobs are already registered

## Self-Check: PASSED

All 7 created files verified present. Both task commits (82cea57, 7010cb2) verified in git log.

---
*Phase: 03-billing-background-jobs*
*Completed: 2026-04-06*
