import { uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export function primaryKeyColumn() {
  return uuid("id").primaryKey().defaultRandom();
}

export function tenantIdColumn() {
  return varchar("tenant_id", { length: 36 }).notNull();
}

export function timestampColumns() {
  return {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  };
}
