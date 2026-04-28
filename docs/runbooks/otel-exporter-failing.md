# OTEL exporter failing — observability silent

> Source alert: [docs/alerts/sentry/otel-exporter-failing.json](../alerts/sentry/otel-exporter-failing.json)

## Trigger

Sentry Issue Alert `otel-exporter-failing` fires when the api or worker process emits transport-error events for the configured ErrorTracker (`SENTRY_DSN` / `GLITCHTIP_DSN`) or when `validateObservabilityEnv` rejected on boot. Maps to `docs/alerts/sentry/otel-exporter-failing.json`.

## Symptoms

- Sentry / GlitchTip stops receiving events. The Issues view shows a flat-line drop in event volume that does NOT match a real traffic drop.
- API or worker pino logs include `Sentry transport error`, `OTLP exporter failed to export`, or `Failed to fetch sentry.io` lines.
- On boot, the process exited with `Error: SENTRY_DSN is required when ERROR_TRACKER=sentry` (or `GLITCHTIP_DSN is required when ERROR_TRACKER=glitchtip`). This is `validateObservabilityEnv` doing the crash-hard guard from Phase 18 D-09 — see `packages/config/src/env.ts:122`.
- Outbound network from the api/worker container to `sentry.io` (or your GlitchTip endpoint) is blocked, surfacing as DNS or TCP errors in the api logs.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

> **Wait 5 minutes before action** to confirm this is not a deploy blip. The alert's frequency window is 5m. A short transport blip during a Sentry SaaS edge restart is not an outage.

1. Check the api boot state:

   ```bash
   docker compose ps api
   docker compose logs api --tail 50
   ```

   If api is in `Restarting` state and logs end with `SENTRY_DSN is required when ERROR_TRACKER=sentry`, the validator caught a misconfig. Jump to Resolution.

2. (If api is running) confirm the env vars are set:

   ```bash
   docker compose exec api printenv | grep -E 'ERROR_TRACKER|SENTRY_DSN|GLITCHTIP_DSN|RELEASE|SENTRY_ENVIRONMENT'
   ```

   `ERROR_TRACKER` is one of `noop`, `pino`, `sentry`, `glitchtip` (default: `pino` — Phase 18 D-06 widened this from `noop`). When `ERROR_TRACKER=sentry`, `SENTRY_DSN` MUST be set. When `ERROR_TRACKER=glitchtip`, `GLITCHTIP_DSN` MUST be set.

3. Verify the line-1 telemetry pattern is intact (Phase 18 D-09 / T-18-40):

   ```bash
   docker compose exec api head -2 src/index.ts
   ```

   Expected output:

   ```typescript
   import "./telemetry";
   import { env, validatePaymentProviderEnv, validateObservabilityEnv } from "@baseworks/config";
   ```

   The `import "./telemetry"` MUST be the first line. If it was moved, the Sentry SDK never initialized and every `captureException` is silently no-op-ing through pino-only.

4. Check outbound network reachability:

   ```bash
   docker compose exec api wget -qO- --timeout=5 https://sentry.io || echo "BLOCKED"
   # For self-hosted GlitchTip:
   docker compose exec api wget -qO- --timeout=5 $GLITCHTIP_DSN || echo "BLOCKED"
   ```

   `BLOCKED` means egress firewall or DNS is failing. Sentry / GlitchTip ingestion will fail silently — `flush()` returns `false` after timeout, no signal in pino logs unless `debug: true` is set in `Sentry.init`.

5. Confirm the validator behaviour with `validateObservabilityEnv` from `packages/config/src/env.ts:122`:

   ```bash
   docker compose exec api bun -e 'import { validateObservabilityEnv } from "@baseworks/config"; validateObservabilityEnv(); console.log("OK")'
   ```

   `OK` means the env shape is valid. An exception means the validator caught a real misconfiguration.

## Resolution

### Most likely: missing or rotated DSN

The Sentry / GlitchTip operator console can rotate DSNs. After rotation, the old DSN returns 401 and every event is silently dropped (the Sentry SDK does not throw on 401 — it logs to the SDK's internal logger).

```bash
# Update the env file with the new DSN
docker compose restart api worker
docker compose logs api --tail 50  # confirm validateObservabilityEnv passes
```

To confirm events flow again, trigger a deliberate test capture:

```bash
docker compose exec api bun -e \
  'import { getErrorTracker } from "@baseworks/observability"; getErrorTracker().captureException(new Error("post-deploy smoke test")); await getErrorTracker().flush(2000)'
```

Within 1-2 minutes the event appears in Sentry / GlitchTip Issues view tagged with the current `RELEASE` and `SENTRY_ENVIRONMENT`.

### If that did not work: outbound network blocked

A new firewall rule, a misconfigured egress proxy, or a DNS change can break Sentry / GlitchTip reachability without changing anything in the api code.

```bash
# Check that the container can reach the egress endpoint
docker compose exec api nslookup sentry.io
docker compose exec api wget -qO- --timeout=5 https://sentry.io
```

Resolve at the network layer (firewall rule, proxy whitelist, VPC egress route). For Sentry SaaS, the relevant hostnames are `*.ingest.sentry.io` and `*.sentry.io`.

### If that did not work: line-1 telemetry import was moved

If `import "./telemetry"` was inadvertently moved below another import (a refactor, an auto-format reorder, an import sorter), the OTel SDK initializes AFTER the first observability call resolves to the no-op tracer. This surfaces as silent absence of spans rather than a transport error.

Restore the line-1 invariant. The pattern is documented in [../observability/trace-propagation.md](../observability/trace-propagation.md) — telemetry init MUST happen before any module that imports `@opentelemetry/api`.

### If that did not work: schema drift in observability config

If you bumped the `@baseworks/config` package without re-running `bun install`, the env shape may have changed. Run `bun install` and restart.

## Escalation

If stuck longer than 30 minutes:

- Open an issue with: api boot logs, `printenv | grep ERROR_TRACKER`, the output of the deliberate test capture, and the timestamp at which Sentry / GlitchTip stopped receiving events.
- Post in repo discussions with the same artefacts.
- Check upstream provider status:
  - Sentry Status — https://status.sentry.io/
  - GlitchTip — your self-hosted endpoint's `/health` page.
- For self-hosted GlitchTip, check the GlitchTip server's storage and ingestion queue independently. The api side may be sending fine; ingestion may be backed up.
- Page yourself for the next attempt.

See also:

- [high-error-rate.md](./high-error-rate.md) — When events ARE flowing but rate is too high.
- [../observability/trace-propagation.md](../observability/trace-propagation.md) — How traces and errors flow through the v1.3 stack.
- [../observability/cardinality.md](../observability/cardinality.md) — What NOT to label on events (so you do not balloon your Sentry quota).
