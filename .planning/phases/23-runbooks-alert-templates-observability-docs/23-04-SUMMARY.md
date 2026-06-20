---
phase: 23
plan: 04
subsystem: docs-alerts
tags: [docs, alerts, sentry, observability, wave-2]
requires:
  - phase: 23-01
    provides: "validate-docs.ts 4th invariant Pass B + ALERT_SLUGS constant + alert-files-present RED test scaffold"
  - phase: 23-03
    provides: "9 docs/runbooks/<slug>.md files as cross-link targets for runbook_url validation"
provides:
  - "docs/alerts/sentry/auth-outage.json — Issue Alert template (login error spike)"
  - "docs/alerts/sentry/webhook-failures.json — Issue Alert (Stripe/Pagar.me delivery errors)"
  - "docs/alerts/sentry/high-error-rate.json — Issue Alert (overall error spike)"
  - "docs/alerts/sentry/otel-exporter-failing.json — Issue Alert (observability transport)"
  - "docs/alerts/sentry/bull-board-inaccessible.json — Issue Alert (admin queue UI 4xx)"
  - "docs/alerts/sentry/db-down.json — Metric Alert (Postgres availability)"
  - "docs/alerts/sentry/redis-down.json — Metric Alert (Redis availability)"
  - "docs/alerts/sentry/queue-backing-up.json — Metric Alert (BullMQ depth runaway)"
  - "docs/alerts/sentry/slow-checkout.json — Metric Alert (p95 checkout latency)"
  - "docs/alerts/sentry/README.md — operator import guide (3 paths) + SLO burn-rate explainer"
affects:
  - "23-05 (Phase close) — DOC-04 acceptance language fully addressed; CI Pass B inherits 9-runbook_url integrity gate on every PR"
tech-stack:
  added: []
  patterns:
    - "Issue Alert skeleton (RESEARCH §Q1) — actionMatch=all, EventFrequencyCondition, TaggedEventFilter, NotifyEmailAction"
    - "Metric Alert skeleton (RESEARCH §Q1) — dataset/query/aggregate, timeWindow=5, warning+critical triggers"
    - "_baseworks_meta wrapper field (endpoint, slo_note, priority) — D-15 + Research Finding 4 corrects D-15's WRONG comment-form"
    - "runbook_url top-level string field — repo-relative path resolves docs/alerts/sentry/<slug>.json -> docs/runbooks/<slug>.md"
    - "Strip-before-import idiom: `jq 'del(.runbook_url, ._baseworks_meta)'` — Research Finding 1"
    - "Three import paths documented (sentry-cli api passthrough, raw curl, UI wizard) — Research Finding 3 (sentry-cli alerts import does NOT exist)"
    - "Placeholder-only IDs (OPERATOR_TEAM_ID, YOUR_PROJECT_SLUG, $SENTRY_AUTH_TOKEN) — T-23-18 / T-23-20 mitigation"
key-files:
  created:
    - docs/alerts/sentry/auth-outage.json
    - docs/alerts/sentry/webhook-failures.json
    - docs/alerts/sentry/high-error-rate.json
    - docs/alerts/sentry/otel-exporter-failing.json
    - docs/alerts/sentry/bull-board-inaccessible.json
    - docs/alerts/sentry/db-down.json
    - docs/alerts/sentry/redis-down.json
    - docs/alerts/sentry/queue-backing-up.json
    - docs/alerts/sentry/slow-checkout.json
    - docs/alerts/sentry/README.md
  modified: []
