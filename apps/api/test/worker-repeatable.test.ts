// Phase 31 / OPS-02 — repeatable-schedule registration mechanism.
//
// The worker boot loop (apps/api/src/worker.ts), for every def.jobs entry with a
// `repeat`, registers the schedule on the SAME queue via
// `queue.upsertJobScheduler(jobName, { pattern }, { name: jobName, data: {} })`
// — idempotent by schedulerId (=== jobName) so redeploys never duplicate it. This
// test asserts (a) the files module declares the four locked cron schedules and
// (b) replaying the worker's registration step against a mock Queue produces the
// exact upsertJobScheduler call shape for each repeat job, and SKIPS consumer-only
// jobs (image-transform has no repeat).

// Side-effect import seeds env vars BEFORE the @baseworks/config barrel evaluates.
import "./_env-setup";

import { describe, expect, test } from "bun:test";
import type { ModuleDefinition } from "@baseworks/shared";

const filesModule = (await import("@baseworks/module-files")).default as ModuleDefinition;

/** The four locked schedules (31-PLAN-CONTRACT §0 D-31-02), staggered. */
const EXPECTED_SCHEDULES: Record<string, string> = {
  "cleanup:reap-pending-uploads": "0 * * * *",
  "quota:reconcile-tenant-usage": "0 2 * * *",
  "cleanup:reap-orphan-files": "30 3 * * *",
  "cleanup:reap-soft-deleted": "0 4 * * 0",
};

interface SchedulerCall {
  schedulerId: string;
  pattern: string;
  optName: string;
  data: unknown;
}

/** Mirror of the worker.ts scheduler step (see worker.ts job loop). */
function simulateWorkerScheduling(def: ModuleDefinition): SchedulerCall[] {
  const calls: SchedulerCall[] = [];
  const makeMockQueue = () => ({
    upsertJobScheduler(
      schedulerId: string,
      repeat: { pattern: string },
      opts: { name: string; data: unknown },
    ) {
      calls.push({
        schedulerId,
        pattern: repeat.pattern,
        optName: opts.name,
        data: opts.data,
      });
      return Promise.resolve();
    },
  });

  for (const [jobName, jobDef] of Object.entries(def.jobs ?? {})) {
    if (!jobDef.repeat) continue; // consumer-only job ⇒ no schedule
    const queue = makeMockQueue();
    void queue.upsertJobScheduler(
      jobName,
      { pattern: jobDef.repeat.pattern },
      { name: jobName, data: {} },
    );
  }
  return calls;
}

describe("worker repeatable scheduling (Phase 31 / OPS-02)", () => {
  test("files module declares the four locked cron schedules", () => {
    const jobs = filesModule.jobs ?? {};
    for (const [name, pattern] of Object.entries(EXPECTED_SCHEDULES)) {
      expect(jobs[name]).toBeDefined();
      expect(jobs[name]?.queue).toBe(name); // def.jobs key === queue === SC identifier
      expect(jobs[name]?.repeat?.pattern).toBe(pattern);
    }
  });

  test("image-transform stays consumer-only (no repeat)", () => {
    expect(filesModule.jobs?.["files:transform-image"]?.repeat).toBeUndefined();
  });

  test("registration step calls upsertJobScheduler(jobName,{pattern},{name,data}) for each repeat job only", () => {
    const calls = simulateWorkerScheduling(filesModule);
    // Exactly the 4 repeat jobs are scheduled (transform-image excluded).
    expect(calls.length).toBe(Object.keys(EXPECTED_SCHEDULES).length);
    for (const call of calls) {
      // schedulerId === jobName (idempotency key) === opts.name.
      expect(call.schedulerId).toBe(call.optName);
      expect(EXPECTED_SCHEDULES[call.schedulerId]).toBe(call.pattern);
      expect(call.data).toEqual({});
    }
  });
});
