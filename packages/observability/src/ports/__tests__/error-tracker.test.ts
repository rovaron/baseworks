import { describe, expect, test } from "bun:test";
import { NoopErrorTracker } from "../../adapters/noop/noop-error-tracker";
import type { ErrorTracker } from "../error-tracker";

/**
 * ErrorTracker port contract tests (OBS-01).
 *
 * Verifies NoopErrorTracker satisfies the ErrorTracker port. Every method
 * must be safe under minimal and maximal argument shapes. Mitigates
 * T-17-01 (Tampering): untrusted inputs must never break the default
 * adapter.
 */

describe("ErrorTracker port / NoopErrorTracker", () => {
  test("NoopErrorTracker.name === 'noop'", () => {
    const t = new NoopErrorTracker();
    expect(t.name).toBe("noop");
  });

  test("captureException(err) returns void and does not throw", () => {
    const t = new NoopErrorTracker();
    expect(() => t.captureException(new Error("x"))).not.toThrow();
    expect(() => t.captureException("not an Error")).not.toThrow();
    expect(() => t.captureException(null)).not.toThrow();
    expect(() => t.captureException(undefined)).not.toThrow();
  });

  test("captureException with full scope does not throw", () => {
    const t = new NoopErrorTracker();
    expect(() =>
      t.captureException(new Error("x"), {
        user: { id: "u1", email: "u1@example.com" },
        tags: { a: "b" },
        extra: { k: 1 },
        tenantId: "t1",
      }),
    ).not.toThrow();
    expect(() =>
      t.captureException(new Error("x"), {
        user: null,
        tenantId: null,
      }),
    ).not.toThrow();
  });

  test("captureMessage(msg, level) does not throw", () => {
    const t = new NoopErrorTracker();
    expect(() => t.captureMessage("hi")).not.toThrow();
    expect(() => t.captureMessage("hi", "error")).not.toThrow();
    expect(() => t.captureMessage("hi", "debug")).not.toThrow();
    expect(() => t.captureMessage("hi", "info")).not.toThrow();
    expect(() => t.captureMessage("hi", "warning")).not.toThrow();
    expect(() => t.captureMessage("hi", "fatal")).not.toThrow();
  });

  test("addBreadcrumb does not throw", () => {
    const t = new NoopErrorTracker();
    expect(() => t.addBreadcrumb({ message: "click", category: "ui" })).not.toThrow();
    expect(() =>
      t.addBreadcrumb({
        message: "request",
        category: "http",
        level: "info",
        data: { url: "/x", status: 200 },
        timestamp: Date.now(),
      }),
    ).not.toThrow();
  });

  test("withScope runs callback and returns its value; scope methods do not throw", () => {
    const t = new NoopErrorTracker();
    const result = t.withScope((scope) => {
      scope.setUser({ id: "u" });
      scope.setUser(null);
      scope.setTag("k", "v");
      scope.setExtra("x", 1);
      scope.setExtra("obj", { nested: true });
      scope.setTenant("t");
      scope.setTenant(null);
      return 7;
    });
    expect(result).toBe(7);
  });

  test("flush() resolves to true", async () => {
    const t = new NoopErrorTracker();
    await expect(t.flush()).resolves.toBe(true);
    await expect(t.flush(50)).resolves.toBe(true);
    await expect(t.flush(0)).resolves.toBe(true);
  });

  test("NoopErrorTracker is structurally assignable to ErrorTracker", () => {
    // Compile-time proof — if NoopErrorTracker drifts from the port
    // this line will fail typecheck, not runtime.
    const _assignable: ErrorTracker = new NoopErrorTracker();
    void _assignable;
    expect(true).toBe(true);
  });
});
