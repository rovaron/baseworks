---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Observability & Operations
status: milestone_complete
stopped_at: "Completed 23-05-PLAN.md (Phase 23 complete; v1.3 ready for /gsd:verify-work)"
last_updated: "2026-04-28T21:03:18.032Z"
last_activity: 2026-04-28
progress:
  total_phases: 2
  completed_phases: 3
  total_plans: 11
  completed_plans: 11
  percent: 150
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-21)

**Core value:** Clone, configure, and start building a multitenant SaaS in minutes -- not weeks.
**Current focus:** Phase 23 — runbooks-alert-templates-observability-docs

## Current Position

Milestone: v1.3 Observability & Operations
Phase: 23
Plan: Not started
Status: Milestone complete
Last activity: 2026-04-28

Progress: [██████████] 100%

### Roadmap Evolution

- **2026-04-26** — Phase 20.1 inserted after Phase 20: Close v1.3 milestone gaps from observability UAT (URGENT). Bundles 3 todos: drizzle migration journal repair, billing `getSubscriptionStatus` TypeError fix, and obsContext.traceId ↔ OTel server-span trace_id bridge. All three surfaced during live v1.3 milestone UAT against a real Sentry DSN + authenticated session + BullMQ producer/consumer round-trip on 2026-04-26.

## Performance Metrics

**Velocity:**

