# Phase 31 — Cleanup, Reconciliation & Operator Surface — PLAN CONTRACT (LOCKED)

**Milestone:** v1.4 File Storage & Uploads (FINAL phase — closes the milestone)
**Requirements:** QUO-03, OPS-01, OPS-02, OPS-03
**Closing rhythm:** mirrors v1.3 Phase 23 (health contributor + cron cleanup + runbooks + alerts + integration docs).
**Conventions:** header docs cite `Phase 31 / <REQ>`; backend `bun:test` against live DB; `bun biome check --write` on touched files; never expose `storage_key`/`bucket`/secrets; match Phase 23 doc templates EXACTLY; keep `bun run test`, `bun run typecheck`, `bun run validate` all green.

The 5 ROADMAP Success Criteria ARE the contract. This document locks the HOW.

---

## 0. CRITICAL ARCHITECTURE FINDING — the repeatable-job mechanism does not exist yet

`billing-sync-usage`'s docstring claims *"Scheduled BullMQ repeatable job (every 5 minutes default)"* but **no `repeat`/cron registration exists anywhere in the codebase**. `apps/api/src/worker.ts` only creates BullMQ **Worker** (consumer) instances for every `def.jobs` entry; nothing ever *enqueues* a repeatable. Grep confirms: zero `repeat:`, `upsertJobScheduler`, `JobScheduler`, or scheduler entrypoint.

Therefore Phase 31 must **ESTABLISH** the repeatable-registration mechanism (and the cleanup jobs are its first consumers). The mechanism is additive and backward-compatible — existing jobs without a `repeat` field are untouched.

**Locked mechanism (D-31-01):**
1. Extend `JobDefinition` (`packages/shared/src/types/module.ts`) with an optional `repeat?: { pattern: string }` (a standard 5-field cron pattern string, BullMQ `cron-parser` syntax).
2. In `apps/api/src/worker.ts`, inside the existing `for (const [name, def] of registry.getLoaded())` → `for (const [jobName, jobDef] of Object.entries(def.jobs))` loop, AFTER `createWorker(...)`, if `jobDef.repeat` is set, register the schedule on the SAME queue via BullMQ 5.73's **`queue.upsertJobScheduler(schedulerId, { pattern }, { name, data: {} })`**:
   - `schedulerId = jobName` (the `def.jobs` record key, e.g. `cleanup:reap-pending-uploads`).
   - `upsertJobScheduler` is idempotent by `schedulerId` — re-running worker boot does NOT create duplicate schedules (no `obliterate`/dedup dance needed). This is the load-bearing reason to use it over the deprecated `queue.add(name, data, { repeat })`.
   - Construct the `Queue` from `@baseworks/queue`'s `createQueue(jobDef.queue, redisUrl)` (inherits the Phase-20 producer wrapper; harmless for scheduled jobs). Only register when `redisUrl` is present (worker role always has it via `assertRedisUrl`).
   - Guard the whole scheduler step in try/catch + `logger.warn` so a scheduler-registration failure never aborts worker boot (consumers must still start).
3. Each cleanup job = its own `JobDefinition` with its own queue (1 queue : 1 worker, matching the existing pattern). The `def.jobs` record key === `jobDef.queue` === the SC identifier (colon-bearing names are valid BullMQ queue names, consistent with the SC wording).

**The 4 cron schedules (D-31-02, staggered so no two run together):**

| Job (def.jobs key === queue) | Cadence | `repeat.pattern` |
|---|---|---|
| `cleanup:reap-pending-uploads` | hourly | `0 * * * *` (top of every hour) |
| `quota:reconcile-tenant-usage` | daily | `0 2 * * *` (02:00) |
| `cleanup:reap-orphan-files` | daily | `30 3 * * *` (03:30) |
| `cleanup:reap-soft-deleted` | weekly | `0 4 * * 0` (Sunday 04:00) |

All four are added to the files module `ModuleDefinition.jobs`. They run in the worker process only (the API process builds read-only `Queue` handles for bull-board / the queueDepth contributor, same as every other queue).

---

## 1. SC#1 — Storage HealthContributor (QUO-03 / OPS-03)

