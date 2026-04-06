---
phase: 03-billing-background-jobs
verified: 2026-04-06T11:00:00Z
status: human_needed
score: 5/5 must-haves verified
human_verification:
  - test: "Start the worker process and confirm BullMQ workers register for all queues"
    expected: "Running `bun run worker` (with REDIS_URL, DATABASE_URL, BETTER_AUTH_SECRET set) logs 'Worker started for job' for billing:process-webhook, billing:sync-usage, and email:send; then 'Worker started' with worker count 3"
    why_human: "Requires a live Redis connection and environment variables not available in CI"
  - test: "Start the API server and confirm billing module loads and routes are attached"
    expected: "Running `bun run api` logs 'Module loaded' for billing, 'Routes attached' for billing, and 'Baseworks API started'"
    why_human: "Requires DATABASE_URL, BETTER_AUTH_SECRET, and other env vars at runtime"
  - test: "Confirm database tables exist after schema push"
    expected: "Running `bun run db:push` creates billing_customers, webhook_events, and usage_records tables in PostgreSQL"
    why_human: "Requires a live PostgreSQL instance; DATABASE_URL was not available in the worktree during development"
  - test: "Webhook endpoint rejects requests without valid Stripe signature"
    expected: "`curl -X POST http://localhost:3000/api/billing/webhooks -d '{}'` returns HTTP 400 with 'Missing stripe-signature header'"
    why_human: "Requires a running API server; verifies the webhook security gate"
  - test: "Confirm password reset email dispatches to BullMQ queue when Redis is available"
    expected: "Triggering a password reset in better-auth calls queue.add('password-reset', ...) and the email:send worker processes it (check worker logs)"
    why_human: "Requires live Redis and Resend API key or queue inspection tooling"
---

# Phase 3: Billing & Background Jobs Verification Report

