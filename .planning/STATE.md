---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: File Storage & Uploads
status: planned
stopped_at: "v1.4 roadmap created; awaiting /gsd:plan-phase 24"
last_updated: "2026-05-05T12:00:00.000Z"
last_activity: 2026-05-05
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-05)

**Core value:** Clone, configure, and start building a multitenant SaaS in minutes -- not weeks.
**Current focus:** v1.4 File Storage & Uploads — roadmap created, ready to plan Phase 24

## Current Position

Milestone: v1.4 File Storage & Uploads
Phase: 24 — Foundation: Storage Port + Files Schema + ModuleDefinition Extension
Plan: —
Status: Roadmap created — ready for /gsd:plan-phase 24
Last activity: 2026-05-05 — v1.4 roadmap created (8 phases, 25 requirements mapped, 0 orphans)

Progress: [░░░░░░░░░░] 0% (0/8 phases)

### Roadmap Evolution

- **2026-05-05** — v1.4 milestone roadmap created. 8 phases (24–31) derived from 25 requirements across 9 categories (FILE/UPL/IMG/QUO/MOD/IDA/ATT/UI/OPS). All 25 requirements mapped to exactly one phase, no orphans. Highest-risk phase is Phase 28 (Image Transform Pipeline) — sharp under Bun in Docker is the one MEDIUM-confidence stack item; the phase begins with a research spike (S-1) on the target Docker base image, with `imagescript` wired as the failover. One variance from research §7 proposal: FILE-02 moved from Phase 24 to Phase 25 (the conformance suite is the deliverable that proves the port, and it runs in Phase 25 against real adapters).
- **2026-04-26** — Phase 20.1 inserted after Phase 20: Close v1.3 milestone gaps from observability UAT (URGENT). Bundles 3 todos: drizzle migration journal repair, billing `getSubscriptionStatus` TypeError fix, and obsContext.traceId ↔ OTel server-span trace_id bridge. All three surfaced during live v1.3 milestone UAT against a real Sentry DSN + authenticated session + BullMQ producer/consumer round-trip on 2026-04-26.

## Performance Metrics

**Velocity:**

- Total plans completed: 121 (15 v1.0 + 24 v1.1 + 19 v1.2 + 38 v1.3 + 25 quick tasks/decimal-phase work)
- Timeline: v1.0 shipped in 3 days, v1.1 in 6 days, v1.2 in 6 days, v1.3 in 13 days

**Previous milestone (v1.3):**

- 38 plans, 7 phases (17-23, with 21 deferred and 20.1 inserted), 13 days
- 239 commits, 21/28 requirements satisfied (5 deferred to v1.4 — Phase 21; 2 with operator UAT carryover — EXT-01, OPS-02)

**v1.4 estimate:** 8 phases planned. Based on 5-plan-per-phase median across v1.0–v1.3, expect ~30–45 plans across the milestone. Phase 28 (image transforms with sharp/Bun spike) carries the highest single-phase risk and may surface a decimal phase if the S-1 spike forces architectural pivots.

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (last updated at v1.3 close with entries covering observability ports, OTEL bootstrap discipline, scrubPii defense-in-depth, single SentryErrorTracker class via `kind`, AsyncLocalStorage<ObservabilityContext>, external CqrsBus/EventBus wrappers, synthetic OTel SpanContext seed at Bun.serve fetch boundary, traceparent always-trust default with hardening deferred, runbooks-as-templates operator surface, and HealthContributor worst-of-N rollup pattern).

**v1.4 Roadmap Decision (2026-05-05):**

- **FILE-02 mapped to Phase 25, not Phase 24** — research §7 proposed FILE-02 in Phase 24 as "port skeleton". Goal-backward analysis: the requirement says "conformance test suite proves all 3 adapters behave identically." That proof happens in Phase 25 against real adapters; Phase 24 only ships Noop scaffolds. Mapping a requirement to the phase where it is *proven* (not where its scaffolding starts) keeps success criteria honest.

### Pending Todos

None at roadmap-creation time. Will accumulate as plans execute.

### Blockers/Concerns

None blocking. Research flags surfaced for v1.4 implementation:

- **Phase 28 (HIGHEST-risk)** — Sharp under Bun + Docker is MEDIUM-confidence. Spike S-1 (smoke test on `oven/bun:1-debian-slim` x64 + arm64) is the phase-entry gate; if RED, pivot to `imagescript` as default. The phase MUST NOT proceed with sharp as default until the spike passes.
- **Phase 25** — Spike S-2 (POST policy enforcement matrix per S3-compat backend) is non-blocking; PUT covers all v1.4 needs and POST is deferred. Spike runs to document the matrix for future POST opt-in.
- **Phase 25** — Spike S-3 (`aws-sdk-client-mock` Bun compatibility) is non-blocking; MinIO-in-CI is the primary harness so any mock-library quirk has a fallback.

Prior concerns (v1.3 carryovers, not v1.4 scope — see Deferred Items below).

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260420-a4t | Route packages/ui tests through vitest (eliminated 22 `document is not defined` failures from `bun test`) | 2026-04-20 | 1a00bfc | [260420-a4t-route-packages-ui-src-test-tsx-through-v](./quick/260420-a4t-route-packages-ui-src-test-tsx-through-v/) |

## Deferred Items

Items acknowledged and deferred at v1.3 milestone close on 2026-05-05. All are operator-gated (require production deploy or deferred Phase 21 stack), not implementation gaps. Survive into v1.4 for resolution when production deploy + observability stack are stood up.

| Category | Item | Status |
|----------|------|--------|
| uat_gap | Phase 18 — 18-HUMAN-UAT.md | partial (4 skipped pending prod deploy) |
| uat_gap | Phase 20 — 20-HUMAN-UAT.md | partial (1 blocked on Phase 21 — deferred to v1.4+) |
| uat_gap | Phase 20.1 — 20.1-HUMAN-UAT.md | passed (audit flagged status field non-canonical) |
| verification_gap | Phase 18 — 18-VERIFICATION.md | human_needed (operator gate: Sentry release workflow secrets + test tag) |
| verification_gap | Phase 20 — 20-VERIFICATION.md | human_needed (Tempo backend — Phase 21 deferred) |
| verification_gap | Phase 20.1 — 20.1-VERIFICATION.md | human_needed |
| verification_gap | Phase 22 — 22-VERIFICATION.md | human_needed (4 manual UAT items: CSP iframe, cookie share, worker dead-status, pt-BR locale) |
| todo | 2026-04-26-harden-inbound-traceparent-trust-gate.md | api — pending |

## Session Continuity

Last session: 2026-05-05T12:00:00.000Z
Stopped at: v1.4 roadmap created. ROADMAP.md, REQUIREMENTS.md (traceability populated), STATE.md updated.
Resume file: None
Next action: `/gsd:plan-phase 24` — Foundation: Storage Port + Files Schema + ModuleDefinition Extension. 2 requirements (FILE-01, MOD-01); 5 success criteria covering schema migration, port type surface, factory env-validation crash, `fileRelations` registry collection, and Biome GritQL ban on direct `files` table access.
