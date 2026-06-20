# Phase 23: Runbooks, Alert Templates & Observability Docs - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the v1.3 documentation surface: 8–10 incident runbooks under `docs/runbooks/`, Sentry alert configuration templates under `docs/alerts/sentry/` annotated with `runbook_url` cross-links, and a developer-facing observability concepts doc set under `docs/observability/` (attributes glossary + cardinality guide + trace-propagation walkthrough). All `runbook_url` references are in-repo paths so `scripts/validate-docs.ts` can hard-fail at phase close on any broken link.

In scope (DOC-03, DOC-04):
- 9 mandated runbooks (db-down, redis-down, queue-backing-up, webhook-failures, auth-outage, otel-exporter-failing, bull-board-inaccessible, high-error-rate, slow-checkout) using the locked Trigger → Symptoms → Triage → Resolution → Escalation template.
- Sentry alert config files (one per alert) with `runbook_url` annotations.
- `docs/observability/` README + three concept files.
- `scripts/validate-docs.ts` extended with a 4th invariant for `runbook_url` integrity, plus a new `.github/workflows/validate.yml` GitHub Actions job.

Out of scope:
- **Grafana alert YAML** — fully dropped per Phase 21 deferral (2026-04-27). The milestone-roadmap deferral note is authoritative; the top-level ROADMAP §"Phase 23" reference to Grafana is a stale mirror.
- Native bull-board UI screenshots, screenshot-driven runbooks (text-only canonical).
- Generic broken-link detection across all of `docs/` (only `runbook_url` + cross-runbook links validated).
- Markdown frontmatter on runbooks (no severity/est-resolution metadata in v1.3).
- New Biome lint rules (cardinality stays a doc-only guide).
- Husky pre-commit hooks (not in the project; not justified by this phase).
- Pulling SLO definitions out of project docs (Baseworks has no formal SLO doc; alert thresholds are defaults the operator tunes per fork).

</domain>

<decisions>
## Implementation Decisions

### Runbook content & audience

- **D-01:** **Audience = solo fork-user wearing all hats.** No L1/L2/L3 paging tiers, no on-call rotation language. Each runbook's **Escalation** section is short: "if stuck >30 min, post in repo discussions / open an issue / check upstream provider status page." Matches Baseworks' positioning (PROJECT.md: "personal infrastructure investment … freelance projects").

- **D-02:** **Command examples assume Docker Compose.** Concrete copy-pasteable shell: `docker compose ps`, `docker compose logs api --tail 100 -f`, `docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB`, `docker compose exec redis redis-cli ping`, etc. Each runbook's **Triage** section opens with a one-paragraph note: "These commands assume `docker-compose.yml` from the repo root. K8s/PaaS users translate to `kubectl exec` / equivalent." No tabbed Compose+K8s+bare-metal variants — defer to v1.4+ if fork demand emerges.

- **D-03:** **Tight 1-page checklist style, ~150–300 lines per runbook.** Section budgets:
  - **Trigger** — 2 lines describing the alert that fires (alert name + matching Sentry template path).
  - **Symptoms** — bullet list, 3–6 entries (what the user sees: HTTP 503, queue depth ≥ 1000, Sentry issue spike, …).
  - **Triage** — numbered checklist of commands, 5–10 steps. Opens with "wait 5m to confirm this is not a deploy blip" so the operator does not react to noise (Sentry alert templates already encode `for: 5m` equivalents — D-15).
  - **Resolution** — 2–3 fix paths with rationale (most likely cause first, escalating to "if that did not work, try this").
  - **Escalation** — 5–10 lines, per D-01.
  No prose narratives. No alternative-root-cause trees. Optimized for 3am readability.

- **D-04:** **Text-only — no screenshots.** Reasoning: screenshots rot fastest (UI changes → broken docs), git-diff-unfriendly, repo-bloat. Mermaid sequence diagrams allowed inline when explaining trace flows (counts toward `validate-docs.ts` Mermaid floor). The `bull-board-inaccessible` runbook explicitly does NOT include a bull-board screenshot — instead links to `docs/observability/trace-propagation.md` for the architectural picture.