- Total plans completed: 83 (15 v1.0 + 24 v1.1 + 19 v1.2 + 13 quick tasks across the last three milestones)
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
- [Phase ?]: Phase 20.1 Plan 01: drizzle.config.ts paths normalized so bun run db:migrate works from any cwd (auto-fix Rule 1)
- [Phase ?]: Phase 20.1 Plan 01: D-02 reset step home = docs/getting-started.md (canonical onboarding doc; neither apps/api/README.md nor repo-root README.md exists)
- [Phase ?]: Phase 20.1 Plan 01: migration history reset to single 0000_red_lester.sql baseline; 0001_rename_stripe_to_provider.sql deleted per D-04 (starter-kit fork model — historical rename SQL intentionally lost)
- [Phase ?]: 20.1-02: D-07 hypothesis EXCLUDED by D-05 probe. Actual root cause: 7 ctx.db handlers misused scopedDb.select(). User-authorized Option A applied across all 7.
- [Phase ?]: 20.1-02: API regression tests for tenant-scoped CQRS handlers must use real scopedDb(realDb, tenantId), not a mock. Bug lived at handler-scopedDb boundary; unit-test mocks hid it.
- [Phase 20.1 Plan 03]: D-11 synthetic OTel SpanContext at Bun.serve fetch boundary; obsContext.traceId now flows into OTel ambient context so producer-side log, consumer-side log, and BullMQ carrier traceparent all share a single traceId end-to-end. SC#3 closed at the production-code level.
- [Phase 20.1 Plan 03]: D-12 CIDR-based traceparent trust gate dropped (OBS_TRUST_TRACEPARENT_FROM/HEADER env vars + ipaddr.js trust logic deleted from packages/config + apps/api). v1.3 adopts OTel always-trust default; production trust hardening deferred per CONTEXT.md.
- [Phase 20.1 Plan 03]: inboundCarrier?: field on ObservabilityContext left in place per CONTEXT.md `<deferred>` (Claude's Discretion default). The Bun.serve seed no longer populates it; type-side removal is a future cleanup.
- [Phase 20.1 Plan 03]: Pattern — atomic signature trim. Function signature change + every call-site update + env-var schema removal + dependent test updates land in ONE commit so tsc stays green at every boundary. Used to remove `decideInboundTrace`'s `remoteAddr` arg + `inboundCarrier` return field across 8 files in a single `e16843d` refactor commit.
- [Phase 20.1 Plan 03]: Pattern — context.with(otelCtx, () => obsContext.run(seed, fn)). OTel ambient context wraps the ALS seed at the Bun.serve fetch boundary; downstream tracer.startSpan and propagation.inject naturally inherit the request's traceId without adapter-specific wiring. Works whether the Tracer port is Noop or wired to a real OTel SDK exporter.
- [Phase ?]: [Phase 20.1 Plan 04]: H-01 closed — locale-cookie decodeURIComponent wrapped in try/catch (D-16); malformed NEXT_LOCALE cookies fall through to defaultLocale instead of throwing URIError before obsContext.run opens.
- [Phase ?]: [Phase 20.1 Plan 04]: H-02 closed — new readRequestId helper validates inbound x-request-id against ^[A-Za-z0-9_-]{1,128}$ (D-17); invalid values fall through to crypto.randomUUID(). Defends log-injection / correlation-poisoning / cardinality.
- [Phase ?]: [Phase 20.1 Plan 04]: H-03 closed — try/catch around app.handle in Bun.serve fetch wrapper now invokes recordException + setStatus(ERROR) on the active OTel span (D-18); Phase 19 ACCEPTED DEVIATION resolved via Option A from 19-REVIEW.md.
- [Phase ?]: [Phase 20.1 Plan 04]: Pattern — duck-typed Request stand-in for tests. When Bun's strict Headers constructor rejects an attack vector (newline in header value), expose the helper through a structural type { headers: { get(name): string | null } } so tests can drive vectors the upstream gate already rejects.
- [Phase ?]: Phase 23 Plan 02: Honored RESEARCH Finding 2 corrected file:line paths in every citation across the 4 docs/observability/ files; CONTEXT.md WRONG paths appear zero times.
- [Phase ?]: Phase 23 Plan 02: Mermaid floor literal raised 8 to 11 in scripts/validate-docs.ts atomically with the 3 new diagrams (Research Finding 5).
- [Phase ?]: Phase 23 Plan 02: docs/observability/ subdirectory established (README + attributes + cardinality + trace-propagation); observability-docs-present.test.ts goes 1/5 to 5/5 GREEN.
- [Phase ?]: Phase 23 Plan 03: shipped 9 incident runbooks under docs/runbooks/ following locked Trigger -> Symptoms -> Triage -> Resolution -> Escalation template (D-03); all 27 Wave-0 runbook tests now GREEN
- [Phase 23]: Phase 23 Plan 04: shipped 9 Sentry alert JSON templates + README under docs/alerts/sentry/; alert-files-present.test.ts 10/10 GREEN; runbook_url cross-link integrity verified by bun run validate Pass B
- [Phase 23]: Phase 23 Plan 05: docs/README.md ## Operations section indexes 4 obs concept docs + 9 runbooks + 9 Sentry alert templates; validate.yml CI gate operator-attested smoke-proven (RED on broken runbook_url, GREEN on revert); v1.3 milestone reaches 11/11 plans complete (Phase 21 deferred).

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
| Phase 20.1 P01 | 25min | 4 tasks | 6 files |
| Phase 20.1 P02 | 50min | 3 tasks | 9 files |
| Phase 20.1 P03 | 11min | 3 tasks | 8 files |
| Phase 20.1 P04 | 8min | 5 tasks | 11 files |
| Phase 23 P02 | 12min | 3 tasks | 5 files |
| Phase 23 P03 | ~7min | 2 tasks | 9 files |
| Phase 23 P04 | 3min | 3 tasks | 10 files |
| Phase 23 P05 | 10min | 2 tasks | 1 files |

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

Last session: 2026-04-28T21:02:38.584Z
Stopped at: Completed 23-05-PLAN.md (Phase 23 complete; v1.3 ready for /gsd:verify-work)
Resume file: None
Next action: `/gsd:verify-work` against Phase 23 (runbooks + alerts + observability docs). All 5 plans shipped; smoke-test operator-confirmed (RED + GREEN both observed); REQUIREMENTS.md DOC-03 + DOC-04 marked Complete; ROADMAP.md shows 5/5 plans Complete; v1.3 milestone reaches 11/11 plans complete. Phase 21 explicitly deferred to v1.4+.

**Phase 22 deliverables verified live (2026-04-27, 14/14 checks):**

- bull-board mounted at /admin/bull-board with requireRole("owner") + CSP frame-ancestors header + readOnly env feature flag (401 for unauth on HTML, JSON API, AND static assets)
- /health/detailed endpoint behind requireRole("owner"); deprecated /api/admin/system/health alias preserved (401 unauth)
- Worker heartbeat publishes worker:heartbeat:{instanceId} JSON to Redis with TTL=2*interval and 4 queues enumerated (example-process-followup, billing-process-webhook, billing-sync-usage, email-send); key DEL'd on graceful shutdown
- Two production defects surfaced and fixed in commit b0dbe1d: (a) apps/api missing bullmq direct dep, (b) bull-board.ts hardcoded uiBasePath broke under Bun isolated install — replaced with Bun.resolveSync('@bull-board/ui/package.json', import.meta.dir) + dirname

**Phase 22 manual UAT items still open (per VALIDATION.md Manual-Only):**

1. Browser CSP frame-ancestors enforcement (foreign-origin iframe → console violation)
2. Iframe session cookie sharing via vite proxy (admin → /jobs renders bull-board without second login)
3. Worker heartbeat `dead` status after SIGKILL + 80s wait
4. pt-BR locale visual review (sidebar shows "Monitor de Jobs", system page renders correctly)

**Deferral context recorded 2026-04-27:** Phase 21 (OTEL Adapters + Grafana stack) moved to v1.4+. MET-01..03 + DOC-01..02 are now in the deferred list of `.planning/milestones/v1.3-ROADMAP.md`. Rationale: Sentry SaaS already serves the operator audience for hosted forks; the observability ports shipped in Phase 17 are vendor-agnostic, so a future fork can wire OTLP without code edits. Phase 22 `Depends on` shrunk from {20, 21} → {20}; Phase 23 from {21, 22} → {22}. Grafana alert YAML scope drops from Phase 23; Sentry alert templates remain in scope.

**Open threads from Phase 19 (advisory — not gap-closure blockers):**

- **19-REVIEW.md** — 0C/3H/6M/7L findings. Top three high-severity:
  1. **H-01** `apps/api/src/lib/locale-cookie.ts:25` — `decodeURIComponent` on a malformed cookie throws BEFORE `obsContext.run` opens, losing request context. Wrap with try/catch.
  2. **H-02** `apps/api/src/index.ts:172` — inbound `x-request-id` header trusted unvalidated (log-injection / correlation-poisoning surface). Add length+charset check.
  3. **H-03** Composed-stack error-span gap (also flagged by verifier as ACCEPTED DEVIATION) — Elysia 1.4 onError chain halts after errorMiddleware returns, so `observabilityMiddleware.onError` never fires on 5xx paths. Span still opens/ends and captures status, but `recordException`/`setStatus('error')` are lost. Reviewer recommends Option A: add try/catch in the Bun.serve fetch wrapper (same file owns ALS seed). Consider a small decimal phase (e.g., 19.1) or fold into Phase 20 discuss.
  Run `/gsd:code-review-fix 19` to auto-fix low/medium findings.

- **Phase 19 perf-gate relaxation** — Plan D-28 budgeted ≤5% p99 regression vs noop; 19-08 raised threshold to 3.0× ratio because µs-scale mixin overhead is comparable to the noop baseline. Currently stable at 2.15–2.33×. Worth revisiting with a macro benchmark at Phase 21 or later.

- **deferred-items.md** — `packages/queue/tsconfig.json` rootDir vs cross-package source imports edge case under direct `tsc -p`; root `bunx tsc --noEmit` remains clean. Not urgent.

**Earlier threads (still open):**

- Phase 18 Plan 07 operator gate — `18-HUMAN-UAT.md` tracks deferred Sentry release workflow secrets + test tag push + demangled-stack-trace verification. Resume signal: `"approved"` once operator completes.

- Phase 19 human verification (deferred to Phase 21 UAT per `19-VALIDATION.md`):
  1. Real-gateway TCP-peer CIDR-trusted traceparent adoption
  2. Tempo trace assembly
