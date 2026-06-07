import { env } from "@baseworks/config";
import { getDb, webhookEvents } from "@baseworks/db";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { cancelSubscription } from "./commands/cancel-subscription";
import { changeSubscription } from "./commands/change-subscription";
import { createCheckoutSession } from "./commands/create-checkout-session";
import { createOneTimePayment } from "./commands/create-one-time-payment";
import { createPortalSession } from "./commands/create-portal-session";
import { recordUsage } from "./commands/record-usage";
import type { NormalizedEvent } from "./ports/types";
import { getPaymentProvider } from "./provider-factory";
import { getBillingHistory } from "./queries/get-billing-history";
import { getSubscriptionStatus } from "./queries/get-subscription-status";

/**
 * Billing module routes plugins.
 *
 * `billingWebhookRoutes` exposes the PUBLIC payment-provider webhook
 * (no auth, no tenant middleware). It is exported separately so apps/api
 * can mount it in the pre-tenant band -- ahead of tenantMiddleware -- since
 * provider webhook POSTs carry no session cookie and must not be rejected by
 * the tenant-scoped derive (C4 / billing-webhook-behind-tenant-middleware).
 *
 * `billingRoutes` mounts the tenant-scoped CQRS command/query endpoints for
 * checkout, subscription management, portal, usage recording, and billing
 * history under the /api/billing prefix.
 *
 * Webhook pipeline (D-10, D-11, D-13):
 * 1. Verify signature via provider.verifyWebhookSignature()
 * 2. Normalize event via provider.normalizeEvent() (PAY-03)
 * 3. Require a queue BEFORE mutating state -- 503 if Redis is unavailable so
 *    the provider retries instead of stranding an orphan "pending" row
 *    (billing-webhook-enqueue-silent-drop)
 * 4. Insert event record with status "pending" (idempotent via DB unique
 *    constraint; concurrent inserts collapse to one -- webhook-idempotency-race)
 * 5. Enqueue NormalizedEvent to BullMQ (return 200 fast)
 *
 * Security (T-03-04, T-03-05, T-03-08, T-10-02):
 * - Signature verification via provider SDK
 * - Dedup at DB and BullMQ jobId level
 * - No auth/tenant middleware on webhook route
 */

// Lazy queue initialization -- avoids requiring Redis in test environments
let webhookQueue: Queue | null = null;

function getWebhookQueue(): Queue | null {
  if (!webhookQueue && env.REDIS_URL) {
    webhookQueue = new Queue("billing-process-webhook", {
      connection: { url: env.REDIS_URL },
    });
  }
  return webhookQueue;
}

/**
 * Enqueue a normalized webhook for async processing. The jobId equals the
 * provider event id, so BullMQ dedups concurrent/duplicate enqueues of the
 * same event (T-03-05) -- making the insert->enqueue handoff safe to retry.
 */
async function enqueueWebhook(queue: Queue, normalizedEvent: NormalizedEvent): Promise<void> {
  await queue.add(
    "process-webhook",
    {
      eventId: normalizedEvent.providerEventId,
      normalizedEvent,
    },
    { jobId: normalizedEvent.providerEventId }, // BullMQ-level dedup via jobId (T-03-05)
  );
}

/**
 * Postgres unique-violation (SQLSTATE 23505). A concurrent delivery of the
 * same providerEventId can win the race between our onConflictDoNothing and
 * commit; treat that as already-received rather than a 500.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

/**
 * PUBLIC billing webhook plugin -- mounted before tenantMiddleware (C4).
 */
