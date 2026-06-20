---
phase: 31-cleanup-operator-surface
verified: 2026-06-18T00:00:00Z
status: passed
score: 5/5 Success Criteria verified
milestone: v1.4
milestone_close: true
overrides_applied: 0
---

# Phase 31: Cleanup, Reconciliation & Operator Surface — Verification Report

**Phase Goal:** Close the operational loop — quota observability in `/health/detailed`,
scheduled cleanup + reconciliation cron jobs, runbooks, Sentry alert templates, and
integration docs. Mirrors the v1.3 Phase 23 closing rhythm. **FINAL phase of v1.4.**
**Verified:** 2026-06-18
**Status:** passed — 5/5 ROADMAP Success Criteria verified against the live codebase.

## Goal Achievement — the 5 Success Criteria ARE the contract

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `/health/detailed` registers a storage `HealthContributor` (top-N tenants by `bytes_used`, %quota, aggregate adapter health); responds within the 5s cache window even when S3 is slow | VERIFIED | `storageHealthContributor` (`packages/modules/files/src/health/storage-health.ts:254`, `{name:"storage", timeoutMs:4000}`) declared as `health` on the files `ModuleDefinition` (`index.ts:130`), auto-registered by `ModuleRegistry.loadAll()` (`registry.ts:128-130`). Output = `{provider, adapter, quota{topTenants,tenantsAtWarn,tenantsAtLimit}, jobs}`; no `storage_key`/`bucket`. Adapter probe `Promise.race` RESOLVES-unreachable on `STORAGE_HEALTH_PROBE_MS` (1500); DB reads parallel. `00-storage-health.test.ts` asserts shape + no-key-leak + <5s return under a never-resolving fake adapter |
| 2 | 4 runbooks under `docs/runbooks/` using the locked Trigger→Symptoms→Triage→Resolution→Escalation template; validate-docs 4th invariant confirms `runbook_url` cross-link integrity | VERIFIED | `storage-quota-exceeded.md`, `image-transform-failure.md`, `s3-unreachable.md`, `orphan-files-detected.md` present; each opens `# Title` → `> Source alert: […]` and has the 5 H2 sections in order (spot-checked on `storage-quota-exceeded.md`); `bun run validate` → PASS |
| 3 | 2+ Sentry alert JSONs from `docs/alerts/sentry/`; each `runbook_url` points at an existing runbook (CI gate) | VERIFIED | 4 alerts: `storage-quota-90.json`→`storage-quota-exceeded.md`, `storage-quota-100.json`→`storage-quota-exceeded.md`, `image-transform-failure-rate.json`→`image-transform-failure.md`, `s3-unreachable.json`→`s3-unreachable.md`; all four `runbook_url` targets exist; validate-docs Pass B green |
| 4 | `docs/integrations/file-storage.md`: per-backend CORS templates, bucket lifecycle snippets (`AbortIncompleteMultipartUpload` 7d, `tmp/` 1d), CDN/Cache-Control, Docker base-image pin for sharp (`oven/bun:1-debian-slim`, NOT Alpine) | VERIFIED | File present with sections: Overview (sequenceDiagram), Per-backend CORS templates, Bucket lifecycle policies, CDN / Cache-Control guidance, Docker base-image pin (sharp), Storage health contributor + cron schedule. References Phase 25 `cors/` dir; cites Phase 28 Debian-not-Alpine spike fact |
| 5 | Scheduled cleanup jobs on cron (reap-pending hourly, reap-orphan daily, reap-soft-deleted weekly, reconcile daily); job runs surfaced in `/health/detailed` | VERIFIED | Four jobs in the files `ModuleDefinition.jobs` with `repeat.pattern` (`0 * * * *` / `30 3 * * *` / `0 4 * * 0` / `0 2 * * *`); `worker.ts` registers each via `queue.upsertJobScheduler` (idempotent by `jobName`); each handler wraps `withJobRun` → `storage_job_runs`; the health contributor reads them via `readJobStatuses` with staleness. `00-reap-*`/`00-reconcile-*` → 10/0; `worker-repeatable.test.ts` → 3/0 |

**Score: 5/5 verified.**

## Required Artifacts

