# Storage quota exceeded — tenant at/over its byte limit

> Source alert: [docs/alerts/sentry/storage-quota-90.json](../alerts/sentry/storage-quota-90.json)

## Trigger

A tenant's storage usage crosses a quota threshold. Two signals:

- The owner-gated `/health/detailed` storage contributor reports a tenant with `pctUsed >= 0.9` (warning) or `>= 1.0` (at/over limit) in `details.storage.quota.topTenants`, and `quota.tenantsAtLimit > 0` flips the storage contributor to `degraded` (Phase 31 / QUO-03).
- `POST /api/files/sign-upload` returns HTTP 413 `quota_exceeded` for that tenant (the race-safe `reserveQuota` UPDATE matched 0 rows — `bytes_used + bytes_pending + size > COALESCE(bytes_limit, STORAGE_DEFAULT_QUOTA_BYTES)`).

Maps to `docs/alerts/sentry/storage-quota-90.json` (warning) + `docs/alerts/sentry/storage-quota-100.json` (critical).

## Symptoms

- Uploads for the affected tenant fail at sign-time with 413 `quota_exceeded`; the browser never gets a signed PUT URL.
- `/health/detailed` `data.storage.status` is `degraded` with `quota.tenantsAtLimit >= 1`.
- The tenant appears at the top of `quota.topTenants` with `pctUsed` near or above `1.0`.
- `bytes_pending` may be inflated by abandoned uploads (sign-upload reserved bytes that `complete-upload` never converted) — these are released hourly by `cleanup:reap-pending-uploads`.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

1. `curl -s -H "cookie: <owner session>" http://localhost:3000/health/detailed | jq '.data.storage.quota'` — confirm `tenantsAtLimit` and read the offending `topTenants[].tenantId`, `bytesUsed`, `bytesLimit`, `pctUsed`.
2. Decide whether usage is REAL or DRIFTED. Inspect the row directly:
   `docker compose exec postgres psql -U baseworks -d baseworks -c "SELECT bytes_used, bytes_pending, bytes_limit FROM tenant_storage_usage WHERE tenant_id = '<tenantId>';"`
3. Compare against the authoritative SUM over live counted files:
   `docker compose exec postgres psql -U baseworks -d baseworks -c "SELECT COALESCE(SUM(byte_size + COALESCE((SELECT SUM((t->>'byteSize')::bigint) FROM jsonb_array_elements(transforms) t),0)),0) FROM files WHERE tenant_id='<tenantId>' AND deleted_at IS NULL AND status IN ('uploaded','ready','transforming');"`
4. If step 2's `bytes_used` is much larger than step 3's SUM, the counter has DRIFTED (a missed decrement) — usage is not actually that high.
5. Check `data.storage.jobs[]` for `quota:reconcile-tenant-usage` — a `stale` or `error` run explains why drift was not auto-corrected.

## Resolution

### If usage is real and the tenant needs more room

Raise the per-tenant override (NULL means "use `STORAGE_DEFAULT_QUOTA_BYTES`"):

```bash
docker compose exec postgres psql -U baseworks -d baseworks \
  -c "UPDATE tenant_storage_usage SET bytes_limit = 5368709120 WHERE tenant_id = '<tenantId>';"  # 5 GiB
```

The change is effective immediately for the next `sign-upload` (the COALESCE reads the column live).

### If the counter has drifted (step 4 above)

Run the reconcile job to rebuild `bytes_used` from the authoritative SUM (it never touches `bytes_pending`):

```bash
# In the worker process (or trigger the BullMQ scheduler manually):
docker compose exec worker bun -e "import('@baseworks/module-files').then(m => m.default.jobs['quota:reconcile-tenant-usage'].handler({}))"
```

Re-check `/health/detailed`; `bytes_used` should now match the live SUM and `tenantsAtLimit` should clear if the tenant was only over due to drift.

### If `bytes_pending` is inflated by abandoned uploads

Wait for the hourly `cleanup:reap-pending-uploads` job, or trigger it manually (same pattern as above with `cleanup:reap-pending-uploads`). It deletes pending rows older than 1 hour and releases their reserved bytes.

### Otherwise: have the tenant delete files

Soft-deleted files refund `bytes_used` immediately; the physical objects + tombstones are hard-deleted later by the weekly `cleanup:reap-soft-deleted`.

## Escalation

If stuck longer than 30 minutes:

- Open an issue with the `/health/detailed` `data.storage.quota` JSON and the step 2/3 query outputs.
- If `bytes_used` keeps drifting after a reconcile, a decrement path is leaking — capture the sequence of operations (upload / transform / delete / cascade) and file a bug; do NOT keep raising `bytes_limit` to mask it.
- For systemic capacity issues, review `STORAGE_DEFAULT_QUOTA_BYTES` and the object-store bucket sizing.

See also:

- [orphan-files-detected.md](./orphan-files-detected.md) — orphaned files inflate `bytes_used`; the orphan reaper is the backstop that returns those bytes.
