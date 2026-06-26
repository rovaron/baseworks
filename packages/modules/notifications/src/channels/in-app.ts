// packages/modules/notifications/src/channels/in-app.ts
import type { Channel, ChannelAdapter, DeliverableNotification, DeliveryResult } from "./channel";

export interface Publisher {
  publish(channel: string, message: string): unknown;
}

/** Channel key for a user's per-tenant SSE stream. */
export function userChannel(tenantId: string, userId: string): string {
  return `notif:${tenantId}:${userId}`;
}

/**
 * In-app delivery: the `notification` row is already written by notify(); this
 * publishes a lightweight "new notification" signal to the recipient's Redis
 * channel (fanned out to any SSE stream on any instance). Pure publish — the
 * delivery-row status is managed by the caller.
 */
export class InAppAdapter implements ChannelAdapter {
  readonly name: Channel = "in-app";
  constructor(private readonly redis: Publisher) {}
  async deliver(n: DeliverableNotification, _deliveryId: string): Promise<DeliveryResult> {
    this.redis.publish(
      userChannel(n.tenantId, n.recipientUserId),
      JSON.stringify({ type: "notification.created", id: n.id }),
    );
    return { status: "sent" };
  }
}
