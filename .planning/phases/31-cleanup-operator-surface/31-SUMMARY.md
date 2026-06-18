---
phase: 31-cleanup-operator-surface
milestone: v1.4
title: Cleanup, Reconciliation & Operator Surface (FINAL — closes v1.4)
status: complete
requirements: [QUO-03, OPS-01, OPS-02, OPS-03]
executed_from: 31-PLAN-CONTRACT.md (LOCKED)
completed: 2026-06-18
---

# Phase 31 — Cleanup, Reconciliation & Operator Surface — SUMMARY

**The final phase of v1.4.** Closes the operational loop, mirroring the v1.3 Phase 23
closing rhythm (health contributor + cron cleanup + runbooks + alerts + integration
docs). Executed from a single LOCKED `31-PLAN-CONTRACT.md`. Requirements QUO-03, OPS-01,
OPS-02, OPS-03 satisfied.

## What shipped

### SC#1 — Storage `HealthContributor` (QUO-03 / OPS-03)
`packages/modules/files/src/health/storage-health.ts` exports `storageHealthContributor`
(`{ name: "storage", timeoutMs: 4000, check }`), declared as `health` on the files
`ModuleDefinition` and auto-registered into the central `HealthAggregator` by
`ModuleRegistry.loadAll()` (`apps/api/src/core/registry.ts:128-130`) — zero apps/api boot
edit. This is the FIRST module to ship a `HealthContributor`. `/health/detailed`
(owner-gated) now surfaces `details.storage`:
- `provider` + aggregate `adapter` health (S3 reachability via a bounded sentinel `stat()`;
  Local disk-free via `node:fs/promises statfs`).
- `quota`: top-N tenants by `bytes_used` (`STORAGE_HEALTH_TOP_TENANTS`, default 10), `pctUsed`
  = `bytes_used / COALESCE(bytes_limit, STORAGE_DEFAULT_QUOTA_BYTES)`, plus `tenantsAtWarn`
  (≥90%) / `tenantsAtLimit` (≥100%) counts.
- `jobs`: last-run status of all four cleanup jobs (read from `storage_job_runs`) with `ageSec`
  + `stale` (run older than 2× the cron interval ⇒ a silently-stopped scheduler is visible).
- **No `storage_key` / `bucket` / secrets** in the output; adapter `detail` is a sanitized
  summary string only.
- **5s-timeout discipline (load-bearing):** the adapter probe has its OWN short internal
  timeout (`STORAGE_HEALTH_PROBE_MS`, default 1500) via a `Promise.race` that RESOLVES (never
  rejects, Pitfall-4) to `reachable:false`; the two DB reads run in parallel with the probe.
  Worst case the contributor returns in ~1.5s even with S3 fully hung, well under the
  aggregator's 4s race / 5s cache.
- **Status rollup (D-31-03):** `unhealthy` if adapter unreachable; `degraded` if local disk
  <10%, OR any job stale/errored, OR `tenantsAtLimit > 0`; else `healthy`. ≥90% tenants are
  informational (`tenantsAtWarn`) — quota alerting is the Sentry alerts' job, not a health degrade.

### SC#5 — Repeatable-job mechanism + four cron jobs (OPS-02)
The contract's CRITICAL architecture finding held: **no repeatable/cron registration
existed anywhere** despite `billing-sync-usage`'s docstring claim. Phase 31 ESTABLISHED the
mechanism (additive, backward-compatible):
- `JobDefinition.repeat?: { pattern: string }` added to `packages/shared/src/types/module.ts`
  (standard 5-field cron string).
- `apps/api/src/worker.ts` job loop now, after `createWorker(...)`, registers the schedule on
  the SAME queue via BullMQ `queue.upsertJobScheduler(jobName, { pattern }, …)` — idempotent
  by `schedulerId === jobName` (no obliterate/dedup dance, no duplicate schedules on redeploy).
  Guarded in try/catch + `logger.warn` so a scheduler failure never aborts consumer boot;
  only registers when `redisUrl` is present.

