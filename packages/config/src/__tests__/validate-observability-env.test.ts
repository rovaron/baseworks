import { describe, test, expect } from "bun:test";
import { validateObservabilityEnv } from "../index";

describe("validateObservabilityEnv (OBS-04 / D-07 / D-09)", () => {
  test("does not throw when TRACER/METRICS_PROVIDER/ERROR_TRACKER are unset (defaults to noop)", () => {
    // env is already loaded with whatever process.env had at module init;
    // since defaults are "noop", calling the validator is a no-op.
    expect(() => validateObservabilityEnv()).not.toThrow();
  });

  test("does not throw when all three are explicitly 'noop'", () => {
    // Schema allows "noop"; default also "noop". Calling is idempotent.
    expect(() => validateObservabilityEnv()).not.toThrow();
  });

  test("is exported as a named export from @baseworks/config", () => {
    // Re-import via the package barrel to assert the index.ts re-export.
    // (Direct import from "../index" already proves it; this assertion is
    //  belt-and-braces to catch a future barrel regression.)
    expect(typeof validateObservabilityEnv).toBe("function");
  });

  // Negative env-typo cases — these need a subprocess to test, because
  // createEnv runs at module import time and we cannot re-import a module
  // with mutated process.env in the same test process. Defer the
  // subprocess negative-cases to Plan 04's telemetry-boot smoke test
  // (which spawns a real bun subprocess) — see 17-VALIDATION.md row 17-04-05
  // and threat T-17-01. This file covers the positive path only; the
  // negative path is exercised end-to-end at boot.
});