### Observability concepts doc layout

- **D-05:** **Four files under `docs/observability/`:**
  - `README.md` — ~30-line index linking to the three concept files, with a one-paragraph "what observability looks like in this codebase" intro.
  - `attributes.md` — glossary table (columns: Name | Lives on (span/log/metric) | Type | Example value | Cardinality risk).
  - `cardinality.md` — rules + anti-patterns + Baseworks-specific high-card values (D-08).
  - `trace-propagation.md` — Mermaid sequenceDiagram + stateDiagram-v2 + walkthrough (D-06).
  Easier to deep-link from runbooks (`see docs/observability/cardinality.md#tenant-id`) than a single combined file.

- **D-06:** **Two Mermaid diagrams in `trace-propagation.md`:**
  1. `sequenceDiagram` — HTTP request → `onRequest` middleware → CQRS dispatch span → Drizzle query span → `wrapQueue.add` (W3C carrier on `job.data._otel`) → `wrapProcessorWithAls` worker resume span. Shows the single-trace API → DB → enqueue → worker flow that Phase 20.1 closed.
  2. `stateDiagram-v2` — ALS context lifecycle: `obsContext.run()` → `enterWith` ban (Phase 19) → fork on `setImmediate` / queue boundary → context restoration via W3C carrier on dequeue.
  **Both are added in the same commit as the new diagrams**; raise the validate-docs.ts Mermaid floor from 8 → 11.

- **D-07:** **File:line refs + 5-line snippets.** When `trace-propagation.md` explains the W3C carrier, cite `packages/queue/src/wrap-queue.ts:42` (or wherever the carrier-write site actually lives at planning time — researcher verifies) and embed the 5-line excerpt. When `attributes.md` lists the legitimate context fields, cite `packages/observability/src/lib/obs-context.ts` and `packages/observability/src/lib/scrub-pii.ts:13` (where the denylist + allowlist live). Excerpts kept short to age gracefully across refactors.

- **D-08:** **Cardinality guide is doc-only — no new lint rule, no validate-docs.ts grep.** Enumerates Baseworks-specific high-cardinality values that **must not** become metric labels but **are** legitimate span/log attributes:
  - `tenantId`, `userId`, `requestId`, `email`, `command`, `queryName`, `jobId`, `stripeCustomerId`, `pagarmeCustomerId`.
  Cross-links Phase 18's `scrubPii()` denylist (the same values that get redacted in error events). Cross-links Phase 19's `obsContext` (the same values that get put on logs as structured fields). Forward-looking note: when OTLP wires happen in v1.4+ a Biome GritQL rule similar to Phase 19's `enterWith` ban can mechanically enforce — flagged for that phase.

### CI runbook_url integrity check

- **D-09:** **Extend `scripts/validate-docs.ts` with a 4th invariant.** Sits alongside the existing forbidden-import / secret-shape / Mermaid-floor invariants. One file, one CI gate, one local command (`bun run validate`). Matches the established phase-close validator pattern from Phase 15 D-01.

- **D-10:** **Validator parses two source classes:**
  1. **Sentry alert templates** at `docs/alerts/sentry/*.json` — extracts every `runbook_url` field via JSON parse. Each value MUST resolve to an existing file at the repo-relative path it points to (e.g., `docs/runbooks/db-down.md`).
  2. **Cross-runbook markdown links** inside `docs/runbooks/*.md` — regex matches `\]\((\.\.?/[\w/.-]+\.md)(?:#[\w-]+)?\)`. Each captured target MUST resolve to an existing `.md` file. README links to runbooks/ are also covered through the same regex.
  Out of scope for the validator: HTTP URLs, anchor-only links (`#section`), links inside code fences. README-anchor verification is left to runtime markdown rendering.

- **D-11:** **Hard-fail with exit 1 on any broken reference.** Output a numbered list to stderr: `[validate-docs] FAIL: <source-file>:<line>: <broken-ref> → target not found at <expected-path>`. Matches existing validator failure format. No allowlist override — broken refs get fixed, not allowlisted.

