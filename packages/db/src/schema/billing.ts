import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { primaryKeyColumn, tenantIdColumn, timestampColumns } from "./base";

/**
 * Billing module tables.
 *
 * Per D-02: billing_customers links tenants to payment provider customers.
 * Per D-07: webhook_events stores provider webhook events for idempotency and audit.
 * Per D-11: usage_records tracks metered usage for provider billing.
 *
 * The `lastEventAt` column in billing_customers supports event ordering
 * protection (Pitfall 3): only update billing_customers if the incoming
 * webhook event's `created` timestamp is newer than `lastEventAt`.
 *
 * Column names are provider-agnostic (providerCustomerId, providerSubscriptionId, etc.)
 * to support multiple payment providers (Stripe, Pagar.me, etc.).
 */

export const billingCustomers = pgTable("billing_customers", {
  id: primaryKeyColumn(),
  tenantId: tenantIdColumn(),
  providerCustomerId: text("provider_customer_id").notNull().unique(),
  providerSubscriptionId: text("provider_subscription_id"),
  providerPriceId: text("provider_price_id"),
  status: text("status").notNull().default("inactive"),
  currentPeriodEnd: timestamp("current_period_end"),
  lastEventAt: timestamp("last_event_at"),
  ...timestampColumns(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: primaryKeyColumn(),
  providerEventId: text("provider_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("pending"),
  payload: text("payload"),
  processedAt: timestamp("processed_at"),
  ...timestampColumns(),
});

export const usageRecords = pgTable("usage_records", {
  id: primaryKeyColumn(),
  tenantId: tenantIdColumn(),
  metric: text("metric").notNull(),
  quantity: integer("quantity").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  syncedToProvider: boolean("synced_to_provider").notNull().default(false),
  providerUsageRecordId: text("provider_usage_record_id"),
});
