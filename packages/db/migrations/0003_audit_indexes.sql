CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_org_id_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_inviter_id_idx" ON "invitation" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "member_org_id_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_active_org_id_idx" ON "session" USING btree ("active_organization_id");--> statement-breakpoint
CREATE INDEX "billing_customers_tenant_id_idx" ON "billing_customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "usage_records_tenant_metric_idx" ON "usage_records" USING btree ("tenant_id","metric");--> statement-breakpoint
CREATE INDEX "usage_records_synced_idx" ON "usage_records" USING btree ("synced_to_provider");