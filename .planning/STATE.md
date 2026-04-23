---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Observability & Operations
status: executing
stopped_at: Phase 18 plan 03 complete
last_updated: "2026-04-23T09:11:40.000Z"
last_activity: 2026-04-23 -- Phase 18 Plan 03 (error capture utilities) complete
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 12
  completed_plans: 8
  percent: 67
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-21)

**Core value:** Clone, configure, and start building a multitenant SaaS in minutes -- not weeks.
**Current focus:** v1.3 Observability & Operations — Phase 17 shipped, Phase 18 (Error Tracking Adapters) next

## Current Position

Milestone: v1.3 Observability & Operations
Phase: 18 — Error Tracking Adapters (executing)
Plan: 18-03 (error capture utilities: installGlobalErrorHandlers + wrapCqrsBus + makeTestTransport) — complete
Status: Wave 1 complete (Plans 01, 02, 03 done). Wave 2 next — Plans 04 (pino adapter), 05 (sentry adapter), 07 (conformance + docs) unblocked
Last activity: 2026-04-23 -- Phase 18 Plan 03 complete

Progress: [███░░░░░░░] 33% (1/7 phases, 3/7 plans in Phase 18)

## Performance Metrics

**Velocity:**

- Total plans completed: 71 (15 v1.0 + 24 v1.1 + 19 v1.2 + 13 quick tasks across the last three milestones)
- Timeline: v1.0 shipped in 3 days, v1.1 shipped in 6 days, v1.2 shipped in 6 days

**Previous milestone (v1.2):**

- 19 plans, 4 phases (13-16), 6 days
- 115 commits, 23/23 requirements validated
- +5,908 / −312 lines across 114 files
- Milestone-close work: 1 quick task + 2 debug sessions resolved before tagging

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (updated at v1.2 close with 7 new entries covering JSDoc style, two-runner test orchestration, lazy handler deps for mock.module, Elysia mount guard, validate-docs.ts contract, and Phase 16 docs-first content-drift strategy).

**Phase 18 Plan 01 (2026-04-23):**
- Added `@sentry/core ^10.49.0` as explicit observability dependency to resolve A2 concern — `createTransport` was not reachable as transitive-only of `@sentry/bun`. Still zero direct `@sentry/node` references per CLAUDE.md Bun-only constraint.
- Widened `ERROR_TRACKER` default from `'noop'` to `'pino'` per CONTEXT D-06 (pino-sink adapter becomes the default for meaningful local-dev error visibility without Sentry keys).

