# DB down — Postgres unreachable

> Source alert: [docs/alerts/sentry/db-down.json](../alerts/sentry/db-down.json)

## Trigger

Sentry Metric Alert `db-down` fires when `/health` responses include `data.db.status='down'` for 5 minutes. Maps to `docs/alerts/sentry/db-down.json` (Phase 23 / Plan 04).

## Symptoms

- API returns 500 or 503 on every route that touches the DB (CQRS commands, queries, billing webhooks).
- The unauthenticated Docker probe `/health` returns `status: "degraded"` with `checks.database.status: "down"`.
- The owner-gated `/health/detailed` reports `data.db.status: 'unhealthy'` and a non-null `lagMs` or an `error` string.
- pgAdmin / `psql` connections refused from your laptop or another container in the same compose network.
- API pino logs include `ECONNREFUSED 127.0.0.1:5432` or `ENOTFOUND postgres` lines on cold start.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

> **Wait 5 minutes before action** to confirm this is not a deploy blip. The alert's frequency window is 5m (matches Sentry alert template's `frequency: 5`). A cold-start migration or a single dropped connection is not an outage.

1. `docker compose ps` — confirm the postgres service is `Up`. If it is `Restarting` or `Exit 137`, OOM is likely; jump to Resolution.
2. `docker compose exec postgres pg_isready -U $POSTGRES_USER -d $POSTGRES_DB` — confirm Postgres accepts new connections at the socket level. Returns `accepting connections` on healthy.
3. `docker compose logs postgres --tail 100` — look for `FATAL`, `out of memory`, `could not extend`, or `disk full` lines. Also check for `database system was shut down` immediately followed by another `LOG: starting PostgreSQL` (cold-start in progress, not a real outage).
4. `curl -s http://localhost:3000/health | jq` — confirm the API agrees the DB is down. The Docker probe at `apps/api/src/index.ts:250-283` performs `SELECT 1` and reports `checks.database.status: "down"` with a `latency_ms` if it gets a connection at all.
5. (If you have an owner session) `curl -s -H "cookie: <owner session>" http://localhost:3000/health/detailed | jq .data.db` — see the live `db` subobject below.

The `/health/detailed` `data.db` shape (per `apps/api/src/routes/health-detailed.ts:130-141`):

```json
{
  "connected": false,
  "lagMs": null,
  "status": "unhealthy"
}
```

`status` is one of `"healthy"` (`lagMs < 500`), `"degraded"` (`lagMs ≥ 500`), `"unhealthy"` (`SELECT 1` threw). When `connected` is `false`, the `error` string in `details` (visible via the aggregator) carries the postgres-side reason.

## Resolution

### Most likely: Postgres container exited or crashed

```bash
docker compose ps postgres                    # confirm the state
docker compose up -d postgres                 # restart it
docker compose logs postgres --tail 200 -f    # watch the recovery
```

If the container exited because of disk pressure, free space on the volume backing `postgres-data` and retry. `docker system df` shows volume usage; `docker volume prune` removes orphaned volumes (NOT `postgres-data`).

If postgres is `Up` but `pg_isready` still refuses, the listener may be bound but unable to accept (max_connections exhausted). Run:

```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state"
```

If `idle in transaction` count is large, a previous deploy left transactions open. Restart api + worker:

```bash
docker compose restart api worker
```

### If that did not work: connection-string mismatch

Check `$DATABASE_URL` in api and worker matches what postgres is actually serving:

```bash
docker compose exec api printenv DATABASE_URL
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "\\du"
```

The host inside compose is `postgres` (the service name), NOT `localhost`. A `.env` change that swapped these is a common cause after a fresh clone. Drizzle config also reads `DATABASE_URL` (see `drizzle.config.ts`); a different value there can cause migrations to land in the wrong DB.

### If that did not work: migrations need to run

If the API was upgraded to a release that added new tables and `bun run db:migrate` was skipped, queries against the missing tables will surface as 500s rather than connection failures, but the `db` contributor still passes (the `SELECT 1` probe ignores schema). Cross-check by running:

```bash
docker compose exec api bun run db:migrate
```

This is idempotent and safe. Drizzle's journal at `packages/db/drizzle/meta/_journal.json` tracks which migrations applied.

## Escalation

If stuck longer than 30 minutes:

- Open an issue describing what you saw, the timestamp ranges in `docker compose logs postgres`, and the output of `pg_stat_activity`.
- Post in repo discussions with the same artefacts.
- Check upstream provider status:
  - PostgreSQL release notes — https://www.postgresql.org/docs/release/
  - Postgres Docker image issues — https://github.com/docker-library/postgres/issues
- If you are on managed Postgres (Neon, Supabase, RDS, Cloud SQL), open the provider status page and a support ticket in parallel. Do NOT keep restarting api/worker — that masks the real signal.
- Page yourself for the next attempt rather than burning out on this one.

See also:

- [redis-down.md](./redis-down.md) — Redis unreachable triage. Frequently correlated when the host running compose is unhealthy.
- [queue-backing-up.md](./queue-backing-up.md) — When the DB outage prevents workers from acking jobs, the queue depth alert often fires next.
