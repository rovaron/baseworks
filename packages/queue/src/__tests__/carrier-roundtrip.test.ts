import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  propagation,
  trace,
  context,
  ROOT_CONTEXT,
  SpanKind,
  type SpanContext,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { createTraceState } from "@opentelemetry/core";
import {
  obsContext,
  getObsContext,
  type ObservabilityContext,
} from "@baseworks/observability";
import { defaultLocale } from "@baseworks/i18n";
import type { Processor, Queue, JobsOptions } from "bullmq";
// wrapQueue lands in Plan 20-02 — import path will resolve once that plan ships.
import { wrapQueue } from "@baseworks/observability";
import { wrapProcessorWithAls } from "../index";

/**
 * Phase 20 Plan 01 Task 1 — D-07b smoke gate (RED phase).
 *
 * The 5 tests below describe the producer + consumer wrapper contract that
 * Plan 20-02 must satisfy. They are EXPECTED RED at end of Plan 20-01:
 * `wrapQueue` is not yet exported from `@baseworks/observability`, and the
 * extended `wrapProcessorWithAls` (D-05 carrier-extract) is not yet
 * implemented.
 *
 * RESEARCH §250 / Pitfall 1: registering W3CTraceContextPropagator in
 * `beforeAll` is REQUIRED — without it `propagation.inject` is a silent
 * no-op against the default NoopTextMapPropagator. The acceptance criteria
 * grep-verify the registration block.
 */

beforeAll(() => {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});
afterAll(() => {
  propagation.disable();
});

const fakeJob = (data: Record<string, unknown> = {}, attemptsMade = 0) =>
  ({
    id: "fake-id",
    name: "fake-name",
    queueName: "test-queue",
    data,
    attemptsMade,
  }) as unknown as Parameters<Processor>[0];

const SEED_ALS: ObservabilityContext = {
  requestId: "R-PRODUCER",
  traceId: "a".repeat(32),
  spanId: "b".repeat(16),
  locale: defaultLocale,
  tenantId: "T-1",
  userId: "U-1",
};

type RecordedCall = { name: string; data: any; opts?: JobsOptions };

function buildStubQueue(name = "test-queue"): { queue: Queue; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const stub = {
    name,
    add: async (jobName: string, data: any, opts?: JobsOptions) => {
      calls.push({ name: jobName, data, opts });
      return { id: "job-id-" + calls.length, name: jobName, data } as any;
    },
    addBulk: async (jobs: Array<{ name: string; data: any; opts?: JobsOptions }>) => {
      for (const j of jobs) {
        calls.push({ name: j.name, data: j.data, opts: j.opts });
      }
      return jobs.map((j, i) => ({ id: `bulk-${i}`, name: j.name, data: j.data })) as any;
    },
  } as unknown as Queue;
  return { queue: stub, calls };
}

