-- CR-01: drop the per-tenant unique index (tenant_id, bucket, storage_key) and
-- replace it with a GLOBAL (bucket, storage_key) unique index so no two files
-- across ANY tenant can claim the same physical object.
-- WR-01: re-assert the partial-index WHERE clause and the status CHECK so the
-- live DB matches the (now accurate) drizzle snapshot.
-- Guards (IF EXISTS / DROP CONSTRAINT IF EXISTS) make this safe to apply on both
-- a fresh fork (0002 already created the check + partial index) and the existing
-- already-migrated dev DB.
DROP INDEX IF EXISTS "files_tenant_bucket_key_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "files_pending_status_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "files_bucket_key_uq" ON "files" USING btree ("bucket","storage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_pending_status_idx" ON "files" USING btree ("status","created_at") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_status_check";--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_status_check" CHECK ("files"."status" IN ('pending', 'uploaded', 'transforming', 'ready', 'failed', 'deleted'));
