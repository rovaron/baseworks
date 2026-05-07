import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
    // CHECK constraint enforced in migration SQL (Drizzle 0.45 lacks ergonomic check() in builder).
    status: text("status").notNull().default("pending"),
    // text — references better-auth user.id (which is text, not uuid).
    uploadedByUserId: text("uploaded_by_user_id"),
    // D-04 — soft-delete column (Phase 27 consumer).
    deletedAt: timestamp("deleted_at"),
    ...timestampColumns(),
  },
  (t) => [
    // Cross-tenant uniqueness guarantee: same bucket+key cannot be claimed
    // by two tenants. Tenant prefix is informational, not authoritative
    // (UPL-03 / Pitfall 1).
    uniqueIndex("files_tenant_bucket_key_uq").on(t.tenantId, t.bucket, t.storageKey),
    // Owner-lookup index for `list-files-for-record` query (Phase 27 / ATT-01).
    index("files_owner_idx").on(t.tenantId, t.ownerModule, t.ownerRecordType, t.ownerRecordId),
    // Pending-cleanup index for hourly reap job (Phase 31 cleanup-pending).
    // D-04 — partial index on live rows; tombstones excluded so the index
    // stays small as soft-delete tombstones accumulate.
    // CONSTRAINT: partial-index WHERE clause cannot be expressed in the
    // Drizzle table builder (0.45) — added directly in the migration SQL.
    index("files_pending_status_idx").on(t.status, t.createdAt),
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
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