Four handlers (`packages/modules/files/src/jobs/`), each a plain
`(data: unknown) => Promise<void>` wrapped by `withJobRun(...)` so BOTH success and failure
record a `storage_job_runs` row, staggered so no two run together:

| Job (def.jobs key === queue) | Cadence | `repeat.pattern` |
|---|---|---|
| `cleanup:reap-pending-uploads` | hourly | `0 * * * *` |
| `quota:reconcile-tenant-usage` | daily 02:00 | `0 2 * * *` |
| `cleanup:reap-orphan-files` | daily 03:30 | `30 3 * * *` |
| `cleanup:reap-soft-deleted` | weekly Sun 04:00 | `0 4 * * 0` |

- **reap-pending-uploads** — single `DELETE … WHERE status='pending' AND deleted_at IS NULL
  AND created_at < now()-1h RETURNING …`, then `releaseQuota` for exactly the returned rows
  (a row that flipped to `uploaded` between scan and delete won't match → no double-release,
  no deleting a live upload) + best-effort `storage.delete()`. Tenant-aware, idempotent.
- **reap-orphan-files** — CONSERVATIVE backstop via the opt-in per-relation `ownerExists`
  resolver (D-31-05). REAP only on a definitive `false` from a SUCCEEDED query AND a live file
  AND older than a 24h grace window; every other branch (no relation / no resolver / throws /
  `"unknown"` / `true` / within grace / already tombstoned) SKIPs. Soft-deletes via the shared
  `softDeleteRow()` (refund counted bytes incl. variant bytes) so the weekly job hard-deletes
  later. Existence checks memoized per owner.
- **reap-soft-deleted** — hard-deletes tombstones past `STORAGE_SOFT_DELETE_RETENTION_DAYS`
  (default 30): best-effort `storage.delete()` of the primary object AND every
  `transforms[].storageKey` (variant objects would leak forever otherwise), then the DB row.
  Does NOT touch usage counters (already decremented at soft-delete time). Idempotent.
- **reconcile-tenant-usage** — single set-based `UPDATE` rebuilding `bytes_used` from the
  AUTHORITATIVE sum over live counted files using the EXACT counting model the increment/refund
  paths use: `Σ (byte_size + Σ transforms[].byteSize)` over `deleted_at IS NULL AND status IN
  ('uploaded','ready','transforming')`. **`bytes_pending` is never in a SET clause** (locked).
  Reports `driftCorrectedBytes` via a pre/post CTE. Corrects drift without introducing any.

### SC#5 (persistence) — `storage_job_runs` table
New table (`packages/db/src/schema/storage.ts`, migration `0005_v14_storage_job_runs.sql` +
`.down.sql`), exported from the db barrel. The worker (handlers) and API (contributor) are
separate processes, so last-run status crosses the boundary via durable shared storage, not
in-memory. `lib/job-runs.ts` provides `withJobRun(...)` (INSERT … ON CONFLICT (job_name) DO
UPDATE on both success and error) and `readJobRuns(...)` for the contributor.

### SC#2 — Four runbooks (`docs/runbooks/`)
`storage-quota-exceeded.md`, `image-transform-failure.md`, `s3-unreachable.md`,
`orphan-files-detected.md` — locked Phase 23 template (`# Title` → `> Source alert: [..]` →
`## Trigger` / `## Symptoms` / `## Triage` / `## Resolution` / `## Escalation`), each linking
its source alert (orphan-files links the storage-contributor section of `file-storage.md`,
which has no Sentry metric).

### SC#3 — Four Sentry alert JSONs (`docs/alerts/sentry/`)
`storage-quota-90.json`, `storage-quota-100.json`, `image-transform-failure-rate.json`,
`s3-unreachable.json` — same shape as the Phase 23 alerts (+ `runbook_url` + `_baseworks_meta`).
Every `runbook_url` resolves to an existing runbook (validate-docs Pass B); the
`_baseworks_meta.slo_note` carries the same honest caveat as `redis-down.json` (quota/adapter
metrics need custom-metrics/OTLP wiring; for now operators monitor via `/health/detailed`).

