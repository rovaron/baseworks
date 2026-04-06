import { eq } from "drizzle-orm";
import type { DbInstance } from "../connection";

/**
 * Tenant-scoped Drizzle query wrapper.
 * Auto-applies tenant_id filtering on all operations, making cross-tenant
 * data access structurally impossible through normal module code.
 */
export interface ScopedDb {
  /** SELECT with automatic WHERE tenant_id = tenantId */
  select(table: any): any;
  /** INSERT with automatic tenantId injection */
  insert(table: any): {
    values: (data: Record<string, any> | Record<string, any>[]) => any;
  };
  /** UPDATE with automatic WHERE tenant_id = tenantId */
  update(table: any): {
    set: (data: Record<string, any>) => any;
  };
  /** DELETE with automatic WHERE tenant_id = tenantId */
  delete(table: any): any;
  /** The current tenant ID */
  tenantId: string;
  /**
   * The underlying Drizzle instance for complex queries.
   * @warning Use with caution -- no automatic tenant filtering.
   */
  raw: DbInstance;
}

/**
 * Creates a tenant-scoped database wrapper that auto-applies tenant_id
 * filtering on all select/insert/update/delete operations.
 */
export function scopedDb(db: DbInstance, tenantId: string): ScopedDb {
  return {
    select(table: any) {
      return db.select().from(table).where(eq(table.tenantId, tenantId)) as any;
    },

    insert(table: any) {
      return {
        values(data: Record<string, any> | Record<string, any>[]) {
          const inject = (row: Record<string, any>) => ({ ...row, tenantId });
          const injected = Array.isArray(data) ? data.map(inject) : inject(data);
          return db.insert(table).values(injected as any).returning() as any;
        },
      };
    },

    update(table: any) {
      return {
        set(data: Record<string, any>) {
          return db.update(table).set(data as any).where(eq(table.tenantId, tenantId)) as any;
        },
      };
    },

    delete(table: any) {
      return db.delete(table).where(eq(table.tenantId, tenantId)) as any;
    },

    tenantId,

    raw: db,
  };
}
