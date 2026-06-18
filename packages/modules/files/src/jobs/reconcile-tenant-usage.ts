/**
 * Phase 31 / OPS-02, QUO-03 — quota:reconcile-tenant-usage (DAILY).
 *
 * Rebuild `tenant_storage_usage.bytes_used` from the authoritative SUM over live
 * counted files (drift correction). CRITICAL: this uses the EXACT counting model
 * the increment/refund paths use, so it corrects drift WITHOUT introducing any:
 *
 *   bytes_used(T) = Σ over files f
 *                   WHERE f.tenant_id = T
 *                     AND f.deleted_at IS NULL
 *                     AND f.status IN ('uploaded','ready','transforming')   -- COUNTED_STATUSES
 *                   of ( f.byte_size + Σ (t.byteSize) for t in f.transforms )
 *
 * (markUploaded adds authoritativeSize; addUsed adds sumTransformBytes; the
 * delete/cascade refund debits byte_size + sumTransformBytes — see lib/quota.ts,
 * lib/soft-delete.ts, lib/cascade.ts.) `'pending'` is excluded (those bytes live
 * in `bytes_pending`); `'failed'`/`'deleted'` excluded.
 *
 * A single set-based UPDATE reconciles EVERY usage row (incl. now-empty tenants →
 * 0) and NEVER touches `bytes_pending` (locked). A CTE snapshots pre/post per
 * tenant so the job-run detail reports `driftCorrectedBytes` = Σ|old−new|.
 *
 * Operates on the RAW drizzle instance (getDb) — allow-listed direct files /
 * tenant_storage_usage access.
 */

import { env } from "@baseworks/config";
import { getDb } from "@baseworks/db";
import { sql } from "drizzle-orm";
import { withJobRun } from "../lib/job-runs";

interface ReconcileResult {
  drift: string | number;
  rows_corrected: string | number;
}

export async function reconcileTenantUsage(_data: unknown): Promise<void> {
  const db = getDb(env.DATABASE_URL);
  await withJobRun(db, "quota:reconcile-tenant-usage", async () => {
    const result = (await db.execute(sql`
      WITH recomputed AS (
        SELECT
          u.tenant_id,
          u.bytes_used AS old_used,
          COALESCE((
            SELECT SUM(
                     f.byte_size
                     + COALESCE((SELECT SUM((t->>'byteSize')::bigint)
                                   FROM jsonb_array_elements(f.transforms) t), 0)
                   )
              FROM files f
             WHERE f.tenant_id = u.tenant_id
               AND f.deleted_at IS NULL
               AND f.status IN ('uploaded', 'ready', 'transforming')
          ), 0) AS new_used
        FROM tenant_storage_usage u
      ),
      updated AS (
        UPDATE tenant_storage_usage u
           SET bytes_used = r.new_used,
               updated_at = now()
          FROM recomputed r
         WHERE u.tenant_id = r.tenant_id
           AND u.bytes_used <> r.new_used
        RETURNING r.old_used, r.new_used
      )
      SELECT
        COALESCE(SUM(ABS(old_used - new_used)), 0) AS drift,
        COUNT(*) AS rows_corrected
      FROM updated
    `)) as unknown as ReconcileResult[];

    const driftCorrectedBytes = Number(result[0]?.drift ?? 0);
    const rowsCorrected = Number(result[0]?.rows_corrected ?? 0);

    return {
      itemsSwept: rowsCorrected,
      detail: { driftCorrectedBytes },
    };
  });
}
