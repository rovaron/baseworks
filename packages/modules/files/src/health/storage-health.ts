/**
 * Phase 31 / QUO-03, OPS-03 — storage HealthContributor.
 *
 * Declared as `health` on the files ModuleDefinition → auto-registered into the
 * central HealthAggregator by `ModuleRegistry.loadAll()` (registry.ts:128-130),
 * so /health/detailed surfaces it with zero apps/api boot edit. This is the FIRST
 * module to ship a HealthContributor.
 *
 * Reports (NO storage_key / bucket / secrets — this endpoint is
 * requirePlatformAdmin()-gated, so internal tenantId is acceptable):
 *   - provider + aggregate adapter health (S3 reachable via a short-timeout stat;
 *     Local disk-free via statfs).
 *   - top-N tenants by bytes_used, %quota used, counts at warn (≥90%) / limit (≥100%).
 *   - last-run status of the cleanup jobs (read from storage_job_runs), with
 *     staleness so a silently-stopped scheduler is visible.
 *
 * 5s-timeout discipline (load-bearing): the contributor declares `timeoutMs:4000`
 * (under the aggregator's 5s cache). The adapter probe gets its OWN short
 * internal timeout (STORAGE_HEALTH_PROBE_MS, default 1500) via a
 * race-resolves-unreachable (Pitfall 4 — resolves, never rejects; a late-settling
 * probe is absorbed), so a hung S3 stat() never consumes the whole budget. The
 * two DB reads run in parallel with the probe.
 */

import { statfs } from "node:fs/promises";
import { env } from "@baseworks/config";
import { getDb } from "@baseworks/db";
import type { HealthCheckResult, HealthContributor } from "@baseworks/shared";
import { getFileStorage } from "@baseworks/storage";
import { sql } from "drizzle-orm";
import { readJobRuns } from "../lib/job-runs";

type Provider = "local" | "s3" | "s3-compat";

interface AdapterHealth {
  reachable: boolean;
  kind: "object-store" | "local-disk";
  detail: string | null;
  diskFreePct: number | null;
}

interface TopTenant {
  tenantId: string;
  bytesUsed: number;
  bytesLimit: number | null;
  pctUsed: number;
}

/**
 * Staleness thresholds (seconds) per job — already 2× the expected interval, so a
 * run older than this means the scheduler likely stopped. hourly→7200,
 * daily→172800, weekly→1209600.
 */
const STALE_THRESHOLD_SEC: Record<string, number> = {
  "cleanup:reap-pending-uploads": 7200,
  "quota:reconcile-tenant-usage": 172800,
  "cleanup:reap-orphan-files": 172800,
  "cleanup:reap-soft-deleted": 1209600,
};
/** Fallback when a job name is not in the table above (daily cadence). */
const DEFAULT_STALE_THRESHOLD_SEC = 172800;

function resolveProvider(): Provider {
  const raw = process.env.STORAGE_PROVIDER ?? "local";
  return raw === "s3" || raw === "s3-compat" ? raw : "local";
}

/** Probe local disk free via statfs; never throws (returns reachable:false on error). */
async function probeLocal(): Promise<AdapterHealth> {
  const path = process.env.STORAGE_LOCAL_PATH ?? "./storage";
  try {
    const stats = await statfs(path);
    const diskFreePct =
      stats.blocks > 0 ? Math.round((Number(stats.bavail) / Number(stats.blocks)) * 100) : 0;
    return {
      reachable: true,
      kind: "local-disk",
      detail: `disk-free ${diskFreePct}%`,
      diskFreePct,
    };
  } catch {
    return { reachable: false, kind: "local-disk", detail: "statfs failed", diskFreePct: null };
  }
}

/**
 * Probe object-store reachability via a bounded stat() of a sentinel key. A
 * missing key returns null WITHOUT error when reachable; a network failure throws
 * → caught → reachable:false. The whole probe is raced against a short timeout
 * that RESOLVES (never rejects) to reachable:false so a hung stat() is fast.
 */
