import { uuid, varchar, timestamp } from "drizzle-orm/pg-core";

/**
 * Return a UUID primary key column definition using `defaultRandom()`.
 *
 * Applied to all Baseworks tables for consistent ID generation.
 * Uses PostgreSQL's `gen_random_uuid()` to generate UUIDs server-side.
 *
 * @returns Drizzle column builder configured as a random UUID primary key
 */
export function primaryKeyColumn() {
  return uuid("id").primaryKey().defaultRandom();
}

/**
 * Return a non-nullable tenant ID column for row-level tenant isolation.
 *
 * Applied to all tenant-scoped tables. The value references the
 * organization ID from better-auth's organization table. The ScopedDb
 * wrapper auto-filters on this column.
 *
 * @returns Drizzle column builder for a 36-char varchar `tenant_id` column
 */
export function tenantIdColumn() {
  return varchar("tenant_id", { length: 36 }).notNull();
}

/**
 * Return `createdAt` and `updatedAt` timestamp column definitions
 * with automatic `defaultNow()` values.
 *
 * Applied to all tables for audit trails. Both columns default to the
 * current timestamp at insert time. `updatedAt` should be updated by
 * application code on modifications.
 *
 * @returns Object with `createdAt` and `updatedAt` Drizzle column builders
 */
export function timestampColumns() {
  return {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  };
}
