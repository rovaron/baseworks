import { describe, expect, test } from "bun:test";
import { NoopMetricsProvider } from "../../adapters/noop/noop-metrics";
import type { MetricsProvider } from "../metrics";

/**
 * MetricsProvider port contract tests (OBS-02).
 *
 * Verifies NoopMetricsProvider satisfies the MetricsProvider port. Every
 * instrument method must be safe under minimal and maximal argument
 * shapes. Mitigates T-17-01 (Tampering).
 */

describe("MetricsProvider port / NoopMetricsProvider", () => {
  test("NoopMetricsProvider.name === 'noop'", () => {
    const m = new NoopMetricsProvider();
    expect(m.name).toBe("noop");
  });

  test("counter().inc() and counter().inc(v, attrs) do not throw", () => {
    const m = new NoopMetricsProvider();
    const c = m.counter("req.count");
    expect(c).toBeDefined();
    expect(() => c.inc()).not.toThrow();
    expect(() => c.inc(5)).not.toThrow();
    expect(() => c.inc(5, { route: "/x" })).not.toThrow();
    expect(() => c.inc(1, { route: "/y", n: 1, flag: true })).not.toThrow();
  });

  test("counter with options does not throw", () => {
    const m = new NoopMetricsProvider();
    const c = m.counter("req.count", {
      description: "HTTP request count",
      unit: "1",
    });
    expect(() => c.inc()).not.toThrow();
  });

  test("histogram().record(v, attrs) does not throw", () => {
    const m = new NoopMetricsProvider();
    const h = m.histogram("req.duration", { unit: "ms" });
    expect(h).toBeDefined();
    expect(() => h.record(123.4)).not.toThrow();
    expect(() => h.record(42, { route: "/x" })).not.toThrow();
    expect(() => h.record(0, { route: "/y", status: 200 })).not.toThrow();
  });

  test("gauge().set(v, attrs) does not throw", () => {
    const m = new NoopMetricsProvider();
    const g = m.gauge("pool.size");
    expect(g).toBeDefined();
    expect(() => g.set(10)).not.toThrow();
    expect(() => g.set(0)).not.toThrow();
    expect(() => g.set(100, { pool: "db" })).not.toThrow();
  });

  test("NoopMetricsProvider is structurally assignable to MetricsProvider", () => {
    // Compile-time proof — if NoopMetricsProvider drifts from the port
    // this line will fail typecheck, not runtime.
    const _assignable: MetricsProvider = new NoopMetricsProvider();
    void _assignable;
    expect(true).toBe(true);
  });
});
