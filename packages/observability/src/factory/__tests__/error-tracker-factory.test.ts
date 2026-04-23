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

  test("returns PinoErrorTracker when ERROR_TRACKER is unset (Phase 18 default per D-06 — widened from noop)", () => {
    delete process.env.ERROR_TRACKER;
    const t = getErrorTracker();
    expect(t.name).toBe("pino");
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
    // Phase 18 valid values: noop, pino, sentry, glitchtip. Use a value that
    // cannot be mistaken for a real adapter across phases.
    process.env.ERROR_TRACKER = "banana";
    expect(() => getErrorTracker()).toThrow(/Unknown ERROR_TRACKER/);
    expect(() => getErrorTracker()).toThrow(/banana/);
  });

  test("returns NoopErrorTracker when ERROR_TRACKER='noop' explicitly", () => {
    process.env.ERROR_TRACKER = "noop";
    expect(getErrorTracker()).toBeInstanceOf(NoopErrorTracker);
  });
});

// ---------------------------------------------------------------------------
// Phase 18 — extended switch: pino, sentry, glitchtip (D-05, D-06, D-09)
// ---------------------------------------------------------------------------

describe("getErrorTracker — Phase 18 adapters", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetErrorTracker();
    delete process.env.ERROR_TRACKER;
    delete process.env.SENTRY_DSN;
    delete process.env.GLITCHTIP_DSN;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    resetErrorTracker();
  });

  test("default when ERROR_TRACKER unset is 'pino' (D-06)", () => {
    const tracker = getErrorTracker();
    expect(tracker.name).toBe("pino");
  });

  test("ERROR_TRACKER=noop returns Noop adapter (backcompat)", () => {
    process.env.ERROR_TRACKER = "noop";
    expect(getErrorTracker().name).toBe("noop");
  });

  test("ERROR_TRACKER=pino returns Pino adapter", () => {
    process.env.ERROR_TRACKER = "pino";
    expect(getErrorTracker().name).toBe("pino");
  });

  test("ERROR_TRACKER=sentry + SENTRY_DSN returns Sentry adapter", () => {
    process.env.ERROR_TRACKER = "sentry";
    process.env.SENTRY_DSN = "http://public@example.com/1";
    expect(getErrorTracker().name).toBe("sentry");
  });

  test("ERROR_TRACKER=glitchtip + GLITCHTIP_DSN returns GlitchTip adapter", () => {
    process.env.ERROR_TRACKER = "glitchtip";
    process.env.GLITCHTIP_DSN = "http://public@example.com/1";
    expect(getErrorTracker().name).toBe("glitchtip");
  });

  test("ERROR_TRACKER=sentry without SENTRY_DSN throws", () => {
    process.env.ERROR_TRACKER = "sentry";
    expect(() => getErrorTracker()).toThrow(/SENTRY_DSN/);
  });

  test("ERROR_TRACKER=glitchtip without GLITCHTIP_DSN throws", () => {
    process.env.ERROR_TRACKER = "glitchtip";
    expect(() => getErrorTracker()).toThrow(/GLITCHTIP_DSN/);
  });

  test("Unknown ERROR_TRACKER throws with supported-list message", () => {
    process.env.ERROR_TRACKER = "kiwi";
    expect(() => getErrorTracker()).toThrow(/Unknown ERROR_TRACKER/);
    expect(() => getErrorTracker()).toThrow(/noop.*pino.*sentry.*glitchtip/);
  });
});