describe("Phase 20 carrier round-trip — D-07b smoke gate", () => {
  test("Test 1: producer injects valid traceparent and flat ALS fields when ALS frame active", async () => {
    const { queue, calls } = buildStubQueue();
    const wrapped = wrapQueue(queue);
    await obsContext.run(SEED_ALS, async () => {
      await wrapped.add("test-job", { foo: 1 });
    });
    expect(calls.length).toBe(1);
    const data = calls[0]!.data;
    expect(data.foo).toBe(1);
    expect(typeof data._otel?.traceparent).toBe("string");
    expect(data._otel.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
    );
    expect(data._requestId).toBe("R-PRODUCER");
    expect(data._tenantId).toBe("T-1");
    expect(data._userId).toBe("U-1");
  });

  test("Test 2: worker reconstitutes producer traceId via wrapProcessorWithAls", async () => {
    const { queue, calls } = buildStubQueue();
    const wrapped = wrapQueue(queue);
    await obsContext.run(SEED_ALS, async () => {
      await wrapped.add("test-job", { foo: 2 });
    });
    const recordedData = calls[0]!.data;
    // Parse the producer traceId from the carrier (W3C format: 00-<traceId>-<spanId>-<flags>).
    const producerTraceId = (recordedData._otel.traceparent as string).split("-")[1]!;
    let captured: ObservabilityContext | undefined;
    const processor: Processor = async () => {
      captured = getObsContext();
    };
    const wrappedProc = wrapProcessorWithAls(processor);
    await wrappedProc(fakeJob(recordedData), "fake-token");
    expect(captured?.traceId).toBe(producerTraceId);
    expect(captured?.requestId).toBe("R-PRODUCER");
    expect(captured?.tenantId).toBe("T-1");
    expect(captured?.userId).toBe("U-1");
  });

  test("Test 3: D-09 — no _otel, no flat ALS fields when called outside obsContext.run", async () => {
    const { queue, calls } = buildStubQueue();
    const wrapped = wrapQueue(queue);
    await wrapped.add("test-job", { foo: 3 });
    const data = calls[0]!.data;
    expect(data.foo).toBe(3);
    expect(data._otel).toBeUndefined();
    expect(data._requestId).toBeUndefined();
    expect(data._tenantId).toBeUndefined();
    expect(data._userId).toBeUndefined();
    // Worker side: fresh-fallback path (Phase 19 invariant).
    let captured: ObservabilityContext | undefined;
    const processor: Processor = async () => {
      captured = getObsContext();
    };
    const wrappedProc = wrapProcessorWithAls(processor);
    await wrappedProc(fakeJob(data), "fake-token");
    expect(captured?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(captured?.tenantId).toBeNull();
    expect(captured?.userId).toBeNull();
  });

  test("Test 4: D-04 — tracestate forwarded when active span context carries it", async () => {
    const { queue, calls } = buildStubQueue();
    const wrapped = wrapQueue(queue);
    // Manually craft a span context with tracestate; set it active so propagation.inject picks it up.
    const sc: SpanContext = {
      traceId: "c".repeat(32),
      spanId: "d".repeat(16),
      traceFlags: 1,
      isRemote: false,
      traceState: createTraceState("vendor=value"),
    };
    const ctxWithState = trace.setSpanContext(context.active(), sc);
    await context.with(ctxWithState, async () => {
      await obsContext.run(SEED_ALS, async () => {
        await wrapped.add("test-job", { foo: 4 });
      });
    });
    const data = calls[0]!.data;
    // tracestate is only forwarded when the producer span inherits it; the producer
    // wrapper opens a NEW span via tracer.startSpan inside context.active(), and the
    // new span inherits the active context's tracestate by default (W3C semantics).
    expect(typeof data._otel.tracestate).toBe("string");
    expect(data._otel.tracestate).toContain("vendor=value");
  });

  test("Test 5: D-10 — per-attempt consumer spans share producer parent (same traceId, distinct spanIds)", async () => {
    const { queue, calls } = buildStubQueue();
    const wrapped = wrapQueue(queue);
    await obsContext.run(SEED_ALS, async () => {
      await wrapped.add("test-job", { foo: 5 });
    });
    const recordedData = calls[0]!.data;
    const captures: ObservabilityContext[] = [];
    const processor: Processor = async () => {
      const ctx = getObsContext();
      if (ctx) captures.push({ ...ctx });
    };
    const wrappedProc = wrapProcessorWithAls(processor);
    await wrappedProc(fakeJob(recordedData, 0), "fake-token");
    await wrappedProc(fakeJob(recordedData, 1), "fake-token");
    expect(captures.length).toBe(2);
    expect(captures[0]!.traceId).toBe(captures[1]!.traceId); // shared producer trace
    expect(captures[0]!.spanId).not.toBe(captures[1]!.spanId); // fresh per attempt
    expect(captures[0]!.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(captures[0]!.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  // Reference SpanKind/ROOT_CONTEXT to satisfy any future linter; harmless at runtime.
  void SpanKind;
  void ROOT_CONTEXT;
});
