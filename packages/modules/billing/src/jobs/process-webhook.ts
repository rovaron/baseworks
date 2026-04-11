import { env } from "@baseworks/config";
import {
  createDb,
  billingCustomers,
  webhookEvents,
} from "@baseworks/db";
import { eq } from "drizzle-orm";
import type { NormalizedEvent } from "../ports/types";

/**
 * Webhook event processing job handler.
 *
 * Processes provider-agnostic NormalizedEvent types (PAY-03):
 * - checkout.completed
 * - subscription.created
 * - subscription.updated
 * - subscription.cancelled
 * - payment.succeeded
 * - payment.failed
 *
 * Per Pitfall 3 (T-03-09): Uses lastEventAt column to protect against
 * out-of-order webhook delivery. Only updates billing_customers if the
 * event timestamp is newer than the stored lastEventAt.
 *
 * Per T-10-04: lastEventAt ordering protection preserved.
 */

interface WebhookJobData {
  eventId: string;
  normalizedEvent: NormalizedEvent;
}

export async function processWebhook(data: unknown): Promise<void> {
  const { eventId, normalizedEvent } = data as WebhookJobData;
  const db = createDb(env.DATABASE_URL);

  // Load the event from webhook_events table
  const [event] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.providerEventId, eventId))
    .limit(1);

  if (!event) {
    throw new Error(`Webhook event not found: ${eventId}`);
  }

  if (event.status === "processed") {
    return; // Already processed (extra safety)
  }

  try {
    switch (normalizedEvent.type) {
      case "checkout.completed":
        await handleCheckoutCompleted(db, normalizedEvent);
        break;

      case "subscription.created":
        await handleSubscriptionCreated(db, normalizedEvent, event.createdAt);
        break;

      case "subscription.updated":
        await handleSubscriptionUpdated(db, normalizedEvent, event.createdAt);
        break;

      case "subscription.cancelled":
        await handleSubscriptionDeleted(db, normalizedEvent, event.createdAt);
        break;

      case "payment.succeeded":
        console.log(
          `[BILLING] Payment succeeded for customer ${normalizedEvent.providerCustomerId}`,
        );
        break;

      case "payment.failed":
        console.log(
          `[BILLING] Payment failed for customer ${normalizedEvent.providerCustomerId}`,
        );
        break;
    }

    // Mark event as processed (T-03-06: audit trail)
    await db
      .update(webhookEvents)
      .set({
        status: "processed",
        processedAt: new Date(),
      })
      .where(eq(webhookEvents.providerEventId, eventId));
  } catch (err) {
    // Mark event as failed -- BullMQ will retry the job
    await db
      .update(webhookEvents)
      .set({ status: "failed" })
      .where(eq(webhookEvents.providerEventId, eventId));

    throw err; // Re-throw so BullMQ knows to retry
  }
}

/**
 * checkout.completed: Update billing_customers with subscription info.
 */
async function handleCheckoutCompleted(db: any, normalizedEvent: NormalizedEvent): Promise<void> {
  if (!normalizedEvent.providerCustomerId || !normalizedEvent.data.subscriptionId) return;

  await db
    .update(billingCustomers)
    .set({
      providerSubscriptionId: normalizedEvent.data.subscriptionId,
      status: "active",
      lastEventAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(billingCustomers.providerCustomerId, normalizedEvent.providerCustomerId));
}

/**
 * subscription.created: Create/update billing_customers record.
 */
async function handleSubscriptionCreated(
  db: any,
  normalizedEvent: NormalizedEvent,
  eventTime: Date,
): Promise<void> {
  if (!normalizedEvent.providerCustomerId) return;

  const now = new Date();

  await db
    .update(billingCustomers)
    .set({
      providerSubscriptionId: normalizedEvent.data.subscriptionId ?? null,
      providerPriceId: normalizedEvent.data.priceId ?? null,
      status: normalizedEvent.data.status ?? "active",
      currentPeriodEnd: normalizedEvent.data.currentPeriodEnd ?? null,
      lastEventAt: eventTime,
      updatedAt: now,
    })
    .where(eq(billingCustomers.providerCustomerId, normalizedEvent.providerCustomerId));
}

/**
 * subscription.updated: Update billing_customers if event is newer.
 *
 * Per Pitfall 3 (T-03-09): Only update if event timestamp > lastEventAt
 * to protect against out-of-order webhook delivery.
 */
async function handleSubscriptionUpdated(
  db: any,
  normalizedEvent: NormalizedEvent,
  eventTime: Date,
): Promise<void> {
  if (!normalizedEvent.providerCustomerId) return;

  // Only update if this event is newer than the last processed event
  const [existing] = await db
    .select({ lastEventAt: billingCustomers.lastEventAt })
    .from(billingCustomers)
    .where(eq(billingCustomers.providerCustomerId, normalizedEvent.providerCustomerId))
    .limit(1);

  if (existing?.lastEventAt && eventTime <= existing.lastEventAt) {
    console.log(
      `[BILLING] Skipping stale subscription.updated for ${normalizedEvent.providerCustomerId} (event: ${eventTime.toISOString()}, lastEventAt: ${existing.lastEventAt.toISOString()})`,
    );
    return;
  }

  await db
    .update(billingCustomers)
    .set({
      providerSubscriptionId: normalizedEvent.data.subscriptionId ?? null,
      providerPriceId: normalizedEvent.data.priceId ?? null,
      status: normalizedEvent.data.status ?? "active",
      currentPeriodEnd: normalizedEvent.data.currentPeriodEnd ?? null,
      lastEventAt: eventTime,
      updatedAt: new Date(),
    })
    .where(eq(billingCustomers.providerCustomerId, normalizedEvent.providerCustomerId));
}

/**
 * subscription.cancelled: Mark subscription as canceled.
 */
async function handleSubscriptionDeleted(
  db: any,
  normalizedEvent: NormalizedEvent,
  eventTime: Date,
): Promise<void> {
  if (!normalizedEvent.providerCustomerId) return;

  await db
    .update(billingCustomers)
    .set({
      status: "canceled",
      lastEventAt: eventTime,
      updatedAt: new Date(),
    })
    .where(eq(billingCustomers.providerCustomerId, normalizedEvent.providerCustomerId));
}
