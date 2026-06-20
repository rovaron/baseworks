# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-04-08
**Phases:** 5 | **Plans:** 15 | **Tasks:** 41

### What Was Built
- Config-driven module registry with CQRS command/query dispatch and in-process event bus
- Tenant-scoped database wrapper with automatic filtering, better-auth with OAuth/magic links/RBAC
- Stripe billing (subscriptions, one-time, usage-based) with webhook idempotency and BullMQ job processing
- Next.js customer app with auth/billing/tenant-switching and Vite admin dashboard with management panels
- Shared UI package (18 shadcn components, Tailwind 4) and Eden Treaty type-safe API client
- Docker multi-stage builds, Docker Compose orchestration, Vercel config, health checks, pino logging

### What Worked
- Foundation-first phase ordering (registry -> auth -> billing -> frontend -> production) validated well — each phase built cleanly on the previous
- Medusa-style module architecture scaled from example module through auth, billing without refactoring the registry
- Eden Treaty end-to-end type safety eliminated manual type definitions across both frontend apps
- better-auth organization plugin reuse for tenancy avoided duplicating user/org/role schemas
- Static import map for module loading (vs dynamic imports) was the right call for Bun compatibility
- 3-day timeline from project init to shipped v1.0 across 116 commits

### What Was Inefficient
- Requirements checkboxes for phases 3-5 were never updated during execution (bookkeeping gap)
- ROADMAP.md progress table showed Phase 5 as "0/2 Not started" despite both plans being complete
- Some STATE.md fields drifted from actual state (e.g., progress bar showed 67% when actually 100%)
- No milestone audit was run before completion — all verification was retroactive

### Patterns Established
- Module definition contract: routes, commands, queries, jobs, events in a standard ModuleDefinition
- handlerCtx injected via Elysia derive chain (not .state()) for route handlers
- Auth routes mounted before tenant middleware via registry.getAuthRoutes() separation
- Session-derived tenant context (not header-based) for security
- Webhook idempotency via dedup table pattern
- Request ID propagation from API through BullMQ jobs for log correlation

### Key Lessons
1. Keep REQUIREMENTS.md checkboxes in sync during phase execution — don't rely on SUMMARY.md alone
2. STATE.md needs automated updates or it drifts — the manual update model doesn't scale
3. Run `/gsd-audit-milestone` before `/gsd-complete-milestone` — retroactive verification is harder
4. better-auth's organization plugin is powerful but sparsely documented — expect to read source code
5. Elysia type chain requires careful sub-app splitting from day one to avoid inference degradation

### Cost Observations
- Model mix: primarily opus for execution, sonnet for research/planning
- Sessions: ~10-12 sessions across 3 days
- Notable: Parallel agent execution (worktrees) significantly accelerated frontend phase

---

## Milestone: v1.2 — Documentation & Quality

**Shipped:** 2026-04-21
**Phases:** 4 (13-16) | **Plans:** 19

### What Was Built
- Comprehensive JSDoc annotations across every exported symbol in packages/shared, packages/db, auth, billing, example module, and core infrastructure — anchored by a canonical style guide at `docs/jsdoc-style-guide.md`
- Unit test coverage for every CQRS handler: 8 auth commands + 6 auth queries + 6 billing commands + 2 billing queries, plus Stripe adapter conformance at parity with Pagar.me and scoped-db edge cases (cross-tenant prevention, empty tenant)
- Canonical `createMockContext` helper unifying test convention across auth handlers (Phase 14 + Phase 16 migration)
- 11 in-repo documentation pages: Getting Started, Architecture Overview (4 Mermaid diagrams), Add-a-Module tutorial, Configuration + Testing guides, integration docs for better-auth, Stripe/Pagar.me, BullMQ, Resend/React Email
- Example module extended (D-05) to demonstrate event emission + BullMQ job handler + Wave 0 tests — the "how to build a module" reference
- `scripts/validate-docs.ts` phase-close validator enforcing forbidden-import, secret-shape, and Mermaid floor invariants
- Two-runner test orchestration — `bun test` (non-DOM) chained to `vitest run` (jsdom) via root `bun run test`

