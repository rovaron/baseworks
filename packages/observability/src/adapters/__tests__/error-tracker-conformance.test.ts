/**
 * Cross-adapter PII conformance test (ERR-04 / Phase 18 D-11, D-14).
 *
 * Runs the 13 hand-crafted PII_FIXTURES through every writing adapter
 * (pino, sentry) and asserts that every `shouldNotAppear` substring is
 * absent AND every `shouldSurvive` substring is present in the emitted
 * output. The same 13 fixtures exercise both code paths — if any
 * adapter leaks a secret, the test fails with the fixture name.
 *
 * No env-dependent skips — Sentry runs against the in-memory test
 * transport (D-11 / A2). No CI secrets, no real network.
 *
 * Hub discipline: `afterEach(Sentry.close)` is mandatory in the sentry
 * adapter describe. The Sentry hub is process-global; without close()
 * between the 13 fixture runs the hub accumulates integrations and
 * transport state across calls (T-18-32).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as Sentry from "@sentry/bun";
import { pino } from "pino";
import type { Logger } from "pino";
import { PII_FIXTURES, type PiiFixture } from "./pii-fixtures";
import { PinoErrorTracker } from "../pino/pino-error-tracker";
import { SentryErrorTracker } from "../sentry/sentry-error-tracker";
import { NoopErrorTracker } from "../noop/noop-error-tracker";
import { makeTestTransport } from "../sentry/__tests__/test-transport";

const TEST_DSN = "http://public@example.com/1";

/**
 * Reassemble captured transport envelope bytes into a single searchable
 * string. Sentry envelopes are newline-delimited JSON lines; joining with
 * "\n" preserves line boundaries so shouldNotAppear/shouldSurvive substring
 * checks see the full serialized payload.
 */
function envelopeText(captured: Array<string | Uint8Array>): string {
  return captured
    .map((c) => (typeof c === "string" ? c : Buffer.from(c).toString("utf8")))
    .join("\n");
}

describe("ErrorTracker conformance — PII scrubbing across adapters", () => {
  describe("pino adapter", () => {
    let logged: unknown[];
    let tracker: PinoErrorTracker;

    beforeEach(() => {
      logged = [];
      const stream = {
        write(chunk: string) {
          try {
            logged.push(JSON.parse(chunk));
          } catch {
            logged.push(chunk);
          }
        },
      };
      // pino({level}, stream) returns Logger<never, boolean>; the adapter
      // accepts the default Logger<string, boolean>. Cast via unknown per
      // Plan 18-04 precedent (runtime shape is identical).
      const fakeLogger = pino({ level: "debug" }, stream as never) as unknown as Logger;
      tracker = new PinoErrorTracker(fakeLogger);
    });

    for (const fixture of PII_FIXTURES as PiiFixture[]) {
      test(`[${fixture.name}]`, () => {
        tracker.captureException(fixture.input.err, fixture.input.scope);
        // Webhook-route fixtures carry an event.request object — exercise
        // the route rule by re-capturing with the event attached to extra.
        if (fixture.input.event) {
          tracker.captureException(new Error("event-wrapped"), {
            extra: { event: fixture.input.event },
          });
        }
        const output = JSON.stringify(logged);
        for (const secret of fixture.shouldNotAppear ?? []) {
          expect(output).not.toContain(secret);
        }
        for (const survivor of fixture.shouldSurvive ?? []) {
          expect(output).toContain(survivor);
        }
      });
    }
  });

  describe("sentry adapter", () => {
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

    // REQUIRED: close Sentry between fixtures so the process-global hub
    // does not accumulate state across 13+ Sentry.init calls driven by
    // the fixture loop. Drops stale integrations + transport.
    afterEach(async () => {
      await Sentry.close(100);
    });

    for (const fixture of PII_FIXTURES as PiiFixture[]) {
      test(`[${fixture.name}]`, async () => {
        tracker.captureException(fixture.input.err, fixture.input.scope);
        if (fixture.input.event) {
          tracker.captureException(new Error("event-wrapped"), {
            extra: { event: fixture.input.event },
          });
        }
        await tracker.flush(500);
        const output = envelopeText(handle.captured);
        for (const secret of fixture.shouldNotAppear ?? []) {
          expect(output).not.toContain(secret);
        }
        for (const survivor of fixture.shouldSurvive ?? []) {
          expect(output).toContain(survivor);
        }
      });
    }
  });

  describe("noop adapter — smoke", () => {
    const tracker = new NoopErrorTracker();
    for (const fixture of PII_FIXTURES as PiiFixture[]) {
      test(`[${fixture.name}] does not throw`, () => {
        expect(() =>
          tracker.captureException(fixture.input.err, fixture.input.scope),
        ).not.toThrow();
      });
    }
  });
});
