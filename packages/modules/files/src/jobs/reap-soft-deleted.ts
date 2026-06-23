/**
 * Phase 31 / OPS-02 — cleanup-reap-soft-deleted (WEEKLY).
 *
 * Hard-delete tombstones past the retention window. A soft-deleted row
 * (`deleted_at IS NOT NULL`, status `'deleted'`) had its counted bytes refunded
 * at soft-delete time (lib/soft-delete.ts / lib/cascade.ts), so this job MUST NOT
 * touch the usage counters — refunding again would corrupt `bytes_used`.
 *
 * Per row: best-effort `storage.delete()` for the primary object AND for EVERY
 * `transforms[].storageKey` (variant objects leak forever otherwise), then
 * hard-`DELETE` the DB row. Idempotent (a re-run finds fewer/zero rows).
 *
 * Operates on the RAW drizzle instance (getDb) — allow-listed direct files
 * access; the DELETE carries an explicit deleted_at age predicate.
 */

import { env } from "@baseworks/config";
import { type FileTransform, getDb } from "@baseworks/db";
import { getFileStorage } from "@baseworks/storage";
import { sql } from "drizzle-orm";
import { withJobRun } from "../lib/job-runs";

interface ReapedTombstoneRow {
  bucket: string;
  storage_key: string;
  transforms: FileTransform[] | null;
}

export async function reapSoftDeleted(_data: unknown): Promise<void> {
  const db = getDb(env.DATABASE_URL);
  const retentionDays = env.STORAGE_SOFT_DELETE_RETENTION_DAYS;

  await withJobRun(db, "cleanup-reap-soft-deleted", async () => {
    // Hard-delete tombstones older than the retention window; capture the
    // physical coordinates (incl. variant keys) for best-effort object cleanup.
    const rows = (await db.execute(sql`
      DELETE FROM files
       WHERE deleted_at IS NOT NULL
         AND deleted_at < now() - make_interval(days => ${retentionDays})
      RETURNING bucket, storage_key, transforms
    `)) as unknown as ReapedTombstoneRow[];

    const storage = getFileStorage();
    for (const row of rows) {
      // Primary object.
      try {
        await storage.delete({ bucket: row.bucket, key: row.storage_key });
      } catch {
        // Best-effort; a leftover object is harmless (the DB row is gone).
      }
      // Variant objects — leak forever if not deleted alongside the original.
      for (const variant of row.transforms ?? []) {
        if (!variant?.storageKey) continue;
        try {
          await storage.delete({ bucket: row.bucket, key: variant.storageKey });
        } catch {
          // Best-effort.
        }
      }
    }

    // NOTE: usage counters are intentionally NOT touched — bytes were already
    // refunded at soft-delete time.
    return { itemsSwept: rows.length };
  });
}
