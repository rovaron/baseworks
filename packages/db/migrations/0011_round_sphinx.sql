CREATE TABLE "notification_webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(36) NOT NULL,
	"webhook_id" text NOT NULL,
	"event_type" text NOT NULL,
	"category" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"http_status" text,
	"attempts" text DEFAULT '0' NOT NULL,
	"last_error" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_webhook_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_webhook" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "notification_webhook" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
UPDATE "notification_webhook" SET "status" = CASE WHEN "enabled" THEN 'active' ELSE 'disabled' END;--> statement-breakpoint
ALTER TABLE "notification_webhook" ADD COLUMN "consecutive_failures" text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_webhook" ADD COLUMN "last_delivery_at" timestamp;--> statement-breakpoint
ALTER TABLE "notification_webhook" ADD COLUMN "last_status" text;--> statement-breakpoint
ALTER TABLE "notification_webhook" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
CREATE INDEX "notification_webhook_delivery_lookup_idx" ON "notification_webhook_delivery" USING btree ("tenant_id","webhook_id","created_at");--> statement-breakpoint
ALTER TABLE "notification_webhook" DROP COLUMN "enabled";--> statement-breakpoint
CREATE POLICY "notification_webhook_delivery_tenant_isolation" ON "notification_webhook_delivery" AS PERMISSIVE FOR ALL TO "baseworks_rls" USING ("notification_webhook_delivery"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("notification_webhook_delivery"."tenant_id" = current_setting('app.tenant_id', true));