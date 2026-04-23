import { Queue, Worker } from "bullmq";
import type { Processor } from "bullmq";
import { getRedisConnection } from "./connection";
import type { WorkerConfig } from "./types";
import { obsContext, type ObservabilityContext } from "@baseworks/observability";
import { defaultLocale } from "@baseworks/i18n";

/**
 * Create a BullMQ Queue with sensible defaults.
 *
 * Defaults:
 * - removeOnComplete: 3 days (259200 seconds)
 * - removeOnFail: 7 days (604800 seconds)
 * - attempts: 3 with exponential backoff starting at 1000ms
 */
export function createQueue(name: string, redisUrl: string): Queue {
  const connection = getRedisConnection(redisUrl);

  return new Queue(name, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 259200 },
      removeOnFail: { age: 604800 },
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
    },
  });
}

/**
 * Wrap a BullMQ Processor so each invocation runs inside a seeded
 * ObservabilityContext ALS frame (Phase 19 / D-05).
 *
 * Seed composition per job:
 * - `requestId` — prefers `job.data._requestId` (propagated by enqueue in
 *   Phase 20) so job logs correlate with the originating HTTP request; falls
 *   back to a fresh `crypto.randomUUID()` when absent.
 * - `traceId` / `spanId` — fresh per job (32-char / 16-char hex-like slices).
 *   Phase 21 OtelTracer will replace these with span-provided IDs; Phase 19
 *   NoopTracer consumes them as-is for log correlation.
 * - `locale` — `defaultLocale` from `@baseworks/i18n`. Jobs don't inherit a
 *   per-user locale today; future work can call `setLocale(...)` inside the
 *   handler once session/tenant lookup lands.
 * - `tenantId` / `userId` — null at seed time; enriched downstream when a
 *   job handler looks up tenant/user from job.data (mirrors the HTTP
 *   tenantMiddleware pattern in Plan 06).
 *
 * Exported for Phase 19 unit testing — callers SHOULD route through
 * `createWorker`; direct use is only for tests that need to poke a processor
 * without constructing a real Worker + Redis connection.
 *
 * @internal
 */
export function wrapProcessorWithAls(processor: Processor): Processor {
  return (job, token) => {
    const jobCtx: ObservabilityContext = {
      requestId: (job.data as any)?._requestId ?? crypto.randomUUID(),
      traceId: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
      spanId: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      locale: defaultLocale,
      tenantId: null,
      userId: null,
    };
    return obsContext.run(jobCtx, () => processor(job, token));
  };
}

/**
 * Create a BullMQ Worker with inline processor (no worker threads).
 *
 * Worker threads (sandboxed processors) are NOT used because they are
 * broken on Bun runtime. All processors run inline in the main thread.
 *
 * Default concurrency: 5
 *
 * Phase 19 D-05 — each processor call runs inside a seeded ObservabilityContext
 * ALS frame so pino log lines, CQRS dispatches, and event publications inside
 * the job handler automatically carry requestId / traceId / tenantId. Seed is
 * derived from `job.data._requestId` (propagated by enqueue in Phase 20) plus
 * a fresh traceId/spanId. Public signature UNCHANGED — every existing caller
 * continues to work without modification.
 */
export function createWorker(
  name: string,
  processor: Processor,
  redisUrl: string,
  opts?: WorkerConfig,
): Worker {
  const connection = getRedisConnection(redisUrl);

  return new Worker(name, wrapProcessorWithAls(processor), {
    connection,
    concurrency: opts?.concurrency ?? 5,
  });
}

export { getRedisConnection, closeConnection } from "./connection";
export type { QueueConfig, WorkerConfig, EmailJobData } from "./types";