**Declared as `health` on the files `ModuleDefinition`** (`packages/modules/files/src/index.ts`) → auto-registered by `ModuleRegistry.loadAll()` at `apps/api/src/core/registry.ts:128-130` (`this.healthAggregator.register(def.health)`). Zero apps/api boot edit required. v1.4 makes the files module the FIRST module to ship a `HealthContributor` (the v1.3 `moduleStatuses()` map stays empty per index.ts:245 — out of scope here; we surface via the aggregator's contributor list + the dedicated `storage` contributor entry).

**Implementation:** `packages/modules/files/src/health/storage-health.ts` exporting `storageHealthContributor: HealthContributor` (`{ name: "storage", timeoutMs: 4000, check }`).

**Output shape (`HealthCheckResult.details`) — NO `storage_key`, NO `bucket`, NO secrets:**
```
{
  status: "healthy" | "degraded" | "unhealthy",
  details: {
    provider: "local" | "s3" | "s3-compat",        // from process.env.STORAGE_PROVIDER ?? "local"
    adapter: {                                       // SC#1 "aggregate adapter health"
      reachable: boolean,
      kind: "object-store" | "local-disk",
      detail: string | null,                         // e.g. "disk-free 38%" (local) | "stat ok" (s3); NEVER a key/path/secret
      diskFreePct: number | null                     // local only; null for s3
    },
    quota: {
      tenantCount: number,
      topTenants: [                                   // SC#1 top-N by bytes_used, env STORAGE_HEALTH_TOP_TENANTS (default 10)
        { tenantId, bytesUsed, bytesLimit, pctUsed }  // pctUsed = bytesUsed / COALESCE(bytesLimit, STORAGE_DEFAULT_QUOTA_BYTES)
      ],
      tenantsAtWarn: number,                          // count >= 90%
      tenantsAtLimit: number                          // count >= 100%
    },
    jobs: [                                            // SC#5 last-run status (read from storage_job_runs)
      { name, lastRunAt, status: "ok"|"error", itemsSwept, durationMs, ageSec, stale: boolean }
    ]
  }
}
```
`tenantId` is an internal id (already shown in the platform-admin-gated admin UI and this endpoint is `requirePlatformAdmin()`-gated) — not a secret. The adapter `detail` string is a sanitized summary only.

**Status rollup (D-31-03):**
- `unhealthy` — adapter `reachable === false`.
- `degraded` — local `diskFreePct < 10`, OR any job `stale === true`, OR any job `status === "error"`, OR `tenantsAtLimit > 0`.
- `healthy` — otherwise. Tenants at ≥90% are surfaced (`tenantsAtWarn`) but are informational-only at the health level; quota alerting is the Sentry alerts' job (SC#3), not a health degrade.

**Job-run-status surfacing:** the contributor `SELECT`s every row of `storage_job_runs` (§5) and maps it. `ageSec = now - last_run_at`. `stale` = `ageSec > 2 × expectedIntervalSec` for that job (hourly→7200, daily→172800, weekly→1209600), so a silently-stopped scheduler is visible.

**5s-timeout discipline (D-31-04) — load-bearing:**
- The aggregator (`apps/api/src/core/health-aggregator.ts`) races each contributor against `timeoutMs` (default 2000) and caches for 5000ms. We set the contributor `timeoutMs: 4000` (under the 5s cache window).
- The adapter reachability probe gets its OWN short internal timeout (`STORAGE_HEALTH_PROBE_MS`, default 1500) via `Promise.race([probe, timeoutResolvingUnreachable])` — a hung S3 `stat()` resolves to `{ reachable: false }` fast and NEVER consumes the whole budget. **Pitfall-4 discipline:** the timeout branch *resolves* (does not reject), and a late-settling probe is absorbed (no `unhandledRejection`).
- S3 probe = `getFileStorage().stat({ bucket: S3_BUCKET, key: "__healthcheck__/probe" })` (a missing key returns `null` without error when reachable; a network failure throws → caught → `reachable:false`). Local probe = `node:fs.statfs(STORAGE_LOCAL_PATH)` for `diskFreePct` (reachable = statfs resolves).
- The two DB reads (top-N tenants; job runs) are fast indexed reads on small tables and run in parallel with the adapter probe via `Promise.all`. Worst case the contributor returns in ~1.5s even with S3 fully hung; the aggregator 4s race + 5s cache are belt-and-suspenders.

---

## 2. SC#5 — Four BullMQ repeatable cleanup/reconciliation jobs (OPS-02)

All handlers are plain `(data: unknown) => Promise<void>` (the `JobDefinition.handler` shape), live-DB-testable by calling the handler directly. All operate on the RAW drizzle instance (`getDb(env.DATABASE_URL)`) — the files module is allow-listed for direct `files` / `tenant_storage_usage` access; every statement carries an explicit `tenant_id` predicate where row-scoped. Each handler ends by calling `recordJobRun(...)` (§5) in a `finally`-style wrapper so BOTH success and failure record a run.

### 2a. `cleanup:reap-pending-uploads` (HOURLY) — `jobs/reap-pending-uploads.ts`
Delete never-completed uploads and release their reserved pending bytes.
- Target rows: `status='pending' AND deleted_at IS NULL AND created_at < now() - interval '1 hour'` (uses the existing partial index `files_pending_status_idx`).
- Per row (tenant-aware, idempotent): best-effort `getFileStorage().delete({ bucket, key })` (delete of a missing object is a no-op in every adapter), then **hard-`DELETE`** the DB row (a never-completed, never-attached pending row has no audit value), then `releaseQuota(db, tenantId, byte_size)` (GREATEST-guarded).
- Race-safe: do `DELETE ... WHERE status='pending' AND created_at < cutoff ... RETURNING tenant_id, byte_size, bucket, storage_key` in ONE statement, then release pending for exactly the returned rows. A row that completed between scan and delete has flipped to `uploaded` and will NOT match — no double-release, no deleting a live upload.
- Idempotent: a re-run after partial failure finds fewer/zero rows.

### 2b. `cleanup:reap-orphan-files` (DAILY) — `jobs/reap-orphan-files.ts`  — see §3 for safety
Backstop sweep for files whose owner record is **definitively** gone (cascade-event was missed/dropped). CONSERVATIVE per §3.

### 2c. `cleanup:reap-soft-deleted` (WEEKLY) — `jobs/reap-soft-deleted.ts`
Hard-delete tombstones past retention.
- Retention env: `STORAGE_SOFT_DELETE_RETENTION_DAYS` (new, default 30).
- Target rows: `deleted_at IS NOT NULL AND deleted_at < now() - interval 'N days'`.
- Per row: best-effort `getFileStorage().delete()` for the primary object **AND for every `transforms[].storageKey`** (variant objects leak forever otherwise), then hard-`DELETE` the DB row.
- **Do NOT touch usage counters** — `bytes_used` was already decremented at soft-delete time (`lib/soft-delete.ts` / `lib/cascade.ts`); refunding again here would corrupt `bytes_used`. Idempotent.

### 2d. `quota:reconcile-tenant-usage` (DAILY) — `jobs/reconcile-tenant-usage.ts` — see §4 for the exact formula
Rebuild `tenant_storage_usage.bytes_used` from the authoritative SUM over live counted files (drift correction). MUST use the same counting model as the rest of the code. **Does NOT touch `bytes_pending`** (locked decision #5; pending is the reap-pending job's concern). Records total drift corrected in the job-run detail.

---

## 3. SC#5 — reap-orphan SAFE owner-resolution (NO false deletes)

The orphan reaper is the BACKSTOP for files whose `onDelete:"cascade"` event was lost. It MUST NEVER delete a file whose owner still exists, and MUST SKIP whenever owner-existence cannot be proven gone.

**Mechanism (D-31-05): opt-in per-relation `ownerExists` resolver, dispatched via `fileRelationsRegistry`.**
- Extend `FileRelation` (`packages/shared/src/types/module.ts`) with:
  ```ts
  /** Phase 31 / OPS-02 — orphan-reaper owner-existence resolver. The reaper deletes a file
   *  ONLY when this returns `false` (owner definitively gone). Absent / `"unknown"` / `true`
   *  ⇒ SKIP (never delete). Reads the owning module's OWN tables via @baseworks/db shared
   *  schema (NOT a cross-module package import). */
  ownerExists?: (args: { tenantId: string; recordId: string }) => Promise<boolean | "unknown">;
  ```
- Each owning module declares it next to `recordType`. Phase 31 wires:
  - `auth` `userFileRelation.ownerExists` → `SELECT 1 FROM "user" WHERE id = recordId` (auth reads its own `user` table from `@baseworks/db`).
  - `auth` `organizationFileRelation.ownerExists` → `SELECT 1 FROM organization WHERE id = recordId AND ... tenant scope`.
  - files' own `adminAttachmentRelation.ownerExists` (recordType `tenant`, recordId = tenantId) → `SELECT 1 FROM organization WHERE id = recordId` (tenant existence). Reading `organization`/`user` from the shared `@baseworks/db` schema is allowed for any module — only the `files` TABLE access and cross-module *package* imports are banned; this is neither.
- The reaper helper (`lib/owner-resolution.ts`) resolves the relation for each candidate file via `fileRelationsRegistry.getAll()` keyed by `(ownerModule, recordType)` and calls `ownerExists`.

**Safety decision table (D-31-06) — every branch except one is SKIP:**

| Condition | Action |
|---|---|
| No relation found for `(ownerModule, recordType)` (relation removed from code) | **SKIP** |
| Relation found, `ownerExists` NOT declared | **SKIP** |
| `ownerExists` throws / returns `"unknown"` (query failed) | **SKIP** |
| `ownerExists` returns `true` (owner alive) | **SKIP** |
| File `created_at >= now() - 24h` (grace window — owner row may still be committing) | **SKIP** |
| File already tombstoned (`deleted_at IS NOT NULL`) | **SKIP** (left to reap-soft-deleted) |
| `ownerExists` returns `false` (definitive: query succeeded, zero rows) **AND** file live **AND** older than grace | **REAP** → shared `softDeleteRow()` (refund counted bytes incl. variant bytes) in a tx, then best-effort `storage.delete()` + emit `file.deleted` AFTER commit |

The reaper SOFT-deletes (not hard) — it reuses `lib/soft-delete.ts`'s `softDeleteRow()` so quota refund logic stays in exactly one place; the weekly reap-soft-deleted later hard-deletes. Candidate scan is batched (`LIMIT`/cursor) to bound memory; per-`(ownerModule,recordType,recordId)` existence checks are memoized within a run to avoid N queries for N files of one owner.

---

## 4. SC#5 — quota-reconcile formula (MUST match how `bytes_used` is computed)

Authoritative counting model, derived from `lib/quota.ts` (`markUploaded` adds `authoritativeSize`; `addUsed` adds `sumTransformBytes`), `lib/soft-delete.ts` + `lib/cascade.ts` (`COUNTED_STATUSES = {uploaded, ready, transforming}`, refund = `byte_size + sumTransformBytes(transforms)`):

```
bytes_used(T) = Σ over files f
                WHERE f.tenant_id = T
                  AND f.deleted_at IS NULL
                  AND f.status IN ('uploaded','ready','transforming')   -- COUNTED_STATUSES
                of ( f.byte_size + Σ (t.byteSize) for t in f.transforms )
```

Set-based single statement reconciling EVERY usage row (incl. tenants whose counted set is now empty → reset to 0), **never touching `bytes_pending`**:
```sql
UPDATE tenant_storage_usage u
   SET bytes_used = COALESCE((
         SELECT SUM(
                  f.byte_size
                  + COALESCE((SELECT SUM((t->>'byteSize')::bigint)
                               FROM jsonb_array_elements(f.transforms) t), 0)
                )
           FROM files f
          WHERE f.tenant_id = u.tenant_id
            AND f.deleted_at IS NULL
            AND f.status IN ('uploaded','ready','transforming')
       ), 0),
       updated_at = now();
```
Notes:
- `byte_size` is `bigint(mode:number)`; variant `byteSize` lives in the `transforms` jsonb (`(t->>'byteSize')::bigint`) — exactly `sumTransformBytes`.
- `'pending'` is excluded (those bytes live in `bytes_pending`); `'failed'`/`'deleted'` excluded. This is IDENTICAL to the increment/refund paths, so reconcile corrects drift WITHOUT introducing any.
- For the job-run detail + observability, optionally snapshot pre/post per tenant in a CTE to report `driftCorrectedBytes` = Σ|old−new|; the load-bearing UPDATE is the one above.
- `bytes_pending` column is NOT in any SET clause — locked.

---

## 5. Job-run status persistence (SC#5 "job runs surfaced in /health/detailed")

The worker (job handlers) and the API (health contributor) are **separate processes** — last-run status must live in shared storage. Locked: a small DB table (durable, queryable, survives Redis flush), matching the existing `0002_v14_file_storage.sql` migration pattern.

**New table `storage_job_runs`** (`packages/db/src/schema/storage.ts`), migration **`0005_v14_storage_job_runs.sql`** (+ `.down.sql` + `meta/0005_snapshot.json` via `bun run db:generate`; next free number — existing: 0000, 0002, 0003, 0004):
```
storage_job_runs(
  job_name     text PRIMARY KEY,          -- e.g. 'cleanup:reap-pending-uploads'
  last_run_at  timestamptz NOT NULL,
  status       text NOT NULL,             -- 'ok' | 'error'   (CHECK constraint)
  items_swept  integer NOT NULL DEFAULT 0,
  duration_ms  integer NOT NULL DEFAULT 0,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {error?, driftCorrectedBytes?, ...} — NO secrets
  updated_at   timestamptz NOT NULL DEFAULT now()
)
```
Export `storageJobRuns` from the db barrel (`packages/db/src/index.ts`, the `files, tenantStorageUsage` line).

**Helper `lib/job-runs.ts`:** `recordJobRun(db, { jobName, status, itemsSwept, durationMs, detail })` = `INSERT ... ON CONFLICT (job_name) DO UPDATE`; `readJobRuns(db)` = `SELECT * ORDER BY job_name` for the contributor. Every job wraps its body so the run is recorded on BOTH success (`status:'ok'`) and failure (`status:'error'`, `detail.error` sanitized) before rethrowing (the worker's `worker.on("failed")` path still captures to the ErrorTracker).

---

## 6. SC#2 — Four runbooks (OPS-03) — `docs/runbooks/`

Locked template (verbatim from `docs/runbooks/redis-down.md`): `# <Title>` → `> Source alert: [<path>](<relative>)` → `## Trigger` → `## Symptoms` → `## Triage` → `## Resolution` → `## Escalation`. Triage uses numbered `docker compose …` / `curl … /health/detailed | jq` steps; cross-runbook `[..](./x.md)` "See also" links MUST resolve (validate-docs Pass A).

1. **`storage-quota-exceeded.md`** — Source alert: `[storage-quota-90.json](../alerts/sentry/storage-quota-90.json)`. Trigger: tenant `pctUsed ≥ 90%/100%` in `/health/detailed` storage contributor + HTTP 413 `quota_exceeded` from `/sign-upload`. Resolution: raise `tenant_storage_usage.bytes_limit` for the tenant, or run `quota:reconcile-tenant-usage` if usage looks wrong, or have tenant delete files. See-also → `orphan-files-detected.md`.
2. **`image-transform-failure.md`** — Source alert: `[image-transform-failure-rate.json](../alerts/sentry/image-transform-failure-rate.json)`. Trigger: spike of `file.transform-failed` / `image-transform` queue failures. Symptoms: variants missing, `files.transforms` empty, decompression-bomb 413s. Resolution: sharp native-binding check (Docker base image — see file-storage.md), `imagescript` fallback via `IMAGE_TRANSFORM_PROVIDER`, bomb-limit tuning. See-also → `s3-unreachable.md`.
3. **`s3-unreachable.md`** — Source alert: `[s3-unreachable.json](../alerts/sentry/s3-unreachable.json)`. Trigger: storage contributor `adapter.reachable=false`. Symptoms: sign/complete/read failures, transform worker can't `getObject`. Resolution: creds/endpoint/region, bucket policy, network egress, MinIO container. See-also → `redis-down.md`.
4. **`orphan-files-detected.md`** — Source alert: surfaced via the `/health/detailed` storage contributor job-run status (operator-monitored; no Sentry metric) — Source-alert line links the storage contributor section of `[file-storage.md](../integrations/file-storage.md)`. Trigger: `cleanup:reap-orphan-files` reporting non-trivial `items_swept`, or stale job. Symptoms/Triage/Resolution: cascade-event drops, the SAFE resolver decision table (§3), how to dry-run, retention interplay with reap-soft-deleted.

---

## 7. SC#3 — Sentry alert JSON templates (OPS-03) — `docs/alerts/sentry/`

Shape mirrors existing `docs/alerts/sentry/*.json` (metric-style: `name,dataset,query,aggregate,timeWindow,thresholdType,resolveThreshold,triggers[{label,alertThreshold,thresholdType,actions}],projects,environment` + `runbook_url` + `_baseworks_meta{endpoint,slo_note,priority}`; OR issue-style like `high-error-rate.json` with `conditions`/`filters`/`actions`). Each `runbook_url` is a relative path that MUST resolve (validate-docs Pass B). **4 alerts** (SC#3 requires "2+"; the 3 named + s3-unreachable so that runbook has a real source alert):

| File | Models | `runbook_url` |
|---|---|---|
| `storage-quota-90.json` | metric `storage.quota.pct ≥ 90` warning | `../../runbooks/storage-quota-exceeded.md` |
| `storage-quota-100.json` | metric `storage.quota.pct ≥ 100` critical | `../../runbooks/storage-quota-exceeded.md` |
| `image-transform-failure-rate.json` | issue-style: `file.transform-failed` event frequency in 5m (model on `high-error-rate.json`) | `../../runbooks/image-transform-failure.md` |
| `s3-unreachable.json` | metric `storage.adapter.reachable=false` (model on `redis-down.json`) | `../../runbooks/s3-unreachable.md` |

`_baseworks_meta.slo_note` documents that the quota/adapter metrics require custom-metrics wiring (v1.4+ OTLP) and that for now operators monitor via `/health/detailed` — same honest caveat as `redis-down.json`.

---

## 8. SC#4 — `docs/integrations/file-storage.md` (OPS-03)

New integration doc. Outline:
1. **Overview** + 1 Mermaid `sequenceDiagram` of the lifecycle (sign-upload → PUT → complete → transform → read → delete → cleanup jobs) — keeps the validate-docs Mermaid floor (≥11; "1 per integration doc") satisfied with buffer.
2. **Per-backend CORS templates** — reference the existing `docs/integrations/file-storage/cors/{aws-s3,r2,minio,garage}.json` (Phase 25) and `bun run validate-cors`; explain ETag in `ExposeHeaders`, no wildcard origins, required PUT.
3. **Bucket lifecycle policy snippets** — `AbortIncompleteMultipartUpload` after 7 days; expire `tmp/` prefix after 1 day. JSON snippets per backend.
4. **CDN / Cache-Control guidance** — long-lived immutable cache for variant objects (content-addressed keys), private/no-store for signed originals, CDN-in-front-of-signed-URL caveats.
5. **Docker base-image pin guidance** — `oven/bun:1-debian-slim` (Debian/glibc) for sharp native bindings; **NOT Alpine/musl** (Phase 28 spike fact). `imagescript` is the pure-JS fallback (`IMAGE_TRANSFORM_PROVIDER=imagescript`) when a glibc base is impossible.
6. **Storage health contributor** section (anchor target for `orphan-files-detected.md`) — what `/health/detailed` `details.storage` reports + the cleanup-job cron table.

---

## 9. New env vars (`packages/config/src/env.ts` + `.env.example`)

| Var | Schema | Default | Purpose |
|---|---|---|---|
| `STORAGE_SOFT_DELETE_RETENTION_DAYS` | `z.coerce.number().int().positive()` | `30` | reap-soft-deleted retention window |
| `STORAGE_HEALTH_TOP_TENANTS` | `z.coerce.number().int().positive()` | `10` | top-N tenants in the health contributor |
| `STORAGE_HEALTH_PROBE_MS` | `z.coerce.number().int().positive()` | `1500` | internal adapter-probe timeout (< aggregator 4s / cache 5s) |

(`STORAGE_DEFAULT_QUOTA_BYTES` already exists and is the quota-pct denominator fallback.)

---

## 10. Full file list

**Modified:**
- `packages/shared/src/types/module.ts` — `JobDefinition.repeat?`, `FileRelation.ownerExists?`.
- `apps/api/src/worker.ts` — scheduler step (`upsertJobScheduler`) in the existing job loop.
- `packages/db/src/schema/storage.ts` — `storageJobRuns` table.
- `packages/db/src/index.ts` — export `storageJobRuns`.
- `packages/config/src/env.ts` — 3 new env vars.
- `.env.example` — 3 new env vars.
- `packages/modules/files/src/index.ts` — add `health` + 4 cleanup `jobs` (with `repeat`); add `ownerExists` to `adminAttachmentRelation`.
- `packages/modules/auth/src/file-relations.ts` — add `ownerExists` to `userFileRelation` + `organizationFileRelation`.

**New (source):**
- `packages/db/migrations/0005_v14_storage_job_runs.sql` (+ `.down.sql` + `meta/0005_snapshot.json` + `_journal.json` bump via `db:generate`).
- `packages/modules/files/src/lib/job-runs.ts`
- `packages/modules/files/src/lib/owner-resolution.ts`
- `packages/modules/files/src/jobs/reap-pending-uploads.ts`
- `packages/modules/files/src/jobs/reap-orphan-files.ts`
- `packages/modules/files/src/jobs/reap-soft-deleted.ts`
- `packages/modules/files/src/jobs/reconcile-tenant-usage.ts`
- `packages/modules/files/src/health/storage-health.ts`

**New (tests, bun:test live DB):**
- `packages/modules/files/src/jobs/__tests__/reap-pending-uploads.test.ts`
- `packages/modules/files/src/jobs/__tests__/reap-orphan-files.test.ts` (asserts NO false delete: owner-exists, unknown, no-resolver, grace-window all SKIP; only definitive-false reaps)
- `packages/modules/files/src/jobs/__tests__/reap-soft-deleted.test.ts` (variant objects deleted; counters untouched)
- `packages/modules/files/src/jobs/__tests__/reconcile-tenant-usage.test.ts` (formula match incl. variant bytes; pending untouched; drift correction)
- `packages/modules/files/src/health/__tests__/storage-health.test.ts` (output shape + no key leak + 5s discipline under a fake slow adapter)
- `apps/api/test/worker-repeatable.test.ts` (asserts the scheduler registers `upsertJobScheduler(jobName, {pattern}, …)` for each `repeat` job; mock Queue)

**New (docs):**
- `docs/runbooks/{storage-quota-exceeded,image-transform-failure,s3-unreachable,orphan-files-detected}.md`
- `docs/alerts/sentry/{storage-quota-90,storage-quota-100,image-transform-failure-rate,s3-unreachable}.json`
- `docs/integrations/file-storage.md`

---

## 11. Risks & mitigations

- **Reaper over-deletion / false deletes (HIGHEST):** opt-in `ownerExists` resolver; SKIP on absent/unknown/true/error/grace-window/already-tombstoned; REAP only on definitive `false` from a succeeded query (§3 table). Soft-delete (reversible) not hard-delete in the reaper. Test proves all SKIP branches.
- **Reconcile introducing drift:** the recompute uses the EXACT model the increment/refund paths use (COUNTED_STATUSES, `byte_size + sumTransformBytes`, `deleted_at IS NULL`, exclude pending/failed/deleted); `bytes_pending` never in a SET. Test seeds known files+variants and asserts post-reconcile equals the hand-computed sum.
- **5s timeout under slow S3:** internal `STORAGE_HEALTH_PROBE_MS` (1500) Promise.race-resolves-unreachable; contributor `timeoutMs:4000` < 5s cache; DB reads parallel; Pitfall-4 no-leak. Test injects a fake adapter whose `stat` never resolves and asserts the contributor returns `< 5s` with `reachable:false`.
- **mock-isolation for new tests:** any `mock.module()` of `@baseworks/storage` / `@baseworks/db` / `@baseworks/queue` / `@baseworks/observability` MUST spread the real module (`...(await import(...actual))`) so partial stubs don't leak into sibling suites (the `on-tenant-created.ts` header documents this exact hazard). Prefer live-DB + `setFileStorage(fake)` injection over module-mocking where possible. No `as any` / `@ts-ignore` in new code.
- **Repeatable double-scheduling on redeploy:** `upsertJobScheduler` is idempotent by `schedulerId` — no dup schedules; no obliterate needed.
- **Colon-in-queue-name:** valid in BullMQ 5.73 (Redis key prefix `bull:<queue>:…`); matches SC identifiers; verified consistent with bull-board + queueDepth contributor enumeration.
- **Variant-object leak on soft-deleted reap:** reap-soft-deleted explicitly deletes every `transforms[].storageKey` before the DB row.
- **reap-pending releasing pending for a concurrently-completing row:** single `DELETE ... WHERE status='pending' ... RETURNING` + release-returned-only; a completed row flipped to `uploaded` won't match.
- **Migration numbering:** next free is `0005` (gap at 0001 is pre-existing); generate via `db:generate` so the snapshot/journal stay consistent — do not hand-author the meta snapshot.
- **Worker-only handlers, API-only contributor:** job-run status crosses the process boundary via the `storage_job_runs` table (not in-memory) so the API health contributor sees worker outcomes.
