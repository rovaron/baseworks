---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Observability & Operations
status: executing
stopped_at: Phase 18 complete (7/7 plans; verifier passed 4/4 must-haves; EXT-01 operator gate deferred to 18-HUMAN-UAT.md)
last_updated: "2026-04-23T11:20:00Z"
last_activity: 2026-04-23 -- Phase 18 complete; ready for Phase 19
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 12
  completed_plans: 12
  percent: 29
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-21)

**Core value:** Clone, configure, and start building a multitenant SaaS in minutes -- not weeks.
**Current focus:** v1.3 Observability & Operations — Phases 17 + 18 shipped, Phase 19 (Context, Logging & HTTP/CQRS Tracing) next

## Current Position

Milestone: v1.3 Observability & Operations
Phase: 18 — Error Tracking Adapters (complete 2026-04-23; EXT-01 operator gate deferred to 18-HUMAN-UAT.md)
Plan: —
Status: Ready to discuss Phase 19
Last activity: 2026-04-23 -- Phase 18 complete (verifier: 4/4 must-haves pass; EXT-01 PARTIAL — workflow file in place, operator secrets+demangled-trace verification deferred)

Progress: [██░░░░░░░░] 29% (2/7 phases)

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

**Phase 18 Plan 04 (2026-04-23):**

- Shipped `PinoErrorTracker` at `packages/observability/src/adapters/pino/pino-error-tracker.ts` (201 lines) — the default ErrorTracker when `ERROR_TRACKER` is unset or `=pino` (ERR-03). Implements the full Phase-17 port: `captureException` (scrubPii defense-in-depth, breadcrumb serialization + buffer clear), `captureMessage` (full LogLevel mapping fatal→60/error→50/warning→40/info→30/debug→20/default→info), `addBreadcrumb` (ring buffer capped at 10, oldest-first eviction), `withScope` (closure-scoped — NO instance state, Pitfall 4 safe), `flush` (always true).
- Added `pino ^10.0.0` as an explicit `@baseworks/observability` dependency. apps/api had it transitively but Bun's workspace resolution did not expose it to the observability package's module graph.
- Fixed plan-vs-authoritative LogLevel naming mismatch (Rule 1): plan text used `"warn"` but `ports/types.ts LogLevel` uses `"warning"` (Sentry-native). Adapter's `pinoMethod` switch now uses port vocabulary and bridges to pino's `.warn` internally; also added `"fatal"` case since the port includes it. Comments in pinoMethod document the divergence.
- Pattern: closure-scoped `withScope` — setters `setUser/setTag/setExtra/setTenant` write to a local `{ tags: {}, extra: {} }` object captured by arrow functions; acceptance grep `this.(tags|user|tenantId|extra)\s*=` returns empty. Concurrent `Promise.all([withScope(), withScope()])` + a subsequent unscoped `captureException` leak-nothing is the Pitfall 4 regression guard test.
- Pattern: fake pino logger for adapter tests — `pino({ level: 'debug' }, customStream)` where `customStream.write(chunk)` parses JSON into an array for assertions. No stdout touched during tests. Generic-parameter cast `as unknown as Logger` bridges `Logger<never, boolean>` return to `Logger<string, boolean>` ctor param.
- TDD RED→GREEN gate passed: `9481f61` test → `2e8ccf0` feat. 12 new tests (31 expects); full observability suite 121/121 pass, zero regressions; tsc --noEmit clean.

**Phase 18 Plan 06 (2026-04-23):**

