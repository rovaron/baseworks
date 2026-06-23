/**
 * Phase 31 / OPS-02 — cleanup-reap-orphan-files (DAILY) — CONSERVATIVE backstop.
 *
 * Sweeps files whose owner record is DEFINITIVELY gone (a lost/dropped
 * `onDelete:"cascade"` event). It MUST NEVER delete a file whose owner still
 * exists and MUST SKIP whenever owner-existence cannot be proven gone.
 *
 * Safety (see lib/owner-resolution.ts + 31-PLAN-CONTRACT §3 decision table) —
 * every branch is SKIP except one:
 *   - no relation found / `ownerExists` not declared / resolver throws or returns
 *     `"unknown"` / resolver returns `true` (owner alive) ⇒ SKIP.
 *   - file `created_at` within the 24h grace window (owner row may still be
 *     committing) ⇒ SKIP.
 *   - already tombstoned (handled by the scan predicate `deleted_at IS NULL`).
 *   - REAP only when `ownerExists` returns a definitive `false` AND the file is
 *     live AND older than the grace window.
 *
 * The reaper SOFT-deletes (reversible) via the shared `softDeleteRow()` so quota
 * refund logic (byte_size + variant bytes) stays in exactly one place; the weekly
 * `cleanup-reap-soft-deleted` hard-deletes later. Best-effort `storage.delete()`
 * + `file.deleted` emit happen AFTER the tx commits. Existence checks are
 * memoized per owner within a run.
 *
 * Operates on the RAW drizzle instance (getDb) — allow-listed direct files
 * access; the candidate scan + per-row FOR UPDATE carry explicit predicates.
 */

import { env } from "@baseworks/config";
import { getDb } from "@baseworks/db";
import { getFileStorage } from "@baseworks/storage";
import { sql } from "drizzle-orm";
import { emitCleanupEvent } from "../lib/cleanup-events";
import { withJobRun } from "../lib/job-runs";
import { createOwnerResolver } from "../lib/owner-resolution";
import { type SoftDeleteCaptured, type SoftDeleteRow, softDeleteRow } from "../lib/soft-delete";

/** Grace window: a file younger than this is never reaped (owner may still be committing). */
const GRACE_HOURS = 24;
/** Bound per-run memory; the daily cadence drains a backlog over consecutive runs. */
const SCAN_LIMIT = 5000;

interface CandidateRow {
  id: string;
  tenant_id: string;
  owner_module: string;
  owner_record_type: string;
  owner_record_id: string;
}

export async function reapOrphanFiles(_data: unknown): Promise<void> {
  const db = getDb(env.DATABASE_URL);
  await withJobRun(db, "cleanup-reap-orphan-files", async () => {
    const resolver = createOwnerResolver();
    const storage = getFileStorage();

    // Candidate scan: live, ATTACHED files older than the grace window.
    // Tombstoned and too-young rows are excluded here so the safety check below is
    // the only remaining gate before a definitive-false reap.
    //
    // `owner_record_id <> ''` is LOAD-BEARING (Phase 31 data-safety fix): the
    // column is NOT NULL with a '' sentinel set at sign-upload and only replaced
    // with a real id by attach. The orphan reaper is the cascade-backstop for
    // ATTACHED files whose owner once resolved and is now definitively gone — it
    // must NOT touch never-attached uploads. Without this filter an unattached row
    // dispatches `ownerExists('')` → e.g. `SELECT 1 FROM "user" WHERE id = '' ` →
    // zero rows → a definitive `false` → an erroneous REAP of a legitimately
    // uploaded-but-not-yet-attached file (and, for a pending unattached row, a
    // permanent bytes_pending leak since softDeleteRow refunds only bytes_used and
    // reconcile never touches bytes_pending). Attached rows are never 'pending'.
    const candidates = (await db.execute(sql`
      SELECT id, tenant_id, owner_module, owner_record_type, owner_record_id
        FROM files
       WHERE deleted_at IS NULL
         AND owner_record_id <> ''
         AND created_at < now() - make_interval(hours => ${GRACE_HOURS})
       ORDER BY created_at ASC
       LIMIT ${SCAN_LIMIT}
    `)) as unknown as CandidateRow[];

    let swept = 0;
    for (const candidate of candidates) {
      const existence = await resolver.resolve({
        ownerModule: candidate.owner_module,
        recordType: candidate.owner_record_type,
        tenantId: candidate.tenant_id,
        recordId: candidate.owner_record_id,
      });
      // REAP only on a definitive false; true / "unknown" ⇒ SKIP.
      if (existence !== false) continue;

      let captured: SoftDeleteCaptured | null = null;
      await db.transaction(async (tx) => {
        // Re-read FOR UPDATE inside the tx (serializes against a concurrent
        // delete; skips a row tombstoned between scan and now).
        const rows = (await tx.execute(sql`
          SELECT id, bucket, storage_key, owner_module, owner_record_type,
                 owner_record_id, byte_size, status, transforms
            FROM files
           WHERE id = ${candidate.id}
             AND tenant_id = ${candidate.tenant_id}
             AND deleted_at IS NULL
           FOR UPDATE
        `)) as unknown as SoftDeleteRow[];
        if (rows.length === 0) return;
        captured = await softDeleteRow(tx, candidate.tenant_id, rows[0]);
      });

      if (!captured) continue;
      swept++;

      // Post-commit best-effort physical delete + lifecycle emit.
      const done: SoftDeleteCaptured = captured;
      try {
        await storage.delete({ bucket: done.bucket, key: done.key });
      } catch {
        // The weekly reap-soft-deleted will retry the object delete.
      }
      emitCleanupEvent("file.deleted", {
        fileId: done.fileId,
        tenantId: candidate.tenant_id,
        ownerModule: done.ownerModule,
        ownerRecordType: done.ownerRecordType,
        ownerRecordId: done.ownerRecordId,
        byteSize: done.byteSize,
        reason: "orphan-reap",
      });
    }

    return { itemsSwept: swept };
  });
}
