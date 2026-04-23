/**
 * Observability port singleton factories (OBS-01, OBS-02, OBS-03).
 *
 * Three lazy-singleton factories — one per port — selected by env var:
 *   - TRACER           → getTracer()         default "noop"
 *   - METRICS_PROVIDER → getMetrics()        default "noop"
 *   - ERROR_TRACKER    → getErrorTracker()   default "noop" (Phase 17 only — Phase 18 changes default to "pino")
 *
 * Each factory ships a `set*` + `reset*` trio for tests (D-02), mirroring
 * `setPaymentProvider`/`resetPaymentProvider` in provider-factory.ts.
 *
 * IMPORTANT: This file reads `process.env` directly. It does NOT import
 * `@baseworks/config` so it can be safely loaded by `apps/api/src/telemetry.ts`
 * (which obeys D-06 — no @baseworks/config import before sdk.start()).
 */
import { pino } from "pino";
import type { Tracer } from "./ports/tracer";
import type { MetricsProvider } from "./ports/metrics";
import type { ErrorTracker } from "./ports/error-tracker";
import { NoopTracer } from "./adapters/noop/noop-tracer";
import { NoopMetricsProvider } from "./adapters/noop/noop-metrics";
import { NoopErrorTracker } from "./adapters/noop/noop-error-tracker";
import { PinoErrorTracker } from "./adapters/pino/pino-error-tracker";
import { SentryErrorTracker } from "./adapters/sentry/sentry-error-tracker";

// ---------------------------------------------------------------------------
// Tracer (OBS-03)
// ---------------------------------------------------------------------------

let tracerInstance: Tracer | null = null;

/**
 * Return the cached Tracer instance, creating it on first call based on
 * the TRACER env var. Defaults to "noop" when unset (D-03 / Phase 17 only).
 *
 * @returns The singleton Tracer instance
 * @throws Error if TRACER is set to an unsupported value
 *
 * @example
 * const tracer = getTracer();
 * tracer.startSpan("op").end();
 */
export function getTracer(): Tracer {
  if (!tracerInstance) {
    const name = process.env.TRACER ?? "noop";
    switch (name) {
      case "noop":
        tracerInstance = new NoopTracer();
        break;
      // Phase 21 will add: case "otel": tracerInstance = new OtelTracer(...);
      default:
        throw new Error(
          `Unknown TRACER: ${name}. Phase 17 supports only 'noop'.`,
        );
    }
  }
  return tracerInstance;
}

/**
 * Reset the Tracer singleton. Used in tests to inject mocks via setTracer.
 *
 * @returns void
 */
export function resetTracer(): void {
  tracerInstance = null;
}

/**
 * Set the Tracer singleton directly. Used in tests to inject a mock
 * Tracer without env var configuration.
 *
 * @param tracer - The Tracer instance to use
 * @returns void
 */
export function setTracer(tracer: Tracer): void {
  tracerInstance = tracer;
}

// ---------------------------------------------------------------------------
// MetricsProvider (OBS-02)
// ---------------------------------------------------------------------------

let metricsInstance: MetricsProvider | null = null;

/**
 * Return the cached MetricsProvider instance, creating it on first call
 * based on the METRICS_PROVIDER env var. Defaults to "noop" when unset
 * (D-03 / Phase 17 only).
 *
 * @returns The singleton MetricsProvider instance
 * @throws Error if METRICS_PROVIDER is set to an unsupported value
 *
 * @example
 * const metrics = getMetrics();
 * metrics.counter("requests.total").inc();
 */
export function getMetrics(): MetricsProvider {
  if (!metricsInstance) {
    const name = process.env.METRICS_PROVIDER ?? "noop";
    switch (name) {
      case "noop":
        metricsInstance = new NoopMetricsProvider();
        break;
      // Phase 21 will add: case "otel": metricsInstance = new OtelMetricsProvider(...);
      default:
        throw new Error(
          `Unknown METRICS_PROVIDER: ${name}. Phase 17 supports only 'noop'.`,
        );
    }
  }
  return metricsInstance;
}

