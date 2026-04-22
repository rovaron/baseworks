/**
 * MetricsProvider port interface (OBS-02).
 *
 * Contract for metrics adapters. Phase 17 ships NoopMetricsProvider;
 * Phase 21 adds OtelMetricsProvider backed by @opentelemetry/api meters.
 *
 * Design decisions:
 * - Sub-instruments (Counter, Histogram, Gauge) are returned by factory
 *   calls so adapters can cache per-name state (OTEL instruments are
 *   expensive to create).
 * - `attributes` on inc/record/set are the tag/label set — cardinality
 *   discipline is the adapter's responsibility (Phase 21 adds OTEL Views
 *   + collector filters).
 * - Attribute values are scalar primitives only — matches the `Attributes`
 *   type at `packages/observability/src/ports/types.ts`.
 */

import type { Attributes } from "./types";

/**
 * Monotonic counter instrument — increases only.
 */
export interface Counter {
  /**
   * Increment the counter.
   *
   * @param value - Increment amount (defaults to 1 if omitted)
   * @param attributes - Optional per-increment tags
   */
  inc(value?: number, attributes?: Attributes): void;
}

/**
 * Histogram instrument — records a distribution of values.
 */
export interface Histogram {
  /**
   * Record a single observation.
   *
   * @param value - Observed value (e.g., request duration in ms)
   * @param attributes - Optional per-observation tags
   */
  record(value: number, attributes?: Attributes): void;
}

/**
 * Gauge instrument — tracks a single current value.
 */
export interface Gauge {
  /**
   * Set the gauge's current value.
   *
   * @param value - New value
   * @param attributes - Optional per-set tags
   */
  set(value: number, attributes?: Attributes): void;
}

/**
 * Metrics provider port. Every adapter exposes the same surface — call
 * sites never branch on adapter identity.
 */
export interface MetricsProvider {
  /** Adapter identifier (e.g., `"noop"`, `"otel"`). */
  readonly name: string;

  /**
   * Get or create a monotonic counter instrument.
   *
   * @param name - Instrument name (OTEL convention: dot-notation)
   * @param options - Optional description and unit (e.g., `unit: "ms"`)
   * @returns Counter handle
   */
  counter(name: string, options?: { description?: string; unit?: string }): Counter;

  /**
   * Get or create a histogram instrument.
   *
   * @param name - Instrument name
   * @param options - Optional description and unit
   * @returns Histogram handle
   */
  histogram(
    name: string,
    options?: { description?: string; unit?: string },
  ): Histogram;

  /**
   * Get or create a gauge instrument.
   *
   * @param name - Instrument name
   * @param options - Optional description and unit
   * @returns Gauge handle
   */
  gauge(name: string, options?: { description?: string; unit?: string }): Gauge;
}

// Re-export types for convenience
export type { Attributes } from "./types";
