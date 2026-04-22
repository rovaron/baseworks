/**
 * ErrorTracker factory unit tests (OBS-01).
 *
 * Covers the six canonical behaviors of every observability factory:
 * default-to-noop, singleton identity, reset, set-injection, unknown-value
 * throw, and explicit "noop" parity with default.
 *
 * NOTE: Phase 17 default is 'noop' per D-03; Phase 18 changes the default to
 * 'pino' when the pino-sink adapter lands. Update the first test then.
 *
 * Env-var-based tests use process.env directly (not bun:test's mock.module)
 * because the env-var path is what we're exercising. beforeEach/afterEach
 * reset the singleton and restore the pre-test ERROR_TRACKER value so tests
 * do not bleed state.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { NoopErrorTracker } from "../../adapters/noop/noop-error-tracker";
import {
  getErrorTracker,
  setErrorTracker,
  resetErrorTracker,
} from "../../factory";
import type { ErrorTracker } from "../../ports/error-tracker";

describe("error tracker factory (OBS-01)", () => {
  const origErrorTracker = process.env.ERROR_TRACKER;

  beforeEach(() => {
    resetErrorTracker();
  });
  afterEach(() => {
    resetErrorTracker();
    if (origErrorTracker === undefined) delete process.env.ERROR_TRACKER;
    else process.env.ERROR_TRACKER = origErrorTracker;
  });

  test("returns NoopErrorTracker when ERROR_TRACKER is unset (Phase 17 default — Phase 18 changes default to 'pino')", () => {
    delete process.env.ERROR_TRACKER;
    const t = getErrorTracker();
    expect(t).toBeInstanceOf(NoopErrorTracker);
    expect(t.name).toBe("noop");
  });

  test("returns the same singleton across calls", () => {
    delete process.env.ERROR_TRACKER;
    const a = getErrorTracker();
    const b = getErrorTracker();
    expect(a).toBe(b);
  });

  test("resetErrorTracker() forces a new instance on next get", () => {
    delete process.env.ERROR_TRACKER;
    const a = getErrorTracker();
    resetErrorTracker();
    const b = getErrorTracker();
    expect(a).not.toBe(b);
  });

  test("setErrorTracker() injects a mock that getErrorTracker() returns", () => {
    const mock: ErrorTracker = new NoopErrorTracker(); // any ErrorTracker-shaped value
    setErrorTracker(mock);
    expect(getErrorTracker()).toBe(mock);
  });

  test("getErrorTracker() throws on unknown ERROR_TRACKER value", () => {
    process.env.ERROR_TRACKER = "sentry";
    expect(() => getErrorTracker()).toThrow(/Phase 17 supports only 'noop'/);
    expect(() => getErrorTracker()).toThrow(/sentry/);
  });

  test("returns NoopErrorTracker when ERROR_TRACKER='noop' explicitly", () => {
    process.env.ERROR_TRACKER = "noop";
    expect(getErrorTracker()).toBeInstanceOf(NoopErrorTracker);
  });
});
