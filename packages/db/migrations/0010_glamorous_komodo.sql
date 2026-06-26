CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(36) NOT NULL,
	"recipient_user_id" text NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"data" jsonb,
	"actions" jsonb,
	"group_key" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_action_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(36) NOT NULL,
	"notification_id" text NOT NULL,
	"action_id" text NOT NULL,
	"executed_by" text NOT NULL,
	"result" jsonb,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_action_execution" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(36) NOT NULL,
	"notification_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"attempts" text DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(36) NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(36) NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"categories" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_webhook" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "notification_tenant_recipient_idx" ON "notification" USING btree ("tenant_id","recipient_user_id");--> statement-breakpoint
CREATE INDEX "notification_group_key_idx" ON "notification" USING btree ("tenant_id","group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_action_execution_uq" ON "notification_action_execution" USING btree ("notification_id","action_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_notification_idx" ON "notification_delivery" USING btree ("tenant_id","notification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_uq" ON "notification_preference" USING btree ("tenant_id","user_id","category","channel");--> statement-breakpoint
CREATE POLICY "notification_tenant_isolation" ON "notification" AS PERMISSIVE FOR ALL TO "baseworks_rls" USING ("notification"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("notification"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "notification_action_execution_tenant_isolation" ON "notification_action_execution" AS PERMISSIVE FOR ALL TO "baseworks_rls" USING ("notification_action_execution"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("notification_action_execution"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "notification_delivery_tenant_isolation" ON "notification_delivery" AS PERMISSIVE FOR ALL TO "baseworks_rls" USING ("notification_delivery"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("notification_delivery"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "notification_preference_tenant_isolation" ON "notification_preference" AS PERMISSIVE FOR ALL TO "baseworks_rls" USING ("notification_preference"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("notification_preference"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "notification_webhook_tenant_isolation" ON "notification_webhook" AS PERMISSIVE FOR ALL TO "baseworks_rls" USING ("notification_webhook"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("notification_webhook"."tenant_id" = current_setting('app.tenant_id', true));