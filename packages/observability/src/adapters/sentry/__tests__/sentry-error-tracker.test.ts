/**
 * SentryErrorTracker unit tests (ERR-01 / ERR-02 / Phase 18 D-05, D-15 / A1 Option C).
 *
 * Covers both the adapter class and its `buildInitOptions` pure helper.
 * Every describe that constructs SentryErrorTracker calls `Sentry.close(100)`
 * in afterEach — the Sentry hub is a process-global side effect, and without
 * the teardown it accumulates integrations/transports across the 11+ init
 * calls made here plus the 26+ calls made by the conformance test.
 *
 * A2 resolution: all tests use `makeTestTransport()` (no real network).
 * DSN is RFC 2606 reserved (`example.com`) — cannot accidentally hit Sentry.
 *
 * LogLevel note: plan Test 5 used `"warn"` but `ports/types.ts` LogLevel
 * uses `"warning"` (Sentry-native vocabulary). Same discrepancy Plan 18-04
 * hit — fixed at authoring time to match the authoritative port vocabulary.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as Sentry from "@sentry/bun";
import { SentryErrorTracker } from "../sentry-error-tracker";
import { buildInitOptions } from "../init-options";
import { makeTestTransport } from "./test-transport";

const TEST_DSN = "http://public@example.com/1";

describe("SentryErrorTracker", () => {
  let handle: ReturnType<typeof makeTestTransport>;
  let tracker: SentryErrorTracker;

  beforeEach(() => {
    handle = makeTestTransport();
    tracker = new SentryErrorTracker({
      dsn: TEST_DSN,
      kind: "sentry",
      transport: handle.transport,
    });
  });

  // REQUIRED: Sentry.init is a process-global side effect. Without
  // Sentry.close() between tests, the hub accumulates state across the
  // 13+ Sentry.init calls made in this file + the conformance test,
  // causing later tests to see stale integrations / transports.
  afterEach(async () => {
    await Sentry.close(100);
  });

  test('name="sentry" when kind="sentry"', () => {
    expect(tracker.name).toBe("sentry");
  });

  test('name="glitchtip" when kind="glitchtip"', () => {
    const h = makeTestTransport();
    const t = new SentryErrorTracker({
      dsn: TEST_DSN,
      kind: "glitchtip",
      transport: h.transport,
    });
    expect(t.name).toBe("glitchtip");
  });

  test("captureException produces an envelope containing the error message", async () => {
    tracker.captureException(new Error("boom"));
    await tracker.flush(200);
    expect(handle.captured.length).toBeGreaterThanOrEqual(1);
    const body = handle.captured
      .map((c) => (typeof c === "string" ? c : Buffer.from(c).toString("utf8")))
      .join("\n");
    expect(body).toContain("boom");
  });

  test("beforeSend scrubs PII — password does not appear in envelope", async () => {
    tracker.captureException(new Error("x"), {
      extra: { password: "hunter2" },
    });
    await tracker.flush(200);
    const body = handle.captured
      .map((c) => (typeof c === "string" ? c : Buffer.from(c).toString("utf8")))
      .join("\n");
    expect(body).not.toContain("hunter2");
  });

  test("captureMessage forwards with level (warning)", async () => {
    tracker.captureMessage("warn-msg", "warning");
    await tracker.flush(200);
    const body = handle.captured
      .map((c) => (typeof c === "string" ? c : Buffer.from(c).toString("utf8")))
      .join("\n");
    expect(body).toContain("warn-msg");
  });

  test("withScope returns the callback result", () => {
    expect(tracker.withScope(() => 42)).toBe(42);
  });

  test("flush resolves a boolean", async () => {
    const ok = await tracker.flush(200);
    expect(typeof ok).toBe("boolean");
  });
});

describe("buildInitOptions", () => {
  test("sendDefaultPii is hard-coded to false", () => {
    const opts = buildInitOptions({ dsn: TEST_DSN });
    expect(opts.sendDefaultPii).toBe(false);
  });

  test("defaultIntegrations is false (A1 resolution)", () => {
    const opts = buildInitOptions({ dsn: TEST_DSN });
    expect(opts.defaultIntegrations).toBe(false);
  });

  test("integrations has exactly 4 safe integrations (Option C)", () => {
    const opts = buildInitOptions({ dsn: TEST_DSN });
    expect(Array.isArray(opts.integrations)).toBe(true);
    expect((opts.integrations as unknown[]).length).toBe(4);
  });

  test("beforeSend strips PII", () => {
    const opts = buildInitOptions({ dsn: TEST_DSN });
    // biome-ignore lint/suspicious/noExplicitAny: Sentry's beforeSend hook signature is permissive by design
    const out = (opts.beforeSend as any)(
      { extra: { password: "hunter2" } },
      {},
    );
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  test("passes transport through unchanged", () => {
    const h = makeTestTransport();
    const opts = buildInitOptions({ dsn: TEST_DSN, transport: h.transport });
    expect(opts.transport).toBe(h.transport);
  });
});
