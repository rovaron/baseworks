-- Revert CR-01/WR-01: restore the original per-tenant unique index and the
-- partial index (the CHECK constraint is unchanged in shape, so it is left as-is).
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_status_check";--> statement-breakpoint
DROP INDEX IF EXISTS "files_bucket_key_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "files_pending_status_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "files_tenant_bucket_key_uq" ON "files" ("tenant_id", "bucket", "storage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_pending_status_idx" ON "files" ("status", "created_at") WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_status_check" CHECK ("status" IN ('pending', 'uploaded', 'transforming', 'ready', 'failed', 'deleted'));
