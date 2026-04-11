import type {
  RawProviderEvent,
  NormalizedEvent,
  NormalizedEventType,
} from "../../ports/types";

/**
 * Stripe event type to NormalizedEventType mapping.
 *
 * Maps the 6 Stripe webhook events that the billing module processes
 * into provider-agnostic NormalizedEvent types (PAY-03).
 */
const STRIPE_EVENT_MAP: Record<string, NormalizedEventType> = {
  "checkout.session.completed": "checkout.completed",
  "customer.subscription.created": "subscription.created",
  "customer.subscription.updated": "subscription.updated",
  "customer.subscription.deleted": "subscription.cancelled",
  "invoice.payment_succeeded": "payment.succeeded",
  "invoice.payment_failed": "payment.failed",
};

/**
 * Map a raw Stripe webhook event to a NormalizedEvent.
 *
 * Extracts provider-agnostic fields from Stripe's event structure:
 * - event.data.object contains the Stripe resource (subscription, invoice, etc.)
 * - Customer ID is always on object.customer
 * - Subscription fields vary by event type but follow consistent patterns
 *
 * @throws Error if the Stripe event type is not in the mapping table
 */
export function mapStripeEvent(rawEvent: RawProviderEvent): NormalizedEvent {
  const normalizedType = STRIPE_EVENT_MAP[rawEvent.type];
  if (!normalizedType) {
    throw new Error(`Unhandled Stripe event type: ${rawEvent.type}`);
  }

  const object = (rawEvent.data as any)?.object ?? rawEvent.data;

  return {
    type: normalizedType,
    providerEventId: rawEvent.id,
    providerCustomerId: (object?.customer as string) ?? "",
    data: {
      subscriptionId: object?.id ?? object?.subscription,
      priceId: object?.items?.data?.[0]?.price?.id,
      status: object?.status,
      currentPeriodEnd: object?.current_period_end
        ? new Date(object.current_period_end * 1000)
        : undefined,
      amount: object?.amount_due ?? object?.amount,
      currency: object?.currency,
    },
    occurredAt: new Date(),
    raw: rawEvent,
  };
}