async function probeObjectStore(probeMs: number): Promise<AdapterHealth> {
  const bucket = process.env.S3_BUCKET ?? "";
  const probe = (async (): Promise<AdapterHealth> => {
    try {
      await getFileStorage().stat({ bucket, key: "__healthcheck__/probe" });
      return { reachable: true, kind: "object-store", detail: "stat ok", diskFreePct: null };
    } catch {
      return { reachable: false, kind: "object-store", detail: "stat failed", diskFreePct: null };
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<AdapterHealth>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          reachable: false,
          kind: "object-store",
          detail: "probe timeout",
          diskFreePct: null,
        }),
      probeMs,
    );
  });
  try {
    return await Promise.race([probe, timeoutP]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface QuotaSummary {
  tenantCount: number;
  topTenants: TopTenant[];
  tenantsAtWarn: number;
  tenantsAtLimit: number;
}

interface TopTenantRow {
  tenant_id: string;
  bytes_used: string | number;
  bytes_limit: string | number | null;
  pct_used: string | number;
}
interface QuotaAggRow {
  tenant_count: string | number;
  at_warn: string | number;
  at_limit: string | number;
}

async function readQuota(
  db: ReturnType<typeof getDb>,
  defaultQuota: number,
  topN: number,
): Promise<QuotaSummary> {
  const [topRows, aggRows] = await Promise.all([
    db.execute(sql`
      SELECT tenant_id,
             bytes_used,
             bytes_limit,
             (bytes_used::numeric / NULLIF(COALESCE(bytes_limit, ${defaultQuota}), 0)) AS pct_used
        FROM tenant_storage_usage
       ORDER BY bytes_used DESC
       LIMIT ${topN}
    `) as unknown as Promise<TopTenantRow[]>,
    db.execute(sql`
      SELECT COUNT(*) AS tenant_count,
             COUNT(*) FILTER (
               WHERE bytes_used >= 0.9 * COALESCE(bytes_limit, ${defaultQuota})
             ) AS at_warn,
             COUNT(*) FILTER (
               WHERE bytes_used >= COALESCE(bytes_limit, ${defaultQuota})
             ) AS at_limit
        FROM tenant_storage_usage
    `) as unknown as Promise<QuotaAggRow[]>,
  ]);

  const agg = aggRows[0];
  return {
    tenantCount: Number(agg?.tenant_count ?? 0),
    tenantsAtWarn: Number(agg?.at_warn ?? 0),
    tenantsAtLimit: Number(agg?.at_limit ?? 0),
    topTenants: topRows.map((r) => ({
      tenantId: r.tenant_id,
      bytesUsed: Number(r.bytes_used),
      bytesLimit: r.bytes_limit === null ? null : Number(r.bytes_limit),
      pctUsed: r.pct_used === null ? 0 : Number(r.pct_used),
    })),
  };
}

interface JobStatus {
  name: string;
  lastRunAt: string;
  status: "ok" | "error";
  itemsSwept: number;
  durationMs: number;
  ageSec: number;
  stale: boolean;
}

async function readJobStatuses(db: ReturnType<typeof getDb>): Promise<JobStatus[]> {
  const rows = await readJobRuns(db);
  const now = Date.now();
  return rows.map((r) => {
    const lastRun = new Date(r.last_run_at);
    const ageSec = Math.max(0, Math.round((now - lastRun.getTime()) / 1000));
    const threshold = STALE_THRESHOLD_SEC[r.job_name] ?? DEFAULT_STALE_THRESHOLD_SEC;
    return {
      name: r.job_name,
      lastRunAt: lastRun.toISOString(),
      status: r.status,
      itemsSwept: Number(r.items_swept),
      durationMs: Number(r.duration_ms),
      ageSec,
      stale: ageSec > threshold,
    };
  });
}

/**
 * Run the storage health check. Adapter probe + the two DB reads run in parallel
 * so the worst case is bounded by the probe timeout (~1.5s), well under the 4s
 * contributor budget even with S3 fully hung.
 */
export async function checkStorageHealth(): Promise<HealthCheckResult> {
  const provider = resolveProvider();
  const probeMs = env.STORAGE_HEALTH_PROBE_MS;
  const defaultQuota = env.STORAGE_DEFAULT_QUOTA_BYTES;
  const topN = env.STORAGE_HEALTH_TOP_TENANTS;
  const db = getDb(env.DATABASE_URL);

  const [adapter, quota, jobs] = await Promise.all([
    provider === "local" ? probeLocal() : probeObjectStore(probeMs),
    readQuota(db, defaultQuota, topN),
    readJobStatuses(db),
  ]);

  // Status rollup (D-31-03).
  let status: HealthCheckResult["status"] = "healthy";
  if (!adapter.reachable) {
    status = "unhealthy";
  } else if (
    (adapter.diskFreePct !== null && adapter.diskFreePct < 10) ||
    jobs.some((j) => j.stale || j.status === "error") ||
    quota.tenantsAtLimit > 0
  ) {
    status = "degraded";
  }

  return {
    status,
    details: {
      provider,
      adapter,
      quota,
      jobs,
    },
  };
}

/** Phase 31 — the storage contributor registered via the files ModuleDefinition. */
export const storageHealthContributor: HealthContributor = {
  name: "storage",
  timeoutMs: 4000,
  check: checkStorageHealth,
};