key-decisions:
  - "Honored the 9 locked ALERT_SLUGS from scripts/__tests__/_slugs.ts byte-for-byte. Each alert file's basename matches its docs/runbooks/<slug>.md sibling 1:1."
  - "Issue Alerts (5) shaped per RESEARCH §Q1 verbatim: actionMatch=all, EventFrequencyCondition (value+interval=5m), TaggedEventFilter, NotifyEmailAction. Endpoint: POST /api/0/projects/{org}/{project}/rules/."
  - "Metric Alerts (4) shaped per RESEARCH §Q1 verbatim: dataset/query/aggregate, timeWindow=5, warning+critical triggers, projects array. Endpoint: POST /api/0/organizations/{org}/alert-rules/."
  - "Per-alert customization (priority, threshold, tag-filter) sourced from CONTEXT.md Discretion-default priorities + RESEARCH alert-type assignments verbatim — see customization table below."
  - "All JSON parseable by JSON.parse with zero comments (Research Finding 4 corrects D-15). The SLO note ships as a `_baseworks_meta.slo_note` string field, never as a `// comment` (which would break JSON.parse)."
  - "README documents `sentry-cli alerts import` does NOT exist (twice) — Research Finding 3. Path A is sentry-cli api REST passthrough, Path B is raw curl, Path C is Sentry UI wizard fallback."
  - "Strip-before-import idiom: every CLI/curl example in README pipes through `jq 'del(.runbook_url, ._baseworks_meta)'` before POSTing — Sentry's REST API may reject unknown top-level fields per RESEARCH §Q1 footnote."
  - "Forward-looking caveat in 3 Metric Alerts (db-down, redis-down, queue-backing-up): `metric:health.*` and `metric:queue.waiting_count` queries require custom-metrics ingestion not wired in v1.3 (Phase 21 deferred). slo_note documents the v1.3 fallback (monitor /health/detailed manually) and the v1.4+ OTLP path."
  - "biome-format pass applied (style commit 91bee2a) — biome's preferred single-line `actions` array form for Metric Alert critical triggers. Identical semantics; satisfies repo-wide format gate."
metrics:
  duration: ~3min
  tasks: 3
  files_created: 10
  total_lines: 420
  json_files: 9
  total_json_lines: 299
  readme_lines: 121
  completed: 2026-04-28
---

# Phase 23 Plan 04: Sentry alert JSON templates (Wave 2) Summary

Shipped 9 Sentry alert JSON templates + 1 operator-facing README under `docs/alerts/sentry/`. Each JSON is the request body an operator POSTs to Sentry's REST API after stripping the `runbook_url` and `_baseworks_meta` fields with `jq 'del(...)'`. The 5 Issue Alerts target project-rules; the 4 Metric Alerts target org-rules. Every `runbook_url` resolves to its 1:1 sibling under `docs/runbooks/` (Plan 23-03 ships those targets in parallel — both plans landed in Wave 2 with no merge ordering required). All 10 Wave-0 alert tests went RED → GREEN.

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-28T20:35:47Z (approx)
- **Tasks:** 3 / 3
- **Files created:** 10 (9 JSON + 1 README, all under `docs/alerts/sentry/`)
- **Total lines:** 420 (299 JSON + 121 README)

## Per-alert final customization