- **D-12:** **Wired in two places:**
  1. `bun run validate` — already exists at the root and already runs `validate-docs.ts`. The 4th invariant ships in the same script, so this lights up automatically.
  2. **NEW** `.github/workflows/validate.yml` — runs on `pull_request` + `push` to `main`. Single job that runs `bun install` + `bun run validate`. Phase 18 D-16 created `release.yml` (the repo's first workflow); `validate.yml` is the second. Honors Phase 18's "broader ci.yml deferred" direction by scoping narrowly to docs validation only — no test/lint/typecheck jobs in this workflow yet.

### Alert templates (Claude-default decisions)

The user did not select the "Alert templates" gray area for explicit discussion, so these decisions are Claude's defaults. They are decisive, not flexible — downstream agents act on them.

- **D-13:** **Grafana alert YAML scope FULLY DROPPED.** Per Phase 21 deferral (2026-04-27), the milestone-roadmap deferral note ("Grafana alert YAML scope drops with it; Sentry alert templates remain in scope") is authoritative. Resolves the conflict with top-level ROADMAP §"Phase 23" success-criterion 2, which is a stale mirror. No `docs/alerts/grafana/` directory ships in this phase. Forward-looking note in `docs/alerts/sentry/README.md` acknowledges OTLP/Grafana wiring is available to forks via the v1.3-shipped observability ports — they author their own YAML when they wire it.

- **D-14:** **Sentry alert configs ship as JSON files at `docs/alerts/sentry/<alert-slug>.json`.** One file per alert. Format = Sentry's native Issue-Alert / Metric-Alert REST API JSON shape (the body operators POST to `/api/0/projects/{org}/{project}/rules/`). Operator imports via `sentry-cli alerts import` (researcher verifies this CLI command exists at planning time — fall back to "copy-paste into Sentry UI's Create Alert wizard" with one paragraph of click-through if not). Alert files mirror the runbook slug list: at minimum 9 alerts matching the 9 runbooks. Each file MUST include a `runbook_url` annotation pointing to `docs/runbooks/<matching-slug>.md` — this is what D-10's validator checks.

- **D-15:** **SLO burn-rate translates to Sentry-native vocabulary.** Sentry's alert API does not speak Prometheus burn-rate directly. Translation:
  - Short-window detection → Sentry Issue Alert with `actionMatch: "all"` and `frequency` window of 5–15 minutes.
  - `for: 5m` minimum (success-criterion 4) → Sentry's `triggers[].alertThreshold` paired with a 5-minute frequency window — fires only when the threshold has held for one full window. Equivalent semantic to Prometheus `for: 5m`.
  - Burn-rate math (e.g., "fast burn = >2% of monthly budget in 1h") gets documented as a one-line comment in each alert JSON file (`"// SLO note: this threshold corresponds to a fast-burn alert at 2% monthly budget over 1h"`) so the operator can see the math when tuning.
  - `docs/alerts/sentry/README.md` includes a 30-line explainer on how to translate Prometheus burn-rate semantics if a fork user wires their own Grafana later.

- **D-16:** **`docs/alerts/sentry/README.md` ships alongside the JSON files** (~30-line guide): how to import alerts (CLI command + UI fallback), how to update `runbook_url` paths if the operator forks docs to a different path layout, and the SLO-burn-rate translation note from D-15.

### Folded Todos

None. The single matched todo (`2026-04-26-harden-inbound-traceparent-trust-gate.md`, score 0.9) is keyword-incidental — the match came from `api` / `trace` / `config` overlapping with this phase's surface area, but the todo is about API trust-gate hardening (a security task), not documentation. Already deferred by Phase 22 (which also reviewed it and did not fold). Listed in `<deferred>` below.

### Claude's Discretion

- Exact runbook filename slugs — must match Sentry alert template slugs and `runbook_url` paths; planner picks consistent kebab-case (`db-down.md` over `database-unavailable.md`).
- Mermaid theme/aesthetics in `trace-propagation.md` — pick whatever renders well in GitHub's default Mermaid theme.
- Whether each runbook's Triage section uses ordered or unordered lists per step — pick the more scannable shape per runbook.
- Severity levels (`priority` field) on Sentry alerts — reasonable defaults: `db-down` / `auth-outage` / `redis-down` = high, `webhook-failures` / `slow-checkout` / `high-error-rate` = medium, `otel-exporter-failing` / `bull-board-inaccessible` / `queue-backing-up` = low. Researcher/planner adjust if the actual Sentry alert API uses a different field name or value enum.
- Whether `validate-docs.ts` literal Mermaid floor goes 8 → 11 or the existing logic auto-counts — planner picks based on the existing source.
- Whether the cardinality guide includes a "future Prometheus considerations" appendix — recommended yes (forward-looking note for v1.4+ when OTLP wires happen).
- File names of any helper utilities under `scripts/` (e.g., a small Sentry alert validator could be split out, or kept inline in `validate-docs.ts` per D-09).
- Whether `wait 5m` lines in runbook Triage sections include the matching alert template's frequency window inline (recommended yes, helps the operator confirm they are looking at the right alert).
- Tone and voice — second-person imperative ("Run `docker compose ps` to verify…") is canonical for solo-operator audience.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + requirements

- `.planning/REQUIREMENTS.md` §DOC — DOC-03, DOC-04 acceptance language
- `.planning/milestones/v1.3-ROADMAP.md` §"Phase 23: Runbooks, Alert Templates & Observability Docs" — full success criteria + Phase 21 deferral note (authoritative on Grafana drop)
- `.planning/ROADMAP.md` §"Phase 23: Runbooks, Alert Templates & Observability Docs" — top-level summary; superseded by milestone-roadmap on Grafana scope (D-13)

### Prior CONTEXT (decisions to honor)

- `.planning/phases/17-observability-ports-otel-bootstrap/17-CONTEXT.md` — `Tracer` / `MetricsProvider` / `ErrorTracker` ports, env-selected factory, OTEL line-1 bootstrap; `docs/observability/attributes.md` cites these ports as the shape source
- `.planning/phases/18-error-tracking-adapters/18-CONTEXT.md` — Sentry/GlitchTip via DSN swap (D-05), `scrubPii()` denylist (D-13), runbook for server-side scrubbing (D-12 — written in this phase under `docs/runbooks/auth-outage.md` and `docs/runbooks/high-error-rate.md`)
- `.planning/phases/19-context-logging-http-cqrs-tracing/19-CONTEXT.md` — `obsContext` / ALS shape, `enterWith` ban; `docs/observability/cardinality.md` cites the legitimate context fields, `trace-propagation.md` cites the ALS lifecycle
- `.planning/phases/20-bullmq-trace-propagation/20-CONTEXT.md` — `wrapQueue` / `wrapProcessorWithAls` + W3C carrier on `job.data._otel`; `trace-propagation.md` Mermaid sequence diagram is built around this surface
- `.planning/phases/20.1-close-v13-milestone-gaps/20.1-CONTEXT.md` — Drizzle migration baseline reset, `obsContext`→OTel bridge at `Bun.serve` boundary; `queue-backing-up.md` runbook may reference the OTel bridge
- `.planning/phases/22-admin-ops-tooling/22-CONTEXT.md` — bull-board mount + RBAC (D-01..04), `/health/detailed` shape (D-07), worker heartbeat keys (D-12..14), ringbuffer recent errors (D-15); the `bull-board-inaccessible.md`, `queue-backing-up.md`, and `high-error-rate.md` runbooks all reference Phase 22 surfaces directly

### Existing source patterns to extend

- `scripts/validate-docs.ts` — the phase-close validator; this phase adds a 4th invariant (D-09) and raises the Mermaid floor (D-06)
- `docs/README.md` — top-level index; add entries linking to `docs/observability/` and `docs/runbooks/` (and `docs/alerts/sentry/` if recommended-yes README ships per D-16)
- `docs/architecture.md` — existing 4-Mermaid architecture doc; `trace-propagation.md` sits at the same fidelity level
- `docs/jsdoc-style-guide.md` — Phase 13 D-01 precedent: ship a style guide alongside the volume content; `attributes.md` follows the same template-first pattern
- `docs/integrations/{better-auth,billing,bullmq,email}.md` — existing 4-Mermaid integration docs; cross-link from runbooks (e.g., `webhook-failures.md` links to `docs/integrations/billing.md`)
- `apps/api/src/lib/logger.ts` — pino setup; obs docs reference for log correlation patterns
- `packages/queue/src/wrap-queue.ts` — `wrapQueue` carrier on `job.data._otel`; `trace-propagation.md` cites the file:line (D-07)
- `packages/observability/src/lib/scrub-pii.ts` — Phase 18 scrubber denylist; `cardinality.md` links here for "values that go on logs but never on metrics"
- `packages/observability/src/lib/obs-context.ts` — `obsContext` ALS surface; `attributes.md` cites the legitimate context fields
- `packages/config/src/env.ts` — env vars referenced in runbooks (`BULL_BOARD_READ_ONLY`, `WORKER_HEARTBEAT_INTERVAL_MS`, `ERROR_TRACKER`, `SENTRY_DSN`, `GLITCHTIP_DSN`)
- `apps/api/src/routes/admin.ts:321-349` — current `/api/admin/system/health` (deprecated alias per Phase 22 D-07); some runbooks reference `/health/detailed` directly
- `apps/api/src/index.ts:100-133` — current `/health` (unauthenticated Docker probe); `db-down.md` and `redis-down.md` reference it
- `.github/workflows/release.yml` — Phase 18 D-16 first workflow; `.github/workflows/validate.yml` (D-12) is the second, follows the same shape

### External docs (planner verifies during research)

- Sentry Issue Alert / Metric Alert REST API — alert JSON shape for `docs/alerts/sentry/*.json` (D-14)
- `sentry-cli alerts` subcommand — verify the import path exists; fall back to UI-import flow if not (D-14)
- Mermaid `sequenceDiagram` + `stateDiagram-v2` syntax — for `trace-propagation.md` (D-06)
- BullMQ docs `Worker` lifecycle + `job.data` shape — referenced in `queue-backing-up.md` triage commands

### Project doctrine

- `CLAUDE.md` — Bun-only constraint applies to any tooling added by `validate-docs.ts` extension (D-09)
- `.planning/PROJECT.md` "Out of Scope" — Phase 21 (OTEL adapters + Grafana stack) deferred to v1.4+; observability ports remain ready for OTLP wiring later

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`scripts/validate-docs.ts`** — extend with a 4th invariant (D-09). Existing structure: 3 invariants share a single `for await (const relPath of docsGlob.scan(...))` loop with `failures` counter and exit-1-on-nonzero. Adding a 4th invariant is a localized change (one new check inside the loop + one new collector pass over `docs/alerts/sentry/*.json`).
- **`docs/architecture.md`** — 4 existing Mermaid `sequenceDiagram` blocks; the new `docs/observability/trace-propagation.md` follows the same fidelity and counts toward the Mermaid floor (D-06).
- **`docs/jsdoc-style-guide.md`** — Phase 13 D-01 precedent: a single canonical style guide before volume content. `docs/observability/attributes.md` is to obs annotations what `jsdoc-style-guide.md` is to JSDoc.
- **`docs/integrations/{better-auth,billing,bullmq,email}.md`** — 4 existing integration docs with `sequenceDiagram` blocks; cross-link from runbooks for deeper context.
- **Phase 22 `/health/detailed` response shape** — runbooks (`db-down.md`, `redis-down.md`, `queue-backing-up.md`) reference this endpoint as the operator's primary triage entry point.
- **Phase 18 `scrubPii()` denylist** (`packages/observability/src/lib/scrub-pii.ts`) — `cardinality.md` cross-links for the "values that may live on logs but must not live on metric labels" examples.
- **Phase 19 `obsContext` ALS** (`packages/observability/src/lib/obs-context.ts`) — `attributes.md` cites the legitimate context fields.
- **Phase 20 `wrapQueue` W3C carrier** (`packages/queue/src/wrap-queue.ts`) — `trace-propagation.md` Mermaid sequence diagram is built around this surface.
- **`bun run validate`** root script — already runs `validate-docs.ts`; the 4th invariant lights up automatically (D-12).

### Established Patterns

- **Phase-close validator with hard-fail** (Phase 15 D-01) — `validate-docs.ts` exits 1 on any invariant failure. The 4th invariant follows the same pattern (D-11). No allowlist override.
- **Two-runner test orchestration via root script** — `bun run test` runs `bun test` + `vitest run`. `bun run validate` follows the same shape — single command, multiple checks.
- **Markdown without frontmatter** — existing docs (`jsdoc-style-guide.md`, `architecture.md`, `getting-started.md`, all 4 integration docs) ship as plain markdown with no YAML frontmatter. Runbooks follow the same shape (no severity/est-resolution metadata in v1.3).
- **Cross-link style** — `[link text](./relative-file.md)` is the canonical form across existing docs. Runbooks and obs docs follow the same shape; the validator's regex (D-10) targets exactly this form.
- **Single-workflow-per-purpose GitHub Actions** — Phase 18 D-16 established the pattern (one workflow file per purpose, narrowly scoped). `.github/workflows/validate.yml` follows: only docs validation, no test/lint/typecheck (D-12).
- **Mermaid floor enforcement counts diagrams across all `.md` files under `docs/`** — `validate-docs.ts:34` regex `/^```mermaid$/gm`. Adding 2 new diagrams in `trace-propagation.md` raises the floor literal from 8 → 11 (D-06).
- **Crash-hard env validation pattern** (Phase 17 D-09 → reused in Phase 18 D-09 → reused in Phase 22 D-02) — runbooks reference this when explaining "if the API does not start, check `validateObservabilityEnv()` errors first."

### Integration Points

- **`scripts/validate-docs.ts`** — 4th invariant lands inline; D-10's two source classes (Sentry templates + cross-runbook markdown links) get one collector pass each. Mermaid floor literal updated in the same diff (8 → 11 per D-06).
- **`docs/README.md`** — append entries linking to `docs/observability/`, `docs/runbooks/`, and `docs/alerts/sentry/`.
- **`docs/observability/`** (NEW directory) — `README.md`, `attributes.md`, `cardinality.md`, `trace-propagation.md`.
- **`docs/runbooks/`** (NEW directory) — 9 mandated files matching the success-criterion 1 list. Slugs are the source of truth for `runbook_url` annotations in `docs/alerts/sentry/*.json`.
- **`docs/alerts/sentry/`** (NEW directory) — one JSON file per alert + a `README.md` explainer (D-16). Each JSON file's `runbook_url` is what D-10's validator parses.
- **`.github/workflows/validate.yml`** (NEW workflow file) — second workflow alongside Phase 18's `release.yml`. Triggers on `pull_request` + `push` to `main`. Single job: checkout + `bun install` + `bun run validate`.
- **`package.json`** root — `bun run validate` already exists per Phase 15; verify it runs `validate-docs.ts` (it does) and consider whether the new GitHub Actions workflow needs any additional script-level wiring (likely none).

</code_context>

<specifics>
## Specific Ideas

- "Solo fork-user wearing all hats" framing matches Baseworks' positioning per PROJECT.md ("personal infrastructure investment … freelance projects"). Runbook tone is second-person imperative, no jargon, no rotation/paging language.
- Docker-Compose command examples are concrete because Baseworks ships `docker-compose.yml`. The one-paragraph K8s/PaaS translation note in each runbook's Triage acknowledges other deployment shapes without ballooning the doc.
- "wait 5m before action" appears at the top of every runbook's Triage to discourage 3am thrash on deploy-blip alerts. The Sentry alert templates encode the same 5m frequency-window equivalent so the operator confirms they are looking at the right alert.
- Mermaid floor going 8 → 11 in the same commit as the new diagrams keeps the validator + content in lockstep — no half-merged state where the floor outpaces the content.
- The bull-board-inaccessible runbook deliberately does NOT include a screenshot of bull-board (D-04) — instead it walks the operator through the `requireRole("owner")` 401/403 / static-asset / CSP `frame-ancestors` failure modes from Phase 22 D-01..04 in commands.
- The OTEL exporter failing runbook references `validateObservabilityEnv()` from Phase 17 D-09 as the first triage step — the env validator is the canonical "did the operator misconfigure?" check.
- The high-error-rate runbook references the Phase 22 D-15 ringbuffer (`/health/detailed` `recentErrors` field) as the in-app first-look surface, with Sentry/GlitchTip as the cross-replica deeper-look surface.
- Forward-looking note in `docs/alerts/sentry/README.md`: when fork users wire OTLP/Grafana in v1.4+ (Phase 21 deferred work), they author Grafana YAML themselves; the observability ports are vendor-agnostic so the Sentry templates here are not throw-away.

</specifics>

<deferred>
## Deferred Ideas

- **Grafana alert YAML** — fully dropped per Phase 21 deferral. Revive in v1.4+ if a fork user requests self-hosted Grafana wiring. Observability ports remain ready (Phase 17), so a future fork can author its own YAML without touching application code.
- **Generic broken-link detection across all of `docs/`** — only `runbook_url` + cross-runbook links validated in this phase. A broader docs-quality phase in v1.4 can extend `validate-docs.ts` to cover every relative markdown link.
- **Pre-commit hook via Husky** — Husky is not in the project; adding it for a single validator is not justified. CI catches drift before merge; local-dev catches it before push via `bun run validate`.
- **Tabbed Compose+bare-metal+K8s command variants in runbooks** — Docker-Compose-assumed is the canonical shape. K8s/PaaS users translate per the one-paragraph note. Revisit in v1.4+ if multi-deployment fork users ask.
- **Liberal screenshots in runbooks** — text-only canonical. Screenshots cost more to maintain than they save, and Mermaid covers the visual needs that matter.
- **Markdown frontmatter on runbooks** (severity, est-resolution-time, related-alerts) — not adopted in v1.3. Defer to v1.4 if alert-runbook cross-referencing needs structured metadata.
- **Biome GritQL lint rule for cardinality enforcement** — defer (lint authoring is a phase-sized task). Note in `cardinality.md` that the rule is a forward-looking option once OTLP wiring lands in v1.4+.
- **Liberal code embedding in obs docs** (>20-line blocks) — file:line refs + 5-line snippets are the chosen depth (D-07). Heavier embedding ages poorly across refactors.
- **Tabular format / structured YAML + generator for `attributes.md`** — markdown table is sufficient at v1.3 attribute count. Revisit if the glossary grows past ~30 attributes.
- **Runbook test/dry-run instructions** ("here's how to simulate the failure to verify the runbook works") — useful but adds 50–100 lines per runbook. Defer to v1.4 ops-quality phase.
- **`HealthContributor` populated for auth/billing/example modules** — Phase 22 already deferred this; runbooks reference the slot but do not author module health checks.
- **Per-queue threshold overrides** — Phase 22 already deferred this; runbooks document the v1.3 single-global-threshold default.
- **Cross-replica error aggregation** — Phase 22 already deferred (ringbuffer is process-local); runbooks document the limitation.
- **README anchor verification in the validator** — only file existence is checked; anchor (`#section`) integrity is left to runtime markdown rendering. Defer to v1.4 docs-quality phase if anchor rot becomes a problem.
- **Allowlist override for intentional dangling refs** — D-11 is hard-fail-no-override. If a stub runbook for a v1.4 feature needs to land early, the path is to write the runbook stub (1 line is fine) rather than allowlisting the broken ref.

### Reviewed Todos (not folded)

- **`.planning/todos/2026-04-26-harden-inbound-traceparent-trust-gate.md`** (score 0.9, area: api) — keyword match was incidental (`config`, `api`, `trace` overlapped this phase's surface area, but the todo is about API trust-gate hardening — a security task, not documentation). Already deferred by Phase 22. Belongs in a future security-hardening phase.

</deferred>

---

*Phase: 23-runbooks-alert-templates-observability-docs*
*Context gathered: 2026-04-28*
