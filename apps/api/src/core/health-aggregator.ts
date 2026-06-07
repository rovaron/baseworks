import type { HealthCheckResult, HealthContributor } from "@baseworks/shared";

/**
 * Phase 22 / OPS-04 / D-10 + D-11 — central health aggregator.
 *
 * Runs every registered contributor in parallel via Promise.allSettled with a
 * per-contributor Promise.race timeout. Caches the last successful aggregation
 * for 5 seconds to debounce admin UI's 30s polling and concurrent dashboard reloads.
 *
 * NOT instantiated directly outside the registry — `ModuleRegistry` owns the
 * single instance and exposes it via `registry.getHealthAggregator()`.
 *
 * Pitfall 4 closure: per-contributor timeout uses Promise.race with a
 * resolve-with-unhealthy-result branch (NOT setTimeout(reject, ...)). The
 * underlying contributor's eventual rejection is then absorbed silently — the
 * race already resolved, so the late settlement does not surface as an
 * unhandledRejection.
 */

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface AggregatedHealthEntry {
  name: string;
  result: HealthCheckResult;
}

export interface AggregatedHealth {
  /** Worst-of-N rollup across all contributors. */
  status: HealthStatus;
  contributors: AggregatedHealthEntry[];
  /** ISO 8601 timestamp captured when this aggregation completed. */
  timestamp: string;
  /** Total wall-clock time across the parallel fan-out. */
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 2000;
const CACHE_TTL_MS = 5000;

export class HealthAggregator {
  private contributors: HealthContributor[] = [];
  private cached: { value: AggregatedHealth; expiresAt: number } | null = null;

  /** Register a contributor; called by `ModuleRegistry.loadAll()` for every module that ships `def.health`. */
  register(contributor: HealthContributor): void {
    this.contributors.push(contributor);
  }

  /** Test/operations utility — drops the cache so the next aggregate() re-runs probes. */
  clearCache(): void {
    this.cached = null;
  }

  /** Read-only view of registered contributors (e.g. for /health/detailed module rollup). */
  getContributors(): readonly HealthContributor[] {
    return this.contributors;
  }

  /**
   * Run every contributor in parallel under a per-contributor timeout, roll
   * results up worst-of-N, and cache the resulting object for 5 seconds.
   *
   * Returns the same object reference on cache hits — callers MUST treat the
   * return value as immutable.
   */
  async aggregate(): Promise<AggregatedHealth> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached.value;
    }

    const start = Date.now();

    // D-11 — parallel via allSettled; per-item timeout via race-resolves-not-throws (Pitfall 4).
    const settled = await Promise.allSettled(
      this.contributors.map((c) => this.runWithTimeout(c)),
    );

    const results: AggregatedHealthEntry[] = settled.map((s, i) => ({
      name: this.contributors[i].name,
      result:
        s.status === "fulfilled"
          ? s.value
          : {
              status: "unhealthy" as HealthStatus,
              details: { error: String(s.reason) },
            },
    }));

    // Worst-of-N rollup (D-10).
    const overall: HealthStatus = this.rollup(
      results.map((r) => r.result.status),
    );

    const value: AggregatedHealth = {
      status: overall,
      contributors: results,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
    };

    this.cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  private rollup(statuses: HealthStatus[]): HealthStatus {
    if (statuses.some((s) => s === "unhealthy")) return "unhealthy";
    if (statuses.some((s) => s === "degraded")) return "degraded";
    return "healthy";
  }

  private async runWithTimeout(c: HealthContributor): Promise<HealthCheckResult> {
    const timeoutMs = c.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Pitfall 4 — Promise.race resolves the timeout with an unhealthy
    // HealthCheckResult instead of rejecting. The underlying contributor's
    // eventual settlement is absorbed silently because the race already
    // resolved. Avoids the unhandledRejection escape on late-settling promises.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutP = new Promise<HealthCheckResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: "unhealthy", details: { error: "timeout" } }),
        timeoutMs,
      );
    });
    // Wrap the contributor's check() — synchronous throws inside check() must
    // surface as a rejection that we convert to an unhealthy result here, so
    // Promise.allSettled never sees a rejected entry from a thrown contributor.
    const checkP = (async () => c.check())().catch((err) => ({
      status: "unhealthy" as HealthStatus,
      details: { error: err instanceof Error ? err.message : String(err) },
    }));
    try {
      return await Promise.race([checkP, timeoutP]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
