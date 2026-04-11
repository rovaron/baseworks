-- Migration: Rename Stripe-specific columns to provider-agnostic names
-- Phase 10 Plan 01: Payment provider abstraction foundation
-- This migration is non-destructive (column rename only, no data loss)

ALTER TABLE "billing_customers" RENAME COLUMN "stripe_customer_id" TO "provider_customer_id";
ALTER TABLE "billing_customers" RENAME COLUMN "stripe_subscription_id" TO "provider_subscription_id";
ALTER TABLE "billing_customers" RENAME COLUMN "stripe_price_id" TO "provider_price_id";
ALTER TABLE "webhook_events" RENAME COLUMN "stripe_event_id" TO "provider_event_id";
ALTER TABLE "usage_records" RENAME COLUMN "synced_to_stripe" TO "synced_to_provider";
ALTER TABLE "usage_records" RENAME COLUMN "stripe_usage_record_id" TO "provider_usage_record_id";
