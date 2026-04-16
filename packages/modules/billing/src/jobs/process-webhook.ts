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

/**
 * Process a normalized webhook event from the BullMQ queue.
 *
 * Dispatches to type-specific sub-handlers that update the
 * billing_customers table. Uses lastEventAt ordering to protect
 * against out-of-order webhook delivery.
 *
 * @param data - Job data containing eventId and normalizedEvent
 * @returns void
 * @throws Re-throws processing errors so BullMQ retries the job
 */
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
    // WR-04: Use the provider-semantic event timestamp (normalizedEvent.occurredAt)
    // rather than the DB row insertion time (event.createdAt). DB insertion time
    // is a local wall-clock time that gets assigned in an uncoordinated order
    // under concurrent webhook ingestion, so it cannot protect against
    // out-of-order replay. The mappers still need to populate occurredAt from
    // the provider's own event timestamp (see IN-02) for this to be fully robust.
    const eventTime = normalizedEvent.occurredAt ?? event.createdAt;

    switch (normalizedEvent.type) {
      case "checkout.completed":
        await handleCheckoutCompleted(db, normalizedEvent);
        break;

      case "subscription.created":
        await handleSubscriptionCreated(db, normalizedEvent, eventTime);
        break;

      case "subscription.updated":
        await handleSubscriptionUpdated(db, normalizedEvent, eventTime);
        break;

      case "subscription.cancelled":
        await handleSubscriptionDeleted(db, normalizedEvent, eventTime);
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
 * Handle checkout.completed: link subscription to billing customer.
 *
 * @param db - Database instance
 * @param normalizedEvent - Normalized checkout event
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
 * Handle subscription.created: set subscription details on
 * billing customer.
 *
 * @param db - Database instance
 * @param normalizedEvent - Normalized subscription event
 * @param eventTime - Event timestamp for ordering protection
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
 * Handle subscription.updated: update billing customer if event
 * is newer than the last processed event.
 *
 * Per Pitfall 3 (T-03-09): Only update if event timestamp >
 * lastEventAt to protect against out-of-order webhook delivery.
 *
 * @param db - Database instance
 * @param normalizedEvent - Normalized subscription event
 * @param eventTime - Event timestamp for ordering comparison
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
 * Handle subscription.cancelled: mark billing customer as
 * canceled.
 *
 * @param db - Database instance
 * @param normalizedEvent - Normalized cancellation event
 * @param eventTime - Event timestamp for ordering protection
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
