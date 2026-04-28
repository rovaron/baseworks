# High error rate — error count spike across replicas

> Source alert: [docs/alerts/sentry/high-error-rate.json](../alerts/sentry/high-error-rate.json)

## Trigger

Sentry Issue Alert `high-error-rate` fires when `>=N` events land within a 5-minute window (threshold tunable per fork — default suggestion: 100 events / 5m). Maps to `docs/alerts/sentry/high-error-rate.json`.

## Symptoms

- `/health/detailed.data.recentErrors` is non-empty and growing — see the shape below.
- Sentry / GlitchTip Issues view shows a sharp rate spike that does NOT match a deploy window or a real traffic increase.
- API or worker pino logs include a high-frequency stream of `ERROR` lines.
- Customers report intermittent 500s or "something went wrong" toasts that resolve on retry.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

> **Wait 5 minutes before action** to confirm this is not a deploy blip. The alert's frequency window is 5m. A rolling deploy that briefly broke a code path while replicas restarted produces a transient spike.

1. Read the most recent process-local errors:

   ```bash
   curl -s -H "cookie: <owner session>" http://localhost:3000/health/detailed | jq .data.recentErrors
   ```

   The shape (per Phase 22 D-15 + `apps/api/src/routes/health-detailed.ts:159-164`):

   ```json
   {
     "timestamp": "2026-04-28T12:00:00Z",
     "message": "string (truncated to 500 chars)",
     "source": "cqrs | http | worker | global",
     "count": 1
   }
   ```

   Note the surfaced shape DROPS `firstFrame` — the internal `RingBufferEntry` interface at `packages/observability/src/lib/ring-buffer-error-tracker.ts:13-24` has 5 fields, but `firstFrame` is internal-only and MUST NOT leak to the wire (T-22-07 mitigation). The dedup key is built from `message + firstFrame` server-side; the response only exposes the four fields above.

2. **CRITICAL — the ringbuffer is process-local.** Phase 22 deferred cross-replica aggregation. With multiple api / worker replicas, EACH replica has its own ringbuffer and its own `recentErrors` snapshot. To get the full picture you must:

   a. Hit `/health/detailed` on every replica (load-balancer-bypass — direct pod / container address), OR
   b. Rely on Sentry / GlitchTip for cross-replica aggregation. The error tracker forwards every capture to the configured backend (Sentry / GlitchTip / pino / noop) IN ADDITION to populating the local ring buffer. The ring buffer is a redundant local view, not the source of truth.

3. Tail current process logs:

   ```bash
   docker compose logs api --tail 500 -f | grep -i error
   docker compose logs worker --tail 500 -f | grep -i error
   ```

4. Open the Sentry / GlitchTip dashboard and group by `issue.message`:

   - Filter by `environment` (production / staging) and `release` (the active release tag).
   - Sort by event count, descending.
   - The top issue almost always is the root cause; second-tier issues are typically downstream.
   - Inspect tags: `tenantId`, `userId`, `requestId`, `command`, `queryName`, `queue`. A spike scoped to one tag (e.g., `command=createSubscription`) confirms a localized regression rather than a global outage.

5. Cross-check with the `recentErrors` `source` field distribution:

   - `source=cqrs` — CQRS handler threw (wrapped via `wrapCqrsBus`, see `apps/api/src/index.ts:76`).
   - `source=http` — HTTP request handler threw (Elysia error middleware path).
   - `source=worker` — BullMQ job handler threw (see `apps/api/src/worker.ts:77-89`).
   - `source=global` — uncaughtException / unhandledRejection (the Phase 18 D-02 global handler).

   A spike heavily weighted to one source narrows the search.

## Resolution

### Most likely: recent deploy regression

A deploy introduced a code path that throws under specific input. Check git log against the timestamp of the spike onset:

```bash
git log --since="1 hour ago" --oneline
```

If a candidate commit stands out, bisect:

```bash
git bisect start
git bisect bad HEAD
git bisect good <last-known-good-tag>
# Run the specific failing scenario at each step
```

Alternatively, rolling back the active deploy is a fast, safe action when the regression is clear.

### If that did not work: dependency-of-a-dependency change

A transitive dependency upgrade (e.g., a `bun.lock` change from a contributor's PR) introduced a behavior change without an obvious code-side culprit. Inspect:

```bash
git log --oneline bun.lock | head -10
git diff <last-known-good> HEAD -- bun.lock | head -50
```

Pin the suspect transitive dependency in `package.json` if needed and roll forward.

### If that did not work: upstream provider regression

If the spike correlates with calls to an upstream API (Stripe, Pagar.me, Resend, OAuth provider), check that provider's status page. The error event tags (`tags.upstream`, span names like `http.client`) help identify the provider.

For metric label discipline so future error dashboards stay queryable rather than exploding under cardinality, see [../observability/cardinality.md](../observability/cardinality.md). The 9-value HIGH-card list documented there (`tenantId`, `userId`, `requestId`, etc.) tells you which dimensions to put in `extra` (Sentry) rather than `tags` (metric).

## Escalation

If stuck longer than 30 minutes:

- Open an issue with: timestamp of spike onset, top 3 issues from Sentry by count, dominant `source` from `recentErrors`, current `release` tag, and the affected user count.
- Post in repo discussions with the same artefacts.
- For multi-replica deployments, gather `recentErrors` from at least 3 replicas to confirm whether the spike is uniform or skewed (a replica with a bad node would skew the distribution).
- Check upstream:
  - Sentry Status — https://status.sentry.io/
  - The dominant upstream provider in the error tags
- Page yourself for the next attempt.

See also:

- [otel-exporter-failing.md](./otel-exporter-failing.md) — When events ARE being captured but not delivered.
- [slow-checkout.md](./slow-checkout.md) — If errors correlate with billing latency.
- [auth-outage.md](./auth-outage.md) — If errors are heavily auth-tagged.
- [../observability/cardinality.md](../observability/cardinality.md) — Safe metric labels for error-rate dashboards.
