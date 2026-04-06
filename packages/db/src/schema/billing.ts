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
 * Per D-02: billing_customers links tenants to Stripe customers.
 * Per D-07: webhook_events stores Stripe webhook events for idempotency and audit.
 * Per D-11: usage_records tracks metered usage for Stripe billing.
 *
 * The `lastEventAt` column in billing_customers supports event ordering
 * protection (Pitfall 3): only update billing_customers if the incoming
 * webhook event's `created` timestamp is newer than `lastEventAt`.
 */

export const billingCustomers = pgTable("billing_customers", {
  id: primaryKeyColumn(),
  tenantId: tenantIdColumn(),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  status: text("status").notNull().default("inactive"),
  currentPeriodEnd: timestamp("current_period_end"),
  lastEventAt: timestamp("last_event_at"),
  ...timestampColumns(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: primaryKeyColumn(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
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
  syncedToStripe: boolean("synced_to_stripe").notNull().default(false),
  stripeUsageRecordId: text("stripe_usage_record_id"),
});
