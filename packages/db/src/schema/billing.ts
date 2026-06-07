import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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

export const billingCustomers = pgTable(
  "billing_customers",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    providerCustomerId: text("provider_customer_id").notNull().unique(),
    providerSubscriptionId: text("provider_subscription_id"),
    providerPriceId: text("provider_price_id"),
    status: text("status").notNull().default("inactive"),
    currentPeriodEnd: timestamp("current_period_end"),
    lastEventAt: timestamp("last_event_at"),
    ...timestampColumns(),
  },
  (t) => [index("billing_customers_tenant_id_idx").on(t.tenantId)],
);

export const webhookEvents = pgTable("webhook_events", {
  id: primaryKeyColumn(),
  providerEventId: text("provider_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("pending"),
  payload: text("payload"),
  processedAt: timestamp("processed_at"),
  ...timestampColumns(),
});

export const usageRecords = pgTable(
  "usage_records",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    metric: text("metric").notNull(),
    quantity: integer("quantity").notNull(),
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
    syncedToProvider: boolean("synced_to_provider").notNull().default(false),
    providerUsageRecordId: text("provider_usage_record_id"),
  },
  (t) => [
    index("usage_records_tenant_metric_idx").on(t.tenantId, t.metric),
    // Sync-usage job scans by syncedToProvider every 5 minutes. A partial
    // index WHERE synced_to_provider = false would keep this smaller, but the
    // Drizzle 0.45 builder cannot express partial-index WHERE clauses
    // (same limitation noted at storage.ts:67-69); add it in the migration
    // SQL if needed. The plain index fully resolves the finding.
    index("usage_records_synced_idx").on(t.syncedToProvider),
  ],
);