**Phase Goal:** Tenants can subscribe to plans, manage billing through Stripe, and asynchronous work (webhooks, emails) processes reliably through job queues
**Verified:** 2026-04-06T11:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A tenant can subscribe to a plan via Stripe Checkout, change plans, cancel, and access the Stripe Customer Portal | VERIFIED | `create-checkout-session.ts` calls `checkout.sessions.create(mode:"subscription")`, `cancel-subscription.ts` uses `cancel_at_period_end`, `change-subscription.ts` calls `subscriptions.update`, `create-portal-session.ts` calls `billingPortal.sessions.create` — all registered in ModuleDefinition |
| 2 | Stripe webhook events are received, verified, deduplicated via idempotency table, and processed via BullMQ | VERIFIED | `routes.ts` performs HMAC signature check via `constructEvent()`, DB-level dedup via `webhookEvents` unique `stripe_event_id`, BullMQ enqueue with `jobId: event.id` for queue-level dedup; `process-webhook.ts` handles 6 event types |
| 3 | A module can register its own job queue and handlers, and a dedicated worker processes jobs via `bun run worker` | VERIFIED | `ModuleDefinition` has `jobs` field; `worker.ts` iterates `registry.getLoaded()` and calls `createWorker()` per job; `bun run worker` script declared in root `package.json` |
| 4 | Transactional emails send reliably through the job queue | VERIFIED | `send-email.ts` uses Resend + React Email; auth module `auth.ts` replaces `console.log` placeholders with `queue.add()` calls to `email:send`; graceful degradation when `RESEND_API_KEY` absent |
| 5 | Usage-based billing tracks tenant consumption and reports metered usage to Stripe | VERIFIED | `record-usage.ts` inserts into `usage_records` with `syncedToStripe: false`; `sync-usage.ts` groups unsynced records and calls `subscriptionItems.createUsageRecord` with idempotency keys |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/queue/src/connection.ts` | Redis connection factory with `maxRetriesPerRequest: null` | VERIFIED | Singleton pattern; `maxRetriesPerRequest: null` confirmed at line 16 |
| `packages/queue/src/index.ts` | `createQueue`, `createWorker` exports | VERIFIED | Both exported; `useWorkerThreads` absent (inline-only per Bun constraint) |
| `packages/queue/src/types.ts` | Queue type definitions | VERIFIED | `QueueConfig`, `WorkerConfig`, `EmailJobData` interfaces present |
| `apps/api/src/worker.ts` | BullMQ worker entrypoint with module job iteration | VERIFIED | Iterates `registry.getLoaded()`, creates worker per job, SIGTERM/SIGINT graceful shutdown |
| `packages/modules/billing/src/index.ts` | Billing ModuleDefinition export | VERIFIED | `name: "billing"`, 6 commands, 2 queries, 3 jobs, 4 events, `satisfies ModuleDefinition` |
| `packages/db/src/schema/billing.ts` | `billingCustomers`, `webhookEvents`, `usageRecords` tables | VERIFIED | All 3 tables with correct columns including `lastEventAt`, `stripe_event_id` unique, `syncedToStripe` |
| `packages/modules/billing/src/routes.ts` | Webhook endpoint at `/api/billing/webhooks` | VERIFIED | Signature verify, DB dedup, BullMQ enqueue, returns 200 fast |
| `packages/modules/billing/src/jobs/process-webhook.ts` | Webhook event processor for 6 Stripe event types | VERIFIED | All 6 event types handled; `lastEventAt` event ordering protection in `subscription.updated` |
| `packages/modules/billing/src/hooks/on-tenant-created.ts` | Auto-create Stripe customer on tenant creation | VERIFIED | Listens `tenant.created`, calls `stripe.customers.create()` with idempotency key, inserts `billingCustomers` |
| `packages/modules/billing/src/commands/create-checkout-session.ts` | Stripe Checkout subscription mode | VERIFIED | `checkout.sessions.create(mode:"subscription")` with idempotency key |
| `packages/modules/billing/src/commands/cancel-subscription.ts` | `cancel_at_period_end` | VERIFIED | `subscriptions.update({cancel_at_period_end: true})` |
| `packages/modules/billing/src/commands/change-subscription.ts` | `subscriptions.update` | VERIFIED | Retrieves current sub item ID then calls `subscriptions.update` |
| `packages/modules/billing/src/commands/create-one-time-payment.ts` | `mode: "payment"` | VERIFIED | `checkout.sessions.create(mode:"payment")` |
| `packages/modules/billing/src/commands/create-portal-session.ts` | `billingPortal.sessions.create` | VERIFIED | Returns portal URL with `return_url` |
| `packages/modules/billing/src/queries/get-subscription-status.ts` | Subscription status query | VERIFIED | Queries `billingCustomers` by `tenantId`, returns status and subscription fields |
| `packages/modules/billing/src/queries/get-billing-history.ts` | Invoice history from Stripe | VERIFIED | Calls `stripe.invoices.list()` with tenant's `stripeCustomerId` |
| `packages/modules/billing/src/commands/record-usage.ts` | Usage tracking into `usageRecords` | VERIFIED | Inserts with `syncedToStripe: false` |
| `packages/modules/billing/src/jobs/sync-usage.ts` | Syncs usage to Stripe | VERIFIED | Groups unsynced records, calls `subscriptionItems.createUsageRecord` |
| `packages/modules/billing/src/jobs/send-email.ts` | Email via Resend + React Email | VERIFIED | `resend.emails.send()` with rendered React Email template; degrades gracefully without API key |
| `packages/modules/billing/src/templates/welcome.tsx` | `WelcomeEmail` component | VERIFIED | React Email component present |
| `packages/modules/billing/src/templates/password-reset.tsx` | `PasswordResetEmail` component | VERIFIED | React Email component with `Reset Your Password` heading |
| `packages/modules/billing/src/templates/billing-notification.tsx` | `BillingNotificationEmail` component | VERIFIED | React Email component present |
| `packages/queue/src/__tests__/queue.test.ts` | Queue unit tests | VERIFIED | 14 tests pass covering connection singleton, queue defaults, worker config |
| `packages/modules/billing/src/__tests__/billing.test.ts` | Billing integration tests | VERIFIED | 13 tests pass covering module structure, email handler, schema correctness |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `apps/api/src/worker.ts` | `packages/queue/src/index.ts` | `import createWorker` | WIRED | Line 3: `import { createWorker, closeConnection } from "@baseworks/queue"` |
| `apps/api/src/worker.ts` | `apps/api/src/core/registry.ts` | `registry.getLoaded()` | WIRED | Line 29: `for (const [name, def] of registry.getLoaded())` |
| `packages/modules/billing/src/routes.ts` | `packages/modules/billing/src/jobs/process-webhook.ts` | BullMQ enqueue | WIRED | `queue.add("process-webhook", {eventId, type}, {jobId: event.id})` at line 91 |
| `packages/modules/billing/src/hooks/on-tenant-created.ts` | `packages/modules/billing/src/stripe.ts` | `stripe.customers.create` | WIRED | Line 50: `stripe.customers.create({metadata: {tenantId}}, {idempotencyKey})` |
| `packages/modules/billing/src/index.ts` | `create-checkout-session.ts` | CQRS command registration | WIRED | `"billing:create-checkout-session": createCheckoutSession` at line 32 |
| `packages/modules/billing/src/index.ts` | `get-subscription-status.ts` | CQRS query registration | WIRED | `"billing:get-subscription-status": getSubscriptionStatus` at line 41 |
| `packages/modules/auth/src/auth.ts` | `packages/modules/billing/src/jobs/send-email.ts` | BullMQ `email:send` queue | WIRED | `getEmailQueue()` + `queue.add("password-reset", ...)` and `queue.add("magic-link", ...)` with console.log fallback |
| `packages/modules/billing/src/jobs/sync-usage.ts` | `packages/modules/billing/src/stripe.ts` | `subscriptionItems.createUsageRecord` | WIRED | Line 78: `stripe.subscriptionItems.createUsageRecord(subscriptionItemId, ...)` |
| `apps/api/src/index.ts` | `@baseworks/module-billing` | `registerBillingHooks` | WIRED | Line 8: import; line 27: `registerBillingHooks(registry.getEventBus())` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `routes.ts` webhook endpoint | `event` from Stripe | `stripe.webhooks.constructEvent(rawBody, sig, secret)` | Yes — real Stripe event object | FLOWING |
| `process-webhook.ts` | `event` from `webhook_events` | `db.select().from(webhookEvents).where(...)` | Yes — DB query | FLOWING |
| `get-subscription-status.ts` | `record` from `billingCustomers` | `ctx.db.select().from(billingCustomers).where(tenantId)` | Yes — DB query | FLOWING |
| `get-billing-history.ts` | `invoiceList` from Stripe | `stripe.invoices.list({customer: stripeCustomerId})` | Yes — Stripe API call | FLOWING |
| `sync-usage.ts` | `unsyncedGroups` | `db.select(...).from(usageRecords).where(syncedToStripe=false).groupBy(...)` | Yes — DB query with aggregation | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Queue unit tests (14 tests) | `bun test packages/queue/src/__tests__/queue.test.ts` | 14 pass, 0 fail | PASS |
| Billing integration tests (13 tests) | `bun test packages/modules/billing/src/__tests__/billing.test.ts` | 13 pass, 0 fail | PASS |
| Worker entrypoint starts (build check) | Module inspection via test suite | Module loads correctly, all jobs registered | PASS |
| Worker starts server via root script | `bun run worker` script in `package.json` | Script `"worker": "bun run apps/api/src/worker.ts"` declared | PASS |
| Billing module registered in API server | Code inspection of `apps/api/src/index.ts` | `modules: ["auth", "billing", "example"]` + `registerBillingHooks` call | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| BILL-01 | 03-03 | Tenant can subscribe to a plan via Stripe Checkout | SATISFIED | `create-checkout-session.ts` implements Stripe Checkout in subscription mode; registered in ModuleDefinition |
| BILL-02 | 03-03 | Tenant can change or cancel subscription | SATISFIED | `cancel-subscription.ts` (cancel_at_period_end) + `change-subscription.ts` (subscriptions.update) |
| BILL-03 | 03-03 | Tenant can make one-time payments | SATISFIED | `create-one-time-payment.ts` uses Checkout mode:"payment" |
| BILL-04 | 03-04 | Usage-based billing tracks consumption and reports to Stripe | SATISFIED | `record-usage.ts` inserts; `sync-usage.ts` reports via `subscriptionItems.createUsageRecord` |
| BILL-05 | 03-03 | Stripe Customer Portal accessible | SATISFIED | `create-portal-session.ts` calls `billingPortal.sessions.create` |
| BILL-06 | 03-02 | Stripe webhook handler with idempotency dedup table | SATISFIED | `routes.ts` performs sig verify + `webhook_events` unique `stripe_event_id` dedup + BullMQ jobId dedup |
| BILL-07 | 03-02 | Tenant linked to Stripe customer on creation | SATISFIED | `on-tenant-created.ts` listens `tenant.created`, creates Stripe customer, inserts `billingCustomers` |
| JOBS-01 | 03-01 | BullMQ queue infrastructure with Redis connection management | SATISFIED | `packages/queue` package with singleton Redis connection (`maxRetriesPerRequest: null`), `createQueue`, `createWorker` |
| JOBS-02 | 03-01 | Each module can register jobs with queue and handlers | SATISFIED | `ModuleDefinition.jobs` field; worker iterates `registry.getLoaded()` to start per-job workers |
| JOBS-03 | 03-01 | Dedicated worker instance mode via `bun run worker` | SATISFIED | `"worker": "bun run apps/api/src/worker.ts"` in root `package.json`; `worker.ts` starts BullMQ workers for all registered jobs |
| JOBS-04 | 03-04 | Transactional email through job queue | SATISFIED | `send-email.ts` processes `email:send` queue via Resend + React Email; auth module dispatches password reset and magic link to queue |
| JOBS-05 | 03-02 | Stripe webhook events processed via job queue | SATISFIED | Webhook route enqueues to `billing:process-webhook`; `process-webhook.ts` handles all 6 event types asynchronously |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `process-webhook.ts` | 71-83 | `console.log` for `invoice.payment_succeeded/failed` instead of `pino` logger | Info | Inconsistent logging; pino is used in other job files (`sync-usage.ts`); no functional impact |
| `on-tenant-created.ts` | 39-43, 68-74 | `console.log`/`console.error` instead of `pino` logger | Info | Inconsistent with backend logging convention; no functional impact |

No stub-level anti-patterns found. All `return null`, `return []` cases are guarded by real data checks upstream.

### Human Verification Required

#### 1. Worker Process Startup

**Test:** With `REDIS_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET` set, run `bun run worker` from the repo root
**Expected:** Logs show `Worker started for job` three times (for `billing:process-webhook`, `billing:sync-usage`, `email:send`), then `Worker started` with `workers: 3`
**Why human:** Requires live Redis; cannot start external services in automated verification

#### 2. API Server with Billing Module

**Test:** With `DATABASE_URL` and `BETTER_AUTH_SECRET` set, run `bun run api` from the repo root
**Expected:** Logs show `Module loaded` for billing, `Routes attached` for billing, `Baseworks API started`
**Why human:** Requires live PostgreSQL; cannot start services in automated verification

#### 3. Database Schema Push

**Test:** With `DATABASE_URL` set pointing to a running PostgreSQL instance, run `bun run db:push`
**Expected:** Creates `billing_customers`, `webhook_events`, and `usage_records` tables; drizzle-kit reports success
**Why human:** DATABASE_URL was unavailable in the worktree during development; schema definitions are correct but live push was deferred (confirmed in 03-04-SUMMARY.md deviations)

#### 4. Webhook Endpoint Security

**Test:** With the API running, send: `curl -X POST http://localhost:3000/api/billing/webhooks -d '{}'`
**Expected:** HTTP 400 response with body `Missing stripe-signature header`
**Why human:** Requires running API server

#### 5. Email Queue Dispatch

**Test:** With REDIS_URL set, trigger a password reset for a test user via better-auth; inspect worker logs
**Expected:** Worker logs `Job completed` for `email:send` queue; if `RESEND_API_KEY` is set, the email arrives
**Why human:** Requires Redis + better-auth flow trigger; cross-module behavior difficult to verify statically

### Gaps Summary

No functional gaps found. All 5 roadmap success criteria are satisfied by substantive, wired implementations with passing unit and integration tests.

The 5 human verification items above are operational confirmations — they verify the system works end-to-end with live infrastructure, not that the implementation is missing anything.

**Note on database schema push:** The `bunx drizzle-kit push` step was deferred during development because `DATABASE_URL` was unavailable in the worktree CI environment. The schema definitions in `packages/db/src/schema/billing.ts` are correct and complete. This is a setup/operational requirement, not a code gap.

---

_Verified: 2026-04-06T11:00:00Z_
_Verifier: Claude (gsd-verifier)_
