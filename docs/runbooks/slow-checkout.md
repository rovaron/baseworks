# Slow checkout — p95 latency above 5s on /api/billing/checkout

> Source alert: [docs/alerts/sentry/slow-checkout.json](../alerts/sentry/slow-checkout.json)

## Trigger

Sentry Metric Alert `slow-checkout` fires when `p95(transaction.duration)` on the `POST /api/billing/checkout` transaction exceeds 5s for 5 minutes. Maps to `docs/alerts/sentry/slow-checkout.json`.

## Symptoms

- Stripe Dashboard → Checkout Sessions shows session creation taking longer than usual (the redirect URL response is delayed).
- Customers report "the checkout button spins for a long time" or "I clicked Pay and it took forever."
- Conversion drops in your billing analytics — abandonment rate on the checkout step climbs.
- Sentry / GlitchTip Performance view shows the `/api/billing/checkout` transaction p95 line crossing the 5s threshold.
- API pino logs show `checkout` entries with elevated `latency_ms` values.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

> **Wait 5 minutes before action** to confirm this is not a deploy blip. The alert's frequency window is 5m. p95 over a 5-minute window is sensitive to a single slow request when traffic is light.

1. Tail api logs filtered for checkout activity:

   ```bash
   docker compose logs api --tail 200 -f | grep -i checkout
   ```

   Look for `latency_ms` values, error responses, or repeated retries within a single request. The pino logger emits an HTTP-summary line per request via the request-trace middleware — `latency_ms > 5000` is the signal.

2. (If you have an owner session) check the billing module health and recent errors:

   ```bash
   curl -s -H "cookie: <owner session>" http://localhost:3000/health/detailed | jq '{
     status: .data.status,
     billing: (.data.modules[] | select(.name == "billing")),
     recentErrors: [.data.recentErrors[] | select(.message | test("checkout|stripe|billing"; "i"))]
   }'
   ```

3. Open Sentry / GlitchTip Performance:

   - Navigate to Performance → Transactions.
   - Filter by `transaction:"POST /api/billing/checkout"`.
   - Set the time window to 1 hour around the spike.
   - View the p95 chart and the trace detail for the slowest transactions.
   - Inside a slow trace, find the slowest child span — common candidates:
     - `db.query` against `subscriptions` or `customers` — slow SELECT, likely missing index or DB lock contention.
     - `http.client POST stripe.com` — Stripe API itself is slow.
     - `webhook.send` (forwarding) — outbound webhook to a customer URL is slow.

4. Check Stripe Status (or Pagar.me Status when `PAYMENT_PROVIDER=pagarme`):

   - Stripe Status — https://status.stripe.com/
   - Pagar.me Status — https://status.pagar.me/

   If the upstream provider is having a partial degradation, our checkout latency tracks theirs.

5. Inspect recent traces for the span hierarchy:

   - Sentry Performance view → click the slow transaction.
   - Read the flame graph: which child span dominates total duration?
   - The `http.client` span name carries the upstream URL. If `stripe.com` dominates, the issue is upstream.

## Resolution

### Most likely: Stripe (or Pagar.me) API is slow upstream

Stripe's checkout session creation occasionally degrades during high-traffic periods or regional incidents. There is nothing to fix on our side — wait it out and monitor `https://status.stripe.com/`. If the provider posts an incident, link it in the alert thread so the team does not chase ghosts.

To avoid blocking customers entirely during prolonged upstream slowness, consider:

- Surfacing a banner ("checkout may be slow") on the customer-facing page when the alert is active.
- For extreme cases (>30 min p95 above 10s), failing fast at the api layer with a clear "please retry in a few minutes" rather than letting the page spin.

These are policy decisions; do not implement them inside an active incident without an issue + PR.

### If that did not work: DB lock contention on the subscriptions / customers table

If the slow span is `db.query` (not `http.client`), DB lock contention is likely. Probe live activity:

```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "SELECT pid, state, wait_event_type, wait_event, query_start, query \
      FROM pg_stat_activity WHERE state != 'idle'"
```

A row with `wait_event_type = "Lock"` or `wait_event = "transactionid"` is a blocked transaction. To unblock:

- Identify the blocking transaction (often a long-running migration or a manual `psql` session left open).
- If safe, `SELECT pg_cancel_backend(<pid>)` or `pg_terminate_backend(<pid>)` against the offender.

### If that did not work: deploy regression introduced a chatty pre-checkout flow

A new release added a synchronous call (price lookup, tax calculation, address validation) BEFORE Stripe's session-create call. Each extra hop adds latency. Check git log for recent changes to billing handler files:

```bash
git log --since="1 day ago" --oneline -- "packages/module-billing/src/**/*"
git log --since="1 day ago" --oneline -- "apps/api/src/routes/billing*"
```

Roll back or patch the chatty path. The fix is usually moving the pre-checkout calls behind a cache or running them in parallel rather than sequentially.

For the canonical billing flow (where checkout fits and what the boundaries are), see [../integrations/billing.md](../integrations/billing.md).

## Escalation

If stuck longer than 30 minutes:

- Open an issue with: timestamp of spike onset, current p95, sample slow trace ID from Sentry, dominant child span, and Stripe / Pagar.me Status link if relevant.
- Post in repo discussions with the same artefacts.
- For prolonged upstream incidents, communicate to customers proactively (status page, in-app banner). The "wait it out" path is the right call only when you have surfaced the wait clearly.
- If the issue correlates with webhook failures, also check [webhook-failures.md](./webhook-failures.md). A spike in failed webhooks can produce backpressure that shows up as checkout latency.
- Page yourself for the next attempt.

See also:

- [webhook-failures.md](./webhook-failures.md) — When checkout latency correlates with failed webhook deliveries.
- [high-error-rate.md](./high-error-rate.md) — When latency is paired with error spikes.
- [db-down.md](./db-down.md) — When the slow span is DB rather than upstream.
- [../integrations/billing.md](../integrations/billing.md) — Canonical billing flow.