| Artifact | Status | Details |
|---|---|---|
| `packages/modules/files/src/health/storage-health.ts` | VERIFIED | `storageHealthContributor` + `checkStorageHealth`; bounded probe; status rollup D-31-03 |
| `packages/modules/files/src/jobs/reap-pending-uploads.ts` | VERIFIED | hourly; single DELETE…RETURNING + release-returned-only |
| `packages/modules/files/src/jobs/reap-orphan-files.ts` | VERIFIED | daily; conservative `ownerExists` backstop; `owner_record_id <> ''` guard; soft-delete via shared helper |
| `packages/modules/files/src/jobs/reap-soft-deleted.ts` | VERIFIED | weekly; deletes primary + every `transforms[].storageKey`; counters untouched |
| `packages/modules/files/src/jobs/reconcile-tenant-usage.ts` | VERIFIED | daily; set-based UPDATE; counting model matches increment/refund; `bytes_pending` untouched |
| `packages/modules/files/src/lib/job-runs.ts` | VERIFIED | `withJobRun` (ON CONFLICT upsert, success+error) + `readJobRuns` |
| `packages/modules/files/src/lib/owner-resolution.ts` | VERIFIED | per-relation resolver via `fileRelationsRegistry`; memoized; SKIP-by-default |
| `packages/db/migrations/0005_v14_storage_job_runs.sql` (+ `.down.sql`) | VERIFIED | `storage_job_runs` table; exported from db barrel |
| `packages/shared/src/types/module.ts` | VERIFIED | `JobDefinition.repeat?` + `FileRelation.ownerExists?` |
| `apps/api/src/worker.ts` | VERIFIED | `upsertJobScheduler` scheduler step, guarded, idempotent |
| `packages/config/src/env.ts` + `.env.example` | VERIFIED | 3 new env vars with defaults |
| `docs/runbooks/{storage-quota-exceeded,image-transform-failure,s3-unreachable,orphan-files-detected}.md` | VERIFIED | locked template; Source-alert openers |
| `docs/alerts/sentry/{storage-quota-90,storage-quota-100,image-transform-failure-rate,s3-unreachable}.json` | VERIFIED | resolving `runbook_url` + `_baseworks_meta` |
| `docs/integrations/file-storage.md` | VERIFIED | 6 sections incl. health-contributor anchor |
| Phase 31 tests (`00-reap-*`, `00-reconcile-*`, `00-storage-health`, `worker-repeatable`) | VERIFIED | 10/0 + 3/0 |

## Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| files `ModuleDefinition.health` | `HealthAggregator` | `registry.ts:128-130` auto-register | WIRED |
| files `ModuleDefinition.jobs[*].repeat` | BullMQ scheduler | `worker.ts` `upsertJobScheduler(jobName,{pattern})` | WIRED |
| job handlers | health contributor | `storage_job_runs` table (cross-process) | WIRED |
| `docs/alerts/sentry/*.json#runbook_url` | `docs/runbooks/*.md` | validate-docs Pass B | WIRED (validate PASS) |
| `orphan-files-detected.md` | `file-storage.md` storage-contributor section | Source-alert link | WIRED |
| reap-orphan | owning modules | `FileRelation.ownerExists` via `fileRelationsRegistry` (no cross-module import) | WIRED |

## Behavioral Spot-Checks

| Behavior | Result | Status |
|---|---|---|
| `bun run validate` exits 0 (4 invariants, Mermaid ≥ 11) | `[validate-docs] PASS`, 12 Mermaid blocks | PASS |
| Phase 31 job + health suites green vs live Postgres | 10 pass / 0 fail | PASS |
| Repeatable scheduler registers per `repeat` job | `worker-repeatable.test.ts` 3 pass / 0 fail | PASS |
| Health contributor returns < 5s under a hung adapter, `reachable:false`, no key leak | `00-storage-health.test.ts` green | PASS |
| reconcile matches hand-computed sum incl. variant bytes; `bytes_pending` untouched | `00-reconcile-tenant-usage.test.ts` green | PASS |
| orphan reaper SKIPs owner-exists / unknown / no-resolver / grace / `''` sentinel; reaps only definitive-false | `00-reap-orphan-files.test.ts` green | PASS |
| Full files module / typecheck / lint / test | 108/0; tsc exit 0; lint exit 0; `bun run test` exit 0 | PASS |

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| QUO-03 | Quota observability surfaced to operators | SATISFIED | storage HealthContributor `quota` block (top-N, pctUsed, warn/limit counts) in `/health/detailed` |
| OPS-01 | Reconciliation / drift correction | SATISFIED | `quota:reconcile-tenant-usage` daily, formula-identical to increment/refund, `bytes_pending` untouched |
| OPS-02 | Scheduled cleanup jobs | SATISFIED | 4 repeatable cron jobs + the established `repeat`/`upsertJobScheduler` mechanism; runs persisted to `storage_job_runs` |
| OPS-03 | Operator surface: runbooks, alerts, integration docs | SATISFIED | 4 runbooks + 4 Sentry alerts (CI-gated cross-links) + `file-storage.md`; health-contributor job-run visibility |

## Anti-Patterns Found

No blocker anti-patterns. Two adversarial blockers were found DURING the phase and fixed
(documented in `31-SUMMARY.md`): (1) the repeatable-job mechanism did not exist — established
it; (2) the orphan reaper would have false-deleted never-attached uploads via the `''`
`owner_record_id` sentinel — added the load-bearing `owner_record_id <> ''` scan predicate.
One warning (reconcile-formula divergence) mitigated by reusing the exact counting model and
never touching `bytes_pending`.

## Human Verification Required

None blocking. Browser-E2E carryover from `29-HUMAN-UAT.md` + `30-HUMAN-UAT.md` and the
production-deploy-gated UAT items from v1.3 (Sentry DSN, OTLP backend) remain operator-gated
and are not Phase 31 implementation gaps. The Sentry alert JSONs import only against a real
Sentry org (advisory, same posture as Phase 23).

## Gaps Summary

No gaps. All 5 Success Criteria VERIFIED against the live codebase; QUO-03 / OPS-01 / OPS-02 /
OPS-03 all SATISFIED. Repo health green: `bun run typecheck` exit 0, `bun run test` exit 0,
`bun run lint` exit 0, `bun run validate` PASS. **This phase closes the v1.4 milestone (8/8
phases).**

---

_Verified: 2026-06-18 — full-phase verification against the live codebase + CI gates._
