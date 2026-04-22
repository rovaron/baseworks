/**
 * Tracer factory unit tests (OBS-03).
 *
 * Covers the six canonical behaviors of every observability factory:
 * default-to-noop, singleton identity, reset, set-injection, unknown-value
 * throw, and explicit "noop" parity with default.
 *
 * Env-var-based tests use process.env directly (not bun:test's mock.module)
 * because the env-var path is what we're exercising. beforeEach/afterEach
 * reset the singleton and restore the pre-test TRACER value so tests do not
 * bleed state.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { NoopTracer } from "../../adapters/noop/noop-tracer";
import { getTracer, setTracer, resetTracer } from "../../factory";
import type { Tracer } from "../../ports/tracer";

describe("tracer factory (OBS-03)", () => {
  const origTracer = process.env.TRACER;

  beforeEach(() => {
    resetTracer();
  });
  afterEach(() => {
    resetTracer();
    if (origTracer === undefined) delete process.env.TRACER;
    else process.env.TRACER = origTracer;
  });

  test("returns NoopTracer when TRACER is unset", () => {
    delete process.env.TRACER;
    const t = getTracer();
    expect(t).toBeInstanceOf(NoopTracer);
    expect(t.name).toBe("noop");
  });

  test("returns the same singleton across calls", () => {
    delete process.env.TRACER;
    const a = getTracer();
    const b = getTracer();
    expect(a).toBe(b);
  });

  test("resetTracer() forces a new instance on next get", () => {
    delete process.env.TRACER;
    const a = getTracer();
    resetTracer();
    const b = getTracer();
    expect(a).not.toBe(b);
  });

  test("setTracer() injects a mock that getTracer() returns", () => {
    const mock: Tracer = new NoopTracer(); // any Tracer-shaped value
    setTracer(mock);
    expect(getTracer()).toBe(mock);
  });

  test("getTracer() throws on unknown TRACER value", () => {
    process.env.TRACER = "otel";
    expect(() => getTracer()).toThrow(/Phase 17 supports only 'noop'/);
    expect(() => getTracer()).toThrow(/otel/);
  });

  test("returns NoopTracer when TRACER='noop' explicitly", () => {
    process.env.TRACER = "noop";
    expect(getTracer()).toBeInstanceOf(NoopTracer);
  });
});
