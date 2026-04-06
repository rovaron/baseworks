import { Elysia } from "elysia";
import { getStripe } from "./stripe";
import { env } from "@baseworks/config";
import { createDb, webhookEvents } from "@baseworks/db";
import { eq } from "drizzle-orm";
import { Queue } from "bullmq";

/**
 * Billing routes plugin.
 *
 * Public routes (no auth, no tenant middleware):
 * - POST /api/billing/webhooks -- Stripe webhook endpoint
 *
 * Webhook pipeline (D-10, D-11, D-13):
 * 1. Verify Stripe signature using raw body (Pitfall 1)
 * 2. Check idempotency via webhook_events table (D-11)
 * 3. Insert event record with status "pending"
 * 4. Enqueue to BullMQ for async processing (Pitfall 5: return 200 fast)
 *
 * Security (T-03-04, T-03-05, T-03-08):
 * - Signature verification via stripe.webhooks.constructEvent()
 * - Dedup at DB level (unique stripe_event_id) and queue level (BullMQ jobId)
 * - No auth/tenant middleware on webhook route (external Stripe calls)
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
    const stripe = getStripe();
    const sig = ctx.request.headers.get("stripe-signature");

    if (!sig) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    if (!env.STRIPE_WEBHOOK_SECRET) {
      return new Response("Webhook secret not configured", { status: 500 });
    }

    // CRITICAL: Use raw body text for signature verification (Pitfall 1)
    // Elysia may auto-parse JSON bodies, so clone the request to get raw text
    const rawBody = await ctx.request.clone().text();

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      return new Response("Webhook signature verification failed", {
        status: 400,
      });
    }

    // Idempotency check (D-11, T-03-05)
    const db = createDb(env.DATABASE_URL);
    const existing = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.stripeEventId, event.id))
      .limit(1);

    if (existing.length > 0) {
      return { received: true };
    }

    // Insert event record with status "pending" (T-03-06: audit trail)
    await db.insert(webhookEvents).values({
      stripeEventId: event.id,
      eventType: event.type,
      status: "pending",
      payload: JSON.stringify(event.data),
    });

    // Enqueue for async processing (D-10, Pitfall 5 -- return 200 fast)
    const queue = getWebhookQueue();
    if (queue) {
      await queue.add(
        "process-webhook",
        {
          eventId: event.id,
          type: event.type,
        },
        { jobId: event.id }, // BullMQ-level dedup via jobId (T-03-05)
      );
    }

    return { received: true };
  });
