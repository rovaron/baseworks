/**
 * Tracer port interface (OBS-03).
 *
 * Contract for distributed-tracing adapters. Phase 17 ships NoopTracer;
 * Phase 21 adds OtelTracer backed by @opentelemetry/api.
 *
 * Design decisions:
 * - `startSpan` returns a Span object (never null) so call sites never branch.
 * - `withSpan` is the preferred API for scoped spans — handles end() in finally.
 * - `inject`/`extract` operate on a `TraceCarrier` (Record<string,string>) to
 *   keep the port transport-agnostic (HTTP headers, BullMQ job.data._otel, etc.).
 * - Attribute values are limited to scalar primitives — matches OTEL's wire
 *   constraints. See `packages/observability/src/ports/types.ts`.
 */

import type { Attributes, TraceCarrier } from "./types";

/**
 * A live tracing span. Returned by `Tracer.startSpan` and passed to the
 * callback of `Tracer.withSpan`. All methods are no-ops on Noop adapters.
 */
export interface Span {
  /**
   * End the span. Safe to call multiple times (adapters must idempotently
   * ignore extra calls).
   */
  end(): void;

  /**
   * Attach a single attribute to the span.
   *
   * @param key - Attribute key (OTEL convention: dot-notation, e.g., `http.method`)
   * @param value - Scalar attribute value
   */
  setAttribute(key: string, value: string | number | boolean): void;

  /**
   * Mark the span as successful or errored.
   *
   * @param status - Status code (`ok` or `error`) and optional message
   */
  setStatus(status: { code: "ok" | "error"; message?: string }): void;

  /**
   * Record an exception on the span without ending it.
   *
   * @param err - Error object or arbitrary thrown value
   */
  recordException(err: unknown): void;
}

/**
 * Options accepted by `Tracer.startSpan` and `Tracer.withSpan`.
 */
export interface SpanOptions {
  /** Initial attribute bag. */
  attributes?: Attributes;
  /** Span kind — maps to OTEL's `SpanKind` enum on Phase 21 adapters. */
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
  /**
   * Optional pre-attached OTEL Links — used by Phase 19 observabilityMiddleware
   * (D-07) to attach an untrusted inbound `traceparent` as a non-parent
   * correlation. Noop tracer ignores; Phase 21 OtelTracer maps to the OTEL
   * Link API at `startSpan` time.
   */
  links?: Array<{ traceId: string; spanId: string }>;
}

/**
 * Tracer port. Every adapter exposes the same surface — call sites never
 * branch on adapter identity.
 */
export interface Tracer {
  /** Adapter identifier (e.g., `"noop"`, `"otel"`). */
  readonly name: string;

  /**
   * Start a new span. Caller is responsible for calling `end()`. Prefer
   * `withSpan` for scoped usage.
   *
   * @param name - Span name (OTEL convention: verb + noun, e.g., `http.GET`)
   * @param options - Initial attributes and span kind
   * @returns Active span
   */
  startSpan(name: string, options?: SpanOptions): Span;

  /**
   * Run `fn` inside a span that ends automatically (success or failure).
   * The adapter is expected to catch thrown errors, call `recordException`
   * + `setStatus({ code: "error" })`, and rethrow.
   *
   * @param name - Span name
   * @param fn - Function that receives the active span
   * @param options - Initial attributes and span kind
   * @returns Whatever `fn` returns (awaited)
   */
  withSpan<T>(
    name: string,
    fn: (span: Span) => T | Promise<T>,
    options?: SpanOptions,
  ): Promise<T>;

  /**
   * Inject the current trace context into a transport-neutral carrier.
   *
   * @param carrier - Record that will be mutated to hold the context
   */
  inject(carrier: TraceCarrier): void;

  /**
   * Extract a trace context from a carrier and set it as the active context
   * for subsequent spans.
   *
   * @param carrier - Record containing a previously-injected context
   */
  extract(carrier: TraceCarrier): void;

  /**
   * Capture the current trace context as a fresh carrier.
   *
   * @returns Carrier populated with the current context (empty under Noop)
   */
  currentCarrier(): TraceCarrier;
}

// Re-export types for convenience
export type { Attributes, TraceCarrier } from "./types";
