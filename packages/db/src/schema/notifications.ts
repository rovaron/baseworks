// packages/db/src/schema/notifications.ts
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { primaryKeyColumn, tenantIdColumn, timestampColumns } from "./base";
import { tenantRlsPolicy } from "./rls";

/** Canonical record + in-app feed item. */
export const notification = pgTable(
  "notification",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    recipientUserId: text("recipient_user_id").notNull(),
    type: text("type").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(), // info | success | warning | error
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url"),
    data: jsonb("data"),
    actions: jsonb("actions"),
    groupKey: text("group_key"),
    readAt: timestamp("read_at"),
    ...timestampColumns(),
  },
  (t) => [
    index("notification_tenant_recipient_idx").on(t.tenantId, t.recipientUserId),
    index("notification_group_key_idx").on(t.tenantId, t.groupKey),
    tenantRlsPolicy("notification_tenant_isolation", t.tenantId),
  ],
);

/** Per-channel delivery audit. */
export const notificationDelivery = pgTable(
  "notification_delivery",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    notificationId: text("notification_id").notNull(),
    channel: text("channel").notNull(), // in-app | email | webhook
    status: text("status").notNull(), // pending | sent | failed | skipped
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attempts: text("attempts").notNull().default("0"),
    ...timestampColumns(),
  },
  (t) => [
    index("notification_delivery_notification_idx").on(t.tenantId, t.notificationId),
    tenantRlsPolicy("notification_delivery_tenant_isolation", t.tenantId),
  ],
);

/** Per-user opt-out; absence = catalog default. */
export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    userId: text("user_id").notNull(),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    ...timestampColumns(),
  },
  (t) => [
    uniqueIndex("notification_preference_uq").on(t.tenantId, t.userId, t.category, t.channel),
    tenantRlsPolicy("notification_preference_tenant_isolation", t.tenantId),
  ],
);

/** Tenant outbound webhook endpoints. */
export const notificationWebhook = pgTable(
  "notification_webhook",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    categories: jsonb("categories"),
    description: text("description"),
    // active | disabled (tenant) | auto_disabled (system, after repeated failures)
    status: text("status").notNull().default("active"),
    consecutiveFailures: text("consecutive_failures").notNull().default("0"),
    lastDeliveryAt: timestamp("last_delivery_at"),
    lastStatus: text("last_status"), // success | failed
    disabledReason: text("disabled_reason"),
    ...timestampColumns(),
  },
  (t) => [tenantRlsPolicy("notification_webhook_tenant_isolation", t.tenantId)],
);

/** Per (event, endpoint) delivery audit — updated in place across retries. */
export const notificationWebhookDelivery = pgTable(
  "notification_webhook_delivery",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    webhookId: text("webhook_id").notNull(),
    eventType: text("event_type").notNull(),
    category: text("category").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull(), // pending | success | failed | skipped
    httpStatus: text("http_status"),
    attempts: text("attempts").notNull().default("0"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at"),
    ...timestampColumns(),
  },
  (t) => [
    index("notification_webhook_delivery_lookup_idx").on(t.tenantId, t.webhookId, t.createdAt),
    tenantRlsPolicy("notification_webhook_delivery_tenant_isolation", t.tenantId),
  ],
);

/** Idempotency + audit for `once` dispatch actions. */
export const notificationActionExecution = pgTable(
  "notification_action_execution",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    notificationId: text("notification_id").notNull(),
    actionId: text("action_id").notNull(),
    executedBy: text("executed_by").notNull(),
    result: jsonb("result"),
    executedAt: timestamp("executed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_action_execution_uq").on(t.notificationId, t.actionId),
    tenantRlsPolicy("notification_action_execution_tenant_isolation", t.tenantId),
  ],
);
