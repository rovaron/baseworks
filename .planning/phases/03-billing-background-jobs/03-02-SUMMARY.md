---
phase: 03-billing-background-jobs
plan: 02
subsystem: payments
tags: [stripe, bullmq, webhooks, drizzle, elysia, billing]

# Dependency graph
requires:
  - phase: 01-foundation-core-infrastructure
    provides: module registry, CQRS framework, event bus, scoped DB
  - phase: 02-auth-multitenancy
    provides: tenant.created event, organization/tenant model
provides:
  - billing module skeleton with ModuleDefinition export
  - billingCustomers, webhookEvents, usageRecords Drizzle schema tables
  - Stripe webhook endpoint with signature verification and idempotency
  - webhook job processor for 6 Stripe event types
  - auto Stripe customer creation on tenant.created event
  - lazy-initialized Stripe client singleton
affects: [03-billing-background-jobs, 04-frontend-apps]

# Tech tracking
tech-stack:
  added: [stripe ^17.0.0, bullmq ^5.0.0]
  patterns: [lazy service initialization, webhook pipeline (verify -> dedup -> enqueue -> process), event ordering protection via lastEventAt]

key-files:
  created:
    - packages/modules/billing/src/index.ts
    - packages/modules/billing/src/routes.ts
    - packages/modules/billing/src/stripe.ts
    - packages/modules/billing/src/schema.ts
    - packages/modules/billing/src/jobs/process-webhook.ts
    - packages/modules/billing/src/hooks/on-tenant-created.ts
    - packages/db/src/schema/billing.ts
    - packages/modules/billing/package.json
    - packages/modules/billing/tsconfig.json
  modified:
    - packages/db/src/schema/index.ts
    - packages/db/src/index.ts
    - packages/config/src/env.ts

key-decisions:
  - "Schema defined in packages/db (not billing module) to avoid circular workspace deps -- follows auth pattern"
  - "BullMQ Queue used directly in routes.ts with lazy init -- no @baseworks/queue package yet"
  - "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET added as optional env vars to avoid breaking existing setups"

patterns-established:
  - "Webhook pipeline: signature verify -> DB idempotency check -> insert pending -> BullMQ enqueue -> return 200 fast"
  - "Event ordering protection: lastEventAt column comparison before updating billing_customers"
  - "Lazy service init: Stripe client and BullMQ queue initialized on first use, not at import time"

requirements-completed: [BILL-06, BILL-07, JOBS-05]

# Metrics
duration: 4min
completed: 2026-04-06
---

# Phase 3 Plan 2: Billing Module Skeleton Summary

**Billing module with Stripe webhook pipeline (verify -> dedup -> enqueue -> process), 6 event type handlers with ordering protection, and auto Stripe customer creation on tenant events**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-06T10:04:49Z
- **Completed:** 2026-04-06T10:08:43Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Billing module skeleton registered as ModuleDefinition with routes, jobs, and events
- Stripe webhook endpoint with HMAC signature verification, DB-level idempotency (webhook_events unique constraint), and BullMQ queue-level dedup (jobId)
- Webhook job processor handling checkout.session.completed, customer.subscription.created/updated/deleted, invoice.payment_succeeded/failed with event ordering protection via lastEventAt
- Auto Stripe customer creation on tenant.created event with idempotency key

## Task Commits

Each task was committed atomically:

1. **Task 1: Create billing module schema, Stripe client, and package structure** - `88f3799` (feat)
2. **Task 2: Webhook endpoint, webhook job processor, tenant.created hook, and module definition** - `60f76d7` (feat)

## Files Created/Modified
- `packages/modules/billing/package.json` - Module package with stripe, bullmq, drizzle deps
- `packages/modules/billing/tsconfig.json` - TS config following auth module pattern
- `packages/modules/billing/src/index.ts` - ModuleDefinition export with routes, jobs, events
- `packages/modules/billing/src/schema.ts` - Re-exports billing tables from @baseworks/db
- `packages/modules/billing/src/stripe.ts` - Lazy-initialized Stripe client singleton
- `packages/modules/billing/src/routes.ts` - Webhook endpoint with signature verification and idempotency
- `packages/modules/billing/src/jobs/process-webhook.ts` - Async webhook event processor for 6 event types
- `packages/modules/billing/src/hooks/on-tenant-created.ts` - Auto Stripe customer creation on tenant.created
- `packages/db/src/schema/billing.ts` - billingCustomers, webhookEvents, usageRecords table definitions
- `packages/db/src/schema/index.ts` - Added billing schema export
- `packages/db/src/index.ts` - Added billing table exports
- `packages/config/src/env.ts` - Added STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET env vars

## Decisions Made
- Schema defined in packages/db/src/schema/billing.ts (not in the billing module) to avoid circular workspace dependencies -- follows the established auth pattern where auth tables live in packages/db
- BullMQ Queue instantiated directly in routes.ts with lazy initialization rather than through a @baseworks/queue abstraction (queue package does not exist yet -- will be created in Plan 01)
- STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET added as optional z.string().optional() env vars to avoid breaking existing dev setups that lack Stripe credentials

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added STRIPE env vars to config package**
- **Found during:** Task 1 (Stripe client creation)
- **Issue:** env.ts did not have STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET definitions
- **Fix:** Added both as optional string env vars in packages/config/src/env.ts
- **Files modified:** packages/config/src/env.ts
- **Verification:** Stripe client references env.STRIPE_SECRET_KEY without type errors
- **Committed in:** 88f3799 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for Stripe client to access configuration. No scope creep.

## Issues Encountered
None

## User Setup Required
None - Stripe env vars are optional. Users will configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET when ready to test billing.

## Next Phase Readiness
- Billing module skeleton complete, ready for Plan 03 (checkout, portal, subscription CQRS commands)
- Module needs to be registered in apps/api/src/index.ts module list (will happen when billing is activated)
- Queue package (@baseworks/queue) creation in Plan 01 will provide shared queue abstraction

## Self-Check: PASSED

- All 9 created files verified present on disk
- Commit 88f3799 verified in git log
- Commit 60f76d7 verified in git log

---
*Phase: 03-billing-background-jobs*
*Completed: 2026-04-06*
