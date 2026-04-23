import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { wrapCqrsBus, type BusLike } from "../wrap-cqrs-bus";
import type {
  CaptureScope,
  ErrorTracker,
  ErrorTrackerScope,
} from "../../ports/error-tracker";
import type { Span, SpanOptions, Tracer } from "../../ports/tracer";
import { setTracer, resetTracer } from "../../factory";
import { obsContext } from "../../context";
import { defaultLocale } from "@baseworks/i18n";

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

interface RecordedSpan {
  name: string;
  options?: SpanOptions;
  events: Array<{
    type: "setAttribute" | "setStatus" | "recordException" | "end";
    payload: any;
  }>;
}

function makeRecordingTracer() {
  const spans: RecordedSpan[] = [];
  // Cross-cutting timeline so we can assert ordering between span events and
  // tracker.captureException calls (Test 6 — D-17 order of operations).
  const timeline: Array<
    | { kind: "span"; spanIndex: number; event: RecordedSpan["events"][number] }
    | { kind: "tracker"; err: unknown; scope?: CaptureScope }
  > = [];

  const tracer: Tracer = {
    name: "recording",
    startSpan(name, options) {
      const span: RecordedSpan = { name, options, events: [] };
      const idx = spans.push(span) - 1;
      const s: Span = {
        end: () => {
          const ev = { type: "end" as const, payload: null };
          span.events.push(ev);
          timeline.push({ kind: "span", spanIndex: idx, event: ev });
        },
        setAttribute: (k, v) => {
          const ev = {
            type: "setAttribute" as const,
            payload: { k, v },
          };
          span.events.push(ev);
          timeline.push({ kind: "span", spanIndex: idx, event: ev });
        },
        setStatus: (st) => {
          const ev = { type: "setStatus" as const, payload: st };
          span.events.push(ev);
          timeline.push({ kind: "span", spanIndex: idx, event: ev });
        },
        recordException: (err) => {
          const ev = { type: "recordException" as const, payload: err };
          span.events.push(ev);
          timeline.push({ kind: "span", spanIndex: idx, event: ev });
        },
      };
      return s;
    },
    withSpan: async (name, fn, options) => {
      const span: RecordedSpan = { name, options, events: [] };
      const idx = spans.push(span) - 1;
      const s: Span = {
        end: () => {
          const ev = { type: "end" as const, payload: null };
          span.events.push(ev);
          timeline.push({ kind: "span", spanIndex: idx, event: ev });
        },
        setAttribute: (k, v) => {
          const ev = {
            type: "setAttribute" as const,
            payload: { k, v },
          };
          span.events.push(ev);
          timeline.push({ kind: "span", spanIndex: idx, event: ev });
        },
        setStatus: (st) => {
          const ev = { type: "setStatus" as const, payload: st };
          span.events.push(ev);
          timeline.push({ kind: "span", spanIndex: idx, event: ev });
        },
        recordException: (err) => {
          const ev = { type: "recordException" as const, payload: err };
          span.events.push(ev);
          timeline.push({ kind: "span", spanIndex: idx, event: ev });
        },
      };
      try {
        const r = await fn(s);
        const endEv = { type: "end" as const, payload: null };
        span.events.push(endEv);
        timeline.push({ kind: "span", spanIndex: idx, event: endEv });
        return r;
      } catch (e) {
        const endEv = { type: "end" as const, payload: null };
        span.events.push(endEv);
        timeline.push({ kind: "span", spanIndex: idx, event: endEv });
        throw e;
      }
    },
    inject: () => {},
    extract: () => {},
    currentCarrier: () => ({}),
  };
  return { tracer, spans, timeline };
}

