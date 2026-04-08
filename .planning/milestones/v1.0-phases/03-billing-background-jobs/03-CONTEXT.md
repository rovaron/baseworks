# Phase 3: Billing & Background Jobs - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement Stripe billing integration (subscriptions, plan changes, cancellations, one-time payments, usage-based billing, customer portal) and BullMQ background job infrastructure (queue management, worker process, module job registration). Wire transactional email delivery (password reset, welcome, billing notifications) through the job queue using Resend + React Email. This phase also processes Stripe webhook events reliably through BullMQ with idempotency guarantees.

</domain>

<decisions>
## Implementation Decisions

### Stripe-Tenant Linking
- **D-01:** Create Stripe customer on tenant creation via a `tenant.created` event handler in the billing module. Every tenant gets a Stripe customer ID immediately, ensuring billing readiness.
- **D-02:** Store Stripe IDs in a dedicated `billing_customers` table (tenantId, stripeCustomerId, stripeSubscriptionId, stripePriceId, status, currentPeriodEnd). Keeps billing data separate from the tenant schema.
- **D-03:** Link is tenant-level, not user-level. The tenant owner manages billing. Per BILL-07: tenant linked to Stripe customer on creation.

### Stripe Integration
- **D-04:** Stripe Checkout for subscription creation (BILL-01). Redirect flow — create a Checkout Session server-side, redirect user to Stripe-hosted page.
- **D-05:** Subscription changes (upgrade/downgrade) via Stripe API `stripe.subscriptions.update()` (BILL-02). Cancellation sets `cancel_at_period_end` rather than immediate delete.
- **D-06:** One-time payments via Stripe Checkout in `payment` mode (BILL-03). Separate from subscription flow.
- **D-07:** Usage-based billing via Stripe's metered billing — report usage with `stripe.subscriptionItems.createUsageRecord()` (BILL-04). Track consumption in a local `usage_records` table, sync to Stripe periodically via a scheduled BullMQ job.
- **D-08:** Stripe Customer Portal accessible via `stripe.billingPortal.sessions.create()` (BILL-05). Server generates a portal URL, frontend redirects.
- **D-09:** Use idempotency keys (`Idempotency-Key` header) for all Stripe mutation API calls.

### Webhook Processing
- **D-10:** Stripe webhooks hit a dedicated endpoint (`POST /api/billing/webhooks`). Verify signature with `stripe.webhooks.constructEvent()`, then enqueue the event as a BullMQ job for async processing (BILL-05, BILL-06).
- **D-11:** Idempotency via a `webhook_events` table with a unique constraint on `stripe_event_id`. Before processing, check if event already exists. Insert on process, skip duplicates.
- **D-12:** Handle these Stripe events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- **D-13:** Webhook endpoint is excluded from tenant middleware and auth (Stripe sends these, not users).

### Job Queue Infrastructure
- **D-14:** BullMQ infrastructure lives in a new shared package `packages/queue` — provides queue creation, worker setup, Redis connection management. Not a module — a shared service like `packages/db`.
- **D-15:** Each module registers jobs via the existing `jobs` field in `ModuleDefinition` (`Record<string, JobDefinition>`). The worker entrypoint iterates loaded modules and starts BullMQ `Worker` instances for each queue.
- **D-16:** Worker entrypoint (`apps/api/src/worker.ts`) updated to: connect to Redis, load modules, start BullMQ workers for all registered jobs, handle graceful shutdown (JOBS-03).
- **D-17:** Named queues per module: `billing:sync-subscription`, `billing:process-webhook`, `email:send`, etc. (JOBS-02).
- **D-18:** `REDIS_URL` becomes required (not optional) when INSTANCE_ROLE is "worker" or "all".

### Email Delivery
- **D-19:** Resend as the email delivery provider (per CLAUDE.md recommendation). Configured via `RESEND_API_KEY` env var.
- **D-20:** React Email components for transactional email templates (password reset, welcome, billing notifications) (JOBS-04). Templates live in a shared location accessible to the email job handler.
- **D-21:** All emails dispatched via BullMQ `email:send` queue — never sent synchronously from request handlers. Ensures reliability and retry on failure.
- **D-22:** Replace Phase 2's email placeholder (console logger for magic links / password reset) with real Resend delivery through the job queue.

### Billing Module Structure
- **D-23:** Billing is a module at `packages/modules/billing/` — loaded by the module registry. Exports: routes (checkout, portal, webhook), commands (create-subscription, cancel-subscription, record-usage), queries (get-subscription-status, get-billing-history), jobs (process-webhook, sync-usage), events (subscription.created, subscription.cancelled, payment.succeeded, payment.failed).
- **D-24:** Billing module listens to `tenant.created` event (from auth module) to auto-create Stripe customer.

