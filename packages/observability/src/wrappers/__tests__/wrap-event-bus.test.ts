import { describe, test, expect, beforeEach } from "bun:test";
import { wrapEventBus, type EventBusLike } from "../wrap-event-bus";
import type { Span, SpanOptions, Tracer } from "../../ports/tracer";
import { obsContext } from "../../context";
import { defaultLocale } from "@baseworks/i18n";

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
  const tracer: Tracer = {
    name: "recording",
    startSpan(name, options) {
      const span: RecordedSpan = { name, options, events: [] };
      spans.push(span);
      const s: Span = {
        end: () => span.events.push({ type: "end", payload: null }),
        setAttribute: (k, v) =>
          span.events.push({ type: "setAttribute", payload: { k, v } }),
        setStatus: (st) => span.events.push({ type: "setStatus", payload: st }),
        recordException: (err) =>
          span.events.push({ type: "recordException", payload: err }),
      };
      return s;
    },
    withSpan: async (name, fn, options) => {
      const span: RecordedSpan = { name, options, events: [] };
      spans.push(span);
      const s: Span = {
        end: () => span.events.push({ type: "end", payload: null }),
        setAttribute: (k, v) =>
          span.events.push({ type: "setAttribute", payload: { k, v } }),
        setStatus: (st) => span.events.push({ type: "setStatus", payload: st }),
        recordException: (err) =>
          span.events.push({ type: "recordException", payload: err }),
      };
      try {
        const r = await fn(s);
        span.events.push({ type: "end", payload: null });
        return r;
      } catch (e) {
        span.events.push({ type: "end", payload: null });
        throw e;
      }
    },
    inject: () => {},
    extract: () => {},
    currentCarrier: () => ({}),
  };
  return { tracer, spans };
}

function seedAls(partial: {
  tenantId?: string | null;
  userId?: string | null;
  requestId?: string;
}) {
  return {
    requestId: partial.requestId ?? "req-eb",
    traceId: "trace-eb",
    spanId: "span-eb",
    locale: defaultLocale,
    tenantId: partial.tenantId ?? null,
    userId: partial.userId ?? null,
  };
}

/**
 * Synchronous in-memory EventBus stub mirroring TypedEventBus's emit/on
 * semantics. Listeners fire synchronously in registration order. Collects
 * any rejected promises from async listeners into `rejections` so Test 4
 * can deterministically assert the wrapper's rethrow without racing on
 * process-level `unhandledRejection` listeners (Bun may deliver those on
 * a next tick that crosses test boundaries).
 */
class FakeEventBus implements EventBusLike {
  listeners = new Map<string, Array<(data: any) => void | Promise<void>>>();
  rejections: unknown[] = [];
  /** Promises returned by async listener invocations — await to drain. */
  pending: Promise<void>[] = [];
  emit(event: string, data: unknown): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (const h of arr) {
      // Mirror EventEmitter: call synchronously; if async, track the promise
      // so tests can await drain without racing.
      const result = h(data);
      if (result && typeof (result as Promise<void>).catch === "function") {
        this.pending.push(
          (result as Promise<void>).catch((err) => {
            this.rejections.push(err);
          }),
        );
      }
    }
  }
  on(event: string, handler: (data: any) => void | Promise<void>): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(handler);
    this.listeners.set(event, arr);
  }
  async drain(): Promise<void> {
    await Promise.all(this.pending);
    this.pending = [];
  }
}

