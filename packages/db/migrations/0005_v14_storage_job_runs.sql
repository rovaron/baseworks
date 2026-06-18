CREATE TABLE "storage_job_runs" (
	"job_name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"items_swept" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_job_runs_status_check" CHECK ("storage_job_runs"."status" IN ('ok', 'error'))
);
