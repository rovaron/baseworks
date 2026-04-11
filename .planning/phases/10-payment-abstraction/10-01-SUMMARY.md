---
phase: 10-payment-abstraction
plan: 01
subsystem: billing
tags: [ports-and-adapters, payment-abstraction, schema-migration, interfaces]
dependency_graph:
  requires: []
  provides: [PaymentProvider-interface, provider-agnostic-schema, test-scaffolds]
  affects: [billing-commands, billing-queries, billing-jobs, billing-hooks, billing-routes, admin-routes]
tech_stack:
  added: []
  patterns: [ports-and-adapters, hexagonal-architecture]
key_files:
  created:
    - packages/modules/billing/src/ports/payment-provider.ts
    - packages/modules/billing/src/ports/types.ts
    - packages/db/migrations/0001_rename_stripe_to_provider.sql
    - packages/modules/billing/src/__tests__/provider-factory.test.ts
    - packages/modules/billing/src/__tests__/webhook-normalization.test.ts
    - packages/modules/billing/src/__tests__/pagarme-adapter.test.ts
  modified:
    - packages/db/src/schema/billing.ts
    - packages/modules/billing/src/commands/create-checkout-session.ts
    - packages/modules/billing/src/commands/cancel-subscription.ts
    - packages/modules/billing/src/commands/change-subscription.ts
    - packages/modules/billing/src/commands/create-one-time-payment.ts
    - packages/modules/billing/src/commands/create-portal-session.ts
    - packages/modules/billing/src/commands/record-usage.ts
    - packages/modules/billing/src/queries/get-billing-history.ts
    - packages/modules/billing/src/queries/get-subscription-status.ts
    - packages/modules/billing/src/jobs/process-webhook.ts
    - packages/modules/billing/src/jobs/sync-usage.ts
    - packages/modules/billing/src/hooks/on-tenant-created.ts
    - packages/modules/billing/src/routes.ts
    - packages/modules/billing/src/__tests__/billing.test.ts
    - apps/api/src/routes/admin.ts
decisions:
  - PaymentProvider interface uses optional reportUsage method for providers without usage-based billing
  - createPortalSession returns null for providers without hosted portal
  - normalizeEvent lives on the provider interface itself since each adapter knows its own event format
metrics:
  duration: 8m
  completed: 2026-04-11
---

# Phase 10 Plan 01: Payment Provider Port Interface and Schema Rename Summary

PaymentProvider port interface with 10+ methods, provider-agnostic DB column renames across 19 files, Drizzle migration, and test scaffolds for Plans 02/03.

## What Was Done

### Task 1: PaymentProvider Port Interface and Shared Types
Created the core payment abstraction contracts:
- `ports/types.ts`: All shared types including NormalizedEvent, NormalizedEventType, and 15+ parameter/result interfaces derived from existing command signatures
- `ports/payment-provider.ts`: PaymentProvider interface with all required methods -- createCustomer, createSubscription, cancelSubscription, changeSubscription, getSubscription, createOneTimePayment, createCheckoutSession, createPortalSession, verifyWebhookSignature, normalizeEvent, getInvoices, and optional reportUsage

### Task 2: Schema Column Renames + Migration + Test Scaffolds
Renamed all Stripe-specific column names to provider-agnostic equivalents:
- `stripeCustomerId` -> `providerCustomerId` (billing_customers)
- `stripeSubscriptionId` -> `providerSubscriptionId` (billing_customers)
- `stripePriceId` -> `providerPriceId` (billing_customers)
- `stripeEventId` -> `providerEventId` (webhook_events)
- `syncedToStripe` -> `syncedToProvider` (usage_records)
- `stripeUsageRecordId` -> `providerUsageRecordId` (usage_records)

Updated all 15 files referencing these columns: 5 commands, 2 queries, 2 jobs, 1 hook, 1 routes file, 1 test file, 1 admin route file.

Created SQL migration with RENAME COLUMN statements and 3 test scaffold files with `test.todo()` stubs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed admin.ts billing overview route**
- **Found during:** Task 2
- **Issue:** `apps/api/src/routes/admin.ts` referenced `stripeSubscriptionId` and `stripePriceId` which would cause TypeScript compilation errors after schema rename
- **Fix:** Updated to `providerSubscriptionId` and `providerPriceId`
- **Files modified:** apps/api/src/routes/admin.ts
- **Commit:** ac839df

**2. [Rule 3 - Blocking] Fixed record-usage.ts column reference**
- **Found during:** Task 2
- **Issue:** `commands/record-usage.ts` referenced `syncedToStripe` in its insert values, not listed in the plan's file list
- **Fix:** Updated to `syncedToProvider`
- **Files modified:** packages/modules/billing/src/commands/record-usage.ts
- **Commit:** ac839df

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | a77c0f0 | feat(10-01): create PaymentProvider port interface and shared types |
| 2 | ac839df | feat(10-01): rename DB schema columns to provider-agnostic names |

## Verification

- Zero Stripe-specific column names remain in any .ts file under packages/
- PaymentProvider interface exports all 10+ required methods
- All shared types exported from ports/types.ts
- Migration file exists with 6 RENAME COLUMN statements
- Test scaffolds created for provider-factory (4 todos), webhook-normalization (11 todos), pagarme-adapter (7 todos)
- billing.test.ts assertions updated for new column names
- Tests pass in main repo (worktree has no node_modules for isolated test run)
