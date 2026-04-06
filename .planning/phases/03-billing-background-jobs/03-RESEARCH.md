# Phase 3: Billing & Background Jobs - Research

**Researched:** 2026-04-06
**Domain:** Stripe billing, BullMQ job queues, transactional email (Resend + React Email)
**Confidence:** MEDIUM

## Summary

This phase wires three major subsystems: Stripe billing (subscriptions, one-time payments, usage metering, customer portal), BullMQ background job infrastructure (queue creation, worker process, module job registration), and transactional email delivery via Resend + React Email through the job queue. The billing module follows the established Medusa-style module pattern proven in auth (Phase 2).

The critical risk is BullMQ sandboxed processor incompatibility with Bun -- sandboxed processors with async/await do not complete under Bun runtime. The mitigation is straightforward: use inline (non-sandboxed) processors only, which is the default BullMQ mode and sufficient for this use case. Standard BullMQ Workers with inline processor functions work correctly on Bun 1.3+.

**Primary recommendation:** Use BullMQ with inline processors (no sandboxed mode), Stripe SDK v17.x (not v22 which has breaking Decimal type changes), Resend SDK for email delivery, and follow the existing module pattern exactly as established by the auth module.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Create Stripe customer on tenant creation via `tenant.created` event handler in billing module
- **D-02:** Store Stripe IDs in a dedicated `billing_customers` table (tenantId, stripeCustomerId, stripeSubscriptionId, stripePriceId, status, currentPeriodEnd)
- **D-03:** Link is tenant-level, not user-level. Tenant owner manages billing.
- **D-04:** Stripe Checkout for subscription creation (redirect flow)
- **D-05:** Subscription changes via `stripe.subscriptions.update()`; cancellation via `cancel_at_period_end`
- **D-06:** One-time payments via Stripe Checkout in `payment` mode
- **D-07:** Usage-based billing via `stripe.subscriptionItems.createUsageRecord()`; local `usage_records` table, sync via scheduled BullMQ job
- **D-08:** Stripe Customer Portal via `stripe.billingPortal.sessions.create()`
- **D-09:** Idempotency keys for all Stripe mutation API calls
- **D-10:** Webhook endpoint at `POST /api/billing/webhooks`; verify signature, enqueue to BullMQ
- **D-11:** Idempotency via `webhook_events` table with unique constraint on `stripe_event_id`
- **D-12:** Handle: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.payment_succeeded/failed
- **D-13:** Webhook endpoint excluded from tenant middleware and auth
- **D-14:** BullMQ infrastructure in `packages/queue` (shared package, not a module)
- **D-15:** Modules register jobs via `jobs` field in ModuleDefinition
- **D-16:** Worker entrypoint at `apps/api/src/worker.ts` -- connect Redis, load modules, start BullMQ Workers
- **D-17:** Named queues per module: `billing:sync-subscription`, `billing:process-webhook`, `email:send`
- **D-18:** `REDIS_URL` required when INSTANCE_ROLE is "worker" or "all"
- **D-19:** Resend as email delivery provider; `RESEND_API_KEY` env var
- **D-20:** React Email templates for transactional emails
- **D-21:** All emails via BullMQ `email:send` queue -- never synchronous
- **D-22:** Replace Phase 2 email placeholders with real Resend delivery
- **D-23:** Billing module at `packages/modules/billing/` with full CQRS exports
- **D-24:** Billing module listens to `tenant.created` event for auto Stripe customer creation

### Claude's Discretion
- BullMQ Worker configuration details (concurrency, rate limiting, retry policies)
- Redis connection pooling strategy for BullMQ
- Exact React Email template structure and styling
- Usage tracking granularity and sync frequency
- Stripe product/price seeding approach for development
- Whether to use Stripe test mode webhooks via CLI or webhook forwarding tool
- Error handling strategy for failed Stripe API calls within job handlers