- Wired the Phase 18 capture pipeline into four boundary sites in `apps/api`: (1) `apps/api/src/core/middleware/error.ts` — extended the existing `errorMiddleware.onError` callback with `getErrorTracker().captureException(error, { tags: { method: request.method, code: String(code) }, extra: { path: new URL(request.url).pathname } })` BEFORE the status-mapping switch (D-03, A4 invariant preserved: `grep -c '.onError('` returns 1); (2) + (3) `apps/api/src/index.ts` + `apps/api/src/worker.ts` — added `validateObservabilityEnv()` (D-09) + `installGlobalErrorHandlers(getErrorTracker())` (D-02) immediately after `validatePaymentProviderEnv()`, and `wrapCqrsBus(registry.getCqrs(), getErrorTracker())` (D-01) immediately after `await registry.loadAll()`; (4) `apps/api/src/worker.ts` line 70 — extended the existing `worker.on('failed', ...)` handler with a one-line `getErrorTracker().captureException(err, { tags: { queue: jobDef.queue }, extra: { jobId: job?.id, jobName } })` (D-04).
- D-01 invariant preserved end-to-end: `git diff apps/api/src/core/cqrs.ts apps/api/src/core/event-bus.ts` across all Phase 18 commits produces zero lines. The CqrsBus wrap happens externally at registry boot time via `wrapCqrsBus(registry.getCqrs(), tracker)` — the same bus instance the rest of the application reads.
- A3 enforcement: `request.route` is absent from Elysia Context at onError time, so the errorMiddleware uses `request.method` (cardinality-safe: ~7 values) + `String(code)` (Elysia closed set) on tags; the concrete URL path goes to `extra` (not a metric dimension, per Pitfall 4). Phase 19 will add matched-route-template extraction via a separate middleware.
- A4 enforcement: the captureException call was added INSIDE the existing `errorMiddleware.onError(...)` callback, NOT as a separate `.onError` plugin. Single on-error site preserved byte-for-byte.
- D-04 discipline: only ONE captureException call in worker.ts — inside `worker.on('failed', ...)`. The inner try/catch at lines 58-65 (around `jobLog.error({ err: String(err) }, "Job handler error"); throw err;`) remains log-only. Adding capture there would double-report every job failure. Test 3 in `worker-failed-capture.test.ts` enforces this as a cross-file-state regression guard.
- Shipped `apps/api/src/__tests__/worker-failed-capture.test.ts` — 3 tests, 9 expects: (1) D-04 call shape with jobId/jobName extras, (2) undefined-job graceful handling, (3) cross-file-state guard that reads worker.ts source via `Bun.file` and asserts `getErrorTracker` + `captureException` absent from the inner try/catch region. Pattern: lockstep-mirror-function — the test's `onFailed()` helper replicates the worker.on('failed') body verbatim, providing a stable unit-testable surface without booting real BullMQ/Redis.
- Auto-fixed one deviation (Rule 3): initial comment in error.ts literally contained `request.route does not exist on Elysia Context`, which tripped the A3 acceptance grep. Rephrased to "the matched-route template is NOT available on Elysia's Context at onError time" — same meaning, no forbidden token. Fix folded into Task 1 commit.
- 3 commits: `b7e3afa` (Task 1 — errorMiddleware extension), `fb94746` (Task 2 — entrypoint wiring), `f044f97` (Task 3 — worker-failed-capture test). All 63 apps/api tests pass (60 prior + 3 new); telemetry-line1.test.ts gate still green (line-1 invariant T-18-40 preserved).

**Phase 18 Plan 07 (2026-04-23):**

