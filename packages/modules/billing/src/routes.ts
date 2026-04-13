import { Elysia, t } from "elysia";
import { getPaymentProvider } from "./provider-factory";
import { env } from "@baseworks/config";
import { createDb, webhookEvents } from "@baseworks/db";
import { eq } from "drizzle-orm";
import { Queue } from "bullmq";
import { createCheckoutSession } from "./commands/create-checkout-session";
import { cancelSubscription } from "./commands/cancel-subscription";
import { changeSubscription } from "./commands/change-subscription";
import { createOneTimePayment } from "./commands/create-one-time-payment";
import { createPortalSession } from "./commands/create-portal-session";
import { recordUsage } from "./commands/record-usage";
import { getSubscriptionStatus } from "./queries/get-subscription-status";
import { getBillingHistory } from "./queries/get-billing-history";

/**
 * Billing routes plugin.
 *
 * Public routes (no auth, no tenant middleware):
 * - POST /api/billing/webhooks -- Payment provider webhook endpoint
 *
 * Webhook pipeline (D-10, D-11, D-13):
 * 1. Verify signature via provider.verifyWebhookSignature() (T-10-02)
 * 2. Normalize event via provider.normalizeEvent() (PAY-03)
 * 3. Check idempotency via webhook_events table (D-11, T-10-03)
 * 4. Insert event record with status "pending"
 * 5. Enqueue NormalizedEvent to BullMQ for async processing (Pitfall 5: return 200 fast)
 *
 * Security (T-03-04, T-03-05, T-03-08, T-10-02):
 * - Signature verification via provider SDK (never hand-rolled HMAC)
 * - Dedup at DB level (unique providerEventId) and queue level (BullMQ jobId)
 * - No auth/tenant middleware on webhook route (external provider calls)
 */

// Lazy queue initialization -- avoids requiring Redis in test environments
let webhookQueue: Queue | null = null;

function getWebhookQueue(): Queue | null {
  if (!webhookQueue && env.REDIS_URL) {
    webhookQueue = new Queue("billing:process-webhook", {
      connection: { url: env.REDIS_URL },
    });
  }
  return webhookQueue;
}

export const billingRoutes = new Elysia({ prefix: "/api/billing" })
  .post("/webhooks", async (ctx) => {
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

    let rawEvent;
    try {
      rawEvent = await provider.verifyWebhookSignature({ rawBody, signature: sig });
    } catch (err) {
      return new Response("Webhook signature verification failed", {
        status: 400,
      });
    }

    const normalizedEvent = provider.normalizeEvent(rawEvent);

    // Idempotency check (D-11, T-03-05, T-10-03)
    const db = createDb(env.DATABASE_URL);
    const existing = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, normalizedEvent.providerEventId))
      .limit(1);

    if (existing.length > 0) {
      return { received: true };
    }

    // Insert event record with status "pending" (T-03-06: audit trail)
    await db.insert(webhookEvents).values({
      providerEventId: normalizedEvent.providerEventId,
      eventType: normalizedEvent.type,
      status: "pending",
      payload: JSON.stringify(normalizedEvent.raw),
    });

    // Enqueue for async processing (D-10, Pitfall 5 -- return 200 fast)
    const queue = getWebhookQueue();
    if (queue) {
      await queue.add(
        "process-webhook",
        {
          eventId: normalizedEvent.providerEventId,
          normalizedEvent,
        },
        { jobId: normalizedEvent.providerEventId }, // BullMQ-level dedup via jobId (T-03-05)
      );
    }

    return { received: true };
  })
  // --- Billing HTTP routes (tenant-scoped, requires auth + tenant middleware) ---
  .post("/checkout", async (ctx: any) => {
    const result = await createCheckoutSession(ctx.body, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  }, {
    body: t.Object({
      priceId: t.String(),
      successUrl: t.String(),
      cancelUrl: t.String(),
    }),
  })
  .post("/cancel", async (ctx: any) => {
    const result = await cancelSubscription({}, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true };
  })
  .post("/change", async (ctx: any) => {
    const result = await changeSubscription(ctx.body, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true };
  }, {
    body: t.Object({
      newPriceId: t.String(),
    }),
  })
  .post("/one-time", async (ctx: any) => {
    const result = await createOneTimePayment(ctx.body, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  }, {
    body: t.Object({
      priceId: t.String(),
      quantity: t.Optional(t.Number({ minimum: 1 })),
      successUrl: t.String(),
      cancelUrl: t.String(),
    }),
  })
  .post("/portal", async (ctx: any) => {
    const result = await createPortalSession(ctx.body, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  }, {
    body: t.Object({
      returnUrl: t.String(),
    }),
  })
  .post("/usage", async (ctx: any) => {
    const result = await recordUsage(
      { metric: ctx.body.featureKey, quantity: ctx.body.quantity },
      ctx.handlerCtx,
    );
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true };
  }, {
    body: t.Object({
      featureKey: t.String(),
      quantity: t.Number({ minimum: 1 }),
    }),
  })
  .get("/subscription", async (ctx: any) => {
    const result = await getSubscriptionStatus({}, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  })
  .get("/history", async (ctx: any) => {
    const limit = Number(ctx.query?.limit) || 20;
    const offset = Number(ctx.query?.offset) || 0;
    const result = await getBillingHistory({ limit }, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  });