function seedAls(partial: {
  tenantId?: string | null;
  userId?: string | null;
  requestId?: string;
  traceId?: string;
  spanId?: string;
}) {
  return {
    requestId: partial.requestId ?? "req-1",
    traceId: partial.traceId ?? "trace-1",
    spanId: partial.spanId ?? "span-1",
    locale: defaultLocale,
    tenantId: partial.tenantId ?? null,
    userId: partial.userId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Phase 18 baseline — A5 invariants MUST still pass after D-17 extension.
// ---------------------------------------------------------------------------

describe("wrapCqrsBus — A5 invariant", () => {
  let calls: ReturnType<typeof makeRecordingTracker>["calls"];
  let tracker: ErrorTracker;

  beforeEach(() => {
    const rec = makeRecordingTracker();
    calls = rec.calls;
    tracker = rec.tracker;
  });

  test("execute: thrown exception is captured with commandName + rethrown", async () => {
    const bus: BusLike = {
      execute: async () => {
        throw new Error("db down");
      },
      query: async () => ({ success: false, error: "NOT_IMPL" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await expect(
      wrapped.execute("createTenant", {}, { tenantId: "t-1" }),
    ).rejects.toThrow("db down");
    expect(calls.length).toBe(1);
    expect(calls[0].scope?.extra).toMatchObject({ commandName: "createTenant" });
    expect(calls[0].scope?.tenantId).toBe("t-1");
  });

  test("execute: Result.err does NOT trigger captureException (A5)", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: false, error: "COMMAND_NOT_FOUND" }),
      query: async () => ({ success: false, error: "NOT_IMPL" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    const result = await wrapped.execute("x", {}, {});
    expect(result).toMatchObject({ success: false, error: "COMMAND_NOT_FOUND" });
    expect(calls.length).toBe(0);
  });

  test("execute: Result.ok does NOT trigger captureException", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: true, data: 42 }),
      query: async () => ({ success: false, error: "NOT_IMPL" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    const result = await wrapped.execute("x", {}, {});
    expect(result).toMatchObject({ success: true, data: 42 });
    expect(calls.length).toBe(0);
  });

  test("query: thrown exception is captured with queryName + rethrown", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: false, error: "NOT_IMPL" }),
      query: async () => {
        throw new Error("redis hang");
      },
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await expect(
      wrapped.query("listTenants", {}, { tenantId: "t-2" }),
    ).rejects.toThrow("redis hang");
    expect(calls.length).toBe(1);
    expect(calls[0].scope?.extra).toMatchObject({ queryName: "listTenants" });
    expect(calls[0].scope?.tenantId).toBe("t-2");
  });

  test("query: Result.err does NOT trigger captureException (A5)", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: false, error: "NOT_IMPL" }),
      query: async () => ({ success: false, error: "QUERY_NOT_FOUND" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await wrapped.query("x", {}, {});
    expect(calls.length).toBe(0);
  });

  test("tenantId undefined when ctx lacks it", async () => {
    const bus: BusLike = {
      execute: async () => {
        throw new Error("boom");
      },
      query: async () => ({ success: false, error: "X" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await expect(wrapped.execute("cmd", {}, {})).rejects.toThrow();
    expect(calls[0].scope?.tenantId).toBeUndefined();
  });

  test("rethrown error is the original instance (===)", async () => {
    const original = new Error("identity");
    const bus: BusLike = {
      execute: async () => {
        throw original;
      },
      query: async () => ({ success: false, error: "X" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    try {
      await wrapped.execute("cmd", {}, {});
      throw new Error("should not reach here");
    } catch (caught) {
      expect(caught).toBe(original);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 19 D-17 extensions — ALS-aware spans + ALS-first error capture.
// ---------------------------------------------------------------------------

describe("wrapCqrsBus — D-17 ALS + tracer spans", () => {
  let spans: ReturnType<typeof makeRecordingTracer>["spans"];
  let timeline: ReturnType<typeof makeRecordingTracer>["timeline"];
  let tracker: ErrorTracker;
  let calls: ReturnType<typeof makeRecordingTracker>["calls"];
  // Bridge the tracker timeline entries into the tracer timeline so ordering
  // (Test 6) can be asserted on a single array.
  let sharedTimeline: Array<
    | { kind: "span"; event: { type: string; payload?: unknown } }
    | { kind: "tracker"; err: unknown; scope?: CaptureScope }
  >;

  beforeEach(() => {
    const trec = makeRecordingTracer();
    spans = trec.spans;
    timeline = trec.timeline;
    sharedTimeline = [];
    // Wrap a recording tracker that logs into the shared timeline.
    const captureCalls: Array<{ err: unknown; scope?: CaptureScope }> = [];
    tracker = {
      name: "recording",
      captureException: (err, scope) => {
        captureCalls.push({ err, scope });
        sharedTimeline.push({ kind: "tracker", err, scope });
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
    calls = captureCalls;

    // Install the recording tracer in the factory singleton so wrapCqrsBus
    // sees it via getTracer().
    setTracer(trec.tracer);

    // Patch the tracer's Span methods to also emit into sharedTimeline via a
    // proxy on withSpan. We do this by replacing withSpan.
    const origWithSpan = trec.tracer.withSpan.bind(trec.tracer);
    trec.tracer.withSpan = async (name, fn, options) => {
      return origWithSpan(
        name,
        async (span) => {
          const wrapped: Span = {
            end: () => {
              span.end();
              sharedTimeline.push({ kind: "span", event: { type: "end" } });
            },
            setAttribute: (k, v) => {
              span.setAttribute(k, v);
              sharedTimeline.push({
                kind: "span",
                event: { type: "setAttribute", payload: { k, v } },
              });
            },
            setStatus: (st) => {
              span.setStatus(st);
              sharedTimeline.push({
                kind: "span",
                event: { type: "setStatus", payload: st },
              });
            },
            recordException: (err) => {
              span.recordException(err);
              sharedTimeline.push({
                kind: "span",
                event: { type: "recordException", payload: err },
              });
            },
          };
          return await fn(wrapped);
        },
        options,
      );
    };
  });

  afterEach(() => {
    resetTracer();
  });

  test("Test 1: Phase 18 A5 invariant preserved — Result.err does NOT capture", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: false, error: "VALIDATION_FAILED" }),
      query: async () => ({ success: false, error: "NOT_IMPL" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await obsContext.run(
      seedAls({ tenantId: "t-1", userId: "u-1" }),
      async () => {
        const res = await wrapped.execute(
          "auth:create-tenant",
          { name: "Acme" },
          { tenantId: "t-1" },
        );
        expect(res).toMatchObject({ success: false, error: "VALIDATION_FAILED" });
      },
    );
    expect(calls.length).toBe(0);
  });

  test("Test 2: D-14 cqrs.command span with ALS attributes", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: true, data: null }),
      query: async () => ({ success: false, error: "NOT_IMPL" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await obsContext.run(
      seedAls({
        tenantId: "t-als",
        userId: "u-als",
        requestId: "req-als",
      }),
      async () => {
        await wrapped.execute("auth:create-tenant", {}, {});
      },
    );
    expect(spans.length).toBe(1);
    expect(spans[0].name).toBe("cqrs.command");
    expect(spans[0].options?.attributes).toMatchObject({
      "cqrs.name": "auth:create-tenant",
      "tenant.id": "t-als",
      "user.id": "u-als",
      "request.id": "req-als",
    });
  });

  test("Test 3: D-14 cqrs.query span with ALS attributes", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: false, error: "NOT_IMPL" }),
      query: async () => ({ success: true, data: { id: "x" } }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await obsContext.run(
      seedAls({ tenantId: "t-q", userId: "u-q", requestId: "req-q" }),
      async () => {
        await wrapped.query("auth:get-tenant", {}, {});
      },
    );
    expect(spans.length).toBe(1);
    expect(spans[0].name).toBe("cqrs.query");
    expect(spans[0].options?.attributes).toMatchObject({
      "cqrs.name": "auth:get-tenant",
      "tenant.id": "t-q",
      "user.id": "u-q",
      "request.id": "req-q",
    });
  });

  test("Test 4: D-17 ALS tenantId overrides ctx.tenantId on throw", async () => {
    const bus: BusLike = {
      execute: async () => {
        throw new Error("kaboom");
      },
      query: async () => ({ success: false, error: "X" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await obsContext.run(
      seedAls({ tenantId: "ALS_T", userId: "u" }),
      async () => {
        await expect(
          wrapped.execute("x", {}, { tenantId: "CTX_T" }),
        ).rejects.toThrow("kaboom");
      },
    );
    expect(calls.length).toBe(1);
    expect(calls[0].scope?.tenantId).toBe("ALS_T");
  });

  test("Test 5: D-17 ctx.tenantId fallback outside ALS frame", async () => {
    const bus: BusLike = {
      execute: async () => {
        throw new Error("boot-error");
      },
      query: async () => ({ success: false, error: "X" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    // NO obsContext.run frame — dispatch happens at startup / seed scripts.
    await expect(
      wrapped.execute("x", {}, { tenantId: "CTX_T" }),
    ).rejects.toThrow("boot-error");
    expect(calls.length).toBe(1);
    expect(calls[0].scope?.tenantId).toBe("CTX_T");
  });

  test("Test 6: D-17 order — span.recordException + setStatus BEFORE tracker.captureException", async () => {
    const bus: BusLike = {
      execute: async () => {
        throw new Error("order-test");
      },
      query: async () => ({ success: false, error: "X" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await obsContext.run(seedAls({ tenantId: "t" }), async () => {
      await expect(wrapped.execute("x", {}, {})).rejects.toThrow("order-test");
    });
    // Find indices in sharedTimeline.
    const recordExceptionIdx = sharedTimeline.findIndex(
      (e) => e.kind === "span" && e.event.type === "recordException",
    );
    const setStatusErrorIdx = sharedTimeline.findIndex(
      (e) =>
        e.kind === "span" &&
        e.event.type === "setStatus" &&
        (e.event.payload as { code: string })?.code === "error",
    );
    const trackerIdx = sharedTimeline.findIndex((e) => e.kind === "tracker");
    expect(recordExceptionIdx).toBeGreaterThanOrEqual(0);
    expect(setStatusErrorIdx).toBeGreaterThanOrEqual(0);
    expect(trackerIdx).toBeGreaterThanOrEqual(0);
    expect(recordExceptionIdx).toBeLessThan(trackerIdx);
    expect(setStatusErrorIdx).toBeLessThan(trackerIdx);
  });

  test("Test 7: D-17 extra enrichment — commandName/queryName + requestId + traceId", async () => {
    const bus: BusLike = {
      execute: async () => {
        throw new Error("exec-boom");
      },
      query: async () => {
        throw new Error("query-boom");
      },
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await obsContext.run(
      seedAls({ requestId: "req-7", traceId: "trace-7", tenantId: "t" }),
      async () => {
        await expect(
          wrapped.execute("auth:do-thing", {}, {}),
        ).rejects.toThrow("exec-boom");
      },
    );
    expect(calls[0].scope?.extra).toMatchObject({
      commandName: "auth:do-thing",
      requestId: "req-7",
      traceId: "trace-7",
    });

    // Query side.
    calls.length = 0;
    await obsContext.run(
      seedAls({ requestId: "req-7q", traceId: "trace-7q", tenantId: "t" }),
      async () => {
        await expect(
          wrapped.query("auth:lookup", {}, {}),
        ).rejects.toThrow("query-boom");
      },
    );
    expect(calls[0].scope?.extra).toMatchObject({
      queryName: "auth:lookup",
      requestId: "req-7q",
      traceId: "trace-7q",
    });
  });

  test("Test 8: success path — span ends (type: end) and no capture", async () => {
    const bus: BusLike = {
      execute: async () => ({ success: true, data: 1 }),
      query: async () => ({ success: false, error: "X" }),
    };
    const wrapped = wrapCqrsBus(bus, tracker);
    await obsContext.run(seedAls({}), async () => {
      await wrapped.execute("ok-cmd", {}, {});
    });
    expect(spans.length).toBe(1);
    expect(spans[0].events.some((e) => e.type === "end")).toBe(true);
    expect(calls.length).toBe(0);
  });
});
