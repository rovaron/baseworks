/**
 * Phase 31 / OPS-02 — cleanup:reap-pending-uploads (HOURLY).
 *
 * Delete never-completed uploads and release their reserved pending bytes. A
 * `pending` row older than 1 hour represents a sign-upload whose client never
 * called complete — its bytes are still held in `bytes_pending` and its (maybe
 * absent) storage object is dangling.
 *
 * Race-safety (the load-bearing argument): the candidate selection and removal
 * happen in ONE `DELETE ... WHERE status='pending' ... RETURNING` statement, then
 * pending bytes are released for EXACTLY the returned rows. A row that completed
 * between any scan and the delete has flipped to `uploaded` and will NOT match —
 * no double-release, no deletion of a live upload. Idempotent: a re-run after a
 * partial failure finds fewer/zero rows.
 *
 * Durability (Phase 31 data-safety fix): the DELETE and the bytes_pending release
 * are committed TOGETHER in a SINGLE statement via a data-modifying CTE — the
 * `deleted` CTE removes the rows, the `released` CTE debits each tenant's
 * bytes_pending by the SUM of its deleted rows, and the final SELECT returns the
 * removed coordinates. Previously the DELETE auto-committed and per-row
 * releaseQuota() calls ran afterwards in separate auto-commit statements, so a
 * crash/SIGTERM between them left the rows gone but their reserved bytes_pending
 * leaked FOREVER (reconcile-tenant-usage deliberately rebuilds only bytes_used and
 * never touches bytes_pending — there is no recovery path). Folding both into one
 * statement closes that gap: row removal and counter release are now atomic.
 * `released` is a data-modifying CTE, so Postgres always executes it exactly once
 * even though the final SELECT does not reference it.
 *
 * Operates on the RAW drizzle instance (getDb) — the files module is allow-listed
 * for direct `files` / `tenant_storage_usage` access; the DELETE carries an
 * explicit status + age predicate. Object deletes are best-effort (a missing
 * object is a no-op in every adapter) and run AFTER the atomic statement commits
 * (objects are sweepable on a later run; counters are not).
 */

import { env } from "@baseworks/config";
import { getDb } from "@baseworks/db";
import { getFileStorage } from "@baseworks/storage";
import { sql } from "drizzle-orm";
import { withJobRun } from "../lib/job-runs";

interface ReapedPendingRow {
  tenant_id: string;
  byte_size: string | number;
  bucket: string;
  storage_key: string;
}

export async function reapPendingUploads(_data: unknown): Promise<void> {
  const db = getDb(env.DATABASE_URL);
  await withJobRun(db, "cleanup:reap-pending-uploads", async () => {
    // Single atomic statement: remove the stale pending rows AND release their
    // reserved bytes_pending together, then return the removed coordinates for a
    // post-commit best-effort object delete. GREATEST guards pending underflow.
    const rows = (await db.execute(sql`
      WITH deleted AS (
        DELETE FROM files
         WHERE status = 'pending'
           AND deleted_at IS NULL
           AND created_at < now() - interval '1 hour'
        RETURNING tenant_id, byte_size, bucket, storage_key
      ),
      released AS (
        UPDATE tenant_storage_usage u
           SET bytes_pending = GREATEST(u.bytes_pending - d.sz, 0),
               updated_at    = now()
          FROM (
            SELECT tenant_id, SUM(byte_size) AS sz
              FROM deleted
             GROUP BY tenant_id
          ) d
         WHERE u.tenant_id = d.tenant_id
      )
      SELECT tenant_id, byte_size, bucket, storage_key FROM deleted
    `)) as unknown as ReapedPendingRow[];

    // Best-effort physical deletes happen AFTER the atomic DB commit (a missing
    // object → no-op; a leftover object is swept on the next run).
    const storage = getFileStorage();
    for (const row of rows) {
      try {
        await storage.delete({ bucket: row.bucket, key: row.storage_key });
      } catch {
        // The DB row is already gone; a leftover object is swept on the next run.
      }
    }

    return { itemsSwept: rows.length };
  });
}
