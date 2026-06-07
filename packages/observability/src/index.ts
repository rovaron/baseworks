// @baseworks/observability — Phase 17 ports + noop adapters + env-selected factory.
// Barrel is populated incrementally by Phase 17 tasks. Plan 02 appends factory exports.

export { NoopErrorTracker } from "./adapters/noop/noop-error-tracker";
export { NoopMetricsProvider } from "./adapters/noop/noop-metrics";
export { NoopTracer } from "./adapters/noop/noop-tracer";
// Pino-sink adapter (Phase 18 / ERR-03 / D-07).
export { PinoErrorTracker } from "./adapters/pino/pino-error-tracker";
export type { SentryErrorTrackerOptions } from "./adapters/sentry/sentry-error-tracker";
// Sentry/GlitchTip adapter (Phase 18 / ERR-01 / ERR-02 / D-05).
export { SentryErrorTracker } from "./adapters/sentry/sentry-error-tracker";
export type { ObservabilityContext } from "./context";
// ObservabilityContext ALS + mutators (Phase 19 / CTX-01 / D-06).
export {
  getObsContext,
  obsContext,
  setLocale,
  setSpan,
  setTenantContext,
} from "./context";
// Env-selected singleton factories (Plan 17-02).
export {
  getErrorTracker,
  getMetrics,
  getTracer,
  resetErrorTracker,
  resetMetrics,
  resetTracer,
  setErrorTracker,
  setMetrics,
  setTracer,
} from "./factory";
export type {
  HeartbeatPayload,
  HeartbeatPublisherHandle,
  HeartbeatPublisherOptions,
} from "./health/heartbeat";
// Phase 22 / EXT-02 — worker heartbeat publisher/reader.
export { readHeartbeats, startHeartbeatPublisher } from "./health/heartbeat";
// Phase 22 / EXT-02 / D-12 — instance-id resolver for worker heartbeats.
export { resolveInstanceId } from "./instance-id";
// Global error handlers (Phase 18 / D-02).
export { installGlobalErrorHandlers } from "./lib/install-global-error-handlers";
export type { RingBufferEntry } from "./lib/ring-buffer-error-tracker";
// Phase 22 / D-15 — recent-errors ringbuffer decorator (consumed by apps/api/src/index.ts).
export { RingBufferingErrorTracker } from "./lib/ring-buffer-error-tracker";
export type { PiiEvent } from "./lib/scrub-pii";
// PII scrubber (Phase 18 / ERR-04 / D-12).
export { DEFAULT_DENY_KEYS, scrubPii } from "./lib/scrub-pii";
// ErrorTracker port + Noop adapter (Task 17-01-03).
export type {
  Breadcrumb,
  CaptureScope,
  ErrorTracker,
  ErrorTrackerScope,
} from "./ports/error-tracker";
// MetricsProvider port + Noop adapter (Task 17-01-02).
export type { Counter, Gauge, Histogram, MetricsProvider } from "./ports/metrics";
// Tracer port + Noop adapter (Task 17-01-01).
export type { Span, SpanOptions, Tracer } from "./ports/tracer";
export type { Attributes, LogLevel, TraceCarrier } from "./ports/types";
export type { BusLike } from "./wrappers/wrap-cqrs-bus";
// CqrsBus wrapper (Phase 18 / D-01 — no edits to core/cqrs.ts).
export { wrapCqrsBus } from "./wrappers/wrap-cqrs-bus";
export type { EventBusLike } from "./wrappers/wrap-event-bus";
// EventBus wrapper (Phase 19 / TRC-02 / D-15 / D-16 — no edits to core/event-bus.ts).
export { wrapEventBus } from "./wrappers/wrap-event-bus";
// Queue producer wrapper (Phase 20 / CTX-04 / TRC-03 / D-02 — no edits to packages/queue call sites).
export { wrapQueue } from "./wrappers/wrap-queue";
