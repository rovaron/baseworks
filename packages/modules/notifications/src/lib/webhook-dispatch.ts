// packages/modules/notifications/src/lib/webhook-dispatch.ts

/** The subset of a notification_webhook row this helper reads. */
export interface WebhookEndpointRow {
  id: string;
  status: string; // active | disabled | auto_disabled
  categories: unknown; // jsonb — expected string[] | null
}

/** The logical event being dispatched (built once per notify() call). */
export interface WebhookEvent {
  tenantId: string;
  eventType: string;
  category: string;
  recipientUserIds: string[];
  data: Record<string, unknown> | null;
  occurredAt: string; // ISO8601
}

/** Insert-shaped delivery row (status pending) for one matching endpoint. */
export interface WebhookDeliveryValues {
  tenantId: string;
  webhookId: string;
  eventType: string;
  category: string;
  payload: Record<string, unknown>;
  status: "pending";
}

function subscribes(categories: unknown, category: string): boolean {
  return Array.isArray(categories) && categories.includes(category);
}

/**
 * Pure eligibility + payload builder: given the tenant's endpoints and the
 * event, return the delivery-row values for each ACTIVE endpoint SUBSCRIBED to
 * the event's category. The same envelope object is embedded as `payload` on
 * every row (it is what gets POSTed + signed).
 */
export function buildWebhookDeliveries(
  endpoints: WebhookEndpointRow[],
  event: WebhookEvent,
): WebhookDeliveryValues[] {
  const envelope = {
    event: event.eventType,
    category: event.category,
    tenantId: event.tenantId,
    recipientUserIds: event.recipientUserIds,
    data: event.data,
    occurredAt: event.occurredAt,
  };
  return endpoints
    .filter((e) => e.status === "active" && subscribes(e.categories, event.category))
    .map((e) => ({
      tenantId: event.tenantId,
      webhookId: e.id,
      eventType: event.eventType,
      category: event.category,
      payload: envelope,
      status: "pending" as const,
    }));
}
