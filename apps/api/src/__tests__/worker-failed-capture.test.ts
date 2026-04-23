/**
 * Unit test for the worker.on('failed') capture path (Phase 18 / D-04).
 *
 * Rather than boot a real BullMQ worker (requires Redis), this test
 * replicates the EXACT callback body from apps/api/src/worker.ts line 70
 * and asserts the resulting tracker.captureException call shape. If
 * worker.ts is refactored, this test's inline callback must be updated
 * in lockstep — the grep-verifiable shape in plan 18-06 Task 2 acceptance
 * criteria is the contract.
 *
 * Also guards the D-04 discipline: the inner try/catch at lines ~58-65
 * of apps/api/src/worker.ts MUST remain log-only (no captureException)
 * — worker.on('failed') is the single capture site to avoid
 * double-reporting.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setErrorTracker, resetErrorTracker } from "@baseworks/observability";
import type {
  ErrorTracker,
  CaptureScope,
  ErrorTrackerScope,
} from "@baseworks/observability";
import { logger } from "../lib/logger";

/** Mirror of the worker.on('failed') body — kept in lockstep with worker.ts. */
function onFailed(
  job: { id?: string } | undefined,
  err: Error,
  jobDef: { queue: string },
  jobName: string,
  tracker: ErrorTracker,
): void {
  logger.error(
    { job: job?.id, queue: jobDef.queue, err: String(err) },
    "Job failed",
  );
  tracker.captureException(err, {
    tags: { queue: jobDef.queue },
    extra: { jobId: job?.id, jobName },
  });
}

function makeRecordingTracker() {
  const calls: Array<{ err: unknown; scope?: CaptureScope }> = [];
  const tracker: ErrorTracker = {
    name: "recording",
    captureException: (err, scope) => {
      calls.push({ err, scope });
    },
    captureMessage: () => {},
    addBreadcrumb: () => {},
    withScope: <T>(fn: (s: ErrorTrackerScope) => T) =>
      fn({
        setUser: () => {},
        setTag: () => {},
        setExtra: () => {},
        setTenant: () => {},
      }),
    flush: async () => true,
  };
  return { tracker, calls };
}

describe("worker.on('failed') — D-04 capture shape", () => {
  let rec: ReturnType<typeof makeRecordingTracker>;

  beforeEach(() => {
    rec = makeRecordingTracker();
    setErrorTracker(rec.tracker);
  });

  afterEach(() => {
    resetErrorTracker();
  });

  test("captureException called once with queue tag + jobId/jobName extras", () => {
    const err = new Error("boom");
    onFailed(
      { id: "job-1" },
      err,
      { queue: "test-queue" },
      "handleProcessFollowup",
      rec.tracker,
    );
    expect(rec.calls.length).toBe(1);
    expect(rec.calls[0].err).toBe(err);
    expect(rec.calls[0].scope?.tags).toEqual({ queue: "test-queue" });
    expect(rec.calls[0].scope?.extra).toEqual({
      jobId: "job-1",
      jobName: "handleProcessFollowup",
    });
  });

  test("job undefined → jobId undefined in extras (no throw)", () => {
    const err = new Error("connection reset");
    onFailed(undefined, err, { queue: "q" }, "name", rec.tracker);
    expect(rec.calls.length).toBe(1);
    expect(rec.calls[0].scope?.extra).toEqual({
      jobId: undefined,
      jobName: "name",
    });
  });

  test("inner try/catch staying log-only is a CONTRACT (grep guard)", async () => {
    // This test enforces the D-04 discipline: the INNER try/catch inside the
    // createWorker handler (around lines 58-65) of apps/api/src/worker.ts
    // MUST NOT call tracker.captureException — the worker.on('failed') is
    // the single capture site. If the file is refactored to double-capture,
    // plan 18-06 Task 2 acceptance grep will catch it; this test records
    // the intent.
    const src = await Bun.file("apps/api/src/worker.ts").text();
    const lines = src.split("\n");
    // Find the inner try/catch region — starts at "try {" line inside
    // createWorker handler, ends at matching "}" after the log+throw block.
    const tryIdx = lines.findIndex((ln) => ln.includes('jobLog.info("Job started")'));
    expect(tryIdx).toBeGreaterThan(0);
    // Window: the 15 lines starting from jobLog.info cover the try/catch
    // block (try { ... const result = await jobDef.handler ... catch (err)
    // { jobLog.error ...; throw err; }).
    const innerRegion = lines.slice(tryIdx, tryIdx + 15).join("\n");
    expect(innerRegion).not.toContain("getErrorTracker()");
    expect(innerRegion).not.toContain("captureException");
  });
});
