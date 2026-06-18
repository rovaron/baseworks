// Phase 22 / OPS-03 — /health/detailed admin endpoint composing the D-07 envelope.
//
// Mounted at API root (NOT under /api/admin/) per D-08 — sits side-by-side with the
// public /health Docker probe so operators can hit /health/detailed for the full
// queue/worker/db/recentErrors/modules snapshot while liveness probes stay
// unauthenticated. Gated by requirePlatformAdmin() — env-allowlist platform admins
// only, NOT tenant owner role (authz-admin-owner-role-escalation; T-22-04 mitigation).
//
// All inputs flow through the `deps` parameter so the endpoint is purely a
// composition surface — testable in isolation with fake queues, fake redis,
// fake aggregator, and fake module name/status providers.

import { requirePlatformAdmin } from "@baseworks/module-auth";
import type { RingBufferEntry } from "@baseworks/observability";
import { readHeartbeats } from "@baseworks/observability";
import type { getRedisConnection } from "@baseworks/queue";
import type { Queue } from "bullmq";
import { Elysia } from "elysia";
import type { HealthAggregator } from "../core/health-aggregator";

/** D-07 — per-queue thresholds (hardcoded; not env-tunable in v1.3 per D-09). */
const QUEUE_WARN = 100;
const QUEUE_CRITICAL = 1000;

export interface HealthDetailedDeps {
  aggregator: HealthAggregator;
  moduleQueues: Queue[];
  redis: ReturnType<typeof getRedisConnection> | null;
  heartbeatIntervalMs: number;
  loadedModuleNames: () => string[];
  /** Map of module name → status from contributor results. Empty/missing entries fall through to D-16 default ("healthy"). */
  moduleStatuses: () => Map<string, "healthy" | "degraded" | "unhealthy" | "unknown">;
  recentErrorsSnapshot: () => RingBufferEntry[];
}

/**
 * Phase 22 / OPS-03 — factory returning the `/health/detailed` Elysia plugin.
 *
 * The factory shape (rather than a top-level plugin) lets apps/api/src/index.ts
 * inject the live aggregator + moduleQueues + redis connection at boot time,
 * and keeps the plugin testable with fakes (see apps/api/test/health-detailed.test.ts).
 */
