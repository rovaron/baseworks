/**
 * External Queue producer wrapper (CTX-04 / TRC-03 / Phase 20 D-02, D-04, D-06, D-07, D-09).
 *
 * Wraps `queue.add` and `queue.addBulk` so every enqueue:
 *  1. Reads obsContext.getStore() (D-09 short-circuit when undefined — call origAdd
 *     unwrapped, no span, no carrier).
 *  2. Opens a `{queueName} publish` PRODUCER span via @opentelemetry/api.
 *  3. Injects W3C `traceparent` (+ `tracestate` if present per D-04) into a
 *     fresh `_otel: {}` envelope on job.data.
 *  4. Copies store.requestId / store.tenantId / store.userId to flat top-level
 *     fields _requestId / _tenantId / _userId on job.data (D-03 carrier shape).
 *  5. Awaits underlying .add/.addBulk; sets messaging.message.id on the span;
 *     records exceptions on throw; ends the span in finally.
 *
 * Why @opentelemetry/api directly and NOT the Tracer port (RESEARCH §382):
 *   The port returns a NoopTracer whose Span carries no real OTEL SpanContext.
 *   propagation.inject(trace.setSpan(ctx, noopSpan), carrier) writes an empty
 *   traceparent. The global tracer (registered by NodeSDK in apps/api/telemetry.ts)
 *   returns spans with valid SpanContexts under both Noop and real-exporter modes.
 *   This is a deliberate divergence from wrap-cqrs-bus.ts / wrap-event-bus.ts.
 *
 * Single-wrap discipline: createQueue is the only wrap site.
 */
import type { JobsOptions, Queue } from "bullmq";
import {
  context,
  propagation,
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
import { obsContext } from "../context";

const TRACER_NAME = "baseworks.queue";
const SYSTEM_BULLMQ = "bullmq";

export function wrapQueue<Q extends Queue>(queue: Q): Q {
  const queueName = queue.name;
  const origAdd = queue.add.bind(queue);
  const origAddBulk = queue.addBulk.bind(queue);

  // biome-ignore lint/suspicious/noExplicitAny: BullMQ Queue.add has multi-overload generic signature; preserved structurally via cast.
  (queue as any).add = async (
    jobName: string,
    // biome-ignore lint/suspicious/noExplicitAny: data is user-typed across Queue<DataType>; structural pass-through.
    data: any,
    opts?: JobsOptions,
  ) => {
    const store = obsContext.getStore();
    if (!store) {
      // D-09: orphan-from-producer path. Carrier-less enqueue.
      return origAdd(jobName, data, opts);
    }

    const tracer = trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan(`${queueName} publish`, {
      kind: SpanKind.PRODUCER,
      attributes: {
        [ATTR_MESSAGING_SYSTEM]: SYSTEM_BULLMQ,
        [ATTR_MESSAGING_DESTINATION_NAME]: queueName,
        [ATTR_MESSAGING_OPERATION]: "publish",
        "tenant.id": store.tenantId ?? "",
        "user.id": store.userId ?? "",
        "request.id": store.requestId ?? "",
      },
    });

    const carrier: Record<string, string> = {};
    propagation.inject(trace.setSpan(context.active(), span), carrier);

    const dataWithCarrier = {
      ...data,
      _otel: carrier,
      _requestId: store.requestId,
      _tenantId: store.tenantId,
      _userId: store.userId,
    };

    try {
      const job = await origAdd(jobName, dataWithCarrier, opts);
      if (job?.id) {
        span.setAttribute(ATTR_MESSAGING_MESSAGE_ID, String(job.id));
      }
      return job;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  };

  // biome-ignore lint/suspicious/noExplicitAny: BullMQ Queue.addBulk multi-overload generic signature.
  (queue as any).addBulk = async (
    // biome-ignore lint/suspicious/noExplicitAny: per-item data is user-typed; structural pass-through.
    jobs: Array<{ name: string; data: any; opts?: JobsOptions }>,
  ) => {
    const store = obsContext.getStore();
    if (!store) {
      return origAddBulk(jobs);
    }

    const tracer = trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan(`${queueName} publish`, {
      kind: SpanKind.PRODUCER,
      attributes: {
        [ATTR_MESSAGING_SYSTEM]: SYSTEM_BULLMQ,
        [ATTR_MESSAGING_DESTINATION_NAME]: queueName,
        [ATTR_MESSAGING_OPERATION]: "publish",
        "messaging.batch.message_count": jobs.length,
        "tenant.id": store.tenantId ?? "",
        "user.id": store.userId ?? "",
        "request.id": store.requestId ?? "",
      },
    });

    // Per-item carrier injection: each job gets its own _otel carrier.
    const wrappedJobs = jobs.map((j) => {
      const carrier: Record<string, string> = {};
      propagation.inject(trace.setSpan(context.active(), span), carrier);
      return {
        ...j,
        data: {
          ...j.data,
          _otel: carrier,
          _requestId: store.requestId,
          _tenantId: store.tenantId,
          _userId: store.userId,
        },
      };
    });

    try {
      const result = await origAddBulk(wrappedJobs);
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  };

  return queue;
}
