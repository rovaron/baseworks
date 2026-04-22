/**
 * Shared port types for the @baseworks/observability package.
 *
 * These types are referenced by more than one port (e.g., `Attributes`
 * is shared by every metric instrument; `LogLevel` is shared by
 * `ErrorTracker.captureMessage` and `Breadcrumb`). Port-specific
 * types (`Span`, `SpanOptions`, `Counter`, `Histogram`, `Gauge`,
 * `Breadcrumb`, `ErrorTrackerScope`) live alongside the port they
 * belong to — matching the billing precedent at
 * `packages/modules/billing/src/ports/types.ts` (cross-port types only).
 */

/**
 * Attribute bag carried on spans and metric instruments.
 *
 * Intentionally a narrow scalar union — adapters (Phase 21 OTEL)
 * require primitive attribute values; object or array values would
 * be dropped on export. Keeping the type narrow at the port forces
 * callers to stringify upstream.
 */
export type Attributes = Record<string, string | number | boolean>;

/**
 * Wire-level trace context carrier.
 *
 * Used by `Tracer.inject` / `Tracer.extract` / `Tracer.currentCarrier`
 * to propagate the current span context across transport boundaries
 * (HTTP headers, BullMQ job.data._otel, etc.). Kept as a plain
 * `Record<string, string>` so the port stays transport-agnostic.
 */
export type TraceCarrier = Record<string, string>;

/**
 * Severity level for error/log capture.
 *
 * Matches the Sentry/GlitchTip vocabulary so Phase 18 adapters do not
 * need to translate levels. Noop adapters accept and ignore the value.
 */
export type LogLevel = "debug" | "info" | "warning" | "error" | "fatal";
