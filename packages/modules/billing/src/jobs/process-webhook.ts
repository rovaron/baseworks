import { env } from "@baseworks/config";
import {
  createDb,
  billingCustomers,
  webhookEvents,
} from "@baseworks/db";
import { eq, and, sql } from "drizzle-orm";

/**
 * Webhook event processing job handler.
 *
 * Per D-12: Processes 6 Stripe event types:
 * - checkout.session.completed
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 * - invoice.payment_succeeded
 * - invoice.payment_failed
 *
 * Per Pitfall 3 (T-03-09): Uses lastEventAt column to protect against
 * out-of-order webhook delivery. Only updates billing_customers if the
 * event timestamp is newer than the stored lastEventAt.
 */

interface WebhookJobData {
  eventId: string;
  type: string;
}

export async function processWebhook(data: unknown): Promise<void> {
  const { eventId, type } = data as WebhookJobData;
  const db = createDb(env.DATABASE_URL);

  // Load the event from webhook_events table
  const [event] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.stripeEventId, eventId))
    .limit(1);

  if (!event) {
    throw new Error(`Webhook event not found: ${eventId}`);
  }

  if (event.status === "processed") {
    return; // Already processed (extra safety)
  }

  try {
    const payload = event.payload ? JSON.parse(event.payload) : null;
    const object = payload?.object;

    switch (type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(db, object);
        break;

      case "customer.subscription.created":
        await handleSubscriptionCreated(db, object, event.createdAt);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(db, object, event.createdAt);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(db, object, event.createdAt);
        break;

      case "invoice.payment_succeeded":
        console.log(
          `[BILLING] Payment succeeded for customer ${object?.customer}`,
        );
        break;

      case "invoice.payment_failed":
        console.log(
          `[BILLING] Payment failed for customer ${object?.customer}`,
        );
        break;

      default:
        console.log(`[BILLING] Unhandled webhook event type: ${type}`);
    }

    // Mark event as processed (T-03-06: audit trail)
    await db
      .update(webhookEvents)
      .set({
        status: "processed",
        processedAt: new Date(),
      })
      .where(eq(webhookEvents.stripeEventId, eventId));
  } catch (err) {
    // Mark event as failed -- BullMQ will retry the job
    await db
      .update(webhookEvents)
      .set({ status: "failed" })
      .where(eq(webhookEvents.stripeEventId, eventId));

    throw err; // Re-throw so BullMQ knows to retry
  }
}

/**
 * checkout.session.completed: Update billing_customers with subscription info.
 */
async function handleCheckoutCompleted(db: any, object: any): Promise<void> {
  if (!object?.customer || !object?.subscription) return;

  const stripeCustomerId = object.customer as string;
  const stripeSubscriptionId = object.subscription as string;

  await db
    .update(billingCustomers)
    .set({
      stripeSubscriptionId,
      status: "active",
      lastEventAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(billingCustomers.stripeCustomerId, stripeCustomerId));
}

/**
 * customer.subscription.created: Create/update billing_customers record.
 */
async function handleSubscriptionCreated(
  db: any,
  object: any,
  eventTime: Date,
): Promise<void> {
  if (!object?.customer) return;

  const stripeCustomerId = object.customer as string;
  const now = new Date();

  await db
    .update(billingCustomers)
    .set({
      stripeSubscriptionId: object.id,
      stripePriceId: object.items?.data?.[0]?.price?.id ?? null,
      status: object.status ?? "active",
      currentPeriodEnd: object.current_period_end
        ? new Date(object.current_period_end * 1000)
        : null,
      lastEventAt: eventTime,
      updatedAt: now,
    })
    .where(eq(billingCustomers.stripeCustomerId, stripeCustomerId));
}

/**
 * customer.subscription.updated: Update billing_customers if event is newer.
 *
 * Per Pitfall 3 (T-03-09): Only update if event timestamp > lastEventAt
 * to protect against out-of-order webhook delivery.
 */
async function handleSubscriptionUpdated(
  db: any,
  object: any,
  eventTime: Date,
): Promise<void> {
  if (!object?.customer) return;

  const stripeCustomerId = object.customer as string;

  // Only update if this event is newer than the last processed event
  const [existing] = await db
    .select({ lastEventAt: billingCustomers.lastEventAt })
    .from(billingCustomers)
    .where(eq(billingCustomers.stripeCustomerId, stripeCustomerId))
    .limit(1);

  if (existing?.lastEventAt && eventTime <= existing.lastEventAt) {
    console.log(
      `[BILLING] Skipping stale subscription.updated for ${stripeCustomerId} (event: ${eventTime.toISOString()}, lastEventAt: ${existing.lastEventAt.toISOString()})`,
    );
    return;
  }

  await db
    .update(billingCustomers)
    .set({
      stripeSubscriptionId: object.id,
      stripePriceId: object.items?.data?.[0]?.price?.id ?? null,
      status: object.status ?? "active",
      currentPeriodEnd: object.current_period_end
        ? new Date(object.current_period_end * 1000)
        : null,
      lastEventAt: eventTime,
      updatedAt: new Date(),
    })
    .where(eq(billingCustomers.stripeCustomerId, stripeCustomerId));
}

/**
 * customer.subscription.deleted: Mark subscription as canceled.
 */
async function handleSubscriptionDeleted(
  db: any,
  object: any,
  eventTime: Date,
): Promise<void> {
  if (!object?.customer) return;

  const stripeCustomerId = object.customer as string;

  await db
    .update(billingCustomers)
    .set({
      status: "canceled",
      lastEventAt: eventTime,
      updatedAt: new Date(),
    })
    .where(eq(billingCustomers.stripeCustomerId, stripeCustomerId));
}
