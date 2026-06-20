import { defaultLocale } from "@baseworks/i18n";
import { type ObservabilityContext, obsContext, wrapQueue } from "@baseworks/observability";
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import {
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_MESSAGE_ID,
  ATTR_MESSAGING_OPERATION,
  ATTR_MESSAGING_SYSTEM,
} from "@opentelemetry/semantic-conventions/incubating";
import type { Processor } from "bullmq";
import { Queue, Worker } from "bullmq";
import { getRedisConnection } from "./connection";
import type { QueueConfig, WorkerConfig } from "./types";

const CONSUMER_TRACER_NAME = "baseworks.queue";

/**
 * Baseline per-queue job retention/retry policy. Retention is bounded by BOTH
 * `age` (time) and `count` (cardinality) so the completed/failed sorted sets
 * cannot grow unbounded under high throughput — whichever ceiling is hit first
 * triggers eviction (`queue-removeon-no-count-cap`).
 *
 * - removeOnComplete: 3 days OR last 1000 jobs
 * - removeOnFail: 7 days OR last 5000 jobs
 * - attempts: 3 with exponential backoff starting at 1000ms
 */
const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 259200, count: 1000 },
  removeOnFail: { age: 604800, count: 5000 },
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
} as const;

/**
 * Create a BullMQ Queue with sensible defaults and Phase 20 producer-side
 * trace propagation (CTX-04 / D-02). The returned Queue auto-injects:
 *  - `_otel: { traceparent, tracestate? }` (W3C carrier from the active span)
 *  - flat `_requestId`, `_tenantId`, `_userId` from the active obsContext frame
 * into job.data for every .add / .addBulk call. Zero call-site edits required.
 *
 * D-09: when no obsContext frame is active, .add/.addBulk pass through unmodified.
 *
 * Defaults (see DEFAULT_JOB_OPTIONS):
 * - removeOnComplete: 3 days (259200s) OR last 1000 jobs
 * - removeOnFail: 7 days (604800s) OR last 5000 jobs
 * - attempts: 3 with exponential backoff starting at 1000ms
 *
 * Per-queue overrides (`queue-config-not-customizable`): pass an optional
 * `config.defaultJobOptions` and it is merged field-by-field over the defaults,
 * so overriding a single key (e.g. `removeOnComplete.age`) preserves the rest
 * of the baseline policy — including the `count` retention ceilings.
 */
export function createQueue(name: string, redisUrl: string, config?: QueueConfig): Queue {
  const connection = getRedisConnection(redisUrl);

  const override = config?.defaultJobOptions;
  const q = new Queue(name, {
    connection,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      ...override,
      removeOnComplete: {
        ...DEFAULT_JOB_OPTIONS.removeOnComplete,
        ...override?.removeOnComplete,
      },
      removeOnFail: {
        ...DEFAULT_JOB_OPTIONS.removeOnFail,
        ...override?.removeOnFail,
      },
      backoff: {
        ...DEFAULT_JOB_OPTIONS.backoff,
        ...override?.backoff,
      },
    },
  });

  // Phase 20 D-02: wrap immediately so the four queue.add call sites in
  // auth/billing/example/observability inherit instrumentation transparently.
  return wrapQueue(q);
}

/**
 * Wrap a BullMQ Processor so each invocation runs inside a seeded
 * ObservabilityContext ALS frame, with optional inheritance of producer trace
 * context from `job.data._otel` (Phase 19 D-05 + Phase 20 D-05).
 *
 * Phase 20 extension:
 *   - propagation.extract(ROOT_CONTEXT, job.data._otel ?? {}) reconstructs the
 *     producer trace context. When the carrier is absent or malformed, extract
 *     returns ROOT_CONTEXT unchanged → consumer span opens with no parent
 *     (Phase 19 fresh-fallback semantics preserved).
 *   - The consumer span opens via context.with(parentCtx, () => tracer.startSpan)
 *     so its traceId inherits the producer's when available; spanId is fresh
 *     per attempt (D-10 — retries produce sibling consumer spans under one
 *     producer parent).
 *   - ALS frame seeded with carrier-derived _tenantId/_userId/_requestId
 *     when present; falls back to null/fresh-UUID otherwise.
 *
 * Public signature unchanged (Phase 19 invariant). Order of `context.with`
 * nesting (RESEARCH anti-pattern §385): OTEL active context FIRST, ALS INSIDE.
 *
 * @internal
 */
export function wrapProcessorWithAls(processor: Processor): Processor {
  return async (job, token) => {
    // biome-ignore lint/suspicious/noExplicitAny: job.data is user-typed; defensive optional reads.
    const data = (job.data as any) ?? {};
    const carrierIn: Record<string, string> = data._otel ?? {};
    const parentCtx = propagation.extract(ROOT_CONTEXT, carrierIn);
    const tracer = trace.getTracer(CONSUMER_TRACER_NAME);

    return context.with(parentCtx, async () => {
      // biome-ignore lint/suspicious/noExplicitAny: BullMQ Job.queueName is present at runtime; types narrow via cast.
      const queueName = (job as any).queueName ?? "unknown";
      const span = tracer.startSpan(`${queueName} process`, {
        kind: SpanKind.CONSUMER,
        attributes: {
          [ATTR_MESSAGING_SYSTEM]: "bullmq",
          [ATTR_MESSAGING_DESTINATION_NAME]: queueName,
          [ATTR_MESSAGING_OPERATION]: "process",
          [ATTR_MESSAGING_MESSAGE_ID]: String(job.id ?? ""),
          "messaging.bullmq.attempt": (job.attemptsMade ?? 0) + 1,
        },
      });

      const sc = span.spanContext();
      const jobCtx: ObservabilityContext = {
        requestId: data._requestId ?? crypto.randomUUID(),
        traceId: sc.traceId, // inherits producer trace when carrier present
        spanId: sc.spanId, // fresh per attempt (D-10)
        locale: defaultLocale,
        tenantId: data._tenantId ?? null,
        userId: data._userId ?? null,
      };

      return context.with(trace.setSpan(parentCtx, span), async () => {
        try {
          return await obsContext.run(jobCtx, () => processor(job, token));
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      });
    });
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
 * Phase 19 D-05 + Phase 20 D-05 — each processor call runs inside a seeded
 * ObservabilityContext ALS frame so pino log lines, CQRS dispatches, and event
 * publications inside the job handler automatically carry
 * requestId / traceId / spanId / tenantId / userId. Phase 20 extends the seed
 * so traceId inherits the producer's when `job.data._otel` carries a valid
 * W3C traceparent. Public signature UNCHANGED — every existing caller
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

export { closeConnection, getRedisConnection } from "./connection";
export type { EmailJobData, QueueConfig, WorkerConfig } from "./types";