### What Worked
- JSDoc style guide locked in Phase 13-01 before volume annotation — prevented divergent dialects across modules
- Writing the milestone audit BEFORE closing surfaced 6 content-drift gaps in time for a dedicated Phase 16 rather than carrying debt into v1.3
- Choosing docs-first over code-first for content-drift fixes (Phase 16 Option A: revise docs to match live `event-bus-hook` path rather than retrofit `ctx.enqueue`) kept blast radius small
- Debug-session pattern from prior milestones scaled cleanly to the three test-infrastructure bugs surfaced during close — each fix was small, atomic, and well-documented

### What Was Inefficient
- v1.1 milestone section was never added to this retrospective — pattern should be enforced at each close
- Three test-infrastructure bugs (Elysia mount, get-profile pollution, UI runner wiring) all surfaced during milestone close rather than during the phases that introduced them — suggests the phase verification gates should exercise the full `bun test` suite, not just phase-specific tests
- `260420-a4t-PLAN.md` naming convention diverged from what `gsd-tools audit-open` expects (plain `PLAN.md` / `SUMMARY.md`) — forced a rename during close
- Executor leaked file changes from its worktree into main via `node -e fs.writeFileSync` deviation (workaround for a Read-tool cache mismatch with CRLF files) — had to hand-resolve the dirty worktree before merge

### Patterns Established
- JSDoc tag ordering: description, `@param`, `@returns`, `@throws`, `@example`, `@see`, `Per X-YY` citations
- `@warning` tag for security-critical constraints (e.g. bypassing tenant scoping)
- Lazy handler deps via `await import(...)` for any CQRS handler that sits on a module-level singleton — protects against `mock.module()` registering after first import
- Guard eager `.mount()` / side-effect bindings with `typeof x?.method === "function"` to tolerate partial test mocks
- Two-runner test chain: `bun test <non-ui-dirs> && (cd packages/ui && bun run test)` — one command, two environments
- Milestone audit is a gate, not a postscript — run `/gsd:audit-milestone` before `/gsd:complete-milestone`

### Key Lessons
1. **Bun's `mock.module()` is late-bound — handlers that capture deps at module-load time are immune to it.** Resolve deps lazily inside handlers for anything testable, especially when sibling test files load without mocks.
2. **Elysia's `.mount()` does a defensive `path.length` check — passing `undefined` throws an inscrutable TypeError.** Guard the mount site rather than every caller.
3. **Bun's test runner has no DOM — do not let React tests enter its file discovery.** Route them through Vitest+jsdom explicitly; bunfig cannot exclude globs in 1.3.x.
4. **Content drift is invisible to eyeball review at 11-page scale.** Structural validators (`scripts/validate-docs.ts`) make the docs contract enforceable.
5. **"Deferred items" recorded in phase SUMMARY.md files are the next milestone's debt** — surface them in the audit, not just in file comments.

### Cost Observations
- Model mix: Primarily Opus 4.7 for planning + execution, Sonnet for checker/verifier roles
- Sessions: ~6 focused sessions across 6 days
- Notable: Milestone-close bug fixes via `/gsd:debug` spawned isolated investigation contexts, keeping main orchestrator context lean for the close workflow itself

---

## Milestone: v1.3 — Observability & Operations

**Shipped:** 2026-05-05
**Phases:** 7 (17-23, with 21 deferred to v1.4+) | **Plans:** 38

