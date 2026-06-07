import { describe, expect, test } from "bun:test";
import type {
  Breadcrumb,
  CaptureScope,
  ErrorTracker,
  ErrorTrackerScope,
} from "../../ports/error-tracker";
import type { LogLevel } from "../../ports/types";
import { RingBufferingErrorTracker } from "../ring-buffer-error-tracker";

interface FakeTracker extends ErrorTracker {
  captures: Array<{ err: unknown; scope?: CaptureScope }>;
  messages: Array<{ message: string; level?: LogLevel }>;
  breadcrumbs: number;
  flushed: number;
  lastBreadcrumb?: Breadcrumb;
}

function makeFakeTracker(): FakeTracker {
  const captures: FakeTracker["captures"] = [];
  const messages: FakeTracker["messages"] = [];
  const state = { breadcrumbs: 0, flushed: 0, lastBreadcrumb: undefined as Breadcrumb | undefined };
  const tracker: FakeTracker = {
    name: "fake",
    captures,
    messages,
    get breadcrumbs() {
      return state.breadcrumbs;
    },
    get flushed() {
      return state.flushed;
    },
    get lastBreadcrumb() {
      return state.lastBreadcrumb;
    },
    captureException(err, scope) {
      captures.push({ err, scope });
    },
    captureMessage(message, level) {
      messages.push({ message, level });
    },
    addBreadcrumb(breadcrumb) {
      state.breadcrumbs++;
      state.lastBreadcrumb = breadcrumb;
    },
    withScope<T>(fn: (s: ErrorTrackerScope) => T): T {
      return fn({
        setUser() {},
        setTag() {},
        setExtra() {},
        setTenant() {},
      });
    },
    async flush(_t?: number) {
      state.flushed++;
      return true;
    },
  };
  return tracker;
}

describe("RingBufferingErrorTracker — delegation to inner tracker", () => {
  test("captureException delegates to inner with err + scope", () => {
    const inner = makeFakeTracker();
    const rb = new RingBufferingErrorTracker(inner);
    const err = new Error("boom");
    const scope: CaptureScope = { tags: { source: "cqrs" } };
    rb.captureException(err, scope);
    expect(inner.captures.length).toBe(1);
    expect(inner.captures[0]!.err).toBe(err);
    expect(inner.captures[0]!.scope).toBe(scope);
  });

  test("captureMessage delegates to inner with message + level", () => {
    const inner = makeFakeTracker();
    const rb = new RingBufferingErrorTracker(inner);
    rb.captureMessage("hi", "info");
    expect(inner.messages.length).toBe(1);
    expect(inner.messages[0]!.message).toBe("hi");
    expect(inner.messages[0]!.level).toBe("info");
  });

  test("addBreadcrumb / withScope / flush all delegate to inner", async () => {
    const inner = makeFakeTracker();
    const rb = new RingBufferingErrorTracker(inner);
    rb.addBreadcrumb({ message: "x" });
    expect(inner.breadcrumbs).toBe(1);
    expect(inner.lastBreadcrumb?.message).toBe("x");
    rb.withScope((s) => s.setTag("k", "v")); // no throw → delegated
    const ok = await rb.flush(100);
    expect(ok).toBe(true);
    expect(inner.flushed).toBe(1);
  });

  test("name reflects inner adapter for debugging", () => {
    const inner = makeFakeTracker();
    const rb = new RingBufferingErrorTracker(inner);
    expect(rb.name).toBe("ringbuffer(fake)");
  });
});

describe("RingBufferingErrorTracker — capture & dedup", () => {
  test("captureException appends 1 entry with default source 'global'", () => {
    const rb = new RingBufferingErrorTracker(makeFakeTracker());
    rb.captureException(new Error("boom"));
    const snap = rb.snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]!.message).toBe("boom");
    expect(snap[0]!.count).toBe(1);
    expect(snap[0]!.source).toBe("global");
  });

  test("dedup: same Error captured twice → 1 entry, count == 2", () => {
    const rb = new RingBufferingErrorTracker(makeFakeTracker());
    const err = new Error("boom");
    rb.captureException(err);
    rb.captureException(err);
    const snap = rb.snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]!.count).toBe(2);
  });

  test("different messages → 2 entries", () => {
    const rb = new RingBufferingErrorTracker(makeFakeTracker());
    rb.captureException(new Error("a"));
    rb.captureException(new Error("b"));
    expect(rb.snapshot().length).toBe(2);
  });

  test("different first-frames with same message → 2 entries", () => {
    const rb = new RingBufferingErrorTracker(makeFakeTracker());
    const e1 = new Error("same");
    e1.stack = "Error: same\n    at fnA (/app/src/a.ts:1:1)";
    const e2 = new Error("same");
    e2.stack = "Error: same\n    at fnB (/app/src/b.ts:1:1)";
    rb.captureException(e1);
    rb.captureException(e2);
    expect(rb.snapshot().length).toBe(2);
  });

  test("source taken from scope.tags.source", () => {
    const rb = new RingBufferingErrorTracker(makeFakeTracker());
    rb.captureException(new Error("boom"), { tags: { source: "cqrs" } });
    expect(rb.snapshot()[0]!.source).toBe("cqrs");
  });

  test("message truncated to 500 chars (Pitfall 9)", () => {
    const rb = new RingBufferingErrorTracker(makeFakeTracker());
    rb.captureException(new Error("x".repeat(1000)));
    expect(rb.snapshot()[0]!.message.length).toBe(500);
  });
});

describe("RingBufferingErrorTracker — capacity & eviction", () => {
  test("eviction at capacity (51 distinct → 50 retained, oldest evicted)", () => {
    const rb = new RingBufferingErrorTracker(makeFakeTracker(), 50);
    for (let i = 0; i < 51; i++) {
      const e = new Error(`err-${i}`);
      e.stack = `Error: err-${i}\n    at fn${i} (/app/src/x.ts:${i}:1)`;
      rb.captureException(e);
    }
    const snap = rb.snapshot();
    expect(snap.length).toBe(50);
    expect(snap[0]!.message).toBe("err-1"); // err-0 evicted
    expect(snap[49]!.message).toBe("err-50");
  });

  test("dedup of surviving entry after eviction → count++ on existing entry, not new entry", () => {
    const rb = new RingBufferingErrorTracker(makeFakeTracker(), 3);
    // Capture 4 distinct → evicts oldest (err-0), buffer holds err-1, err-2, err-3.
    for (let i = 0; i < 4; i++) {
      const e = new Error(`err-${i}`);
      e.stack = `Error: err-${i}\n    at fn${i} (/app/src/x.ts:${i}:1)`;
      rb.captureException(e);
    }
    // Re-capture survivor err-1 with identical stack → must merge, not create.
    const survivor = new Error("err-1");
    survivor.stack = `Error: err-1\n    at fn1 (/app/src/x.ts:1:1)`;
    rb.captureException(survivor);

    const snap = rb.snapshot();
    expect(snap.length).toBe(3);
    const merged = snap.find((e) => e.message === "err-1");
    expect(merged?.count).toBe(2);
  });
});

describe("RingBufferingErrorTracker — snapshot()", () => {
  test("snapshot() returns a copy (caller mutation does not affect buffer)", () => {
    const rb = new RingBufferingErrorTracker(makeFakeTracker());
    rb.captureException(new Error("boom"));
    const snap1 = rb.snapshot();
    snap1.length = 0;
    const snap2 = rb.snapshot();
    expect(snap2.length).toBe(1);
  });
});
