/**
 * MetricsProvider factory unit tests (OBS-02).
 *
 * Covers the six canonical behaviors of every observability factory:
 * default-to-noop, singleton identity, reset, set-injection, unknown-value
 * throw, and explicit "noop" parity with default.
 *
 * Env-var-based tests use process.env directly (not bun:test's mock.module)
 * because the env-var path is what we're exercising. beforeEach/afterEach
 * reset the singleton and restore the pre-test METRICS_PROVIDER value so
 * tests do not bleed state.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { NoopMetricsProvider } from "../../adapters/noop/noop-metrics";
import { getMetrics, setMetrics, resetMetrics } from "../../factory";
import type { MetricsProvider } from "../../ports/metrics";

describe("metrics factory (OBS-02)", () => {
  const origMetrics = process.env.METRICS_PROVIDER;

  beforeEach(() => {
    resetMetrics();
  });
  afterEach(() => {
    resetMetrics();
    if (origMetrics === undefined) delete process.env.METRICS_PROVIDER;
    else process.env.METRICS_PROVIDER = origMetrics;
  });

  test("returns NoopMetricsProvider when METRICS_PROVIDER is unset", () => {
    delete process.env.METRICS_PROVIDER;
    const m = getMetrics();
    expect(m).toBeInstanceOf(NoopMetricsProvider);
    expect(m.name).toBe("noop");
  });

  test("returns the same singleton across calls", () => {
    delete process.env.METRICS_PROVIDER;
    const a = getMetrics();
    const b = getMetrics();
    expect(a).toBe(b);
  });

  test("resetMetrics() forces a new instance on next get", () => {
    delete process.env.METRICS_PROVIDER;
    const a = getMetrics();
    resetMetrics();
    const b = getMetrics();
    expect(a).not.toBe(b);
  });

  test("setMetrics() injects a mock that getMetrics() returns", () => {
    const mock: MetricsProvider = new NoopMetricsProvider(); // any MetricsProvider-shaped value
    setMetrics(mock);
    expect(getMetrics()).toBe(mock);
  });

  test("getMetrics() throws on unknown METRICS_PROVIDER value", () => {
    process.env.METRICS_PROVIDER = "otel";
    expect(() => getMetrics()).toThrow(/Phase 17 supports only 'noop'/);
    expect(() => getMetrics()).toThrow(/otel/);
  });

  test("returns NoopMetricsProvider when METRICS_PROVIDER='noop' explicitly", () => {
    process.env.METRICS_PROVIDER = "noop";
    expect(getMetrics()).toBeInstanceOf(NoopMetricsProvider);
  });
});
