import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Processor } from "bullmq";
import {
  obsContext,
  getObsContext,
  type ObservabilityContext,
} from "@baseworks/observability";
import { defaultLocale } from "@baseworks/i18n";
import {
  propagation,
  trace,
  context,
  ROOT_CONTEXT,
  type Span,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { wrapProcessorWithAls, createWorker } from "../index";
import type { WorkerConfig } from "../types";

/**
 * Phase 19 Plan 07 Task 1 — ALS seeding invariants for createWorker's internal
 * wrapper. Path A per PLAN: tests call `wrapProcessorWithAls(processor)(job,
 * token)` directly, side-stepping BullMQ Worker + Redis. The queue.test.ts
 * suite already covers Worker-side integration with module mocks; this file
 * covers the ALS frame contents and per-job isolation.
 */

const fakeJob = (data: any = {}) => ({
  id: "fake-id",
  name: "fake-name",
  queueName: "test-queue",
  data,
  attemptsMade: 0,
}) as any;

describe("wrapProcessorWithAls — D-05 seed invariants", () => {
  // Plan 20-02 Rule 3 deviation: register an in-memory BasicTracerProvider +
  // AsyncLocalStorageContextManager so trace.getTracer().startSpan returns
  // valid (non-zero) SpanContexts AND context.with(parentCtx, fn) actually
  // activates the parent context for span-parent inheritance. Without these,
  // the OTEL JS API returns NoopTracer + a no-op ContextManager, which breaks
  // both Phase 19 fresh-fallback assertions (Tests 4/12) and Phase 20 carrier
  // extract assertions (Tests 10/11).
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

  test("Test 1: processor runs inside obsContext.run frame (inner frame exists)", async () => {
    let captured: ObservabilityContext | undefined;
    const processor: Processor = async (_job) => {
      captured = getObsContext();
    };

    const wrapped = wrapProcessorWithAls(processor);
    await wrapped(fakeJob(), "fake-token");

    expect(captured).toBeDefined();
    expect(captured?.requestId).toBeDefined();
    expect(typeof captured?.requestId).toBe("string");
  });

  test("Test 2: requestId forwarded from job.data._requestId when present", async () => {
    let captured: ObservabilityContext | undefined;
    const processor: Processor = async (_job) => {
      captured = getObsContext();
    };

    const wrapped = wrapProcessorWithAls(processor);
    await wrapped(fakeJob({ _requestId: "from-api-request" }), "fake-token");

    expect(captured?.requestId).toBe("from-api-request");
  });

  test("Test 3: fresh requestId when _requestId absent", async () => {
    let captured: ObservabilityContext | undefined;
    const processor: Processor = async (_job) => {
      captured = getObsContext();
    };

    const wrapped = wrapProcessorWithAls(processor);
    await wrapped(fakeJob({}), "fake-token");

    expect(captured?.requestId).toBeDefined();
    // crypto.randomUUID() produces 36-char 8-4-4-4-12 hex-dashed strings.
    expect(captured?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("Test 4: fresh traceId + spanId every job (frame isolation)", async () => {
    const captures: ObservabilityContext[] = [];
    const processor: Processor = async (_job) => {
      const ctx = getObsContext();
      if (ctx) captures.push({ ...ctx });
    };

    const wrapped = wrapProcessorWithAls(processor);
    await wrapped(fakeJob({ _requestId: "job-a" }), "fake-token");
    await wrapped(fakeJob({ _requestId: "job-b" }), "fake-token");

    expect(captures.length).toBe(2);
    expect(captures[0]!.traceId).not.toBe(captures[1]!.traceId);
    expect(captures[0]!.spanId).not.toBe(captures[1]!.spanId);
    // Shape assertions — 32-char trace, 16-char span (hex-like).
    expect(captures[0]!.traceId).toMatch(/^[0-9a-f]{32}$/i);
    expect(captures[0]!.spanId).toMatch(/^[0-9a-f]{16}$/i);
  });

  test("Test 5: default locale seeded for job-scope logging", async () => {
    let captured: ObservabilityContext | undefined;
    const processor: Processor = async () => {
      captured = getObsContext();
    };

    const wrapped = wrapProcessorWithAls(processor);
    await wrapped(fakeJob(), "fake-token");

    expect(captured?.locale).toBe(defaultLocale);
    expect(captured?.tenantId).toBeNull();
    expect(captured?.userId).toBeNull();
  });

  test("Test 6: createWorker public signature — 4-arg shape preserved", () => {
    // Type-level assertion: the signature compiles as the 4-arg shape.
    // A TS compile failure here (tsc --noEmit in build) catches signature drift.
    const sigCheck: (
      name: string,
      processor: Processor,
      redisUrl: string,
      opts?: WorkerConfig,
    ) => ReturnType<typeof createWorker> = createWorker;

    expect(typeof sigCheck).toBe("function");
    expect(typeof createWorker).toBe("function");
    expect(createWorker.length).toBeGreaterThanOrEqual(3); // required positional params
  });

  test("Test 7: processor identity not leaked — wrapper is distinct", () => {
    const processor: Processor = async () => undefined;
    const wrapped = wrapProcessorWithAls(processor);

    expect(wrapped).not.toBe(processor);
    expect(typeof wrapped).toBe("function");
  });

  test("Test 8: no frame bleed across concurrent jobs", async () => {
    // Each concurrent call must see its own requestId — no cross-contamination
    // from Promise.all interleaving the async work between jobs.
    const processor: Processor = async (job) => {
      // Await microtask boundary to force interleaving with sibling invocations.
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      const ctx = getObsContext();
      return ctx?.requestId ?? "MISSING";
    };

    const wrapped = wrapProcessorWithAls(processor);

    const jobs = Array.from({ length: 10 }, (_, i) =>
      wrapped(fakeJob({ _requestId: `job-${i}` }), "fake-token"),
    );

    const results = await Promise.all(jobs);

    for (let i = 0; i < 10; i++) {
      expect(results[i]).toBe(`job-${i}`);
    }
  });

  test("Test 9 (bonus): inner frame sees its seed even when called from an outer frame", async () => {
    // If called from inside an outer obsContext.run frame, the inner wrap still
    // opens its own seeded frame (not inherited from outer). Worker jobs must
    // be isolated from whatever spawned them.
    const outerCtx: ObservabilityContext = {
      requestId: "outer-request",
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      locale: defaultLocale,
      tenantId: "outer-tenant",
      userId: "outer-user",
    };

    let innerRequestId: string | undefined;
    let innerTenantId: string | null | undefined;
    const processor: Processor = async () => {
      const ctx = getObsContext();
      innerRequestId = ctx?.requestId;
      innerTenantId = ctx?.tenantId;
    };

    const wrapped = wrapProcessorWithAls(processor);

    await obsContext.run(outerCtx, async () => {
      await wrapped(fakeJob({ _requestId: "job-seed" }), "fake-token");
    });

    // The inner processor observed its OWN seed, not the outer frame.
    expect(innerRequestId).toBe("job-seed");
    expect(innerTenantId).toBeNull();
  });

  test("Test 10: producer carrier in job.data._otel seeds inner ALS traceId", async () => {
    // Build a known carrier by injecting from a span we control.
    const tracer = trace.getTracer("test.producer");
    const producerSpan: Span = tracer.startSpan("test publish");
    const carrier: Record<string, string> = {};
    propagation.inject(trace.setSpan(context.active(), producerSpan), carrier);
    const producerTraceId = producerSpan.spanContext().traceId;
    producerSpan.end();

    let captured: ObservabilityContext | undefined;
    const processor: Processor = async () => {
      captured = getObsContext();
    };
    const wrapped = wrapProcessorWithAls(processor);
    await wrapped(fakeJob({ _otel: carrier, _requestId: "R-prod" }), "fake-token");

    expect(captured?.traceId).toBe(producerTraceId);
    expect(captured?.requestId).toBe("R-prod");
  });

  test("Test 11: _tenantId and _userId from job.data seed inner ALS frame", async () => {
    // Build a carrier so the consumer extract path runs (otherwise fresh-fallback).
    const tracer = trace.getTracer("test.producer");
    const producerSpan: Span = tracer.startSpan("test publish");
    const carrier: Record<string, string> = {};
    propagation.inject(trace.setSpan(context.active(), producerSpan), carrier);
    producerSpan.end();

    let captured: ObservabilityContext | undefined;
    const processor: Processor = async () => {
      captured = getObsContext();
    };
    const wrapped = wrapProcessorWithAls(processor);
    await wrapped(
      fakeJob({
        _otel: carrier,
        _requestId: "R-789",
        _tenantId: "T-123",
        _userId: "U-456",
      }),
      "fake-token",
    );

    expect(captured?.tenantId).toBe("T-123");
    expect(captured?.userId).toBe("U-456");
    expect(captured?.requestId).toBe("R-789");
  });

  test("Test 12: absent _otel falls back to Phase 19 fresh-trace path", async () => {
    let captured: ObservabilityContext | undefined;
    const processor: Processor = async () => {
      captured = getObsContext();
    };
    const wrapped = wrapProcessorWithAls(processor);
    await wrapped(fakeJob({}), "fake-token");

    // Fresh hex traceId — Phase 19 D-05 behaviour preserved when no carrier present.
    expect(captured?.traceId).toMatch(/^[0-9a-f]{32}$/i);
    expect(captured?.traceId).not.toBe("0".repeat(32));
    expect(captured?.tenantId).toBeNull();
    expect(captured?.userId).toBeNull();
  });

  // Reference imports to avoid unused warnings; harmless at runtime.
  void ROOT_CONTEXT;
});
