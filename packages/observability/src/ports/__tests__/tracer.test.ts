import { describe, expect, test } from "bun:test";
import { NoopTracer } from "../../adapters/noop/noop-tracer";
import type { Span, Tracer } from "../tracer";
import type { TraceCarrier } from "../types";

/**
 * Tracer port contract tests (OBS-03).
 *
 * Verifies that NoopTracer satisfies the Tracer port and that every method
 * is safe to call with minimal and maximal argument shapes without throwing.
 * Mitigates T-17-01 (Tampering): untrusted call-site inputs must never
 * break the default adapter.
 */

describe("Tracer port / NoopTracer", () => {
  test("NoopTracer.name === 'noop'", () => {
    const t = new NoopTracer();
    expect(t.name).toBe("noop");
  });

  test("startSpan(...).end() does not throw and returns a Span", () => {
    const t = new NoopTracer();
    const span = t.startSpan("x");
    expect(span).toBeDefined();
    expect(() => span.end()).not.toThrow();
    expect(() => span.setAttribute("k", "v")).not.toThrow();
    expect(() => span.setAttribute("n", 123)).not.toThrow();
    expect(() => span.setAttribute("b", true)).not.toThrow();
    expect(() => span.setStatus({ code: "ok" })).not.toThrow();
    expect(() => span.setStatus({ code: "error", message: "boom" })).not.toThrow();
    expect(() => span.recordException(new Error("boom"))).not.toThrow();
    expect(() => span.recordException("not an Error")).not.toThrow();
  });

  test("startSpan with options does not throw", () => {
    const t = new NoopTracer();
    const span = t.startSpan("x", {
      attributes: { a: "b", n: 1, flag: false },
      kind: "server",
    });
    expect(span).toBeDefined();
    expect(() => span.end()).not.toThrow();
  });

  test("withSpan resolves to the callback's return value and passes a Span", async () => {
    const t = new NoopTracer();
    let receivedSpan: Span | null = null;
    const result = await t.withSpan("x", async (span) => {
      receivedSpan = span;
      return 42;
    });
    expect(result).toBe(42);
    expect(receivedSpan).not.toBeNull();
    expect(receivedSpan).toBeDefined();
  });

  test("withSpan supports synchronous callbacks", async () => {
    const t = new NoopTracer();
    const result = await t.withSpan("sync", (span) => {
      span.setAttribute("sync", true);
      return "ok";
    });
    expect(result).toBe("ok");
  });

  test("inject is a no-op (carrier unchanged)", () => {
    const t = new NoopTracer();
    const carrier: TraceCarrier = { existing: "value" };
    t.inject(carrier);
    expect(carrier).toEqual({ existing: "value" });
  });

  test("extract does not throw and accepts empty/populated carriers", () => {
    const t = new NoopTracer();
    expect(() => t.extract({})).not.toThrow();
    expect(() => t.extract({ traceparent: "00-abc-def-01" })).not.toThrow();
  });

  test("currentCarrier returns an empty object", () => {
    const t = new NoopTracer();
    const carrier = t.currentCarrier();
    expect(carrier).toEqual({});
  });

  test("NoopTracer is structurally assignable to Tracer", () => {
    // Compile-time proof — if NoopTracer drifts from the Tracer interface
    // this line will fail typecheck, not runtime.
    const _assignable: Tracer = new NoopTracer();
    void _assignable;
    expect(true).toBe(true);
  });
});