### What Was Built
- Observability ports + adapters: `ErrorTracker` (Sentry/GlitchTip via single class with `kind` tag, Pino-sink default fallback), `MetricsProvider`/`Tracer` Noop adapters, OTEL NodeSDK bootstrapped line-1 in apps/api + apps/worker entrypoints
- Error tracking pipeline: `scrubPii()` redaction (17-key denylist + 5 regex patterns + webhook-route rule + per-adapter beforeSend/beforeBreadcrumb defense-in-depth), global `uncaughtException`/`unhandledRejection` handlers with bounded flush, `wrapCqrsBus` throws-only capture, worker.on('failed') BullMQ capture, Elysia errorMiddleware A4-preserving enrichment, GitHub Actions release.yml uploading debug-id source maps to Sentry on tag push
- Unified observability context: single `AsyncLocalStorage<ObservabilityContext>` with Biome GritQL `enterWith` ban, Elysia `observabilityMiddleware` populating ALS per request (inbound traceparent honored), pino logger mixin auto-injecting `{trace_id, span_id, requestId, tenantId}` on every log line — zero call-site changes across handlers
- HTTP + CQRS + BullMQ tracing: span-per-request with method + route template + status code emitting outbound traceparent, external `wrapCqrsBus`/`wrapEventBus` wrappers (zero edits to core files), `wrapQueue` producer + extended `wrapProcessorWithAls` consumer with W3C carrier on `job.data._otel`, single-trace continuity API → enqueue → worker verified live and via D-08 E2E test
- Admin ops tooling: `@bull-board/elysia` mounted at `/admin/bull-board` behind `requireRole("owner")` + readOnly env + admin-origin CSP, vite admin sidebar entry rendering bull-board as same-origin iframe, `/health/detailed` endpoint with `HealthContributor` rollup pattern (worst-of-N aggregator + 5s cache + race-resolves-not-throws timeout), worker heartbeat publisher (Redis SET `worker:heartbeat:{instanceId}` with TTL=2*interval, DEL on graceful shutdown)
- Operator surface: 9 incident runbooks under `docs/runbooks/` (Trigger → Symptoms → Triage → Resolution → Escalation), 9 Sentry alert JSON templates with `runbook_url` cross-links + import README, 4 observability concept docs (attributes/cardinality/trace-propagation/index), `validate-docs.ts` 4th invariant + `.github/workflows/validate.yml` CI gate proving runbook_url integrity
- Mid-milestone urgent insert (Phase 20.1, 2026-04-26): drizzle migration baseline reset, billing scopedDb misuse fix across 7 ctx.db handlers, obsContext.traceId↔OTel server-span bridge at Bun.serve fetch boundary (synthetic OTel SpanContext seed), Phase 19 H-01/H-02/H-03 closure (locale-cookie try/catch, x-request-id charset+length validation, Bun.serve fetch error-span recordException + setStatus)

### What Worked
- **Port + adapter architecture from day one** — Phase 17's vendor-neutral ports made Phase 21 deferral cheap. The same Phase 18-22 code that works against Sentry SaaS will work against self-hosted OTLP/Tempo/Grafana when a fork user wires it; no application code changes required.
- **External wrapper pattern (wrapCqrsBus, wrapQueue, wrapProcessorWithAls)** — keeping instrumentation out of `core/cqrs.ts` and `core/event-bus.ts` meant adding tracing was non-destructive: existing tests still passed, the D-01 invariant ("zero edits to core") was provable via `git diff core/cqrs.ts core/event-bus.ts` returning zero lines across all observability phases.
- **`scrubPii()` defense-in-depth (input gate + output gate)** — calling the same redaction function from PinoErrorTracker AND from each Sentry adapter's `beforeSend`/`beforeBreadcrumb` paid off: the 39-test cross-adapter PII conformance suite caught a `tenantId` regression that the input-gate-only check would have missed.
- **Decimal phase 20.1 as urgent gap-closure** — when live UAT against real Sentry + authenticated session + BullMQ round-trip surfaced 3 production-grade issues mid-milestone (drizzle journal, billing TypeError, obsContext bridge), inserting a numbered phase rather than fixing them ad-hoc preserved the audit trail and let goal-backward verification catch each individually.
- **Operator surface as templates, not tooling** — shipping 9 alert JSONs + 9 runbooks + a CI gate proving `runbook_url` integrity beat building a custom alert engine. A fork user picks Sentry, Grafana, or another monitoring backend; the operator surface ports without rework.
- **Deferring Phase 21 once Sentry SaaS sufficed** — recognizing 2026-04-27 that Sentry covers the operator audience for hosted forks (and that the observability ports are vendor-agnostic) cut a phase without weakening the milestone. The decision was reversible — re-enable Phase 21 if/when fork users want self-hosted Grafana.

