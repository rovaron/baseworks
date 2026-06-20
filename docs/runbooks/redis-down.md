# Redis down — queue + cache backend unreachable

> Source alert: [docs/alerts/sentry/redis-down.json](../alerts/sentry/redis-down.json)

## Trigger

Sentry Metric Alert `redis-down` fires when `/health` reports `checks.redis.status: "down"` for 5 minutes. Maps to `docs/alerts/sentry/redis-down.json` (Phase 23 / Plan 04).

## Symptoms

- BullMQ producer calls (`Queue.add`, hooks that emit jobs) throw or hang. New job submissions fail.
- The unauthenticated Docker probe `/health` returns `status: "degraded"` with `checks.redis.status: "down"`.
- The owner-gated `/health/detailed` reports `data.workers: []` — the heartbeat publisher cannot write `worker:heartbeat:{instanceId}` keys to Redis (per Phase 22 D-12 + `apps/api/src/worker.ts:116-123`).
- Queue depth contributor (`apps/api/src/index.ts:145-161`) returns `unhealthy` because `Queue.getJobCounts` throws.
- API pino logs include `ECONNREFUSED 127.0.0.1:6379` or `Reached the max retries per request limit` (ioredis default).
- If Redis is the session store, `/api/auth/session` may also start returning 500s — though better-auth defaults to DB sessions in baseworks, double-check `BETTER_AUTH_SECRET` configuration.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

> **Wait 5 minutes before action** to confirm this is not a deploy blip. The alert's frequency window is 5m. A single rolling restart of the redis container during a deploy is not an outage.

1. `docker compose ps` — confirm redis is `Up`. `Restarting` is the early signal of OOM or persistence corruption.
2. `docker compose exec redis redis-cli ping` — expect `PONG`. Anything else (timeout, NOAUTH, LOADING) is the real signal.
3. `docker compose logs redis --tail 100` — look for `OOM command not allowed`, `Background save error`, or `Failed opening AOF`.
4. `curl -s http://localhost:3000/health | jq .checks.redis` — confirm the API agrees Redis is down.
5. (If you have an owner session) `curl -s -H "cookie: <owner session>" http://localhost:3000/health/detailed | jq '{workers: .data.workers, queues: .data.queues}'` — empty `workers` array AND `queues[].error` populated is the clean two-signal confirmation.

The unauth `/health` shape under a Redis outage:

```json
{
  "status": "degraded",
  "modules": ["auth", "billing", "example"],
  "checks": {
    "database": { "status": "up", "latency_ms": 4 },
    "redis": { "status": "down", "error": "Failed to connect" }
  },
  "uptime": 1234
}
```

## Resolution

### Most likely: Redis OOM

Redis ships with `maxmemory` unset by default in many compose templates. Once the host fills RAM, Redis evicts (with `maxmemory-policy`) or refuses writes (`OOM command not allowed when used memory > maxmemory`).

```bash
docker compose exec redis redis-cli info memory | grep -E 'used_memory_human|maxmemory_human|maxmemory_policy'
```

If `used_memory_human` is at or above `maxmemory_human`, increase `maxmemory` in your compose env or evict aggressively:

```bash
docker compose exec redis redis-cli config set maxmemory 256mb
docker compose exec redis redis-cli config set maxmemory-policy allkeys-lru
```

These take effect immediately and persist until restart. To make them permanent, edit `redis.conf` mounted into the container.

### If that did not work: persistence misconfiguration (AOF / RDB corruption)

If Redis exits on boot with `Failed opening AOF`, the AOF file is corrupted:

```bash
docker compose exec redis redis-cli config get appendonly
docker compose exec redis redis-check-aof --fix /data/appendonly.aof
docker compose restart redis
```

`redis-check-aof --fix` truncates to the last good record. You will lose recently-committed jobs that had not yet been processed; BullMQ jobs are `redis-persistent`, so missing-but-not-acked jobs are silently dropped on truncation. This is acceptable for `email-send` and `billing-sync-usage` (idempotent retries upstream) but check `billing-process-webhook` against the Stripe Dashboard for any silently lost webhooks.

### If that did not work: the redis container is gone

```bash
docker compose ps
docker compose up -d redis
docker compose logs redis --tail 200 -f
```

If the container will not stay up at all, check the host disk (`df -h`) and inspect the volume backing `redis-data`.

## Escalation

If stuck longer than 30 minutes:

- Open an issue describing what you saw, `redis-cli info memory` output, and any `redis-check-aof` output.
- Post in repo discussions with the same artefacts.
- Check upstream:
  - Redis release notes — https://github.com/redis/redis/releases
  - Redis Docker image issues — https://github.com/docker-library/redis/issues
- If you are on managed Redis (Upstash, ElastiCache, Memorystore), open a support ticket alongside debugging. Do NOT keep restarting api/worker — that hides the real signal.
- Page yourself for the next attempt rather than continuing to fight it solo.

See also:

- [queue-backing-up.md](./queue-backing-up.md) — Queue depth runaway is the most common downstream symptom of a Redis outage.
- [bull-board-inaccessible.md](./bull-board-inaccessible.md) — bull-board needs Redis to render; Redis-down causes the dashboard to show empty queues even when api is otherwise healthy.