- Shipped the repo's first GitHub Actions workflow at `.github/workflows/release.yml` (104 lines). Narrowly scoped per D-16: one job (`upload-sourcemaps`), one trigger (`push.tags: ['v*.*.*']`), zero test/lint/typecheck/deploy jobs. Builds apps/api + worker bundle + apps/admin with `bun build --sourcemap=external` (Debug ID variant — no `//# sourceMappingURL` comment, Pitfall 5 browser-leak prevention), then iterates through the three output dirs with `bun x sentry-cli sourcemaps inject` + `upload --release=$RELEASE --org=$SENTRY_ORG --project=$SENTRY_PROJECT`.
- Single-source RELEASE discipline (Pitfall 6 / D-19): `git rev-parse --short HEAD` runs exactly once at the top of the workflow; the value flows to every `bun build --define process.env.RELEASE=...` AND every `sentry-cli --release=$RELEASE` AND the runtime `Sentry.init({ release })` via env.
- apps/web INTENTIONALLY deferred from this workflow (RESEARCH Open Question 2 RESOLVED) — Next.js 15 server-side `.map` emission is not stable without `@sentry/nextjs`'s wrapper; blind `.next/` upload would silently no-op. Follow-up task tracked in CONTEXT.md Deferred Ideas. Pitfall 5 discipline (no public browser source maps) stays in force regardless.
- `.gitignore` gained `.next/` defensively — this workflow does not build apps/web but `bun run dev:web` / `build:web` locally would produce it.
- One Rule-1 auto-fix caught pre-commit: initial comment literal contained the forbidden `productionBrowserSourceMaps` token (violated `<done>` grep); rephrased to "Next.js browser-source-maps flag" — same meaning, passes grep.
- Task 2 is a `checkpoint:human-action` (not automatable): operator creates Sentry auth token with `project:releases` + `project:write` scopes, adds 3 GitHub repo secrets (SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT), pushes test tag, deploys to staging, verifies demangled stack trace for a deliberate-failure endpoint (Success Criterion #4), and asserts no public `.map` files served (Part F). Resume signal: `"approved"`.
- One commit: `b7748df` (feat/18-07 — workflow + .gitignore atomic).

**Phase 18 Plan 05 (2026-04-23):**

- Shipped `SentryErrorTracker` at `packages/observability/src/adapters/sentry/sentry-error-tracker.ts` (149 lines) — single class serving BOTH Sentry and GlitchTip targets via `kind: 'sentry' | 'glitchtip'` tag (D-05). Completes ERR-01 (Sentry capture) and ERR-02 (GlitchTip parity) by structural identity — same code path processes both backends. Port methods delegate thinly to `@sentry/bun` top-level functions; `withScope` bridges port `ErrorTrackerScope` → Sentry `Scope` one-to-one; `setTenant` maps to `setTag('tenantId', value)`.
- Shipped `buildInitOptions` pure helper at `packages/observability/src/adapters/sentry/init-options.ts` codifying A1 Option C: `defaultIntegrations: false` + `sendDefaultPii: false` (hard-coded literal, no env path per T-18-29) + `beforeSend`/`beforeBreadcrumb` both running `scrubPii` (defense-in-depth per D-12) + a curated 4-integration safe list (`inboundFilters`, `dedupe`, `linkedErrors`, `functionToString`). Cuts every default that would auto-capture request bodies (T-18-26) or double-register global handlers (T-18-27).
- Shipped cross-adapter PII conformance test at `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` — 39 tests (13 PII_FIXTURES × 3 adapters: pino, sentry via makeTestTransport, noop). Every `shouldNotAppear` substring is asserted absent AND every `shouldSurvive` substring is asserted present in the emitted output per adapter. This is the ERR-04 gate.
- Extended `getErrorTracker()` switch in `packages/observability/src/factory.ts` with 3 new cases (pino / sentry / glitchtip), widened default from `'noop'` to `'pino'` per D-06. Factory throws with DSN env var name when selected adapter's DSN is missing (D-09 crash-hard). Invariant preserved: no `@baseworks/config` import; `process.env` read directly; pino ESM-imported at top-of-file per CLAUDE.md (no `require`).
- Fixed latent adapter bug (Rule 1): `SentryErrorTracker.captureException(err, scope)` was passing port `CaptureScope` directly to `Sentry.captureException` as `CaptureContext`, but Sentry's `CaptureContext` has no `tenantId` field — every production error with a tenantId was silently dropping that dimension. Fix: destructure `tenantId` from CaptureScope, merge into tags map (mirrors `withScope`'s `setTenant → setTag('tenantId', value ?? '')`). Surfaced by `tenantId-positive-case` conformance fixture.
- Pattern: `afterEach(async () => { await Sentry.close(100); })` is MANDATORY for every describe that constructs SentryErrorTracker. The Sentry hub is a process-global side effect; 12 init calls in the unit test + 13 in the conformance test would accumulate integrations/transport state without close() (T-18-32 mitigation).
- Pattern: DSN `http://public@example.com/1` in every test — RFC 2606 reserved domain, guaranteed non-routable. `grep "sentry.io|glitchtip.io" packages/observability/src/adapters/sentry/__tests__/` returns nothing (T-18-30).
- Pattern: `Transport` type imported from `@sentry/core`, not `@sentry/bun` — `@sentry/bun` does not re-export the type. `@sentry/core` has been an explicit dep since Plan 01.
- TDD RED→GREEN gates: Task 1 `a5f993f` test → `2d7e115` feat; Task 2 `ef1437d` combined (conformance test + adapter fix land together — GREEN requires both); Task 3 `19a0d90` test → `dee7667` feat.
- 59 new tests (12 unit + 39 conformance + 8 factory); full observability suite 180/180 pass (303 expects); tsc --noEmit clean.

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

Last session: 2026-04-23T10:10:00Z
Stopped at: Phase 18 Plan 07 file-authoring complete (CHECKPOINT:human-action pending operator — three GitHub repo secrets + test tag push + demangled-stack-trace verification for Success Criterion #4).
Next action: Operator performs Task 2 Parts A–G (see `.planning/phases/18-error-tracking-adapters/18-07-SUMMARY.md` §Required User Setup). Resume signal on completion: `"approved"`. Once the checkpoint resolves, Phase 18 closes (ERR-01..04, EXT-01 all satisfied) and Phase 19 (Context, Logging & HTTP/CQRS Tracing — CTX-01..03, TRC-01..02) becomes the next phase target.
