import type { DbInstance } from "../connection";

/**
 * Returns the raw Drizzle instance for admin/system operations
 * that need cross-tenant access. Audit trail recommended.
 *
 * @warning No automatic tenant filtering. Use only for admin operations,
 * system migrations, or cross-tenant reporting.
 */
export function unscopedDb(db: DbInstance): DbInstance {
  return db;
}
