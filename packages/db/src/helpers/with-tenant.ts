// packages/db/src/helpers/with-tenant.ts
import { sql } from "drizzle-orm";
import type { DbInstance } from "../connection";

/**
 * Run `fn` inside a transaction with `app.tenant_id` set TRANSACTION-LOCALLY
 * (`set_config(..., true)`). RLS policies on tenant tables read this via
 * `current_setting('app.tenant_id', true)`. The local scope is mandatory: the
 * postgres.js pool reuses connections, so a session-level setting would leak
 * into the next tenant's request. `db` MUST be the RLS-role pool (`getRlsDb()`)
 * for the policy to apply — the owner role bypasses RLS.
 */
export async function withTenant<T>(
  db: DbInstance,
  tenantId: string,
  fn: (tx: Parameters<Parameters<DbInstance["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
