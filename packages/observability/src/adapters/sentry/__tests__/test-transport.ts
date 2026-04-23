/**
 * In-memory test transport for Sentry adapter conformance tests
 * (Phase 18 / D-11 / A2 resolution).
 *
 * RESEARCH A2 flagged that no pre-built mock-transport export exists in
 * the Sentry Bun SDK. The canonical pattern (Sentry PR
 * sentry-javascript#6826) is to construct a custom transport via
 * `createTransport` from `@sentry/core`. This helper captures envelopes
 * in-process so offline conformance tests can assert on emitted event
 * shape without any network traffic.
 *
 * Usage (from a test):
 *   const t = makeTestTransport();
 *   const adapter = new SentryErrorTracker({
 *     dsn: "http://public@example.com/1",
 *     kind: "sentry",
 *     transport: t.transport,
 *   });
 *   adapter.captureException(new Error("x"));
 *   await adapter.flush(100);
 *   // t.captured now contains the envelope bytes for assertion.
 *
 * Helper exports:
 * - transport: Transport factory passed to `Sentry.init({ transport })`
 * - captured: envelopes captured in insertion order
 * - reset(): clear captured[] in place (stable reference for beforeEach reuse)
 */
import { createTransport } from "@sentry/core";
import type {
  Transport,
  TransportMakeRequestResponse,
} from "@sentry/core";

export interface TestTransportHandle {
  /** Transport factory — pass to Sentry.init({ transport }). */
  transport: (options: unknown) => Transport;
  /** Envelope bytes captured in insertion order. */
  captured: Array<string | Uint8Array>;
  /** Clear the captured[] array without reassigning the reference. */
  reset: () => void;
}

/**
 * Construct an in-memory Sentry Transport for offline conformance tests.
 *
 * @returns Handle exposing the transport factory, captured envelopes,
 *   and a reset() that clears captures without changing the array ref.
 */
export function makeTestTransport(): TestTransportHandle {
  const captured: Array<string | Uint8Array> = [];

  const factory = (options: unknown): Transport =>
    createTransport(
      options as Parameters<typeof createTransport>[0],
      async (req: { body: string | Uint8Array }) => {
        captured.push(req.body);
        return { statusCode: 200 } as TransportMakeRequestResponse;
      },
    );

  return {
    transport: factory,
    captured,
    reset: () => {
      captured.length = 0;
    },
  };
}