export const billingWebhookRoutes = new Elysia({ prefix: "/api/billing" }).post(
  "/webhooks",
  async (ctx) => {
    const provider = getPaymentProvider();

    // Read signature from provider-specific headers
    const sig =
      ctx.request.headers.get("stripe-signature") ||
      ctx.request.headers.get("x-pagarme-signature") ||
      ctx.request.headers.get("x-hub-signature") ||
      "";

    if (!sig) {
      return new Response("Missing webhook signature header", { status: 400 });
    }

    // CRITICAL: Use raw body text for signature verification (Pitfall 1)
    // Elysia may auto-parse JSON bodies, so clone the request to get raw text
    const rawBody = await ctx.request.clone().text();

    let rawEvent: Awaited<ReturnType<typeof provider.verifyWebhookSignature>>;
    try {
      rawEvent = await provider.verifyWebhookSignature({ rawBody, signature: sig });
    } catch (err) {
      return new Response("Webhook signature verification failed", {
        status: 400,
      });
    }

    const normalizedEvent = provider.normalizeEvent(rawEvent);

    // Fail loudly BEFORE mutating state (billing-webhook-enqueue-silent-drop):
    // if no queue is configured we cannot process the event, so do NOT insert
    // an orphan "pending" row. Return 503 so the provider retries later.
    const queue = getWebhookQueue();
    if (!queue) {
      return new Response("Webhook processing queue unavailable", {
        status: 503,
      });
    }

    // Idempotency check (D-11, T-03-05, T-10-03)
    // Race-safe dedup: the DB unique constraint is the arbiter, not an
    // application-level check-then-act. Insert with status "pending"
    // (T-03-06: audit trail) and short-circuit on conflict.
    const db = getDb(env.DATABASE_URL);
    let inserted: { id: string }[];
    try {
      inserted = await db
        .insert(webhookEvents)
        .values({
          providerEventId: normalizedEvent.providerEventId,
          eventType: normalizedEvent.type,
          status: "pending",
          payload: JSON.stringify(normalizedEvent.raw),
        })
        .onConflictDoNothing({ target: webhookEvents.providerEventId })
        .returning({ id: webhookEvents.id });
    } catch (err) {
      // Concurrent delivery inserted the same providerEventId first
      // (webhook-idempotency-race / billing-webhook-toctou-insert). The peer
      // is responsible for enqueueing it -- ack as already-received.
      if (isUniqueViolation(err)) {
        return { received: true };
      }
      throw err;
    }

    if (inserted.length === 0) {
      // Duplicate delivery already recorded. If the prior attempt is still
      // "pending" it may have crashed between insert and enqueue, so re-enqueue
      // (idempotent via jobId). Only short-circuit on a terminal status.
      const [existing] = await db
        .select({ status: webhookEvents.status })
        .from(webhookEvents)
        .where(eq(webhookEvents.providerEventId, normalizedEvent.providerEventId))
        .limit(1);

      if (existing?.status === "pending") {
        await enqueueWebhook(queue, normalizedEvent);
      }

      return { received: true };
    }

    // Enqueue for async processing (D-10, Pitfall 5 -- return 200 fast)
    await enqueueWebhook(queue, normalizedEvent);

    return { received: true };
  },
);

/**
 * Tenant-scoped billing routes -- mounted AFTER auth + tenant middleware.
 */
export const billingRoutes = new Elysia({ prefix: "/api/billing" })
  // --- Billing HTTP routes (tenant-scoped, requires auth + tenant middleware) ---
  .post(
    "/checkout",
    async (ctx: any) => {
      const result = await createCheckoutSession(ctx.body, ctx.handlerCtx);
      if (!result.success) {
        ctx.set.status = 400;
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    },
    {
      body: t.Object({
        priceId: t.String(),
        successUrl: t.String(),
        cancelUrl: t.String(),
      }),
    },
  )
  .post("/cancel", async (ctx: any) => {
    const result = await cancelSubscription({}, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true };
  })
  .post(
    "/change",
    async (ctx: any) => {
      const result = await changeSubscription(ctx.body, ctx.handlerCtx);
      if (!result.success) {
        ctx.set.status = 400;
        return { success: false, error: result.error };
      }
      return { success: true };
    },
    {
      body: t.Object({
        newPriceId: t.String(),
      }),
    },
  )
  .post(
    "/one-time",
    async (ctx: any) => {
      const result = await createOneTimePayment(ctx.body, ctx.handlerCtx);
      if (!result.success) {
        ctx.set.status = 400;
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    },
    {
      body: t.Object({
        priceId: t.String(),
        quantity: t.Optional(t.Number({ minimum: 1 })),
        successUrl: t.String(),
        cancelUrl: t.String(),
      }),
    },
  )
  .post(
    "/portal",
    async (ctx: any) => {
      const result = await createPortalSession(ctx.body, ctx.handlerCtx);
      if (!result.success) {
        ctx.set.status = 400;
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    },
    {
      body: t.Object({
        returnUrl: t.String(),
      }),
    },
  )
  .post(
    "/usage",
    async (ctx: any) => {
      const result = await recordUsage(
        { metric: ctx.body.featureKey, quantity: ctx.body.quantity },
        ctx.handlerCtx,
      );
      if (!result.success) {
        ctx.set.status = 400;
        return { success: false, error: result.error };
      }
      return { success: true };
    },
    {
      body: t.Object({
        featureKey: t.String(),
        quantity: t.Number({ minimum: 1 }),
      }),
    },
  )
  .get("/subscription", async (ctx: any) => {
    const result = await getSubscriptionStatus({}, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  })
  .get("/history", async (ctx: any) => {
    // WR-03: `offset` is not supported by getBillingHistory / getInvoices.
    // Do not accept it from the query string until pagination is wired through
    // to the PaymentProvider interface -- otherwise callers silently get
    // page 1 every time and assume pagination is working.
    const limit = Number(ctx.query?.limit) || 20;
    const result = await getBillingHistory({ limit }, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  });