/**
 * Reset the MetricsProvider singleton. Used in tests to inject mocks via setMetrics.
 *
 * @returns void
 */
export function resetMetrics(): void {
  metricsInstance = null;
}

/**
 * Set the MetricsProvider singleton directly. Used in tests to inject a
 * mock MetricsProvider without env var configuration.
 *
 * @param metrics - The MetricsProvider instance to use
 * @returns void
 */
export function setMetrics(metrics: MetricsProvider): void {
  metricsInstance = metrics;
}

// ---------------------------------------------------------------------------
// ErrorTracker (OBS-01)
// ---------------------------------------------------------------------------

let errorTrackerInstance: ErrorTracker | null = null;

/**
 * Return the cached ErrorTracker instance, creating it on first call based
 * on the ERROR_TRACKER env var. Default is "pino" per D-06 (widened from
 * Phase 17's "noop"). Phase 18 adds pino/sentry/glitchtip cases.
 *
 * Invariant: this file reads `process.env` directly (NOT `@baseworks/config`)
 * per the header comment — preserving that invariant keeps the factory
 * compatible with telemetry.ts's early-load ordering (D-06 from Phase 17).
 *
 * @returns The singleton ErrorTracker instance
 * @throws Error if ERROR_TRACKER is set to an unsupported value, or if the
 *   selected adapter's required DSN env var is missing (sentry/glitchtip).
 *
 * @example
 * const tracker = getErrorTracker();
 * tracker.captureException(err);
 */
export function getErrorTracker(): ErrorTracker {
  if (!errorTrackerInstance) {
    const name = process.env.ERROR_TRACKER ?? "pino"; // D-06: default widened
    switch (name) {
      case "noop":
        errorTrackerInstance = new NoopErrorTracker();
        break;
      case "pino": {
        // Construct a minimal pino logger locally — factory.ts intentionally
        // does NOT import @baseworks/api (cross-package cycle). Callers can
        // substitute their own logger via setErrorTracker(new PinoErrorTracker(customLogger)).
        const level = process.env.LOG_LEVEL ?? "info";
        const logger = pino({ level });
        errorTrackerInstance = new PinoErrorTracker(logger);
        break;
      }
      case "sentry": {
        const dsn = process.env.SENTRY_DSN;
        if (!dsn)
          throw new Error(
            "SENTRY_DSN is required when ERROR_TRACKER=sentry",
          );
        errorTrackerInstance = new SentryErrorTracker({
          dsn,
          kind: "sentry",
          release: process.env.RELEASE,
          environment:
            process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
        });
        break;
      }
      case "glitchtip": {
        const dsn = process.env.GLITCHTIP_DSN;
        if (!dsn)
          throw new Error(
            "GLITCHTIP_DSN is required when ERROR_TRACKER=glitchtip",
          );
        errorTrackerInstance = new SentryErrorTracker({
          dsn,
          kind: "glitchtip",
          release: process.env.RELEASE,
          environment:
            process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
        });
        break;
      }
      default:
        throw new Error(
          `Unknown ERROR_TRACKER: ${name}. Supported: noop, pino, sentry, glitchtip.`,
        );
    }
  }
  return errorTrackerInstance;
}

/**
 * Reset the ErrorTracker singleton. Used in tests to inject mocks via setErrorTracker.
 *
 * @returns void
 */
export function resetErrorTracker(): void {
  errorTrackerInstance = null;
}

/**
 * Set the ErrorTracker singleton directly. Used in tests to inject a mock
 * ErrorTracker without env var configuration.
 *
 * @param tracker - The ErrorTracker instance to use
 * @returns void
 */
export function setErrorTracker(tracker: ErrorTracker): void {
  errorTrackerInstance = tracker;
}
