/**
 * Unit tests for PinoErrorTracker (ERR-03 / Phase 18 D-07).
 *
 * Covers the full ErrorTracker port surface:
 * - name === "pino"
 * - captureException → pino ERROR-level entry with serialized err
 * - captureException applies scrubPii (defense-in-depth, ERR-04)
 * - captureException preserves tenantId
 * - captureException serializes + clears the breadcrumb ring buffer
 * - Breadcrumb ring cap = 10; oldest-first eviction
 * - captureMessage level mapping (error→50, warn→40, info→30, debug→20, default→30)
 * - withScope is STATELESS-FOR-CAPTURE: setters do NOT mutate instance state, so
 *   concurrent withScope calls cannot leak tenantId / tags / user / extra into a
 *   subsequent captureException call without an explicit scope arg (Pitfall 4).
 * - withScope returns the callback's result
 * - addBreadcrumb carries the full shape into the eventual capture
 * - flush always resolves true (with and without timeout)
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { pino } from "pino";
import type { Breadcrumb } from "../../../ports/error-tracker";
import { PinoErrorTracker } from "../pino-error-tracker";

interface FakeLogged {
  level: number;
  msg?: string;
  [key: string]: unknown;
}

function makeFakeLogger(): { logger: ReturnType<typeof pino>; logged: FakeLogged[] } {
  const logged: FakeLogged[] = [];
  const stream = {
    write(chunk: string) {
      try {
        logged.push(JSON.parse(chunk) as FakeLogged);
      } catch {
        logged.push({ level: -1, raw: chunk } as unknown as FakeLogged);
      }
    },
  };
  const logger = pino({ level: "debug" }, stream as unknown as NodeJS.WritableStream);
  return { logger, logged };
}

describe("PinoErrorTracker", () => {
  let fake: ReturnType<typeof makeFakeLogger>;
  let tracker: PinoErrorTracker;

  beforeEach(() => {
    fake = makeFakeLogger();
    tracker = new PinoErrorTracker(fake.logger);
  });

  test('name is "pino"', () => {
    expect(tracker.name).toBe("pino");
  });

  test("captureException emits ERROR-level log entry with serialized error", () => {
    tracker.captureException(new Error("x"));
    expect(fake.logged.length).toBe(1);
    expect(fake.logged[0].level).toBe(50);
    expect(JSON.stringify(fake.logged[0])).toContain("x");
    expect(fake.logged[0].msg).toContain("captured exception");
  });

  test("captureException applies scrubPii — password redacted", () => {
    tracker.captureException(new Error("boom"), { extra: { password: "hunter2" } });
    expect(JSON.stringify(fake.logged[0])).not.toContain("hunter2");
  });

  test("captureException preserves tenantId", () => {
    tracker.captureException(new Error("boom"), { tenantId: "t-1" });
    expect(JSON.stringify(fake.logged[0])).toContain("t-1");
  });

  test("captureException serializes and clears breadcrumb buffer", () => {
    tracker.addBreadcrumb({ message: "a" });
    tracker.addBreadcrumb({ message: "b" });
    tracker.addBreadcrumb({ message: "c" });
    tracker.captureException(new Error("boom"));
    const first = fake.logged[0];
    expect(Array.isArray(first.breadcrumbs)).toBe(true);
    expect((first.breadcrumbs as Breadcrumb[]).length).toBe(3);

    tracker.addBreadcrumb({ message: "d" });
    tracker.captureException(new Error("again"));
    expect((fake.logged[1].breadcrumbs as Breadcrumb[]).length).toBe(1);
  });

  test("breadcrumb buffer caps at 10 — oldest-first eviction", () => {
    for (let i = 0; i < 15; i++) {
      tracker.addBreadcrumb({ message: `bc-${i}` });
    }
    tracker.captureException(new Error("x"));
    const bcs = fake.logged[0].breadcrumbs as Breadcrumb[];
    expect(bcs.length).toBe(10);
    // Oldest 5 (bc-0..bc-4) evicted; newest (bc-14) remains.
    expect(JSON.stringify(bcs)).not.toContain("bc-0");
    expect(JSON.stringify(bcs)).not.toContain("bc-4");
    expect(JSON.stringify(bcs)).toContain("bc-14");
  });

  test("captureMessage level mapping", () => {
    tracker.captureMessage("hi-error", "error");
    tracker.captureMessage("hi-warn", "warn");
    tracker.captureMessage("hi-info", "info");
    tracker.captureMessage("hi-debug", "debug");
    tracker.captureMessage("hi-default");
    const levels = fake.logged.map((e) => e.level);
    expect(levels).toContain(50);
    expect(levels).toContain(40);
    expect(levels).toContain(30);
    expect(levels).toContain(20);
    // Default is info (30) — count at 30 should be >= 2 ("hi-info" + "hi-default").
    expect(levels.filter((l) => l === 30).length).toBeGreaterThanOrEqual(2);
  });

  test("withScope — scope setters do NOT mutate shared state (stateless-for-capture contract)", async () => {
    // Pitfall-4 regression guard. PinoErrorTracker.withScope provides a
    // closure-local scope object; setters write to that local object ONLY.
    // Subsequent captureException calls with no scope arg must NOT see
    // tenantId / tags / extra set inside a withScope callback.
    //
    // Tenant context binding to captureException is Phase 19's job (ALS-
    // driven). For Phase 18 callers must pass tenantId explicitly on each
    // captureException call. This test verifies that relying on setTenant
    // bindings does NOT accidentally work — catching the case where a
    // future refactor stores scope state on the instance.
    await Promise.all([
      (async () =>
        tracker.withScope((scope) => {
          scope.setTenant("t-A");
          scope.setTag("k", "v-A");
          return "A";
        }))(),
      (async () =>
        tracker.withScope((scope) => {
          scope.setTenant("t-B");
          scope.setTag("k", "v-B");
          return "B";
        }))(),
    ]);

    // Capture with NO scope arg AFTER both withScope callbacks ran. If scope
    // setters had leaked to instance state, 't-A' / 't-B' / 'v-A' / 'v-B'
    // would appear in the serialized log entry.
    tracker.captureException(new Error("outside"));
    const last = fake.logged[fake.logged.length - 1];
    const serialized = JSON.stringify(last);
    expect(serialized).not.toContain("t-A");
    expect(serialized).not.toContain("t-B");
    expect(serialized).not.toContain("v-A");
    expect(serialized).not.toContain("v-B");

    // captureException with an EXPLICIT tenantId still works.
    tracker.captureException(new Error("explicit"), { tenantId: "t-explicit" });
    expect(JSON.stringify(fake.logged[fake.logged.length - 1])).toContain("t-explicit");
  });

  test("withScope returns callback result", () => {
    const result = tracker.withScope(() => 42);
    expect(result).toBe(42);
  });

  test("addBreadcrumb carries full shape into eventual capture", () => {
    const bc: Breadcrumb = {
      message: "m",
      category: "http",
      level: "info",
      data: { k: 1 },
      timestamp: 1234,
    };
    tracker.addBreadcrumb(bc);
    tracker.captureException(new Error("x"));
    const bcs = fake.logged[0].breadcrumbs as Breadcrumb[];
    expect(bcs[0]).toMatchObject({ message: "m", category: "http", level: "info" });
  });

  test("flush resolves true (no-timeout and with-timeout)", async () => {
    expect(await tracker.flush()).toBe(true);
    expect(await tracker.flush(500)).toBe(true);
  });

  test("flush does NOT throw on pino transport issues", async () => {
    // Swap the logger for one whose underlying stream synchronously throws —
    // flush still resolves true (synchronous contract; pino backpressure is
    // not this adapter's concern).
    const throwingStream = {
      write(_chunk: string) {
        throw new Error("stream boom");
      },
    };
    const throwingLogger = pino(
      { level: "debug" },
      throwingStream as unknown as NodeJS.WritableStream,
    );
    const throwingTracker = new PinoErrorTracker(throwingLogger);
    expect(await throwingTracker.flush()).toBe(true);
    expect(await throwingTracker.flush(500)).toBe(true);
  });
});
