/**
 * Noop Tracer adapter (OBS-03).
 *
 * Default adapter when `TRACER` is unset or `=noop`. Zero external traffic,
 * zero allocation beyond the per-call `NoopSpan` (spans are stateless; GC
 * reclaims them immediately after `end()` or after `withSpan` resolves).
 *
 * Design rule: NEVER throws on any input. Acceptance criterion asserts zero
 * `throw` statements in this file (17-PATTERNS.md "Anti-patterns").
 */

import type { Span, SpanOptions, Tracer } from "../../ports/tracer";
import type { TraceCarrier } from "../../ports/types";

/**
 * No-op Span. Every method discards its arguments.
 */
class NoopSpan implements Span {
  end(): void {}
  setAttribute(_key: string, _value: string | number | boolean): void {}
  setStatus(_status: { code: "ok" | "error"; message?: string }): void {}
  recordException(_err: unknown): void {}
}

/**
 * Default Tracer adapter. Every operation is a no-op. Returned by
 * `getTracer()` (Plan 02) when `TRACER` is unset or `=noop`.
 */
export class NoopTracer implements Tracer {
  readonly name = "noop";

  /**
   * Return a fresh NoopSpan. Never throws; never null.
   *
   * @param _name - Span name (ignored)
   * @param _options - Span options (ignored)
   * @returns A NoopSpan instance
   */
  startSpan(_name: string, _options?: SpanOptions): Span {
    return new NoopSpan();
  }

  /**
   * Invoke `fn` with a fresh NoopSpan and await the result. Errors from
   * `fn` propagate — the Noop adapter does not swallow them (matching the
   * expected OtelTracer semantics).
   *
   * @param _name - Span name (ignored)
   * @param fn - Callback receiving the span
   * @param _options - Span options (ignored)
   * @returns The awaited result of `fn`
   */
  async withSpan<T>(
    _name: string,
    fn: (span: Span) => T | Promise<T>,
    _options?: SpanOptions,
  ): Promise<T> {
    return await fn(new NoopSpan());
  }

  /**
   * No-op: carrier is left unchanged.
   *
   * @param _carrier - Trace carrier (ignored)
   */
  inject(_carrier: TraceCarrier): void {}

  /**
   * No-op: carrier content is not consumed.
   *
   * @param _carrier - Trace carrier (ignored)
   */
  extract(_carrier: TraceCarrier): void {}

  /**
   * Always returns an empty carrier — the Noop adapter has no context to
   * propagate.
   *
   * @returns Empty object
   */
  currentCarrier(): TraceCarrier {
    return {};
  }
}