### What Was Inefficient
- **REQUIREMENTS.md drift during execution** — same pattern as v1.0/v1.1: 17 of 28 v1.3 requirements still showed `Pending` in the traceability table at milestone close even though phases shipped. Updating REQUIREMENTS.md per-phase remains a manual gap; the close workflow had to back-fill statuses based on SUMMARY.md evidence.
- **`milestone.complete` summary-extract regex grabbed noise** — auto-extracted accomplishments included literal text like "Found during:" and "1. [Rule 3 — Blocking]" from rule-format SUMMARY sections rather than the one-liner field. Had to hand-clean the v1.3 entry in MILESTONES.md.
- **STATE.md frontmatter progress drift** — at close: `total_phases: 2, completed_phases: 3, percent: 150`. The `milestone.complete` CLI fixed it, but the manual append pattern during execution kept producing inconsistent values.
- **Operator-gated UAT items pile up** — 4 of 5 phase 18 UAT tests, 1 of 2 phase 20 UAT tests, and 4 phase 22 manual UAT items all defer on production deploy or Phase 21 stack availability. The build is verified; the operator surface is not. v1.4 should plan a "production smoke milestone" or fold these into the Phase 21 work if/when it runs.
- **Multiple HUMAN-UAT files vs single-file pattern** — phases 18, 20, 20.1, 22 all use `*-HUMAN-UAT.md` (with the human prefix) rather than the `{phase}-UAT.md` pattern the verify-work workflow expects. Audit-open scanned them anyway, but render-checkpoint and other tooling assume the canonical name.

### Patterns Established
- **Closure-scoped `withScope` (no instance state)** — Sentry/Pino adapters' `withScope` setters write to a local `{ tags, extra }` object captured by arrow functions; concurrent `Promise.all([withScope(), withScope()])` + a subsequent unscoped `captureException` leaks nothing. Pitfall 4 regression guard test covers it.
- **Lockstep-mirror-function for hard-to-test boundary code** — `worker-failed-capture.test.ts` defines an `onFailed()` helper that replicates `worker.on('failed', ...)` body verbatim, plus a cross-file-state guard that reads the worker.ts source via `Bun.file` and asserts forbidden tokens absent. Stable unit-testable surface without booting real BullMQ/Redis.
- **`afterEach(async () => { await Sentry.close(100); })` is mandatory** for every describe constructing SentryErrorTracker — Sentry hub is process-global; 12+ init calls would accumulate integrations/transport state without close().
- **RFC 2606 reserved domain DSNs in tests** — `http://public@example.com/1` everywhere; `grep "sentry.io|glitchtip.io"` returns nothing in test files (T-18-30).
- **Atomic signature-trim pattern** — function signature change + every call-site update + env-var schema removal + dependent test updates land in ONE commit so tsc stays green at every boundary. Used to remove `decideInboundTrace`'s `remoteAddr` arg + `inboundCarrier` return field across 8 files in single commit `e16843d`.
- **`context.with(otelCtx, () => obsContext.run(seed, fn))` at fetch boundary** — OTel ambient context wraps the ALS seed; downstream tracer.startSpan and propagation.inject naturally inherit the request's traceId without adapter-specific wiring. Works whether the Tracer port is Noop or wired to a real OTel SDK exporter.
- **Operator-attested smoke proof** — Phase 23's CI gate was confirmed by deliberately breaking a `runbook_url`, watching CI go RED, then reverting and watching it go GREEN. Higher confidence than asserting validator behavior in unit tests alone.
- **`HealthContributor` rollup with worst-of-N + 5s cache + race-resolves-not-throws** — module declares `def.health` returning a typed contribution; ModuleRegistry collects all contributors at boot; aggregator computes worst severity with bounded latency. One function shape per module-author.

