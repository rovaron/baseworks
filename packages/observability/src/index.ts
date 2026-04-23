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