### Deferred Ideas (OUT OF SCOPE)
- Plan gating / feature restriction based on subscription tier (v2 -- ADVB-01)
- Advanced billing analytics / revenue dashboards
- Dunning management beyond Stripe built-in retry
- Invoice PDF generation / custom invoices
- Multi-currency support
- Proration customization beyond Stripe defaults
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BILL-01 | Tenant can subscribe to a plan via Stripe Checkout | Stripe Checkout Session API, redirect flow pattern |
| BILL-02 | Tenant can change or cancel subscription | stripe.subscriptions.update() + cancel_at_period_end pattern |
| BILL-03 | Tenant can make one-time payments | Stripe Checkout in `payment` mode |
| BILL-04 | Usage-based billing tracks consumption and reports to Stripe | createUsageRecord API, local usage_records table, scheduled sync job |
| BILL-05 | Stripe Customer Portal accessible | billingPortal.sessions.create() for portal URL generation |
| BILL-06 | Stripe webhook handler with idempotency | Webhook signature verification, webhook_events dedup table, BullMQ async processing |
| BILL-07 | Tenant linked to Stripe customer on creation | Event-driven via tenant.created, billing_customers table |
| JOBS-01 | BullMQ queue infrastructure with Redis connection | packages/queue shared package, ioredis connection factory |
| JOBS-02 | Each module can register jobs with own queue/handlers | ModuleDefinition.jobs field, worker iterates loaded modules |
| JOBS-03 | Dedicated worker instance via `bun run worker` | worker.ts entrypoint, graceful shutdown with SIGTERM/SIGINT |
| JOBS-04 | Transactional email sending | Resend SDK + React Email templates, email:send queue |
| JOBS-05 | Stripe webhook events processed via job queue | Webhook endpoint enqueues to BullMQ, worker processes async |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe | 17.7.0 | Stripe SDK | Latest v17 stable. v22 introduces breaking Decimal type changes -- stay on v17 for stability [VERIFIED: npm registry] |
| bullmq | 5.73.0 | Job queue | Battle-tested Redis-backed queue. Works with Bun 1.3+ using inline processors [VERIFIED: npm registry] |
| ioredis | 5.10.1 | Redis client | Required by BullMQ peer dependency. Also used for Redis connection management [VERIFIED: npm registry] |
| resend | 6.10.0 | Email delivery | Official Resend SDK for transactional email sending [VERIFIED: npm registry] |
| @react-email/components | 1.0.11 | Email templates | React-based email template components (Html, Head, Body, Text, Button, etc.) [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-email | 5.2.10 | Dev preview server | Optional -- for previewing email templates in browser during development [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| stripe v17 | stripe v22 | v22 has Decimal type breaking change; v17 is stable and sufficient |
| Resend | nodemailer | nodemailer is self-hosted SMTP; Resend has better DX and React Email integration |
| BullMQ sandboxed | BullMQ inline | Sandboxed processors broken on Bun (async/await issue); inline is correct choice |

**Installation (packages/queue):**
```bash
bun add bullmq ioredis
```

**Installation (packages/modules/billing):**
```bash
bun add stripe
```

**Installation (email-related, location TBD by planner):**
```bash
bun add resend @react-email/components
```

## Architecture Patterns

### Recommended Project Structure

```
packages/
  queue/                        # NEW: Shared BullMQ infrastructure
    src/
      index.ts                  # Exports: createQueue, createWorker, getConnection
      connection.ts             # Redis connection factory (singleton ioredis)
      types.ts                  # Queue/worker type definitions
    package.json                # @baseworks/queue
  modules/
    billing/                    # NEW: Billing module
      src/
        index.ts                # ModuleDefinition export
        schema.ts               # billing_customers, webhook_events, usage_records tables
        routes.ts               # Elysia routes (checkout, portal, webhooks)
        commands/
          create-checkout-session.ts
          cancel-subscription.ts
          change-subscription.ts
          record-usage.ts
        queries/
          get-subscription-status.ts
          get-billing-history.ts
        jobs/
          process-webhook.ts    # Handles Stripe webhook events
          sync-usage.ts         # Syncs usage_records to Stripe
        hooks/
          on-tenant-created.ts  # Auto-create Stripe customer
        templates/              # React Email templates
          welcome.tsx
          password-reset.tsx
          billing-notification.tsx
        stripe.ts               # Stripe client singleton
      __tests__/
        billing-setup.test.ts
        webhook-processing.test.ts
        email-dispatch.test.ts
      package.json              # @baseworks/module-billing
```

### Pattern 1: BullMQ Queue Factory (packages/queue)

**What:** Centralized Redis connection and queue creation
**When to use:** Every module that needs background jobs

```typescript
// packages/queue/src/connection.ts
import IORedis from "ioredis";

let connection: IORedis | null = null;

export function getRedisConnection(url: string): IORedis {
  if (!connection) {
    connection = new IORedis(url, {
      maxRetriesPerRequest: null, // Required by BullMQ
    });
  }
  return connection;
}

export async function closeConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
```

```typescript
// packages/queue/src/index.ts
import { Queue, Worker } from "bullmq";
import type { Processor } from "bullmq";
import { getRedisConnection } from "./connection";

export function createQueue(name: string, redisUrl: string): Queue {
  return new Queue(name, {
    connection: getRedisConnection(redisUrl),
    defaultJobOptions: {
      removeOnComplete: { age: 3600 * 24 * 3 }, // 3 days (matches Stripe retry window)
      removeOnFail: { age: 3600 * 24 * 7 },     // 7 days
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    },
  });
}

export function createWorker(
  name: string,
  processor: Processor,
  redisUrl: string,
  opts?: { concurrency?: number },
): Worker {
  return new Worker(name, processor, {
    connection: getRedisConnection(redisUrl),
    concurrency: opts?.concurrency ?? 5,
    // NO useWorkerThreads -- sandboxed processors broken on Bun
  });
}
```
[VERIFIED: BullMQ docs -- maxRetriesPerRequest: null is required for BullMQ connections]

### Pattern 2: Webhook Processing with Idempotency

**What:** Verify Stripe signature, dedup via DB, enqueue for async processing
**When to use:** Stripe webhook endpoint

```typescript
// Webhook endpoint (in billing routes)
// 1. Verify signature (MUST use raw body, not parsed JSON)
// 2. Check webhook_events table for duplicate
// 3. Insert event record with status "pending"
// 4. Enqueue to billing:process-webhook queue
// 5. Return 200 immediately

// Job handler (billing:process-webhook)
// 1. Load event from webhook_events table
// 2. Switch on event.type -> handle each event
// 3. Update webhook_events status to "processed"
// 4. On failure: BullMQ retries; status stays "pending"
```
[CITED: https://docs.stripe.com/webhooks/best-practices]

### Pattern 3: Module Job Registration

**What:** Module declares jobs in ModuleDefinition, worker starts Workers for each
**When to use:** Worker entrypoint initialization

```typescript
// In worker.ts after loading modules:
for (const [name, def] of registry.getLoaded()) {
  if (def.jobs) {
    for (const [jobName, jobDef] of Object.entries(def.jobs)) {
      const worker = createWorker(
        jobDef.queue,
        async (job) => jobDef.handler(job.data),
        env.REDIS_URL!,
      );
      worker.on("failed", (job, err) => {
        logger.error({ job: job?.id, queue: jobDef.queue, err }, "Job failed");
      });
      workers.push(worker);
    }
  }
}
```

### Pattern 4: Email Dispatch via Job Queue

**What:** Enqueue email jobs instead of sending synchronously
**When to use:** Any email send (auth placeholders, billing notifications)

```typescript
// In auth.ts, replace console.log placeholders:
sendResetPassword: async ({ user, url }) => {
  // Fire-and-forget: enqueue email job
  await emailQueue.add("password-reset", {
    to: user.email,
    template: "password-reset",
    data: { url, userName: user.name },
  });
},

// Email job handler (in billing module or shared email handler):
async function processEmailJob(data: EmailJobData) {
  const html = await render(getTemplate(data.template, data.data));
  await resend.emails.send({
    from: "noreply@yourdomain.com",
    to: data.to,
    subject: getSubject(data.template),
    html,
  });
}
```

### Anti-Patterns to Avoid

- **Sandboxed processors on Bun:** BullMQ sandboxed processors (useWorkerThreads: true or file path processors) do not work correctly with Bun's async/await. Always use inline processor functions. [VERIFIED: GitHub issue #2536]
- **Synchronous email sending:** Never send emails in request handlers. Always dispatch via the email:send queue for reliability and retry.
- **Parsing webhook body as JSON before verification:** Stripe signature verification requires the raw body. Elysia/Bun may auto-parse; the webhook route must receive raw body bytes.
- **Sharing ioredis connection for subscriber mode:** BullMQ Worker uses Redis subscriber mode. If you share a connection between Queue (publisher) and Worker (subscriber), use duplicate() or create separate connections. BullMQ handles this internally when given the same connection config -- but be aware of it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook signature verification | Custom HMAC check | `stripe.webhooks.constructEvent()` | Handles timing-safe comparison, versioning, encoding edge cases |
| Job queue with retry/backoff | Custom Redis BRPOPLPUSH | BullMQ Queue + Worker | Handles stalled jobs, delayed retry, rate limiting, concurrency |
| Email HTML rendering | String template concatenation | React Email `render()` | Cross-client compatibility, responsive design, inline styles |
| Subscription state machine | Custom status tracking | Stripe webhook events | Stripe is the source of truth; mirror its state, don't compute it |
| Idempotency key generation | Custom UUID scheme | `crypto.randomUUID()` | Sufficient for Stripe idempotency headers |
| Customer portal UI | Custom billing management pages | Stripe Customer Portal | Stripe hosts invoice history, payment method updates, plan changes |

## Common Pitfalls

### Pitfall 1: Raw Body Access for Webhook Verification
**What goes wrong:** Stripe signature verification fails because the body was JSON-parsed before reaching `constructEvent()`.
**Why it happens:** Elysia auto-parses request bodies. The webhook endpoint needs the raw body bytes.
**How to avoid:** Use Elysia's raw body access. Configure the webhook route to receive `text/plain` or read the raw request body before JSON parsing. Test signature verification in integration tests.
**Warning signs:** `StripeSignatureVerificationError` in production logs despite correct webhook secret.

### Pitfall 2: BullMQ Sandboxed Processors on Bun
**What goes wrong:** Jobs enter "active" state but never complete when using sandboxed (file path) processors with async/await.
**Why it happens:** Bun's worker_threads implementation has incomplete compatibility with BullMQ's sandboxed processor communication protocol for async operations.
**How to avoid:** Always use inline processor functions (pass a function to Worker, not a file path). Never set `useWorkerThreads: true`.
**Warning signs:** Jobs stuck in "active" state, never reaching "completed" or "failed". [VERIFIED: GitHub issue taskforcesh/bullmq#2536]

### Pitfall 3: Webhook Event Ordering
**What goes wrong:** Processing events out of order causes stale data (e.g., processing `subscription.deleted` before `subscription.created`).
**Why it happens:** Stripe does not guarantee event delivery order. BullMQ concurrent workers process jobs in parallel.
**How to avoid:** Use the `created` timestamp from the Stripe event. When updating billing_customers, only update if the event timestamp is newer than `lastEventAt`. Use optimistic locking or compare-and-swap.
**Warning signs:** Subscription status flickering between states in the billing_customers table.

### Pitfall 4: BullMQ maxRetriesPerRequest
**What goes wrong:** BullMQ throws "maxRetriesPerRequest must be null" error on startup.
**Why it happens:** ioredis default maxRetriesPerRequest is 20; BullMQ requires null for blocking commands.
**How to avoid:** Always pass `{ maxRetriesPerRequest: null }` when creating the ioredis connection for BullMQ.
**Warning signs:** Application crash on worker startup with ioredis/BullMQ error. [VERIFIED: BullMQ docs]

### Pitfall 5: Stripe Webhook Timeout
**What goes wrong:** Stripe marks webhook delivery as failed, triggering retries.
**Why it happens:** Webhook endpoint does synchronous processing instead of enqueuing and returning 200 immediately. Stripe expects response within ~5-20 seconds.
**How to avoid:** Verify signature, insert into webhook_events, enqueue BullMQ job, return 200. All heavy processing in the worker.
**Warning signs:** Stripe dashboard showing webhook delivery failures/timeouts. [CITED: https://docs.stripe.com/webhooks/best-practices]

### Pitfall 6: Email Queue Access from Auth Module
**What goes wrong:** Auth module cannot enqueue email jobs because it doesn't have direct access to the BullMQ queue instance.
**Why it happens:** Auth module was built in Phase 2 without queue awareness. The email:send queue lives in the queue package.
**How to avoid:** Wire email dispatch through the `enqueue` function on HandlerContext (already defined as optional in cqrs.ts), or expose a shared `getEmailQueue()` function from packages/queue. For better-auth callbacks (sendResetPassword, sendMagicLink), pass the queue instance via closure in auth.ts configuration.
**Warning signs:** Console.log placeholders still firing instead of real emails.

## Code Examples

### Billing Schema (Drizzle)

```typescript
// packages/modules/billing/src/schema.ts
import { pgTable, text, timestamp, varchar, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { primaryKeyColumn, tenantIdColumn, timestampColumns } from "@baseworks/db";

export const billingCustomers = pgTable("billing_customers", {
  id: primaryKeyColumn(),
  tenantId: tenantIdColumn(),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  status: text("status").notNull().default("inactive"), // active, past_due, canceled, inactive
  currentPeriodEnd: timestamp("current_period_end"),
  ...timestampColumns(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: primaryKeyColumn(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("pending"), // pending, processed, failed
  payload: text("payload"), // JSON stringified event data
  processedAt: timestamp("processed_at"),
  ...timestampColumns(),
});

export const usageRecords = pgTable("usage_records", {
  id: primaryKeyColumn(),
  tenantId: tenantIdColumn(),
  metric: text("metric").notNull(), // e.g., "api_calls", "storage_mb"
  quantity: integer("quantity").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  syncedToStripe: boolean("synced_to_stripe").notNull().default(false),
  stripeUsageRecordId: text("stripe_usage_record_id"),
});
```
[ASSUMED: Schema structure follows Drizzle patterns from Phase 1/2; column names match D-02/D-07/D-11]

### Stripe Client Singleton

```typescript
// packages/modules/billing/src/stripe.ts
import Stripe from "stripe";
import { env } from "@baseworks/config";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia", // Pin API version for stability
  typescript: true,
});
```
[ASSUMED: API version string -- verify against Stripe docs for v17 compatible version]

### Webhook Route with Raw Body

```typescript
// In billing routes -- webhook endpoint excluded from tenant middleware
app.post("/api/billing/webhooks", async (ctx) => {
  const sig = ctx.headers["stripe-signature"];
  const rawBody = await ctx.request.text(); // Raw body for signature verification

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig!, env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  // Idempotency check
  const existing = await db.select()
    .from(webhookEvents)
    .where(eq(webhookEvents.stripeEventId, event.id))
    .limit(1);

  if (existing.length > 0) {
    return { received: true }; // Already processed, skip
  }

  // Insert event record
  await db.insert(webhookEvents).values({
    stripeEventId: event.id,
    eventType: event.type,
    status: "pending",
    payload: JSON.stringify(event.data),
  });

  // Enqueue for async processing
  await webhookQueue.add("process-webhook", {
    eventId: event.id,
    type: event.type,
  }, { jobId: event.id }); // jobId = event.id for BullMQ-level dedup

  return { received: true };
});
```
[CITED: https://docs.stripe.com/webhooks/signatures]

### Resend Email Sending

```typescript
// Email job handler
import { Resend } from "resend";
import { render } from "@react-email/components";
import { WelcomeEmail } from "./templates/welcome";

const resend = new Resend(env.RESEND_API_KEY);

async function sendEmail(data: { to: string; template: string; data: Record<string, any> }) {
  const Component = templates[data.template]; // Map of template name -> React component
  const html = await render(Component(data.data));

  await resend.emails.send({
    from: "Baseworks <noreply@yourdomain.com>",
    to: data.to,
    subject: getSubjectForTemplate(data.template),
    html,
  });
}
```
[CITED: https://react.email/docs/integrations/resend]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| stripe v17.x Decimal-as-string | stripe v22.x Stripe.Decimal type | 2026-03 | Stay on v17 to avoid breaking changes; v17 is supported and stable |
| BullMQ sandboxed + worker_threads | BullMQ inline processors (on Bun) | Ongoing | Sandboxed broken on Bun; inline is the only safe option |
| Bull (legacy) | BullMQ v5 | Bull EOL announced | BullMQ is the successor; Bull should not be used for new projects |
| nodemailer + handlebars templates | Resend + React Email | 2024+ | React Email provides component-based templates with better DX |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Stripe API version "2024-12-18.acacia" is compatible with stripe v17.7.0 | Code Examples | Wrong API version string causes runtime errors; verify against SDK release notes |
| A2 | Elysia provides raw body access via `ctx.request.text()` for webhook signature verification | Pitfall 1 | If Elysia pre-parses body, webhook verification will fail; needs early testing |
| A3 | BullMQ inline processors work correctly with Bun 1.3.10 for async handlers | Architecture | If inline processors also fail, would need to run worker on Node.js instead of Bun |
| A4 | Schema column structure for billing tables matches what Stripe events provide | Code Examples | Mismatched columns require schema migration during implementation |
| A5 | react-email render() function works in Bun runtime | Standard Stack | If SSR rendering fails in Bun, would need workaround or different template approach |

## Open Questions

1. **Stripe API version pinning for v17**
   - What we know: stripe v17.7.0 is latest in v17 line; v22 is latest overall
   - What's unclear: Exact API version string to pin for v17 compatibility
   - Recommendation: Use the default API version bundled with stripe@17.7.0 (don't override unless needed)

2. **Email queue ownership**
   - What we know: D-21 says all emails via email:send queue; D-23 places billing as the module
   - What's unclear: Should email sending be part of billing module, or a separate concern in packages/queue?
   - Recommendation: Email job handler lives alongside billing module since billing is the first consumer, but the email:send queue should be accessible from any module via packages/queue

3. **Auth module email integration mechanism**
   - What we know: better-auth callbacks (sendResetPassword, sendMagicLink) are configured in auth.ts with closure references
   - What's unclear: How to inject the BullMQ queue into auth.ts closures since auth.ts is initialized at import time
   - Recommendation: Lazy-initialize the queue reference; auth.ts callbacks check for queue availability and fall back to console.log in test/dev if queue is not configured

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Redis container | Yes | 28.2.2 | -- |
| Redis | BullMQ queue backend | Yes (via docker-compose) | 7.x | -- |
| PostgreSQL | Billing schema tables | Yes (via docker-compose) | 16 | -- |
| Bun | Runtime | Yes | 1.3.10 | -- |
| Stripe CLI | Webhook testing in dev | Not checked | -- | Use Stripe Dashboard test webhooks or ngrok |

**Missing dependencies with no fallback:**
- None -- all required infrastructure is available

**Missing dependencies with fallback:**
- Stripe CLI: optional; webhook testing can use Stripe Dashboard or manual curl

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | None needed -- Bun discovers test files automatically |
| Quick run command | `bun test packages/modules/billing/src/__tests__/` |
| Full suite command | `bun test` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BILL-01 | Checkout session creation | unit | `bun test packages/modules/billing/src/__tests__/billing-setup.test.ts` | Wave 0 |
| BILL-02 | Subscription change/cancel | unit | `bun test packages/modules/billing/src/__tests__/subscription.test.ts` | Wave 0 |
| BILL-03 | One-time payment checkout | unit | `bun test packages/modules/billing/src/__tests__/billing-setup.test.ts` | Wave 0 |
| BILL-04 | Usage record tracking | unit | `bun test packages/modules/billing/src/__tests__/usage.test.ts` | Wave 0 |
| BILL-05 | Customer portal session | unit | `bun test packages/modules/billing/src/__tests__/billing-setup.test.ts` | Wave 0 |
| BILL-06 | Webhook idempotency | unit | `bun test packages/modules/billing/src/__tests__/webhook-processing.test.ts` | Wave 0 |
| BILL-07 | Stripe customer auto-creation | unit | `bun test packages/modules/billing/src/__tests__/billing-setup.test.ts` | Wave 0 |
| JOBS-01 | Queue infrastructure | unit | `bun test packages/queue/src/__tests__/queue.test.ts` | Wave 0 |
| JOBS-02 | Module job registration | unit | `bun test packages/modules/billing/src/__tests__/billing-setup.test.ts` | Wave 0 |
| JOBS-03 | Worker entrypoint | smoke | Manual -- start worker, verify logs | manual-only |
| JOBS-04 | Email sending via queue | unit | `bun test packages/modules/billing/src/__tests__/email-dispatch.test.ts` | Wave 0 |
| JOBS-05 | Webhook via job queue | unit | `bun test packages/modules/billing/src/__tests__/webhook-processing.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test packages/modules/billing/src/__tests__/ packages/queue/src/__tests__/`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/queue/src/__tests__/queue.test.ts` -- covers JOBS-01
- [ ] `packages/modules/billing/src/__tests__/billing-setup.test.ts` -- covers BILL-01, BILL-03, BILL-05, BILL-07, JOBS-02
- [ ] `packages/modules/billing/src/__tests__/webhook-processing.test.ts` -- covers BILL-06, JOBS-05
- [ ] `packages/modules/billing/src/__tests__/subscription.test.ts` -- covers BILL-02
- [ ] `packages/modules/billing/src/__tests__/usage.test.ts` -- covers BILL-04
- [ ] `packages/modules/billing/src/__tests__/email-dispatch.test.ts` -- covers JOBS-04

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Handled in Phase 2 |
| V3 Session Management | No | Handled in Phase 2 |
| V4 Access Control | Yes | Webhook endpoint excluded from auth; billing routes require tenant owner role |
| V5 Input Validation | Yes | TypeBox schemas for CQRS commands; Stripe SDK validates API params |
| V6 Cryptography | Yes | Stripe webhook signature verification via constructEvent() -- never hand-roll |

### Known Threat Patterns for Stripe + BullMQ

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook replay attack | Spoofing | stripe.webhooks.constructEvent() signature verification |
| Webhook event duplication | Tampering | webhook_events table with unique constraint on stripe_event_id |
| Unauthorized billing access | Elevation of privilege | Billing routes scoped to tenant owner; webhook endpoint requires valid Stripe signature |
| Stripe secret key exposure | Information disclosure | Environment variable only; never log or return in API responses |
| Job data injection | Tampering | Validate job payload before processing; BullMQ jobs are trusted internal dispatch only |

## Sources

### Primary (HIGH confidence)
- npm registry -- verified versions: stripe 22.0.0 (latest), stripe 17.7.0 (v17 latest), bullmq 5.73.0, ioredis 5.10.1, resend 6.10.0, @react-email/components 1.0.11
- Codebase grep -- existing patterns: ModuleDefinition, JobDefinition, worker.ts placeholder, auth module structure, env.ts, event-bus, CQRS types
- [BullMQ docs](https://docs.bullmq.io/) -- connection requirements, worker configuration
- [Stripe webhook best practices](https://docs.stripe.com/webhooks/best-practices) -- signature verification, timeout handling

### Secondary (MEDIUM confidence)
- [GitHub issue taskforcesh/bullmq#2536](https://github.com/taskforcesh/bullmq/issues/2536) -- Bun sandboxed processor bug confirmed
- [Stripe Node SDK changelog](https://github.com/stripe/stripe-node/blob/master/CHANGELOG.md) -- v22 breaking changes (Decimal type)
- [React Email + Resend integration](https://react.email/docs/integrations/resend) -- render() + send() pattern
- [Stigg: Stripe webhook best practices](https://www.stigg.io/blog-posts/best-practices-i-wish-we-knew-when-integrating-stripe-webhooks) -- idempotency patterns

### Tertiary (LOW confidence)
- [BullMQ Bun general compatibility](https://pocketlantern.dev/briefs/bull-vs-bullmq-node-job-queue-performance-2026) -- claims Bun support but no deep details

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM -- versions verified via npm, but Bun compatibility for all packages is [ASSUMED] based on training + one GitHub issue
- Architecture: HIGH -- follows established module pattern from Phase 1/2, decisions are locked and detailed
- Pitfalls: HIGH -- sandboxed processor issue verified via GitHub, webhook patterns well-documented by Stripe

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (30 days -- stack is stable; Stripe SDK and BullMQ have predictable release cycles)