export function createHealthDetailedPlugin(deps: HealthDetailedDeps) {
  return new Elysia({ name: "health-detailed" })
    .use(requirePlatformAdmin())
    .get("/health/detailed", async () => {
      const agg = await deps.aggregator.aggregate();

      // Queue depths (D-09 thresholds, hardcoded warn=100/critical=1000).
      const queueResults = await Promise.all(
        deps.moduleQueues.map(async (q) => {
          try {
            const counts = await q.getJobCounts(
              "waiting",
              "active",
              "delayed",
              "completed",
              "failed",
            );
            const waiting = counts.waiting ?? 0;
            const status: "healthy" | "warning" | "critical" =
              waiting >= QUEUE_CRITICAL
                ? "critical"
                : waiting >= QUEUE_WARN
                  ? "warning"
                  : "healthy";
            return {
              name: q.name,
              waiting,
              active: counts.active ?? 0,
              delayed: counts.delayed ?? 0,
              completed: counts.completed ?? 0,
              failed: counts.failed ?? 0,
              status,
              thresholds: { warn: QUEUE_WARN, critical: QUEUE_CRITICAL },
            };
          } catch (err) {
            // A single failing queue must not 500 the whole snapshot — surface as critical
            // with the error captured. Operators see something is wrong without losing the
            // rest of the dashboard.
            return {
              name: q.name,
              waiting: 0,
              active: 0,
              delayed: 0,
              completed: 0,
              failed: 0,
              status: "critical" as const,
              thresholds: { warn: QUEUE_WARN, critical: QUEUE_CRITICAL },
              error: String(err),
            };
          }
        }),
      );

      // Worker heartbeats (D-13 freshness derivation: healthy < 2×interval, stale < 5×, dead ≥ 5×).
      let workers: Array<{
        instanceId: string;
        queues: string[];
        lastHeartbeat: string;
        ageSec: number;
        status: "healthy" | "stale" | "dead";
      }> = [];
      if (deps.redis) {
        try {
          const heartbeats = await readHeartbeats(deps.redis);
          const now = Date.now();
          const intervalMs = deps.heartbeatIntervalMs;
          workers = heartbeats.map((hb) => {
            const ageMs = now - new Date(hb.lastHeartbeat).getTime();
            const ageSec = Math.max(0, Math.round(ageMs / 1000));
            const status: "healthy" | "stale" | "dead" =
              ageMs < 2 * intervalMs ? "healthy" : ageMs < 5 * intervalMs ? "stale" : "dead";
            return {
              instanceId: hb.instanceId,
              queues: hb.queues,
              lastHeartbeat: hb.lastHeartbeat,
              ageSec,
              status,
            };
          });
        } catch {
          // Reading heartbeats should not 500 the endpoint; surface empty list.
          workers = [];
        }
      }

      // DB status — read from the "db" contributor result that index.ts registers.
      // Falls through to a sane unhealthy default if the contributor never ran.
      const dbContrib = agg.contributors.find((c) => c.name === "db");
      const dbDetails = (dbContrib?.result.details ?? {}) as Record<string, unknown>;
      const db = {
        connected: typeof dbDetails.connected === "boolean" ? dbDetails.connected : false,
        lagMs: typeof dbDetails.lagMs === "number" ? (dbDetails.lagMs as number) : null,
        status: (dbContrib?.result.status ?? "unhealthy") as "healthy" | "degraded" | "unhealthy",
      };

      // Storage status — read from the files module's "storage" contributor (Phase 31 /
      // QUO-03 / OPS-03; the v1.4 follow-up the Phase 22 comment below deferred). The
      // contributor (packages/modules/files/src/health/storage-health.ts) is auto-registered
      // via def.health → ModuleRegistry.loadAll(). We mirror the "db" extraction above and
      // expose its details (adapter / quota / jobs) at data.storage so operator runbooks'
      // `jq '.data.storage.{adapter,quota,jobs[]}'` triage steps resolve. SC#1 + SC#5. The
      // contributor's details carry NO storage_key/bucket/secrets (platform-admin-gated).
      // `data.storage` is undefined when the files module is not loaded (no contributor).
      const storageContrib = agg.contributors.find((c) => c.name === "storage");
      const storage = storageContrib
        ? {
            status: storageContrib.result.status,
            ...((storageContrib.result.details ?? {}) as Record<string, unknown>),
          }
        : undefined;

      // Modules — D-16 default (loaded modules without a contributor → "healthy").
      // In v1.3 ALL modules fall through to this default because no module ships a
      // HealthContributor. See 22-05-PLAN.md must_haves note + Plan 06 follow-up.
      const statuses = deps.moduleStatuses();
      const modules = deps.loadedModuleNames().map((name) => ({
        name,
        loaded: true,
        status: (statuses.get(name) ?? "healthy") as
          | "healthy"
          | "degraded"
          | "unhealthy"
          | "unknown",
      }));

      // Recent errors (D-15 — map ringbuffer entries to the D-07 envelope shape;
      // firstFrame is internal-only and MUST NOT leak to the wire — T-22-07 mitigation).
      const recentErrors = deps.recentErrorsSnapshot().map((e) => ({
        timestamp: e.timestamp,
        message: e.message,
        source: e.source,
        count: e.count,
      }));

      return {
        data: {
          status: agg.status,
          timestamp: agg.timestamp,
          uptime: process.uptime(),
          queues: queueResults,
          workers,
          db,
          ...(storage ? { storage } : {}),
          recentErrors,
          modules,
        },
      };
    });
}
