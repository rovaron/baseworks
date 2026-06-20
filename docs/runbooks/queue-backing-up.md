# Queue backing up — BullMQ depth runaway

> Source alert: [docs/alerts/sentry/queue-backing-up.json](../alerts/sentry/queue-backing-up.json)

## Trigger

Sentry Metric Alert `queue-backing-up` fires when any queue's `waiting` count crosses the v1.3 thresholds (`warn=100`, `critical=1000`, hardcoded per Phase 22 D-09 — see `apps/api/src/routes/health-detailed.ts:20-21`) for 5 minutes. Maps to `docs/alerts/sentry/queue-backing-up.json`.

## Symptoms

- `/health/detailed.data.queues[]` shows one or more queues with `status: "warning"` or `status: "critical"` and a non-trivial `waiting` count.
- `/health/detailed.data.workers` array is empty OR every entry has `status: "stale"` or `status: "dead"` (per `apps/api/src/routes/health-detailed.ts:107-123`).
- bull-board (under `/admin/bull-board`) shows growing waiting / delayed counts and a flat completed rate.
- pino logs from the worker process stop emitting `Job completed` lines but the api continues enqueueing.
- Customers report stale data: signup confirmations not delivered, billing usage not synced, follow-ups not firing.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

> **Wait 5 minutes before action** to confirm this is not a deploy blip. The alert's frequency window is 5m. A worker rolling restart leaves a transient bump in the waiting count.

1. `docker compose ps` — confirm api, worker, and redis are all `Up`. The most common cause of a backed-up queue is a worker that died silently.
2. `docker compose exec redis redis-cli --scan --pattern 'worker:heartbeat:*'` — list every active worker instance. If empty, no workers are heartbeating.
3. For each heartbeat key, inspect the JSON value:

   ```bash
   docker compose exec redis redis-cli get worker:heartbeat:<instanceId>
   ```

   The shape (per Phase 22 D-12 + `apps/api/src/worker.ts:116-123`):

   ```json
   {
     "instanceId": "worker-1",
     "queues": [
       "example-process-followup",
       "billing-process-webhook",
       "billing-sync-usage",
       "email-send"
     ],
     "lastHeartbeat": "2026-04-28T20:00:00.000Z",
     "version": "abc123"
   }
   ```

   The TTL on each key is `2 × $WORKER_HEARTBEAT_INTERVAL_MS` (configurable per `packages/config/src/env.ts:52`, default 15s → 30s TTL). A missing key means the worker has been unreachable for at least 30s.

4. `docker compose logs worker --tail 200 -f` — look for processor errors, OOM-kills, or stuck handlers. Each per-queue handler emits `Job started` / `Job completed` / `Job handler error` lines (see `apps/api/src/worker.ts:60-72`). A long gap between `Job started` and the next log line is a stuck handler — likely an unawaited promise or a deadlock against an upstream API.
5. Open bull-board for visual inspection at `/admin/bull-board` (owner session required — see [bull-board-inaccessible.md](./bull-board-inaccessible.md) if it does not load):

   ```bash
   curl -i -H "cookie: <owner session>" http://localhost:3000/admin/bull-board
   ```

   bull-board lists every queue, its waiting / delayed / completed / failed counts, and a per-job inspector. The four queues v1.3 ships are `example-process-followup`, `billing-process-webhook`, `billing-sync-usage`, `email-send` (verified 2026-04-27 against `apps/api/src/worker.ts`).

The `/health/detailed.data.queues[]` shape:

```json
{
  "name": "billing-process-webhook",
  "waiting": 1234,
  "active": 0,
  "delayed": 0,
  "completed": 0,
  "failed": 0,
  "status": "critical",
  "thresholds": { "warn": 100, "critical": 1000 }
}
```

## Resolution

### Most likely: worker process crashed or stopped

```bash
docker compose ps worker
docker compose restart worker
docker compose logs worker --tail 200 -f
```

If the worker exits immediately on restart, it is likely a configuration error: missing `REDIS_URL`, missing `DATABASE_URL`, or a freshly-pulled release that requires `bun run db:migrate` (see [db-down.md](./db-down.md) for the migration step).

After restart, watch the heartbeat appear:

```bash
docker compose exec redis redis-cli --scan --pattern 'worker:heartbeat:*'
```

### If that did not work: poison message

A single malformed job that always throws can stall the queue if the retry policy keeps re-queueing it. Open bull-board, filter by `failed` state on the affected queue, and inspect `job.data` for the most recent failures. Mark the offender failed permanently:

```bash
# In bull-board UI: Failed → click the job → "Move to failed" or "Remove"
# Or via redis-cli:
docker compose exec redis redis-cli del bull:billing-process-webhook:<jobId>
```

For Stripe webhook poison messages, also check the Stripe Dashboard → Developers → Webhooks → Recent deliveries to confirm Stripe is not retrying upstream (a duplicate-source spiral). See [webhook-failures.md](./webhook-failures.md).

### If that did not work: worker is alive but starved (DB or upstream slow)

If heartbeats are present and recent but `active` count is high while `completed` rate is near zero, every handler is blocked downstream. Check:

```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "SELECT pid, state, wait_event_type, wait_event, query \
      FROM pg_stat_activity WHERE state = 'active'"
```

Long-running `IDLE in transaction` or `Lock` rows indicate DB contention. Restart api + worker to clear:

```bash
docker compose restart api worker
```

For metrics labelling discipline on queue-related dimensions (so you can build a dashboard that finds this faster next time), see [../observability/cardinality.md](../observability/cardinality.md). `jobId` is in the HIGH-cardinality denylist — never label metrics with it.

## Escalation

If stuck longer than 30 minutes:

- Open an issue with: timestamp, affected queue name, `waiting` count, heartbeat snapshot, last 200 lines of worker logs, and bull-board screenshot of failed jobs (NOT committed to docs/runbooks/ per D-04, but useful in the issue thread).
- Post in repo discussions with the same artefacts.
- Check upstream provider dashboards relevant to the affected queue:
  - `billing-process-webhook` / `billing-sync-usage` — Stripe Dashboard, Pagar.me Dashboard
  - `email-send` — Resend / SMTP provider status page
- If the queue is a destructive operation (e.g., scheduled tenant deletion), pause processing first by stopping the worker. Do NOT mass-delete jobs from Redis without first confirming with another operator.
- Page yourself for the next attempt rather than burning out.

See also:

- [redis-down.md](./redis-down.md) — Redis-side root cause.
- [bull-board-inaccessible.md](./bull-board-inaccessible.md) — When you cannot inspect the queue visually.
- [../observability/cardinality.md](../observability/cardinality.md) — Safe metric labels for queue depth dashboards.
