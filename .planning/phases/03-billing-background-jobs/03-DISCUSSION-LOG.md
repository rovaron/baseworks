# Phase 3: Billing & Background Jobs - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-06
**Phase:** 03-billing-background-jobs
**Mode:** --auto (all decisions auto-selected with recommended defaults)
**Areas discussed:** Stripe-Tenant Linking, Webhook Processing Architecture, Job Queue Module Design, Email Delivery Strategy

---

## Stripe-Tenant Linking

| Option | Description | Selected |
|--------|-------------|----------|
| On tenant creation (event handler) | Listen to tenant.created, auto-create Stripe customer immediately | ✓ |
| On first billing action (lazy) | Create Stripe customer only when user first interacts with billing | |
| Manual trigger | Admin or user explicitly triggers Stripe customer creation | |

**User's choice:** On tenant creation (event handler) [auto-selected: recommended default]
**Notes:** Ensures every tenant has a Stripe customer ready. Follows the same event-driven pattern as auto-create-tenant in auth module.

| Option | Description | Selected |
|--------|-------------|----------|
| Separate billing_customers table | Dedicated table with Stripe IDs, status, period info | ✓ |
| Add columns to tenant table | Store Stripe IDs directly on existing tenant record | |

**User's choice:** Separate billing_customers table [auto-selected: recommended default]
**Notes:** Clean separation of concerns. Billing data doesn't pollute the tenant schema.

---

## Webhook Processing Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Verify + enqueue (async via BullMQ) | Verify signature, enqueue as job, return 200 immediately | ✓ |
| Verify + process inline | Verify and process synchronously in the request handler | |

**User's choice:** Verify + enqueue via BullMQ [auto-selected: recommended default]
**Notes:** Required by BILL-05 (webhook events processed via job queue for reliability). Adds retry capability.

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated webhook_events table | Table with stripe_event_id unique constraint for dedup | ✓ |
| In-memory dedup (Redis set) | Store processed event IDs in Redis with TTL | |

**User's choice:** Dedicated webhook_events table [auto-selected: recommended default]
**Notes:** Durable, survives Redis restarts. Per BILL-06 requirement for idempotency.

| Option | Description | Selected |
|--------|-------------|----------|
| Core billing events | checkout.session.completed, subscription.created/updated/deleted, invoice.payment_succeeded/failed | ✓ |
| Minimal set | Only checkout.session.completed and subscription.deleted | |
| Comprehensive | All Stripe events | |

**User's choice:** Core billing events [auto-selected: recommended default]
**Notes:** Covers all BILL-01 through BILL-04 requirements without unnecessary complexity.

---

## Job Queue Module Design

| Option | Description | Selected |
|--------|-------------|----------|
| Shared service (packages/queue) | BullMQ infrastructure as a shared package, like packages/db | ✓ |
| Module (packages/modules/queue) | BullMQ as a module loaded by registry | |
| Inline in worker.ts | Queue setup directly in worker entrypoint | |

**User's choice:** Shared service in packages/queue [auto-selected: recommended default]
**Notes:** All modules need queue access. A shared package is consistent with how db and config are structured.

| Option | Description | Selected |
|--------|-------------|----------|
| ModuleDefinition.jobs field | Worker iterates modules, starts BullMQ Workers for each job definition | ✓ |
| Explicit registration API | Modules call queue.register() during initialization | |

**User's choice:** ModuleDefinition.jobs field [auto-selected: recommended default]
**Notes:** Leverages existing JobDefinition interface already defined in shared types.

---

## Email Delivery Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Resend | Modern email API, React Email native integration, CLAUDE.md recommended | ✓ |
| Nodemailer + SMTP | Self-hosted SMTP, more control, no vendor dependency | |

**User's choice:** Resend [auto-selected: recommended default]
**Notes:** Per CLAUDE.md recommendation. Best DX, works natively with React Email.

| Option | Description | Selected |
|--------|-------------|----------|
| React Email components | JSX-based email templates, type-safe, reusable | ✓ |
| Plain text / HTML strings | Simple, no dependencies | |
| MJML | Responsive email framework | |

**User's choice:** React Email components [auto-selected: recommended default]
**Notes:** Per CLAUDE.md stack. Works natively with Resend.

| Option | Description | Selected |
|--------|-------------|----------|
| BullMQ email:send queue | All emails dispatched as jobs, never synchronous | ✓ |
| Direct send (no queue) | Send emails inline during request processing | |

**User's choice:** BullMQ email:send queue [auto-selected: recommended default]
**Notes:** Reliable, retryable, non-blocking. Standard pattern for transactional email.

---

## Claude's Discretion

- BullMQ Worker concurrency, rate limiting, retry policies
- Redis connection pooling for BullMQ
- React Email template structure and styling
- Usage tracking granularity and sync frequency
- Stripe product/price seeding for development
- Error handling in job handlers

## Deferred Ideas

- Plan gating / feature restriction based on subscription tier (v2)
- Advanced billing analytics (Phase 4 admin shows basic overview)
- Dunning management beyond Stripe defaults
- Invoice PDF generation
- Multi-currency support
- Proration customization
