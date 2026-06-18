# Orphan files detected — owner records gone, files left behind

> Source alert: surfaced via the `/health/detailed` storage contributor job-run status (operator-monitored; no Sentry metric) — see the storage-health section of [file-storage.md](../integrations/file-storage.md)

## Trigger

The daily `cleanup:reap-orphan-files` backstop is sweeping a non-trivial number of files (`items_swept` rising in `details.storage.jobs[]` for that job), OR the job is `stale` / `status: "error"` in the storage contributor. Orphans are files whose owner record was deleted but whose `onDelete:"cascade"` event was lost/dropped, so the normal cascade soft-delete (Phase 27) never fired. There is no Sentry metric for this — operators monitor it via `/health/detailed`.

## Symptoms

- `/health/detailed` `data.storage.jobs[]` entry `cleanup:reap-orphan-files` shows a climbing `itemsSwept`, or `stale: true` (no run within 2× its daily interval ⇒ scheduler stopped), or `status: "error"`.
- `bytes_used` for affected tenants is higher than expected (orphaned files still counted until the reaper soft-deletes them and refunds the bytes).
- Cascade events were dropped — e.g. the worker/event bus was down when an owner (user/organization) was deleted.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

1. `curl -s -H "cookie: <owner session>" http://localhost:3000/health/detailed | jq '.data.storage.jobs[] | select(.name=="cleanup:reap-orphan-files")'` — read `lastRunAt`, `status`, `itemsSwept`, `ageSec`, `stale`.
2. If `stale: true`, the BullMQ scheduler is not running — confirm the worker is up and the repeatable schedule registered: `docker compose logs worker | grep -i "Repeatable schedule registered"`.
3. Dry-run inventory: count candidate orphans WITHOUT deleting (the reaper only reaps when the owning relation's `ownerExists` resolver returns a definitive `false`):
   `docker compose exec postgres psql -U baseworks -d baseworks -c "SELECT owner_module, owner_record_type, count(*) FROM files WHERE deleted_at IS NULL AND created_at < now() - interval '24 hours' GROUP BY 1,2 ORDER BY 3 DESC;"`
4. Cross-check a sample against its owner table (e.g. `SELECT 1 FROM \"user\" WHERE id = '<owner_record_id>'`) to confirm the owner really is gone before trusting a large `itemsSwept`.

## Resolution

### Understand the SAFE decision table (why the reaper is conservative)

The orphan reaper NEVER deletes a file whose owner might still exist. For each candidate it dispatches the owning relation's opt-in `ownerExists({ tenantId, recordId })` resolver and acts as follows — every branch is SKIP except one:

| Condition | Action |
|---|---|
| No relation found for `(ownerModule, recordType)` | SKIP |
| Relation found, `ownerExists` not declared | SKIP |
| `ownerExists` throws / returns `"unknown"` | SKIP |
| `ownerExists` returns `true` (owner alive) | SKIP |
| File `created_at` within the 24h grace window | SKIP |
| File already tombstoned (`deleted_at` set) | SKIP (left to reap-soft-deleted) |
| `ownerExists` returns a definitive `false` AND file is live AND older than grace | **REAP** (soft-delete + refund bytes) |

The reaper SOFT-deletes (reversible) via the shared `softDeleteRow()` so quota refund (byte_size + variant bytes) stays in one code path; the weekly `cleanup:reap-soft-deleted` hard-deletes the objects + rows later.

### If the scheduler is stale/stopped

Restart the worker so `queue.upsertJobScheduler` re-registers the four repeatable schedules (idempotent by scheduler id). Then trigger one run manually if you need immediate cleanup:

```bash
docker compose exec worker bun -e "import('@baseworks/module-files').then(m => m.default.jobs['cleanup:reap-orphan-files'].handler({}))"
```

### If orphans keep appearing

The root cause is dropped cascade events. Confirm the owner-deletion producers emit `<ownerModule>.<recordType>-deleted` with `{ tenantId, recordId }` and that the event bus/worker is healthy. The reaper is a backstop, not the primary path.

### Retention interplay

A reaped (soft-deleted) file's objects + row are removed by `cleanup:reap-soft-deleted` once older than `STORAGE_SOFT_DELETE_RETENTION_DAYS` (default 30). So objects linger for the retention window after a reap — that is intentional (reversibility).

## Escalation

If stuck longer than 30 minutes:

- Open an issue with the `data.storage.jobs[]` entry, the step-3 candidate inventory, and a sample owner cross-check.
- If `itemsSwept` is unexpectedly large, STOP and verify the `ownerExists` resolvers are correct before letting more runs proceed — a buggy resolver that returns `false` for a live owner would over-delete (mitigated by soft-delete reversibility + the retention window, but still investigate).

See also:

- [storage-quota-exceeded.md](./storage-quota-exceeded.md) — orphaned files inflate `bytes_used`; reaping them returns the bytes and can clear a false quota alert.
