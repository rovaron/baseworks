/**
 * Noop MetricsProvider adapter (OBS-02).
 *
 * Default adapter when `METRICS_PROVIDER` is unset or `=noop`. Zero external
 * traffic, zero allocation growth (sub-instruments are fresh per call —
 * fine for a noop since GC reclaims them immediately).
 *
 * Design rule: NEVER throws on any input. Acceptance criterion asserts zero
 * `throw` statements in this file.
 */

import type {
  Counter,
  Gauge,
  Histogram,
  MetricsProvider,
} from "../../ports/metrics";
import type { Attributes } from "../../ports/types";

/**
 * No-op Counter — discards every increment.
 */
class NoopCounter implements Counter {
  inc(_value?: number, _attributes?: Attributes): void {}
}

/**
 * No-op Histogram — discards every observation.
 */
class NoopHistogram implements Histogram {
  record(_value: number, _attributes?: Attributes): void {}
}

/**
 * No-op Gauge — discards every set.
 */
class NoopGauge implements Gauge {
  set(_value: number, _attributes?: Attributes): void {}
}

/**
 * Default MetricsProvider adapter. Every instrument factory returns a fresh
 * no-op instance. Returned by `getMetrics()` (Plan 02) when
 * `METRICS_PROVIDER` is unset or `=noop`.
 */
export class NoopMetricsProvider implements MetricsProvider {
  readonly name = "noop";

  /**
   * Return a fresh NoopCounter. Never throws.
   *
   * @param _name - Instrument name (ignored)
   * @param _options - Instrument options (ignored)
   * @returns A NoopCounter instance
   */
  counter(
    _name: string,
    _options?: { description?: string; unit?: string },
  ): Counter {
    return new NoopCounter();
  }

  /**
   * Return a fresh NoopHistogram. Never throws.
   *
   * @param _name - Instrument name (ignored)
   * @param _options - Instrument options (ignored)
   * @returns A NoopHistogram instance
   */
  histogram(
    _name: string,
    _options?: { description?: string; unit?: string },
  ): Histogram {
    return new NoopHistogram();
  }

  /**
   * Return a fresh NoopGauge. Never throws.
   *
   * @param _name - Instrument name (ignored)
   * @param _options - Instrument options (ignored)
   * @returns A NoopGauge instance
   */
  gauge(
    _name: string,
    _options?: { description?: string; unit?: string },
  ): Gauge {
    return new NoopGauge();
  }
}
