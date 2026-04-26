/**
 * Phase 20 D-08 — In-process API → worker single-trace assertion (CTX-04 SC#2).
 *
 * Asserts that a producer-side log line emitted from an Elysia route handler
 * inside obsContext.run, when followed by feeding the captured Queue.add
 * payload through wrapProcessorWithAls, produces a consumer-side log line
 * whose traceId / requestId / tenantId / userId match the producer side.
 *
 * SC#2's literal "in Tempo" wording is deferred to Phase 21 acceptance once
 * the real OTEL exporter exists and a Tempo backend can be inspected. This
 * test satisfies SC#2 at the trace-data level only.
 *
 * No real Redis. Queue.add is stubbed; wrapQueue is applied to the stub so
 * the producer wrapper exercises propagation.inject end-to-end.
 *
 * RESEARCH §250 / Pitfall 1: propagation.inject is a silent no-op when no
 * global propagator is registered. apps/api/src/telemetry.ts registers it
 * for production runs, but this test file does NOT import telemetry.ts —
 * we register W3CTraceContextPropagator + BasicTracerProvider +
 * AsyncLocalStorageContextManager in beforeAll.
 *
 * Plan 20-02 deviation echo: a propagator alone is not enough. Without a
 * BasicTracerProvider, `trace.getTracer().startSpan()` returns NoopSpans
 * with INVALID_SPAN_CONTEXT (all-zeros) and W3CTraceContextPropagator
 * silently filters them on inject — yielding empty `_otel.traceparent`.
 * Without an AsyncLocalStorageContextManager, `context.with(parentCtx, fn)`
 * is a no-op and the consumer span doesn't inherit the producer traceId.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultLocale } from "@baseworks/i18n";
import {
  getObsContext,
  type ObservabilityContext,
  obsContext,
  setTenantContext,
  wrapQueue,
} from "@baseworks/observability";
import { wrapProcessorWithAls } from "@baseworks/queue";
import { context, propagation, ROOT_CONTEXT, type SpanContext, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import type { JobsOptions, Processor, Queue } from "bullmq";
import { Elysia } from "elysia";
import pino from "pino";

const __tracerProvider = new BasicTracerProvider();
const __ctxManager = new AsyncLocalStorageContextManager();
beforeAll(() => {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(__tracerProvider);
  context.setGlobalContextManager(__ctxManager);
});
afterAll(() => {
  propagation.disable();
  trace.disable();
  context.disable();
});

type Captured = Record<string, unknown>;
// biome-ignore lint/suspicious/noExplicitAny: stub-recorded data is user-typed.
type RecordedCall = { name: string; data: any; opts?: JobsOptions };

function buildStubQueue(name = "test-queue"): {
  queue: Queue;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const stub = {
    name,
    // biome-ignore lint/suspicious/noExplicitAny: stub mirrors BullMQ Queue.add overload.
    add: async (jobName: string, data: any, opts?: JobsOptions) => {
      calls.push({ name: jobName, data, opts });
      return {
        id: `job-id-${calls.length}`,
        name: jobName,
        data,
        // biome-ignore lint/suspicious/noExplicitAny: cast preserves BullMQ Job shape.
      } as any;
    },
    addBulk: async (
      // biome-ignore lint/suspicious/noExplicitAny: bulk per-item data passthrough.
      jobs: Array<{ name: string; data: any; opts?: JobsOptions }>,
    ) => {
      for (const j of jobs) {
        calls.push({ name: j.name, data: j.data, opts: j.opts });
      }
      return jobs.map((j, i) => ({
        id: `bulk-${i}`,
        name: j.name,
        data: j.data,
        // biome-ignore lint/suspicious/noExplicitAny: cast preserves BullMQ Job[] shape.
      })) as any;
    },
  } as unknown as Queue;
  return { queue: stub, calls };
}

// biome-ignore lint/suspicious/noExplicitAny: fakeJob carries arbitrary user data.
function fakeJob(data: any, attemptsMade = 0) {
  return {
    id: "fake-job-id",
    name: "test-job",
    queueName: "test-queue",
    data,
    attemptsMade,
  } as Parameters<Processor>[0];
}

describe("Phase 20 D-08 — single-trace API → worker (SC#2 trace-data level)", () => {
  test("producer log + consumer log share traceId / requestId / tenantId via carrier", async () => {
    const captured: Captured[] = [];
    const stream = {
      write: (chunk: string) => {
        captured.push(JSON.parse(chunk));
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: pino destination type.
    const testLogger = pino(
      { level: "info", mixin: () => obsContext.getStore() ?? {} },
      stream as any,
    );

    const { queue: stubQueue, calls } = buildStubQueue("test-queue");
    const wrappedQueue = wrapQueue(stubQueue);

    const probeApp = new Elysia().get("/probe", async ({ request }) => {
      const tenantHeader = request.headers.get("x-test-tenant") ?? "T-1";
      setTenantContext({ tenantId: tenantHeader, userId: `U-${tenantHeader}` });
      testLogger.info({ at: "producer-side" }, "enqueueing");
      await wrappedQueue.add("test-job", { hello: "world" });
      const store = getObsContext();
      return {
        traceId: store?.traceId ?? null,
        requestId: store?.requestId ?? null,
      };
    });

    // Mirror the production HTTP middleware: an inbound request lands inside an
    // OTEL active span (the http server span), which seeds both ALS and OTEL
    // context. We simulate that here by wrapping the handler in
    // `context.with(traceCtxWithReqSpan, ...)` so wrapQueue's publish span
    // inherits this synthetic "request" span's traceId — and thus the carrier
    // and the eventual consumer-side log share that traceId. Without this
    // OTEL-active seed, the publish span would start a fresh trace and the
    // single-trace SC#2 assertion would fail (RESEARCH §382 + Phase 19 D-13
    // request-span seeding pattern).
    const T_PRODUCER = "a".repeat(32);
    const reqSpanCtx: SpanContext = {
      traceId: T_PRODUCER,
      spanId: "b".repeat(16),
      traceFlags: 1,
      isRemote: false,
    };
    const otelCtxWithReqSpan = trace.setSpanContext(ROOT_CONTEXT, reqSpanCtx);
    const R_PRODUCER = "r-probe-1";
    const seed: ObservabilityContext = {
      requestId: R_PRODUCER,
      traceId: T_PRODUCER,
      spanId: reqSpanCtx.spanId,
      locale: defaultLocale,
      tenantId: null,
      userId: null,
    };

    const req = new Request("http://localhost/probe", {
      headers: {
        "x-test-tenant": "T-PROD",
        "x-request-id": R_PRODUCER,
      },
    });
    const res = await context.with(otelCtxWithReqSpan, () =>
      obsContext.run(seed, () => probeApp.handle(req)),
    );
    expect(res.status).toBe(200);

    // Producer-side recorded.
    expect(calls.length).toBe(1);
    const recordedData = calls[0]?.data;
    expect(recordedData._otel?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
    expect(recordedData._requestId).toBe(R_PRODUCER);
    expect(recordedData._tenantId).toBe("T-PROD");
    expect(recordedData._userId).toBe("U-T-PROD");

    // Consumer side: replay the captured carrier through wrapProcessorWithAls.
    const workerProcessor: Processor = async () => {
      testLogger.info({ at: "consumer-side" }, "processing");
    };
    const wrappedProc = wrapProcessorWithAls(workerProcessor);
    await wrappedProc(fakeJob(recordedData, 0), "fake-token");

    // Single-trace correlation assertions.
    const producerLog = captured.find((l) => l.at === "producer-side");
    const consumerLog = captured.find((l) => l.at === "consumer-side");
    expect(producerLog).toBeDefined();
    expect(consumerLog).toBeDefined();

    // SC#2 trace-data level: traceId equality across producer + consumer logs.
    expect(typeof producerLog?.traceId).toBe("string");
    expect(typeof consumerLog?.traceId).toBe("string");
    expect(producerLog?.traceId).toBe(consumerLog?.traceId);

    // CTX-04: requestId / tenantId / userId round-trip via carrier.
    expect(producerLog?.requestId).toBe(R_PRODUCER);
    expect(consumerLog?.requestId).toBe(R_PRODUCER);
    expect(producerLog?.tenantId).toBe("T-PROD");
    expect(consumerLog?.tenantId).toBe("T-PROD");
    expect(producerLog?.userId).toBe("U-T-PROD");
    expect(consumerLog?.userId).toBe("U-T-PROD");
  });
});
