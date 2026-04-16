import type {
  RawProviderEvent,
  NormalizedEvent,
  NormalizedEventType,
} from "../../ports/types";

/**
 * Pagar.me event type to NormalizedEventType mapping.
 *
 * Maps the 5 Pagar.me webhook events that the billing module processes
 * into provider-agnostic NormalizedEvent types (PAY-04).
 */
const PAGARME_EVENT_MAP: Record<string, NormalizedEventType> = {
  "subscription.created": "subscription.created",
  "subscription.canceled": "subscription.cancelled",
  "charge.paid": "payment.succeeded",
  "charge.payment_failed": "payment.failed",
  "order.paid": "checkout.completed",
};

/**
 * Map a raw Pagar.me webhook event to a NormalizedEvent.
 *
 * Extracts provider-agnostic fields from Pagar.me's event
 * structure. Pagar.me nests resource data differently from
 * Stripe:
 * - Customer ID is on data.customer.id
 * - Subscription ID is on data.subscription.id or data.id
 * - Plan ID is on data.plan.id
 * - Amounts are in centavos (BRL integer)
 *
 * @param rawEvent - Verified raw Pagar.me event from
 *   verifyWebhookSignature
 * @returns Normalized billing domain event
 * @throws Error if the Pagar.me event type is not in the
 *   mapping table
 */
export function mapPagarmeEvent(rawEvent: RawProviderEvent): NormalizedEvent {
  const normalizedType = PAGARME_EVENT_MAP[rawEvent.type];
  if (!normalizedType) {
    throw new Error(`Unhandled Pagar.me event type: ${rawEvent.type}`);
  }

  const data = rawEvent.data as any;

  return {
    type: normalizedType,
    providerEventId: rawEvent.id,
    providerCustomerId: data?.customer?.id ?? "",
    data: {
      subscriptionId: data?.subscription?.id ?? data?.id,
      priceId: data?.plan?.id,
      status: data?.status,
      currentPeriodEnd: data?.current_period_end
        ? new Date(data.current_period_end)
        : undefined,
      amount: data?.amount ?? data?.last_transaction?.amount,
      currency: data?.currency ?? "BRL",
    },
    occurredAt: new Date(),
    raw: rawEvent,
  };
}