### Claude's Discretion
- BullMQ Worker configuration details (concurrency, rate limiting, retry policies)
- Redis connection pooling strategy for BullMQ
- Exact React Email template structure and styling
- Usage tracking granularity and sync frequency
- Stripe product/price seeding approach for development
- Whether to use Stripe test mode webhooks via CLI or a webhook forwarding tool
- Error handling strategy for failed Stripe API calls within job handlers

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Configuration
- `CLAUDE.md` — Technology stack (Stripe SDK ^17.0+, BullMQ ^5.0+, ioredis ^5.4+, Resend ^4.0+, React Email ^0.0.25+), integration patterns, what NOT to use
- `.planning/PROJECT.md` — Core value, constraints (Stripe only, BullMQ + Redis only)
- `.planning/REQUIREMENTS.md` — BILL-01 through BILL-07, JOBS-01 through JOBS-05

### Phase 1 Foundation
- `.planning/phases/01-foundation-core-infrastructure/01-CONTEXT.md` — Module registry design, CQRS conventions, tenant scoping, monorepo package layout
- `packages/shared/src/types/module.ts` — ModuleDefinition interface (has `jobs: Record<string, JobDefinition>`)
- `packages/shared/src/types/cqrs.ts` — HandlerContext, Result, defineCommand/defineQuery
- `apps/api/src/core/registry.ts` — Module registry (import map, loadAll, attachRoutes)
- `apps/api/src/worker.ts` — Worker entrypoint (Phase 3 placeholder comment)
- `packages/config/src/env.ts` — Environment validation (REDIS_URL already defined as optional)

### Phase 2 Auth & Multitenancy
- `.planning/phases/02-auth-multitenancy/02-CONTEXT.md` — Auth module structure, tenant-user relationship, event-driven auto-create tenant pattern
- `packages/modules/auth/src/index.ts` — Auth module (pattern to follow for billing module)
- `packages/modules/auth/src/hooks/auto-create-tenant.ts` — Event-driven hook pattern (billing module will use similar pattern for Stripe customer creation)
- `packages/db/src/schema/auth.ts` — Auth schema (reference for billing schema conventions)
- `packages/db/src/schema/base.ts` — Schema helpers (tenantIdColumn, timestamps, primaryKeyColumn)

### External Documentation
- Stripe docs: https://stripe.com/docs (Checkout, Billing, Customer Portal, Webhooks, Usage Records)
- BullMQ docs: https://docs.bullmq.io (Queue, Worker, connection management)
- Resend docs: https://resend.com/docs (API, React Email integration)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ModuleDefinition` interface with `jobs: Record<string, JobDefinition>` — already supports job registration
- `JobDefinition` type: `{ queue: string, handler: (data: unknown) => Promise<void> }` — ready for BullMQ integration
- `TypedEventBus` — in-process event bus for domain events (billing listens to `tenant.created`)
- `CqrsBus` — command/query dispatch (billing commands/queries register here)
- `defineCommand` / `defineQuery` — handler factories with TypeBox validation
- `ok()` / `err()` — Result constructors
- Schema helpers: `tenantIdColumn()`, `primaryKeyColumn()`, `timestampColumns()`
- Auth module pattern at `packages/modules/auth/` — template for billing module structure
- Worker entrypoint at `apps/api/src/worker.ts` — needs BullMQ setup, has placeholder

### Established Patterns
- Module = workspace package at `packages/modules/<name>/` with flat index.ts export
- Static import map in `registry.ts` — billing module needs an entry: `billing: () => import('@baseworks/module-billing')`
- Handlers are plain async functions: `(input, ctx) => Result`
- Event-driven hooks for cross-module communication (auth auto-creates tenant → billing auto-creates Stripe customer)
- `REDIS_URL` already in env.ts (currently optional)
- Pino structured logging

### Integration Points
- `apps/api/src/core/registry.ts` moduleImportMap — add `billing` entry
- `apps/api/src/worker.ts` — transform from placeholder to real BullMQ worker
- `packages/config/src/env.ts` — add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY; make REDIS_URL required for worker role
- `packages/db/src/schema/index.ts` — export billing tables
- `apps/api/src/index.ts` modules array — add 'billing'
- Auth module's email sending — replace placeholder with job queue dispatch

</code_context>

<specifics>
## Specific Ideas

- BullMQ compatibility with Bun was flagged as a concern in STATE.md — needs early validation during research
- The billing module follows the same structural pattern as the auth module, proving the module system scales to a third real module
- Webhook endpoint must be excluded from both tenant middleware and auth middleware (Stripe sends these, not users)
- Email delivery replaces Phase 2 placeholders — this is a cross-cutting concern affecting the auth module's magic link and password reset flows
- Usage-based billing needs both local tracking (for audit/display) and Stripe sync (for metering) — a scheduled job bridges the two

</specifics>

<deferred>
## Deferred Ideas

- Plan gating / feature restriction based on subscription tier (v2 — ADVB-01)
- Advanced billing analytics / revenue dashboards (Phase 4 admin dashboard will show basic billing overview)
- Dunning management / automated payment recovery beyond Stripe's built-in retry
- Invoice PDF generation / custom invoices
- Multi-currency support
- Proration customization beyond Stripe defaults

</deferred>

---

*Phase: 03-billing-background-jobs*
*Context gathered: 2026-04-06*