| slug | type | priority | endpoint | name | threshold (issue) / triggers (metric) | filter / dataset | slo_note (excerpt) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| auth-outage | Issue | high | project-rules | "Auth outage — login error spike" | value: 50 | tag `module=auth` | "Fires when >=50 auth-tagged events occur within a 5m window." |
| webhook-failures | Issue | medium | project-rules | "Webhook failures — Stripe/Pagar.me delivery errors" | value: 10 | tag `route=/api/webhooks/*` | "Fires when >=10 webhook-route events occur within a 5m window." |
| high-error-rate | Issue | medium | project-rules | "High error rate — overall events spike" | value: 100 | tag `level=error` | "Fires when >=100 error-level events occur within a 5m window across the project." |
| otel-exporter-failing | Issue | low | project-rules | "OTEL exporter failing — observability silent" | value: 5 | tag `logger=observability` | "Fires when >=5 observability-logger events occur within a 5m window (transport errors)." |
| bull-board-inaccessible | Issue | low | project-rules | "Bull-board inaccessible — admin queue UI failures" | value: 5 | tag `route=/admin/bull-board` | "Fires when >=5 bull-board-route 4xx events occur within a 5m window." |
| db-down | Metric | high | org-rules | "DB down — Postgres availability" | warning=1, critical=3 | dataset=metrics, query=`metric:health.db.status`, aggregate=count() | "Fast-burn alert: 3 consecutive 5m windows with health.db.status=down. Forward-looking..." |
| redis-down | Metric | high | org-rules | "Redis down — cache/queue backend" | warning=1, critical=3 | dataset=metrics, query=`metric:health.redis.status`, aggregate=count() | "Fast-burn alert: 3 consecutive 5m windows with health.redis.status=down. Forward-looking..." |
| queue-backing-up | Metric | low | org-rules | "Queue backing up — BullMQ depth runaway" | warning=500, critical=1000 | dataset=metrics, query=`metric:queue.waiting_count`, aggregate=max() | "Fast-burn alert: max queue waiting count >1000 over a 5m window. Forward-looking..." |
| slow-checkout | Metric | medium | org-rules | "Slow checkout — p95 latency" | warning=2000, critical=5000, resolve=1500 | dataset=transactions, query=`event.type:transaction transaction:/api/billing/checkout`, aggregate=p95(transaction.duration) | "Fast-burn alert: >=2% monthly latency budget over a 5m window. timeWindow=5 + alertThreshold gating equivalent to Prometheus `for: 5m`." |

All 9 files use `targetIdentifier: "OPERATOR_TEAM_ID"` placeholder (T-23-18 mitigation). All 4 Metric Alerts use `projects: ["YOUR_PROJECT_SLUG"]` placeholder. README CLI/curl examples reference `$SENTRY_AUTH_TOKEN`, `$SENTRY_ORG`, `$SENTRY_PROJECT` — never literal credentials (T-23-20 mitigation).

## README structure (final, 121 lines)

H1 + 9 H2 sections:

1. `# Sentry Alert Templates` (H1)
2. `## Overview` — what these templates are + 1:1 runbook pairing + Pass B gate.
3. `## Upstream Documentation` — 3 Sentry doc links (Alerts API, Issue config, Metric config).
4. `## Required environment variables` — 3-row table (SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT).
5. `## Alert inventory` — 5 Issue + 4 Metric, with per-file priority + tag/dataset.
6. `## Importing alerts — three paths` — Path A (sentry-cli api passthrough), Path B (raw curl), Path C (UI wizard). Header note: `sentry-cli alerts import` does NOT exist.
7. `## The strip-before-import idiom` — `jq 'del(.runbook_url, ._baseworks_meta)'` rationale.
8. `## SLO burn-rate translation` — short-window detection (Issue Alert), `for: 5m` equivalent (Metric Alert), burn-rate math via slo_note.
9. `## Forward-looking note (Grafana / OTLP)` — D-13: vendor-agnostic ports + custom-metrics caveat.
10. `## Customizing runbook_url for forks` — D-16: relative-path resolution semantics for fork relocation.

All required acceptance grep markers present: `# Sentry Alert Templates` (H1, 1x), `sentry-cli api` (5x), `does NOT exist` (2x), `jq 'del` (4x), `_baseworks_meta` (9x), `Path A` (2x), `Path B` (2x), `Path C` (1x), `burn-rate` (4x), `frequency` (3x), `timeWindow` (2x), 0 image refs, no frontmatter.

## Final Wave-0 test status: 10/10 GREEN

```
$ bun test scripts/__tests__/alert-files-present.test.ts

 10 pass
 0 fail
 28 expect() calls
Ran 10 tests across 1 file. [63.00ms]
```

- 9 alert presence + JSON.parse + runbook_url-shape tests: 0 → 9 PASS
- README presence test: 0 → 1 PASS

`bun run validate` against the live corpus: **exits 0** with `OK: found 11 Mermaid fenced blocks across docs/ (>= 11 required)` and `PASS`. Pass B scans all 9 alert JSON files, parses each, validates `runbook_url` resolves to a real `.md` file under `docs/runbooks/` — every link resolves cleanly because Plan 23-03 shipped those targets in parallel.

