# Webhook failures — Stripe / Pagar.me delivery or signature errors

> Source alert: [docs/alerts/sentry/webhook-failures.json](../alerts/sentry/webhook-failures.json)

## Trigger

Sentry Issue Alert `webhook-failures` fires when `/api/webhooks/stripe` or `/api/webhooks/pagarme` return 4xx for 5 minutes, or when handler errors tagged `kind=webhook` cross threshold. Maps to `docs/alerts/sentry/webhook-failures.json`.

## Symptoms

- Stripe Dashboard → Developers → Webhooks shows red deliveries on the active endpoint with HTTP 400 / 401 / 500 responses.
- Pagar.me Dashboard → Configurações → Webhooks shows similar failures (when `PAYMENT_PROVIDER=pagarme`).
- API pino logs include `webhook signature verification failed`, `Invalid signature`, or `Webhook payload not parseable` lines.
- Payment status divergence: Stripe shows `paid` but the local DB row in `subscriptions` or `invoices` is still `pending` / `processing`.
- Customer reports: "I paid but nothing changed in the app" — the subscription event was rejected upstream.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

> **Wait 5 minutes before action** to confirm this is not a deploy blip. The alert's frequency window is 5m. A single rolling-restart-during-deploy will surface as a transient batch of Stripe retries that succeed on the second attempt.

> **CRITICAL — request bodies are NOT in Sentry.** Per `packages/observability/src/lib/scrub-pii.ts:128-134`, every event whose `request.url` matches `/api/webhooks/**` has `request.data` deleted before forwarding to Sentry / GlitchTip. This is a deliberate privacy guard (Stripe sends signing secrets and card_last4 in webhook payloads). To inspect the actual webhook payload, use the Stripe / Pagar.me Dashboard "Resend" feature OR reproduce locally with `stripe listen` / `pagarme cli`. **Sentry will never have it.**

1. Check the upstream provider dashboard FIRST — that is the canonical source of truth for webhook delivery state.
   - Stripe: Dashboard → Developers → Webhooks → click the endpoint → Recent deliveries → filter `Failed`.
   - Pagar.me: Dashboard → Configurações → Webhooks → recent failures.
2. `docker compose logs api --tail 200 -f | grep -i webhook` — look for signature verification failures and any 4xx the api returned.
3. Verify the signing secret in env matches the Dashboard endpoint:

   ```bash
   docker compose exec api printenv STRIPE_WEBHOOK_SECRET | head -c 10
   # Or, if PAYMENT_PROVIDER=pagarme:
   docker compose exec api printenv PAGARME_WEBHOOK_SECRET | head -c 10
   ```

   Compare the prefix to the value shown in the Dashboard's webhook endpoint detail page. **Do NOT print the full secret** — the first 10 chars are enough to detect a rotation.

4. Confirm the active endpoint URL matches the Dashboard. After deploys behind a reverse proxy or CDN, the path the provider POSTs to may have changed.

5. If you see signature failures but the secret matches, there may be a body-mutation middleware in the chain. Elysia's webhook routes consume the raw body before parsing for signature verification — confirm no compression or transform plugins were added recently.

## Resolution

### Most likely: signing secret was rotated upstream

The Stripe / Pagar.me Dashboard has a "Reveal signing secret" button. If the operator rotated the secret without updating `$STRIPE_WEBHOOK_SECRET` (or `$PAGARME_WEBHOOK_SECRET`), every subsequent delivery fails signature verification.

```bash
# Read new value from the provider dashboard (do NOT paste it into the runbook)
# Update the env file mounted into the api container
docker compose restart api
```

After restart, click "Resend" on the most recent failed delivery in the Dashboard to confirm the fix without waiting for new traffic.

### If that did not work: webhook endpoint URL changed

Check the Dashboard's endpoint config. If your deployment moved (e.g., a domain rename, a path-prefix change behind a reverse proxy), the provider is still POSTing to the old URL.

- Stripe: Dashboard → Webhooks → "Update endpoint" — set the URL to your current `${API_URL}/api/webhooks/stripe`.
- Pagar.me: Dashboard → Webhooks → edit the endpoint URL.

### If that did not work: the api process is rejecting at the route layer

Check the api error response body for the specific failure mode. Common patterns:

- `400 Webhook Error: No signatures found matching the expected signature for payload` — signing-secret mismatch, see above.
- `400 Webhook Error: Unable to extract timestamp and signatures from header` — provider is calling a non-webhook endpoint, OR a CDN stripped the `Stripe-Signature` header.
- `500 internal server error` — handler threw downstream of signature verification. This case will surface in Sentry / GlitchTip with the exception name and a stack trace, but the request body itself is still scrubbed (see CRITICAL note above).

For the canonical end-to-end billing flow (where webhooks fit), see [../integrations/billing.md](../integrations/billing.md).

## Escalation

If stuck longer than 30 minutes:

- Open an issue with: timestamp range of failures, the upstream provider's failure listing (CSV export), the api error response body for one representative failure, and the Sentry / GlitchTip event ID for the same failure (Sentry will have everything EXCEPT the body — that is by design).
- Post in repo discussions with the same artefacts.
- Check upstream provider status:
  - Stripe Status — https://status.stripe.com/
  - Pagar.me Status — https://status.pagar.me/
- For a customer-impact escalation, gather the affected `tenantId` list from the failed-delivery payload metadata (`metadata.tenantId` if your Checkout Session creation populated it) BEFORE marking the issue resolved. Operators reading this runbook months later need that list to backfill subscriptions.
- Page yourself for the next attempt rather than burning out.

See also:

- [slow-checkout.md](./slow-checkout.md) — When latency is the symptom rather than failure.
- [auth-outage.md](./auth-outage.md) — Webhook handlers may need the better-auth session for tenant resolution.
- [../integrations/billing.md](../integrations/billing.md) — Canonical billing flow.
