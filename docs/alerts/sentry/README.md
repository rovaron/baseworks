# Sentry Alert Templates

## Overview

This directory contains 9 Sentry alert JSON templates — one per incident runbook in [../../runbooks/](../../runbooks/). Each file is the request body an operator POSTs to Sentry's REST API to provision the alert; each carries a `runbook_url` field that cross-links it to its runbook sibling. The pairing is 1:1: every alert points at exactly one runbook, and Pass B of `bun run validate` (the docs validator) hard-fails on any alert whose `runbook_url` does not resolve to a real runbook file. These are starter templates — operators import them, swap placeholder org/team/project IDs for real ones, and customize thresholds against their own SLOs.

## Upstream Documentation

- [Sentry Alerts API](https://docs.sentry.io/api/alerts/)
- [Issue Alert config](https://docs.sentry.io/product/alerts/create-alerts/issue-alert-config/)
- [Metric Alert (alert rules)](https://docs.sentry.io/product/alerts/create-alerts/metric-alert-config/)

## Required environment variables

| Env var | Required | Purpose |
| --- | --- | --- |
| `SENTRY_AUTH_TOKEN` | yes for CLI/curl import | Sentry auth token with scope `alerts:write` (project) or `org:write` (org-level alerts). |
| `SENTRY_ORG` | yes for CLI/curl import | Your Sentry organization slug. |
| `SENTRY_PROJECT` | yes for project-level alerts | Your Sentry project slug. Required by Issue Alerts (project-level endpoint). |

## Alert inventory

5 Issue Alerts (project-level, event-frequency-based):

- `auth-outage.json` — login error spike (high priority).
- `webhook-failures.json` — Stripe / Pagar.me delivery errors (medium).
- `high-error-rate.json` — overall error count spike (medium).
- `otel-exporter-failing.json` — observability transport errors (low).
- `bull-board-inaccessible.json` — admin queue UI 4xx spike (low).

4 Metric Alerts (org-level, threshold-based):

- `db-down.json` — Postgres availability (high).
- `redis-down.json` — Redis availability (high).
- `queue-backing-up.json` — BullMQ depth runaway (low).
- `slow-checkout.json` — p95 latency at `/api/billing/checkout` (medium).

The Issue Alerts vs Metric Alerts split mirrors Sentry's two alert subsystems. Issue Alerts trigger on event-tag conditions (project-scoped); Metric Alerts trigger on aggregate thresholds (org-scoped). The endpoint each file targets is recorded in `_baseworks_meta.endpoint`.

## Importing alerts — three paths

**IMPORTANT:** `sentry-cli alerts import` does NOT exist as of 2026-04. The Sentry CLI does not expose a dedicated alert-import command. Use one of the three paths below instead.

### Path A — sentry-cli api POST passthrough (recommended for CLI users)

`sentry-cli api` is a generic REST passthrough. Pipe the alert JSON through `jq` to strip the Baseworks-only fields before POSTing to Sentry.

Issue alerts (project-level):

```bash
jq 'del(.runbook_url, ._baseworks_meta)' docs/alerts/sentry/auth-outage.json \
  | sentry-cli api --auth-token "$SENTRY_AUTH_TOKEN" \
      POST "/projects/$SENTRY_ORG/$SENTRY_PROJECT/rules/" \
      --data @-
```

Metric alerts (org-level):

```bash
jq 'del(.runbook_url, ._baseworks_meta)' docs/alerts/sentry/slow-checkout.json \
  | sentry-cli api --auth-token "$SENTRY_AUTH_TOKEN" \
      POST "/organizations/$SENTRY_ORG/alert-rules/" \
      --data @-
```

NOTE: `sentry-cli alerts import` does NOT exist. The generic `sentry-cli api` REST passthrough is the canonical CLI import path.

### Path B — raw curl (for environments without sentry-cli)

When `sentry-cli` is not installed, `curl` works against the same REST endpoints:

```bash
jq 'del(.runbook_url, ._baseworks_meta)' docs/alerts/sentry/auth-outage.json \
  | curl -X POST "https://sentry.io/api/0/projects/$SENTRY_ORG/$SENTRY_PROJECT/rules/" \
      -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
      -H "Content-Type: application/json" \
      --data @-
```

Use the org-level URL `https://sentry.io/api/0/organizations/$SENTRY_ORG/alert-rules/` for Metric Alert files.

### Path C — Sentry UI click-through (manual fallback)

When neither `sentry-cli` nor `curl` is on hand:

1. Sentry → Project (or Organization) → Alerts → Create Alert.
2. Choose "Issue Alert" or "Metric Alert" per the file's `_baseworks_meta.endpoint`.
3. Build the rule via the wizard using the values in the JSON file as a guide. Map `name`, `conditions`, `filters`, `frequency` (Issue) or `dataset`, `query`, `aggregate`, `triggers`, `timeWindow` (Metric) onto the wizard's fields.
4. Save.

NOTE: Newer Sentry UI versions may have hidden the JSON-edit toggle; if so, fall back to wizard-driven entry using the JSON values as a reference.

## The strip-before-import idiom

Every command in Path A and Path B starts with:

```bash
jq 'del(.runbook_url, ._baseworks_meta)' <file>.json
```

Why this is required: Sentry's REST API may reject unknown top-level fields. The `runbook_url` field exists for Baseworks's `validate-docs.ts` Pass B gate; the `_baseworks_meta` wrapper is for operator reference (endpoint, slo_note, priority). Neither belongs in the actual API payload. Strip before import; both fields are decorative metadata for the in-repo template, not part of Sentry's wire schema.

If a future Sentry release becomes lenient about unknown fields, the `jq` step becomes a no-op — but the strip-first habit costs nothing and is safe under both behaviors.

## SLO burn-rate translation

Sentry's API does not speak Prometheus-style burn-rate alerts directly. The translation reference Baseworks uses across the 9 templates:

- **Short-window detection.** Use an Issue Alert with `actionMatch: "all"` and a 5-15m `frequency` (the Issue Alert evaluation cadence). This is the equivalent of a fast-burn rule that fires on event-rate spikes.
- **Equivalent of Prometheus `for: 5m`.** A Metric Alert's `triggers[].alertThreshold` paired with `timeWindow: 5` enforces a sustained-threshold semantics — the threshold must hold over the full window before the alert resolves.
- **Burn-rate math.** Each alert JSON's `_baseworks_meta.slo_note` field documents the burn-rate intent in plain language (e.g., "fast burn = >2% of monthly latency budget over a 5m window"). Operators wiring alternative burn-rate frameworks (Prometheus, Grafana, Datadog) translate from `slo_note` instead of from the JSON shape.

The Baseworks 9 are NOT a substitute for a true SLO platform — they are starter alerts that capture the most common incident classes. Operators with hard SLO commitments should layer a dedicated burn-rate framework on top.

## Forward-looking note (Grafana / OTLP)

When a fork user wires OTLP / Grafana in v1.4+, they author Grafana YAML themselves. The observability ports shipped in Phase 17 are vendor-agnostic, so these Sentry templates remain useful as a reference for naming conventions and threshold defaults even after Grafana is added — the alert names, slo_note rationales, and runbook cross-links translate cleanly from Sentry to Grafana's alert subsystem. Three of the Metric Alerts (`db-down`, `redis-down`, `queue-backing-up`) reference `metric:health.*` and `metric:queue.waiting_count` queries that require custom-metric ingestion not yet wired in v1.3; their `_baseworks_meta.slo_note` fields document this caveat. v1.3 operators can monitor those signals via `/health/detailed` manually until v1.4+ OTLP lands.

## Customizing runbook_url for forks

If a fork relocates the runbooks directory to a different path, every `runbook_url` value must be updated to match. The validator's Pass B uses repo-relative `path.join(ROOT, dirname(jsonPath), runbookUrl)` — the value is path-resolved from the JSON file's own directory. The default `../../runbooks/<slug>.md` resolves to `<repo>/docs/runbooks/<slug>.md`. Forks moving runbooks to (e.g.) `<repo>/ops/runbooks/` would set `runbook_url` to `../../../ops/runbooks/<slug>.md`. The slug pairing remains 1:1: every alert file's basename matches its runbook file's basename (locked in `scripts/__tests__/_slugs.ts`).
