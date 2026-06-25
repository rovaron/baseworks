// packages/modules/notifications/src/channels/channel.ts

/** Delivery channels. SMS/push added later behind this same union + port. */
export type Channel = "in-app" | "email" | "webhook";

/** Minimal record shape a channel needs to deliver (mirrors the `notification` row). */
export interface DeliverableNotification {
  id: string;
  tenantId: string;
  recipientUserId: string;
  type: string;
  category: string;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string;
  url?: string | null;
  data?: Record<string, unknown> | null;
  actions?: unknown;
}

/** Outcome of a single channel delivery attempt. */
export type DeliveryResult =
  | { status: "sent"; providerMessageId?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/**
 * A delivery channel. Phase 1 defines the port only; adapters land in later
 * phases (in-app inline, email/webhook via the `notifications-deliver` worker).
 */
export interface ChannelAdapter {
  readonly name: Channel;
  deliver(notification: DeliverableNotification, deliveryId: string): Promise<DeliveryResult>;
}
