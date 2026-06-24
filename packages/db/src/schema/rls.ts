// packages/db/src/schema/rls.ts
import { sql } from "drizzle-orm";
import { type AnyPgColumn, pgPolicy, pgRole } from "drizzle-orm/pg-core";

/**
 * The non-owner, RLS-enforced login role. `.existing()` tells drizzle-kit the
 * role is provisioned out-of-band (scripts/db-setup-rls-role.sql) — do NOT emit
 * CREATE ROLE in migrations (roles are cluster-level + carry secrets).
 */
export const rlsRole = pgRole("baseworks_rls").existing();

/**
 * The shared per-tenant isolation policy. Applies ONLY to `baseworks_rls`; the
 * table owner (baseworks) bypasses RLS since we never FORCE it. `current_setting
 * (..., true)` is NULL when unset → fail-closed (zero rows). WITH CHECK blocks
 * writing a row stamped for a different tenant.
 *
 * Pass the table's tenant_id column so the policy text is unambiguous.
 */
export function tenantRlsPolicy(name: string, tenantIdCol: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: rlsRole,
    using: sql`${tenantIdCol} = current_setting('app.tenant_id', true)`,
    withCheck: sql`${tenantIdCol} = current_setting('app.tenant_id', true)`,
  });
}