`bunx biome check docs/alerts/sentry/` exits 0 (after the style format-pass commit 91bee2a applied biome's preferred inline `actions` array form for the Metric Alert critical triggers).

## Note on dataset/metrics availability for db-down / redis-down / queue-backing-up

Sentry's `dataset: "metrics"` namespace + `query: "metric:health.db.status"` / `"metric:health.redis.status"` / `"metric:queue.waiting_count"` queries assume custom-metric ingestion that v1.3 has NOT wired (Phase 21 — OTEL Adapters + Grafana stack — was deferred to v1.4+ per the v1.3-ROADMAP.md update on 2026-04-27). The 3 affected templates document this in their `_baseworks_meta.slo_note` field with the format:

> "Forward-looking: requires custom metrics wiring (v1.4+ OTLP). For v1.3, monitor via /health/detailed manually or convert to Issue Alert on `health.db.status=down` log events."

For v1.3 operators, the operator-side workaround is one of:

1. Monitor the signals via the `/health/detailed` endpoint manually (cite: `apps/api/src/routes/health-detailed.ts:130-141` for `data.db` shape, `:107-123` for queue/worker freshness — already documented inline in the runbook siblings).
2. Convert these 3 templates from Metric Alerts to Issue Alerts (project-rules) keyed off log events emitted when health.db.status / health.redis.status / queue depth crosses thresholds (would require log-event tagging not yet shipped — out of scope for Phase 23).
3. Wait for v1.4+ OTLP + the Phase 21 follow-up to land custom metrics, then provision the 3 Metric Alerts as-shipped.

The `slow-checkout.json` Metric Alert is NOT affected by this caveat — it queries `dataset: "transactions"` against built-in Sentry transaction performance, which IS available in v1.3. Operators can provision `slow-checkout.json` immediately after Plan 23-04 merges.

## Cross-link map

Every JSON file's `runbook_url` field resolves to its 1:1 sibling:

| Alert file | runbook_url (relative from JSON file) | Resolved target |
| --- | --- | --- |
| docs/alerts/sentry/auth-outage.json | `../../runbooks/auth-outage.md` | docs/runbooks/auth-outage.md |
| docs/alerts/sentry/webhook-failures.json | `../../runbooks/webhook-failures.md` | docs/runbooks/webhook-failures.md |
| docs/alerts/sentry/high-error-rate.json | `../../runbooks/high-error-rate.md` | docs/runbooks/high-error-rate.md |
| docs/alerts/sentry/otel-exporter-failing.json | `../../runbooks/otel-exporter-failing.md` | docs/runbooks/otel-exporter-failing.md |
| docs/alerts/sentry/bull-board-inaccessible.json | `../../runbooks/bull-board-inaccessible.md` | docs/runbooks/bull-board-inaccessible.md |
| docs/alerts/sentry/db-down.json | `../../runbooks/db-down.md` | docs/runbooks/db-down.md |
| docs/alerts/sentry/redis-down.json | `../../runbooks/redis-down.md` | docs/runbooks/redis-down.md |
| docs/alerts/sentry/queue-backing-up.json | `../../runbooks/queue-backing-up.md` | docs/runbooks/queue-backing-up.md |
| docs/alerts/sentry/slow-checkout.json | `../../runbooks/slow-checkout.md` | docs/runbooks/slow-checkout.md |

Reciprocally, each runbook (Plan 23-03) opens with a `> Source alert:` blockquote linking back to its alert JSON via `../alerts/sentry/<slug>.json` — bidirectional cross-link complete.

## Task Commits

1. **Task 1: 5 Issue Alert JSON files** — `9beab94` (feat)
2. **Task 2: 4 Metric Alert JSON files** — `d2b2405` (feat)
3. **Task 3: docs/alerts/sentry/README.md** — `9daf0b3` (docs)
4. **Style fix: biome format pass on Metric Alerts** — `91bee2a` (style; Rule 1 auto-fix)

Plan metadata commit: to follow this SUMMARY.

## Files Created

### Created (10 new files under docs/alerts/sentry/)

- `docs/alerts/sentry/auth-outage.json` (36 lines) — Issue Alert, value=50, tag module=auth, priority=high.
- `docs/alerts/sentry/webhook-failures.json` (36 lines) — Issue Alert, value=10, tag route=/api/webhooks/*, priority=medium.
- `docs/alerts/sentry/high-error-rate.json` (36 lines) — Issue Alert, value=100, tag level=error, priority=medium.
- `docs/alerts/sentry/otel-exporter-failing.json` (36 lines) — Issue Alert, value=5, tag logger=observability, priority=low.
- `docs/alerts/sentry/bull-board-inaccessible.json` (36 lines) — Issue Alert, value=5, tag route=/admin/bull-board, priority=low.
- `docs/alerts/sentry/db-down.json` (31 lines) — Metric Alert, dataset=metrics, query=`metric:health.db.status`, warning=1/critical=3, priority=high.
- `docs/alerts/sentry/redis-down.json` (31 lines) — Metric Alert, dataset=metrics, query=`metric:health.redis.status`, warning=1/critical=3, priority=high.
- `docs/alerts/sentry/queue-backing-up.json` (31 lines) — Metric Alert, dataset=metrics, query=`metric:queue.waiting_count`, warning=500/critical=1000, priority=low.
- `docs/alerts/sentry/slow-checkout.json` (26 lines) — Metric Alert, dataset=transactions, p95(transaction.duration), warning=2000ms/critical=5000ms, resolveThreshold=1500ms, priority=medium.
- `docs/alerts/sentry/README.md` (121 lines) — operator import guide, 3 paths, strip idiom, SLO burn-rate explainer, Grafana forward note.

### Modified

None — pure docs-only addition under a new directory.

## Decisions Made

- **Honored the 9 locked ALERT_SLUGS byte-for-byte.** Plan 23-01 D-14 mirroring contract. Every alert file's basename matches its runbook sibling's basename.
- **Issue Alert vs Metric Alert assignment per RESEARCH alert-type table.** Auth/webhook/error-rate/otel/bull-board are event-frequency-based → Issue Alerts. DB/Redis/queue/checkout are threshold-based → Metric Alerts.
- **No comments anywhere in JSON.** Research Finding 4 corrects D-15: SLO note ships as a `_baseworks_meta.slo_note` string, not as a `// comment` line. JSON.parse() succeeds on every file (Pass B's primary gate).
- **Forward-looking caveat in 3 Metric Alerts.** db-down/redis-down/queue-backing-up depend on custom-metrics ingestion deferred to v1.4+. The `slo_note` field carries the operator-facing caveat with the v1.3 fallback (manual /health/detailed) and the v1.4+ resolution path. slow-checkout is NOT affected — it queries built-in transaction performance.
- **Three import paths in README.** Research Finding 3 confirmed `sentry-cli alerts import` does NOT exist; Path A uses the generic `sentry-cli api` REST passthrough as canonical CLI import. Path B is raw curl. Path C is the Sentry UI wizard.
- **Strip-before-import idiom prominent in README.** `jq 'del(.runbook_url, ._baseworks_meta)'` documented in every CLI/curl example AND its own dedicated H2 section. Sentry's REST API may reject unknown top-level fields (RESEARCH §Q1 footnote).
- **Placeholder-only IDs.** `OPERATOR_TEAM_ID`, `YOUR_PROJECT_SLUG`, `$SENTRY_AUTH_TOKEN`, `$SENTRY_ORG`, `$SENTRY_PROJECT` everywhere. T-23-18 / T-23-20 mitigation enforced by validate-docs.ts invariant 2 (catches sk_live_*, re_*, whsec_* shapes if accidentally pasted).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Style/formatter] biome format pass on 4 Metric Alert JSON files**

- **Found during:** Post-Task-3 cross-suite verification (`bunx biome check docs/alerts/sentry/`)
- **Issue:** Initial JSON files used multi-line form for the `actions` array containing a single email-action object inside the critical trigger. biome's JSON formatter prefers the single-line form when the array contains exactly one short object.
- **Fix:** Ran `bunx biome check --write docs/alerts/sentry/` which compacted `"actions": [\n  { ... }\n]` to `"actions": [{ ... }]` in 4 files (db-down, redis-down, queue-backing-up, slow-checkout). Identical JSON semantics; JSON.parse + the alert-files-present test still PASS post-fix. Re-verified all 10 acceptance criteria still met after the format pass.
- **Files modified:** docs/alerts/sentry/{db-down,redis-down,queue-backing-up,slow-checkout}.json
- **Commit:** `91bee2a` (separate style commit so the feat commits stay representative of the human-authored shape).

### Pre-existing Out-of-Scope Issues (logged, not fixed)

- `apps/web/next-env.d.ts` is untracked at exec time. Generated by Next.js, would normally be gitignored. Pre-existing (not caused by this plan); leaving as-is per SCOPE BOUNDARY rule. Not added to gitignore in this plan because the file/gitignore is not in this plan's surface. A follow-up quick task could add `apps/web/next-env.d.ts` (or `**/next-env.d.ts`) to `.gitignore` if not already deferred.

## Issues Encountered

None — plan executed cleanly. The biome format deviation surfaced post-acceptance (during cross-suite verification) and was a 1-command fix.

## User Setup Required

None — pure documentation. Operator-side setup steps (provisioning `SENTRY_AUTH_TOKEN`, importing alerts via Path A/B/C) are documented in the new README; that is operator work performed downstream of this plan, not setup required to land the plan.

## Next Phase Readiness

- **Plan 23-05 (Wave 3): Phase close + CI smoke check** — Inherits the now-9-alert + 9-runbook corpus. Pass B of `bun run validate` confirms every `runbook_url` resolves on disk; Plan 23-05 wires the full-suite smoke check into CI. Both Wave-2 plans (23-03 and 23-04) merged before this — no merge ordering required between them since they ship to disjoint directories (`docs/runbooks/` vs `docs/alerts/sentry/`).
- **DOC-04 acceptance language closed.** The 9 alert templates + README cover the requirement: "Sentry alert JSON templates pinned to runbook URLs, with operator-facing import documentation."

## Self-Check: PASSED

- FOUND: docs/alerts/sentry/auth-outage.json
- FOUND: docs/alerts/sentry/webhook-failures.json
- FOUND: docs/alerts/sentry/high-error-rate.json
- FOUND: docs/alerts/sentry/otel-exporter-failing.json
- FOUND: docs/alerts/sentry/bull-board-inaccessible.json
- FOUND: docs/alerts/sentry/db-down.json
- FOUND: docs/alerts/sentry/redis-down.json
- FOUND: docs/alerts/sentry/queue-backing-up.json
- FOUND: docs/alerts/sentry/slow-checkout.json
- FOUND: docs/alerts/sentry/README.md
- FOUND commit: 9beab94 (feat Task 1 — 5 Issue Alerts)
- FOUND commit: d2b2405 (feat Task 2 — 4 Metric Alerts)
- FOUND commit: 9daf0b3 (docs Task 3 — README)
- FOUND commit: 91bee2a (style — biome format pass)
- VALIDATOR: bun run validate exits 0 with `OK: found 11 Mermaid fenced blocks across docs/ (>= 11 required)` and `PASS`
- TESTS: alert-files-present.test.ts 10/10 GREEN (28 expects)
- BIOME: bunx biome check docs/alerts/sentry/ exits 0 with no violations

---
*Phase: 23-runbooks-alert-templates-observability-docs*
*Completed: 2026-04-28*
