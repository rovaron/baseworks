/**
 * Phase 31 / OPS-02, OPS-03 — last-run status persistence for the cleanup jobs.
 *
 * The worker (job handlers) and the API (storage health contributor) are
 * SEPARATE processes, so last-run status crosses the boundary via the durable
 * `storage_job_runs` table (NOT in-memory). `withJobRun` wraps a handler body so
 * the run is recorded on BOTH success (`status:'ok'`) and failure
 * (`status:'error'` + sanitized `detail.error`) before rethrowing — the worker's
 * `on("failed")` ErrorTracker path still captures the throw.
 *
 * Operates on the RAW drizzle instance (getDb) via `db.execute(sql)`; the files
 * module is allow-listed for direct storage-table access. `detail` carries small
 * structured context only — NEVER a storage_key, bucket, or secret.
 */

import type { getDb } from "@baseworks/db";
import { sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

/** A persisted job-run row (snake_case projection from storage_job_runs). */
export interface JobRunRow {
  job_name: string;
  last_run_at: string | Date;
  status: "ok" | "error";
  items_swept: number;
  duration_ms: number;
  detail: Record<string, unknown>;
}

export interface RecordJobRunArgs {
  jobName: string;
  status: "ok" | "error";
  itemsSwept: number;
  durationMs: number;
  detail?: Record<string, unknown>;
}

/** Upsert the latest run for `jobName` (one row per job, PK = job_name). */
export async function recordJobRun(db: Db, args: RecordJobRunArgs): Promise<void> {
  const detailJson = JSON.stringify(args.detail ?? {});
  await db.execute(sql`
    INSERT INTO storage_job_runs
      (job_name, last_run_at, status, items_swept, duration_ms, detail, updated_at)
    VALUES
      (${args.jobName}, now(), ${args.status}, ${args.itemsSwept}, ${args.durationMs},
       ${detailJson}::jsonb, now())
    ON CONFLICT (job_name) DO UPDATE SET
      last_run_at = excluded.last_run_at,
      status      = excluded.status,
      items_swept = excluded.items_swept,
      duration_ms = excluded.duration_ms,
      detail      = excluded.detail,
      updated_at  = now()
  `);
}

/** Read every job-run row (small table) for the health contributor. */
export async function readJobRuns(db: Db): Promise<JobRunRow[]> {
  const rows = (await db.execute(sql`
    SELECT job_name, last_run_at, status, items_swept, duration_ms, detail
      FROM storage_job_runs
     ORDER BY job_name
  `)) as unknown as JobRunRow[];
  return rows;
}

/**
 * Run a cleanup-job body, timing it and recording the outcome to
 * `storage_job_runs` whether it succeeds or throws. The body returns the swept
 * count and optional structured detail. On throw, records `status:'error'` with
 * a sanitized message, then rethrows so BullMQ records the attempt.
 */
export async function withJobRun(
  db: Db,
  jobName: string,
  body: () => Promise<{ itemsSwept: number; detail?: Record<string, unknown> }>,
): Promise<void> {
  const start = Date.now();
  try {
    const { itemsSwept, detail } = await body();
    await recordJobRun(db, {
      jobName,
      status: "ok",
      itemsSwept,
      durationMs: Date.now() - start,
      detail: detail ?? {},
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordJobRun(db, {
      jobName,
      status: "error",
      itemsSwept: 0,
      durationMs: Date.now() - start,
      detail: { error: message },
    });
    throw err;
  }
}
