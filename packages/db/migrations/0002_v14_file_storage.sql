CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(36) NOT NULL,
	"owner_module" text NOT NULL,
	"owner_record_type" text NOT NULL,
	"owner_record_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"bucket" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"checksum" text,
	"original_filename" text,
	"transforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"uploaded_by_user_id" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	-- D-01: full lifecycle declared up-front; Phases 26-28 transition into states.
	CONSTRAINT "files_status_check" CHECK ("status" IN ('pending', 'uploaded', 'transforming', 'ready', 'failed', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "tenant_storage_usage" (
	"tenant_id" varchar(36) PRIMARY KEY NOT NULL,
	"bytes_used" bigint DEFAULT 0 NOT NULL,
	"bytes_pending" bigint DEFAULT 0 NOT NULL,
	"bytes_limit" bigint,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "files_tenant_bucket_key_uq" ON "files" ("tenant_id", "bucket", "storage_key");
--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" ("tenant_id", "owner_module", "owner_record_type", "owner_record_id");
--> statement-breakpoint
-- D-04: partial index on live rows for pending-cleanup query in Phase 27.
CREATE INDEX "files_pending_status_idx" ON "files" ("status", "created_at") WHERE "deleted_at" IS NULL;