describe("wrapEventBus — D-15/D-16", () => {
  let spans: ReturnType<typeof makeRecordingTracer>["spans"];
  let tracer: Tracer;
  let bus: FakeEventBus;

  beforeEach(() => {
    const rec = makeRecordingTracer();
    spans = rec.spans;
    tracer = rec.tracer;
    bus = new FakeEventBus();
  });

  test("Test 1: event.publish span on emit with ALS attributes", async () => {
    const wrapped = wrapEventBus(bus, tracer);
    await obsContext.run(
      seedAls({ tenantId: "t-1", requestId: "req-1" }),
      async () => {
        wrapped.emit("tenant.created", { id: "t-1" });
        // Give the fire-and-forget withSpan a microtask to settle.
        await Promise.resolve();
      },
    );
    expect(spans.length).toBe(1);
    expect(spans[0].name).toBe("event.publish");
    expect(spans[0].options?.kind).toBe("producer");
    expect(spans[0].options?.attributes).toMatchObject({
      "event.name": "tenant.created",
      "tenant.id": "t-1",
      "request.id": "req-1",
    });
  });

  test("Test 2: event.handle span per listener on emit", async () => {
    const wrapped = wrapEventBus(bus, tracer);
    let received: unknown = null;
    wrapped.on("tenant.created", (data) => {
      received = data;
    });

    await obsContext.run(
      seedAls({ tenantId: "t-als", requestId: "req-h" }),
      async () => {
        wrapped.emit("tenant.created", { id: "x" });
        // Drain the wrapped async listener deterministically.
        await bus.drain();
      },
    );

    expect(received).toEqual({ id: "x" });
    const handleSpans = spans.filter((s) => s.name === "event.handle");
    expect(handleSpans.length).toBe(1);
    expect(handleSpans[0].options?.kind).toBe("consumer");
    expect(handleSpans[0].options?.attributes).toMatchObject({
      "event.name": "tenant.created",
      "event.listener.index": 0,
      "tenant.id": "t-als",
      "request.id": "req-h",
    });
  });

  test("Test 3: multiple listeners get separate event.handle spans with incrementing listener.index", async () => {
    const wrapped = wrapEventBus(bus, tracer);
    wrapped.on("x", () => {});
    wrapped.on("x", () => {});
    wrapped.on("x", () => {});

    await obsContext.run(seedAls({}), async () => {
      wrapped.emit("x", {});
      await bus.drain();
    });

    const handleSpans = spans.filter((s) => s.name === "event.handle");
    expect(handleSpans.length).toBe(3);
    const indices = handleSpans.map(
      (s) => s.options?.attributes?.["event.listener.index"],
    );
    expect(indices).toEqual([0, 1, 2]);
  });

  test("Test 4: listener error — span.recordException + setStatus('error') THEN rethrow", async () => {
    const wrapped = wrapEventBus(bus, tracer);
    wrapped.on("boom", () => {
      throw new Error("listener-failed");
    });

    await obsContext.run(seedAls({}), async () => {
      wrapped.emit("boom", {});
      await bus.drain();
    });

    const handleSpans = spans.filter((s) => s.name === "event.handle");
    expect(handleSpans.length).toBe(1);
    const eventTypes = handleSpans[0].events.map((e) => e.type);
    expect(eventTypes).toContain("recordException");
    const statusEvent = handleSpans[0].events.find(
      (e) => e.type === "setStatus",
    );
    expect((statusEvent?.payload as { code: string })?.code).toBe("error");
    // Verify rethrow occurred — the bus captured exactly one rejection
    // carrying the original Error, confirming the wrapper did NOT swallow it.
    expect(bus.rejections.length).toBe(1);
    expect((bus.rejections[0] as Error)?.message).toBe("listener-failed");
    // Ordering invariant: recordException precedes setStatus precedes end.
    const recIdx = eventTypes.indexOf("recordException");
    const statusIdx = eventTypes.indexOf("setStatus");
    const endIdx = eventTypes.indexOf("end");
    expect(recIdx).toBeLessThan(statusIdx);
    expect(statusIdx).toBeLessThan(endIdx);
  });

  test("Test 5: Pitfall 6 — no error-capture port calls in wrap-event-bus.ts source", async () => {
    // Source hygiene: the wrapper MUST NOT call the error-capture port
    // anywhere. Read the source and grep for the banned token.
    const source = await Bun.file(
      "packages/observability/src/wrappers/wrap-event-bus.ts",
    ).text();
    // Dynamic token construction to avoid self-flagging repo-wide greps.
    const banned = `${"capture"}${"Exception"}`;
    expect(source.includes(banned)).toBe(false);
  });

  test("Test 6: Pitfall 6 — wrapEventBus signature takes only (bus, tracer)", async () => {
    // The function length property reflects the declared arity.
    expect(wrapEventBus.length).toBe(2);
    // Source check: no error-tracker type import + no tracker parameter.
    const source = await Bun.file(
      "packages/observability/src/wrappers/wrap-event-bus.ts",
    ).text();
    const bannedType = `${"Error"}${"Tracker"}`;
    expect(source.includes(bannedType)).toBe(false);
    // No `tracker:` typed parameter anywhere in the file.
    expect(/\btracker\s*:/.test(source)).toBe(false);
  });

  test("Test 7: external-wrap — returns the same bus instance (mutated in place)", () => {
    const wrapped = wrapEventBus(bus, tracer);
    expect(wrapped).toBe(bus);
  });

  test("Test 8: async handler is awaited inside the event.handle span", async () => {
    const wrapped = wrapEventBus(bus, tracer);
    let resolved = false;
    wrapped.on("a", async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolved = true;
    });

    await obsContext.run(seedAls({}), async () => {
      wrapped.emit("a", {});
      await bus.drain();
    });

    expect(resolved).toBe(true);
    const handleSpans = spans.filter((s) => s.name === "event.handle");
    expect(handleSpans.length).toBe(1);
    // Span ended after the async handler resolved.
    expect(handleSpans[0].events.some((e) => e.type === "end")).toBe(true);
  });
});

describe("wrapEventBus — barrel export", () => {
  test("Test 9: wrapEventBus + EventBusLike are exported from @baseworks/observability", async () => {
    // Mirror the wrap-cqrs-bus barrel-export test pattern (deferred-items.md
    // notes the pre-existing config-env flake on full-barrel dynamic imports
    // — guard with the same mock.module trick from Plan 01).
    const { mock } = await import("bun:test");
    mock.module("@baseworks/config", () => ({
      env: { OBS_PII_DENY_EXTRA_KEYS: "" },
    }));
    const mod = await import(`../../index?t=${Date.now()}`);
    expect(typeof (mod as { wrapEventBus?: unknown }).wrapEventBus).toBe(
      "function",
    );
    // Type-only export: runtime-level existence of the *type* is not directly
    // checkable, but we assert the file re-exports the identifier at the
    // source level (grep) so that tsc/eden consumers can `import type { EventBusLike }`.
    const barrel = await Bun.file(
      "packages/observability/src/index.ts",
    ).text();
    expect(barrel.includes("EventBusLike")).toBe(true);
  });
});