### Key Lessons
1. **The same architecture instinct that paid off in v1.0 (port + adapter) compounds over milestones** — Phase 21 was deferrable cheaply only because Phase 17 chose vendor-agnostic ports. Forward-compatibility is a function of architecture choices, not of forecasting.
2. **External instrumentation wrappers are removable; in-source instrumentation is not** — `wrapCqrsBus(bus, tracker)` versus editing `core/cqrs.ts`. The wrapper survives milestone-scope changes; the in-source edit survives only if the dependency stays.
3. **Defense-in-depth catches what a single boundary cannot** — `scrubPii()` at the input gate (PinoErrorTracker) AND at the output gate (Sentry beforeSend) caught regressions a single-gate would have missed. The cost is one extra function call per error path.
4. **Live UAT against real backends surfaces issues unit tests cannot** — Phase 20.1's three production-grade defects all surfaced from running the system end-to-end against real Sentry + authenticated session + BullMQ. The unit tests passed before and after the fixes; only live observation distinguished a working system from a broken one.
5. **Deferral with a reversibility plan beats over-scoping** — Phase 21's deferral to v1.4 was cheap because: (a) the ports stayed in place; (b) Sentry SaaS covered the operator audience; (c) the deferred-items log explicitly tracks what re-enabling the phase would entail. "Cut and document" beats "force-fit and ship half-done."
6. **Operator surface should ship as templates if the operator's tooling is unknown** — alert JSONs + runbooks + CI integrity gate beat building a custom alert engine. The fork user picks the backend; the surface ports without code changes.
7. **REQUIREMENTS.md drift remains a process-level gap across all milestones to date** — v1.0, v1.1, v1.2, v1.3 all closed with stale traceability tables. Worth piloting an automated update via `/gsd:transition` or similar at the next milestone.

### Cost Observations
- Model mix: predominantly Opus 4.7 for planning + execution; Sonnet for checker/verifier roles; Haiku rarely used in v1.3
- Sessions: ~15-18 focused sessions across 13 days (longer than v1.2 due to Phase 19's depth and the urgent Phase 20.1 insert)
- Notable: Phase 17 + 18 + 19 each crossed the 7-plan boundary (5/7/8 plans), making them the most dense planning phases of the project to date. Phase 20.1's 4-plan urgent insert demonstrated decimal-phase mechanics under real schedule pressure.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 5 | 15 | Initial project — established all patterns |
| v1.1 | 7 | 24 | Introduced parallel agent execution (worktrees); responsive + a11y + i18n + invites + payment abstraction |
| v1.2 | 4 | 19 | Introduced phase-close validators (`scripts/validate-docs.ts`); introduced two-runner test orchestration (Bun + Vitest); introduced debug-session pattern during milestone close |
| v1.3 | 7 (1 deferred) | 38 | Introduced port + adapter architecture for cross-cutting concerns (observability, matching v1.1's PaymentProvider pattern); introduced external-wrapper instrumentation pattern (`wrapCqrsBus`/`wrapEventBus`/`wrapQueue`) preserving D-01 zero-edits-to-core; introduced decimal-phase urgent inserts under real schedule pressure (Phase 20.1); introduced reversible-deferral discipline (Phase 21 → v1.4+ with operator-surface intact); introduced operator-surface-as-templates strategy (runbooks + alert JSONs + CI gate over custom alert engine) |

### Top Lessons (Verified Across Milestones)

1. Foundation-first ordering pays off — invest in core architecture before feature modules
2. Type-safe end-to-end (Eden Treaty) eliminates entire categories of bugs
3. Reuse framework primitives (better-auth org plugin) over custom implementations
4. Documentation-as-contract — enforce with validators, not reviewers (`scripts/validate-docs.ts`)
5. Late-binding surprises in test infrastructure — Bun's `mock.module()` registry, Elysia's eager `.mount()`, Vite vs Bun DOM support — plan for them by running full `bun test` as a phase verification gate, not just phase-scoped tests
