/**
 * Example module table.
 *
 * Demonstrates the standard table pattern with tenantIdColumn() for
 * tenant isolation and timestampColumns() for audit. Used as a reference
 * when creating new module schemas.
 */

import { index, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { primaryKeyColumn, tenantIdColumn, timestampColumns } from "./base";

export const examples = pgTable(
  "examples",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    ...timestampColumns(),
  },
  (table) => [index("examples_tenant_id_idx").on(table.tenantId)],
);
