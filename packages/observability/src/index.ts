// @baseworks/observability — Phase 17 ports + noop adapters + env-selected factory.
// Barrel is populated incrementally by Phase 17 tasks. Plan 02 appends factory exports.
export type { Attributes, TraceCarrier, LogLevel } from "./ports/types";

// Tracer port + Noop adapter (Task 17-01-01).
export type { Tracer, Span, SpanOptions } from "./ports/tracer";
export { NoopTracer } from "./adapters/noop/noop-tracer";

// MetricsProvider port + Noop adapter (Task 17-01-02).
export type { MetricsProvider, Counter, Histogram, Gauge } from "./ports/metrics";
export { NoopMetricsProvider } from "./adapters/noop/noop-metrics";

// ErrorTracker port + Noop adapter (Task 17-01-03).
export type {
  ErrorTracker,
  Breadcrumb,
  ErrorTrackerScope,
  CaptureScope,
} from "./ports/error-tracker";
export { NoopErrorTracker } from "./adapters/noop/noop-error-tracker";

// Env-selected singleton factories (Plan 17-02).
export {
  getTracer,
  setTracer,
  resetTracer,
  getMetrics,
  setMetrics,
  resetMetrics,
  getErrorTracker,
  setErrorTracker,
  resetErrorTracker,
} from "./factory";

// PII scrubber (Phase 18 / ERR-04 / D-12).
export { scrubPii, DEFAULT_DENY_KEYS } from "./lib/scrub-pii";
export type { PiiEvent } from "./lib/scrub-pii";

// Global error handlers (Phase 18 / D-02).
export { installGlobalErrorHandlers } from "./lib/install-global-error-handlers";

// CqrsBus wrapper (Phase 18 / D-01 — no edits to core/cqrs.ts).
export { wrapCqrsBus } from "./wrappers/wrap-cqrs-bus";
export type { BusLike } from "./wrappers/wrap-cqrs-bus";

// Pino-sink adapter (Phase 18 / ERR-03 / D-07).
export { PinoErrorTracker } from "./adapters/pino/pino-error-tracker";

// Sentry/GlitchTip adapter (Phase 18 / ERR-01 / ERR-02 / D-05).
export { SentryErrorTracker } from "./adapters/sentry/sentry-error-tracker";
export type { SentryErrorTrackerOptions } from "./adapters/sentry/sentry-error-tracker";

// ObservabilityContext ALS + mutators (Phase 19 / CTX-01 / D-06).
export {
  obsContext,
  getObsContext,
  setTenantContext,
  setSpan,
  setLocale,
} from "./context";
export type { ObservabilityContext } from "./context";

// EventBus wrapper (Phase 19 / TRC-02 / D-15 / D-16 — no edits to core/event-bus.ts).
export { wrapEventBus } from "./wrappers/wrap-event-bus";
export type { EventBusLike } from "./wrappers/wrap-event-bus";

// Queue producer wrapper (Phase 20 / CTX-04 / TRC-03 / D-02 — no edits to packages/queue call sites).
export { wrapQueue } from "./wrappers/wrap-queue";
