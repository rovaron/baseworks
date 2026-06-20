import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { primaryKeyColumn, tenantIdColumn, timestampColumns } from "./base";

/**
 * Storage module tables (Phase 24 / FILE-01).
 *
 * Central `files` table — single source of truth for all file metadata.
 * Modules declare polymorphic relations via ModuleDefinition.fileRelations
 * (D-06..D-09); they NEVER own per-module file tables.
 *
 * Per CONTEXT D-01..D-04, the schema declares ALL Phase 24-28 columns up
 * front to avoid mid-flight enum/column migrations:
 *   - D-01: `status` enum lifecycle (text + CHECK constraint in migration)
 *   - D-02: `tenant_storage_usage.bytes_pending` (consumer Phase 26)
 *   - D-03: `files.transforms` jsonb (consumer Phase 28)
 *   - D-04: `files.deleted_at` + partial index (consumer Phase 27)
 *
 * Foreign-key columns to better-auth tables use `text` (NOT uuid) because
 * `user.id` and `organization.id` are `text("id")` in better-auth schema.
 * `tenant_id` stays varchar(36) via the shared helper.
 */

/** Variant manifest entry — populated by Phase 28 image-transform job. */
export type FileTransform = {
  name: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
};

// biome-ignore format: keep `pgTable("files",` on a single line for grep-based verify
export const files = pgTable("files", {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    ownerModule: text("owner_module").notNull(),
    ownerRecordType: text("owner_record_type").notNull(),
    ownerRecordId: text("owner_record_id").notNull(),
    storageKey: text("storage_key").notNull(),
    bucket: text("bucket").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    checksum: text("checksum"),
    originalFilename: text("original_filename"),
    // D-03 — manifest of generated variants (Phase 28 consumer).
    transforms: jsonb("transforms").$type<FileTransform[]>().notNull().default([]),
    // D-01 — full lifecycle: 'pending' | 'uploaded' | 'transforming' | 'ready' | 'failed' | 'deleted'.
    // CHECK constraint expressed in the builder below via check() (WR-01).
    status: text("status").notNull().default("pending"),
    // text — references better-auth user.id (which is text, not uuid).
    uploadedByUserId: text("uploaded_by_user_id"),
    // D-04 — soft-delete column (Phase 27 consumer).
    deletedAt: timestamp("deleted_at"),
    ...timestampColumns(),
  },
  (t) => [
    // Physical-object exclusivity (global, not per-tenant): a (bucket, storage_key)
    // pair maps to exactly one row across ALL tenants, so no two files can ever
    // point at the same physical object. The tenant prefix in the key is
    // informational, not authoritative (UPL-03 / Pitfall 1); collision resistance
    // comes from the mandatory nanoid(24) segment in buildStorageKey (Phase 26).
    // Tenant READ isolation is provided by ScopedDb + the GritQL files-access ban,
    // NOT by this index (CR-01: tenant_id must NOT be in the key).
    uniqueIndex("files_bucket_key_uq").on(t.bucket, t.storageKey),
    // Owner-lookup index for `list-files-for-record` query (Phase 27 / ATT-01).
    index("files_owner_idx").on(t.tenantId, t.ownerModule, t.ownerRecordType, t.ownerRecordId),
    // Pending-cleanup index for hourly reap job (Phase 31 cleanup-pending).
    // D-04 — partial index on live rows; tombstones excluded so the index
    // stays small as soft-delete tombstones accumulate (WR-01: WHERE clause
    // expressed in the builder, drizzle-orm 0.45 supports index().where()).
    index("files_pending_status_idx")
      .on(t.status, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    // D-01 — status lifecycle CHECK, expressed in the builder so drizzle-kit
    // snapshots stay accurate (WR-01).
    check(
      "files_status_check",
      sql`${t.status} IN ('pending', 'uploaded', 'transforming', 'ready', 'failed', 'deleted')`,
    ),
  ],
);

/**
 * Per-tenant storage usage counter (D-02).
 *
 * `bytes_pending` ships in Phase 24 even though the consumer is Phase 26's
 * race-safe quota UPSERT pattern. One unused column for ~1 phase is cheaper
 * than a Phase 26 column migration.
 *
 * `bytes_limit` is nullable — null means "use STORAGE_DEFAULT_QUOTA_BYTES env
 * default" (D-11). Per-tenant overrides set this column directly.
 */
export const tenantStorageUsage = pgTable("tenant_storage_usage", {
  tenantId: tenantIdColumn().primaryKey(),
  bytesUsed: bigint("bytes_used", { mode: "number" }).notNull().default(0),
  // D-02 — race-safe quota counter (Phase 26 consumer).
  bytesPending: bigint("bytes_pending", { mode: "number" }).notNull().default(0),
  bytesLimit: bigint("bytes_limit", { mode: "number" }),
  // WR-04 — auto-bump on every Drizzle UPDATE (matches timestampColumns()); Phase 26
  // quota UPSERTs that mutate bytes_used/bytes_pending no longer leave this stale.
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/**
 * Phase 31 / OPS-02, OPS-03 — last-run status of the cleanup/reconciliation jobs.
 *
 * The worker process (job handlers) and the API process (storage health
 * contributor) are SEPARATE — last-run status must live in shared, durable
 * storage that survives a Redis flush. One row per job (PK = job_name), upserted
 * by `recordJobRun()` on BOTH success and failure; read by the health
 * contributor's `readJobRuns()` to surface "job runs in /health/detailed".
 *
 * `detail` carries small structured context only (e.g. `{ error?, driftCorrectedBytes? }`)
 * — NEVER a storage_key, bucket, or secret.
 */
export const storageJobRuns = pgTable(
  "storage_job_runs",
  {
    jobName: text("job_name").primaryKey(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    itemsSwept: integer("items_swept").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    detail: jsonb("detail").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("storage_job_runs_status_check", sql`${t.status} IN ('ok', 'error')`)],
);
