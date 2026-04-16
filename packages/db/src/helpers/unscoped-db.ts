import type { DbInstance } from "../connection";

/**
 * Return the raw Drizzle instance for admin/system operations
 * that need cross-tenant access.
 *
 * @param db - Raw Drizzle database instance to pass through
 * @returns The same DbInstance, unscoped
 *
 * @warning No automatic tenant filtering. Use only for admin operations,
 * system migrations, or cross-tenant reporting. Audit trail recommended.
 */
export function unscopedDb(db: DbInstance): DbInstance {
  return db;
}