### SC#4 — `docs/integrations/file-storage.md`
Overview + lifecycle Mermaid `sequenceDiagram`; per-backend CORS templates (references the
Phase 25 `cors/{aws-s3,r2,minio,garage}.json` + `bun run validate-cors`); bucket lifecycle
snippets (`AbortIncompleteMultipartUpload` 7d, `tmp/` 1d); CDN/Cache-Control guidance; Docker
base-image pin guidance (`oven/bun:1-debian-slim` Debian/glibc for sharp, NOT Alpine/musl —
Phase 28 spike fact; `imagescript` is the pure-JS fallback); a storage-health-contributor
section (anchor target for `orphan-files-detected.md`) + the cleanup-job cron table.

### New env vars (`packages/config/src/env.ts` + `.env.example`)
`STORAGE_SOFT_DELETE_RETENTION_DAYS` (30), `STORAGE_HEALTH_TOP_TENANTS` (10),
`STORAGE_HEALTH_PROBE_MS` (1500).

### Owner-existence wiring (no cross-module imports)
`FileRelation.ownerExists?` added to `packages/shared/src/types/module.ts`. `auth` declares it
for `user` (`SELECT 1 FROM "user"`) and `organization`; files' own `admin-attachment` relation
resolves tenant existence. Each module reads its OWN tables from the shared `@baseworks/db`
schema — neither a `files`-table access nor a cross-module package import, so both lint bans
stay green.

## Verification (live DB + CI gates)

- Phase 31 job + health suites — `00-reap-orphan-files / 00-reap-pending-uploads /
  00-reap-soft-deleted / 00-reconcile-tenant-usage / 00-storage-health` → **10 pass / 0 fail**.
- Repeatable scheduler — `apps/api/test/worker-repeatable.test.ts` → **3 pass / 0 fail**
  (asserts `upsertJobScheduler(jobName, {pattern}, …)` per `repeat` job; mock Queue).
- Full files module → **108 pass / 0 fail**.
- `bun run validate` (validate-docs, 4 invariants) → **PASS** (12 Mermaid blocks ≥ 11;
  all four new `runbook_url`s + cross-runbook links resolve).
- `bun run typecheck` → **exit 0**. `bun run lint` → **exit 0**. `bun run test` → **exit 0**.

## Adversarial review

**2 blockers (addressed):**
1. **Repeatable-job mechanism did not exist** — `billing-sync-usage`'s "every 5 minutes"
   docstring was aspirational; no `repeat`/`upsertJobScheduler`/scheduler entrypoint anywhere.
   The four cron jobs would never have fired. FIX: established the `JobDefinition.repeat` +
   `worker.ts upsertJobScheduler` mechanism (D-31-01), proven by `worker-repeatable.test.ts`.
2. **Orphan reaper false-delete of never-attached uploads** — the candidate scan would have
   dispatched `ownerExists('')` for files still carrying the `''` `owner_record_id` sentinel
   (set at sign-upload, replaced only by attach) → `SELECT 1 … WHERE id = ''` → zero rows → a
   definitive `false` → an erroneous REAP of a legitimately uploaded-but-not-yet-attached file
   (and, for a pending unattached row, a permanent `bytes_pending` leak since `softDeleteRow`
   refunds only `bytes_used` and reconcile never touches `bytes_pending`). FIX: load-bearing
   `owner_record_id <> ''` predicate in the candidate scan — the reaper is the cascade-backstop
   for ATTACHED files only.

**1 warning (addressed):**
- **reconcile formula divergence risk** — reconciling with a different formula than the
  increment/refund paths would INTRODUCE drift instead of correcting it. Mitigated by using the
  IDENTICAL counting model (COUNTED_STATUSES, `byte_size + Σ transforms[].byteSize`,
  `deleted_at IS NULL`, exclude pending/failed/deleted) and never touching `bytes_pending`;
  the reconcile test seeds known files + variants and asserts post-reconcile equals the
  hand-computed sum.