**Phase 18 Plan 02 (2026-04-23):**
- Shipped pure `scrubPii(event)` function at `packages/observability/src/lib/scrub-pii.ts` — 17-key denylist (case-insensitive, recursive), 5 regex patterns (email, CPF, CNPJ, Stripe sk_, Bearer), webhook-route rule dropping `request.data` on `/api/webhooks/**`, `OBS_PII_DENY_EXTRA_KEYS` additive env extension.
- 13 PII conformance fixtures at `packages/observability/src/adapters/__tests__/pii-fixtures.ts` ready for Plan 18-05 conformance test.
- Pattern: module-init `DENY_SET` IIFE reads env once; tests use dynamic `await import("../scrub-pii?t=" + Date.now())` after `mock.module("@baseworks/config", ...)` to force fresh module evaluation (cache-bust query string is critical — without it, the pre-evaluated DENY_SET would not pick up the mocked env).
- Auto-fixed two fixture spec bugs (Rule 1): `stripe-webhook-body-in-extra` dropped `"4242"` from shouldNotAppear (card_last4 is not a deny key nor regex match); `better-auth-session-nested-deep` moved `"u-1"` to shouldNotAppear (D-13's recursive-deny wipes the entire `session` subtree wholesale).

**Phase 18 Plan 03 (2026-04-23):**
- Shipped `installGlobalErrorHandlers(tracker)` at `packages/observability/src/lib/install-global-error-handlers.ts` — WeakSet idempotence guard, 2000ms bounded flush, inner try/catch guarantees `process.exit(1)` even when tracker throws. Exports added to barrel alongside Plan 01/02 exports.
- Shipped `wrapCqrsBus(bus, tracker)` at `packages/observability/src/wrappers/wrap-cqrs-bus.ts` — external wrapper (zero edits to `apps/api/src/core/cqrs.ts`, D-01 invariant preserved). A5 invariant: Result.err returns pass through untouched; only thrown exceptions trigger captureException. Rethrow via bare `throw err` preserves identity (`caught === original`).
- Shipped `makeTestTransport()` at `packages/observability/src/adapters/sentry/__tests__/test-transport.ts` — uses `createTransport` from `@sentry/core` (A2 resolution; no pre-built mock-transport export exists in the Bun Sentry SDK). NOT exported from barrel (T-18-13 threat mitigation — test-only code).
- Pattern: subprocess crash tests need `setInterval(() => {}, 1_000)` keep-alive in the fixture — Bun default unhandledRejection is non-fatal, event loop drains before async handler's `process.exit(1)` fires. Also: `Bun.fileURLToPath(new URL(...))` is required on Windows because `.pathname` returns `/C:/...` which Bun.spawn rejects as module not found.
- TDD RED→GREEN gates both passed: Task 1 (`473c60b` test → `7427580` feat), Task 2 (`53dfd81` test → `80a0fd5` feat).

### v1.3 Roadmap Summary

7 phases derived from 28 requirements across 8 categories (OBS/ERR/CTX/TRC/MET/OPS/DOC/EXT):

| Phase | Name | Requirements | Count |
|-------|------|--------------|-------|
| 17 | Observability Ports & OTEL Bootstrap | OBS-01..04 | 4 |
| 18 | Error Tracking Adapters | ERR-01..04, EXT-01 | 5 |
| 19 | Context, Logging & HTTP/CQRS Tracing | CTX-01..03, TRC-01..02 | 5 |
| 20 | BullMQ Trace Propagation | CTX-04, TRC-03 | 2 |
| 21 | OTEL Adapters + Grafana Observability Stack | MET-01..03, DOC-01..02 | 5 |
| 22 | Admin Ops Tooling | OPS-01..04, EXT-02 | 5 |
| 23 | Runbooks, Alert Templates & Observability Docs | DOC-03..04 | 2 |

**Coverage:** 28/28 v1.3 requirements mapped to exactly one phase (no orphans, no duplicates).

**Deferred (not v1.3 scope):** TRC-future-01 (postgres.js DB spans), MET-future-01 (Prometheus scrape endpoint), MET-future-02 (histogram exemplars), ALT-future-01 (in-app alert router).

### Pending Todos

None.

### Blockers/Concerns

None open at milestone close. Research flags surfaced for v1.3 implementation (informational — not blockers):

- **Phase 17** — smoke-test `@appsignal/opentelemetry-instrumentation-bullmq` under Bun 1.1+; verify postgres.js OTEL instrumentation status (TRC-future-01 gate)
- **Phase 21** — verify Grafana 12.4 provisioning JSON schema before building the 4 dashboards

Prior concerns resolved:

- Admin login role check bug (workaround via `getFullOrganization()`) — still valid as documented workaround
- Biome JSDoc formatting on multi-line `@example` blocks — empirically validated across Phase 13
- PGlite + Drizzle schema push in tests — validated across Phase 14

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260420-a4t | Route packages/ui tests through vitest (eliminated 22 `document is not defined` failures from `bun test`) | 2026-04-20 | 1a00bfc | [260420-a4t-route-packages-ui-src-test-tsx-through-v](./quick/260420-a4t-route-packages-ui-src-test-tsx-through-v/) |

## Session Continuity

Last session: 2026-04-23T09:11:40.000Z
Stopped at: Phase 18 Plan 03 complete (error capture utilities)
Next action: Wave 1 complete. Execute Phase 18 Wave 2 — Plan 04 (pino-sink adapter), Plan 05 (Sentry adapter + conformance test), Plan 07 (docs). Plan 06 (apps/api wire-up) depends on Plans 03 and 04; runs in Wave 3.
