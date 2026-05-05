# Baseworks

## What This Is

A production-grade monorepo starter kit for SaaS and freelance projects. Provides a fully wired foundation — modular backend with CQRS, authentication, billing, multitenancy, admin tooling, job processing, and dual frontend apps — so you can fork it, configure which modules to load, and start building your product immediately. Built with Bun, Elysia, Next.js, and a Medusa-style modular backend architecture.

## Core Value

Clone, configure, and start building a multitenant SaaS in minutes — not weeks.

## Current State

**Shipped:** v1.3 Observability & Operations (2026-05-05) — 7 phases (21 deferred), 38 plans, 239 commits over 13 days. 21/28 v1.3 requirements satisfied; 5 deferred to v1.4 (Phase 21 — Sentry SaaS covers operator audience for hosted forks); 2 satisfied with operator UAT carryover (EXT-01 release-tag verification, OPS-02 manual iframe UAT).

**Next milestone:** v1.4 — scope to be defined via `/gsd:new-milestone`. Carry-over candidates from v1.3: Phase 21 work (OTEL adapters + Grafana stack), 18-HUMAN-UAT.md production verification, 22-VERIFICATION.md manual UAT items, harden-inbound-traceparent-trust-gate todo.
**Codebase:** ~20K lines TypeScript across apps/packages
**Tech stack:** Bun + Elysia + Drizzle + PostgreSQL + BullMQ + Redis + Next.js 15 + Vite + React 19 + shadcn/ui + Tailwind 4 + better-auth + Stripe + Pagar.me + Docker + pino + next-intl + react-i18next + Vitest (jsdom)

**What's working:**
- Config-driven module registry loads modules, routes commands/queries through CQRS, emits domain events
- Tenant-scoped database wrapper with automatic tenant_id filtering on all queries
- Full auth: email/password, OAuth (Google/GitHub), magic links, password reset, RBAC
- Provider-agnostic billing: PaymentProvider port interface with Stripe and Pagar.me adapters, webhook normalization, env-based provider selection with startup validation
- BullMQ workers with per-module job queues, transactional email via Resend + React Email
- Next.js customer app with auth pages, billing management, tenant switching, team settings
- Vite admin dashboard with tenant/user management, billing overview, system health
- Eden Treaty type-safe API client shared across both frontends
- 18+ shadcn components in shared UI package with Tailwind 4
- Three-tier responsive layouts (mobile/tablet/desktop) with card-based mobile tables
- Accessibility: semantic landmarks, skip links, keyboard navigation, aria-live, vitest-axe tests
- i18n: shared packages/i18n with 280 keys, 5 namespaces, pt-BR + en, next-intl + react-i18next
- Team invites: email/link modes, CQRS lifecycle, accept page with 5 user states
- Docker multi-stage builds for API/worker/admin, Docker Compose orchestration
- Vercel-ready Next.js deployment configuration
- Health check endpoints with dependency status, structured pino logging with request tracing
- Comprehensive JSDoc annotations across every exported API (packages/shared, packages/db, auth, billing, example module, core infrastructure) with a canonical style guide at `docs/jsdoc-style-guide.md`
- Unit test coverage for every CQRS handler — 8 auth commands + 6 auth queries + 6 billing commands + 2 billing queries, Stripe adapter conformance at parity with Pagar.me, scoped-db edge cases, core infrastructure tests (56/56 auth tests + 21/21 UI tests passing)
- Two-runner test orchestration via root `bun run test` — `bun test` for non-DOM + `vitest run` for React component a11y tests under jsdom
- In-repo developer documentation — Getting Started, Architecture Overview (4 Mermaid diagrams), Add-a-Module tutorial, Configuration + Testing guides, and integration docs for better-auth, Stripe/Pagar.me, BullMQ, Resend/React Email (11 pages under `docs/`)
- `scripts/validate-docs.ts` phase-close validator enforcing forbidden-import, secret-shape, Mermaid floor (≥11), and runbook cross-link invariants — wired to `bun run validate` + `.github/workflows/validate.yml` CI gate
- Operator surface: 9 incident runbooks + 9 Sentry alert JSON templates with import README + 4 observability concept docs (attributes/cardinality/trace-propagation/index) under `docs/observability` and `docs/runbooks` and `docs/alerts/sentry`

## Requirements

### Validated

- ✓ Modular backend architecture (Medusa-style module registry with configurable loading) — v1.0
- ✓ Multitenant data isolation (shared PostgreSQL DB with tenant_id column) — v1.0
- ✓ Authentication via better-auth (email/password, OAuth providers, magic links) — v1.0
- ✓ Stripe integration (subscriptions, one-time payments, usage-based billing, customer portal) — v1.0
- ✓ CQRS command/query split with separate handlers — v1.0
- ✓ BullMQ job workers with Redis — v1.0
- ✓ Admin dashboard (Vite + React + shadcn) — tenant/user/billing management + system health — v1.0
- ✓ Customer-facing app base (Next.js + shadcn + Tailwind 4) — v1.0
- ✓ Eden Treaty for type-safe frontend-backend communication — v1.0
- ✓ Drizzle ORM with PostgreSQL — v1.0
- ✓ Bun workspaces monorepo structure — v1.0
- ✓ Configurable instance roles (API, workers, specific modules) via entrypoints + env config — v1.0
- ✓ Docker setup for backend/workers, Vercel-ready Next.js — v1.0
- ✓ Transactional email via Resend + React Email templates through BullMQ — v1.0
- ✓ Health check endpoints with dependency status (DB, Redis, queues) — v1.0
- ✓ Structured JSON logging via pino with request tracing — v1.0
- ✓ Environment variable validation at startup with typed config — v1.0

- ✓ Fully responsive layouts (mobile/tablet/desktop) with three-tier sidebar — v1.1
- ✓ Accessibility — semantic landmarks, skip links, keyboard nav, aria-live, vitest-axe tests — v1.1
- ✓ i18n infrastructure — shared packages/i18n, 280 keys, 5 namespaces, pt-BR + en — v1.1
- ✓ Team/org invites — email/link modes, CQRS lifecycle, accept page, role assignment — v1.1
- ✓ Payment provider abstraction — PaymentProvider port, StripeAdapter, PagarmeAdapter — v1.1

- ✓ Comprehensive JSDoc annotations across all source files — v1.2 (Phase 13)
- ✓ High-quality unit tests increasing coverage across the full stack — v1.2 (Phase 14; 56/56 auth + 21/21 UI passing at close)
- ✓ In-repo developer documentation (configuration, testing, third-party integrations) — v1.2 (Phase 15; content-drift gaps closed in Phase 16)

- ✓ Observability ports (Tracer / MetricsProvider / ErrorTracker) with Noop adapters + env-selected factory + OTEL NodeSDK bootstrapped line-1 in apps/api entrypoints — v1.3 (Phase 17; OBS-01..04)
- ✓ Error tracking adapters: Sentry + GlitchTip (single class via `kind` tag) + pino-sink default fallback, with `scrubPii()` PII redaction (denylist + regex + webhook-route rule), global handlers (`uncaughtException`/`unhandledRejection`), `wrapCqrsBus()` throws-only capture, worker.on('failed') BullMQ capture, Elysia errorMiddleware A4 single-onError enrichment, and tag-push source-map upload workflow — v1.3 (Phase 18; ERR-01..04, EXT-01 — EXT-01 operator gate deferred to 18-HUMAN-UAT.md)
- ✓ Unified observability context: single `AsyncLocalStorage<ObservabilityContext>` with Biome GritQL `enterWith` ban, Elysia `observabilityMiddleware` populating ALS per request (inbound `traceparent` honored or new trace started), pino logger mixin auto-injecting `{trace_id, span_id, requestId, tenantId}` on every log line — v1.3 (Phase 19; CTX-01..03)
- ✓ HTTP and CQRS tracing: span-per-HTTP-request with method + route template + status code emitting outbound `traceparent`, external `wrapCqrsBus`/`wrapEventBus` wrappers emitting span-per-dispatch with correlation attributes — zero edits to existing handler/core files — v1.3 (Phase 19; TRC-01..02)
- ✓ BullMQ trace propagation: `wrapQueue` producer injects W3C `traceparent` + `requestId` + `tenantId` into `job.data._otel`, `wrapProcessorWithAls` consumer extracts via `propagation.extract` and seeds `obsContext.run`; D-08 E2E test asserts single trace spans API → enqueue → worker — v1.3 (Phase 20; CTX-04, TRC-03 with Tempo visual deferred to v1.4)
- ✓ Admin ops tooling: `@bull-board/elysia` mounted at `/admin/bull-board` behind `requireRole("owner")` + readOnly env + admin-origin CSP, vite admin sidebar entry rendering bull-board as same-origin iframe sharing better-auth cookie, `/health/detailed` endpoint with `HealthContributor` rollup pattern (worst-of-N aggregator, 5s cache, timeout-resolves-not-throws), worker heartbeat publisher (Redis SET `worker:heartbeat:{instanceId}` with TTL=2*interval, DEL on graceful shutdown) — v1.3 (Phase 22; OPS-01..04, EXT-02; manual iframe/cookie/locale UAT deferred to v1.4)
- ✓ Operator runbook + alert template + observability docs set: 9 incident runbooks under `docs/runbooks/` (DB down, Redis down, queue backing up, webhook failures, auth outage, OTEL exporter failing, bull-board inaccessible, high error rate, slow checkout) using locked Trigger → Symptoms → Triage → Resolution → Escalation template, 9 Sentry alert JSON templates with `runbook_url` cross-links + import README, 4 observability concept docs under `docs/observability/` (attributes glossary, cardinality guide, trace-propagation flow, README index), `validate-docs.ts` 4th invariant enforcing runbook_url integrity wired to `bun run validate` + `.github/workflows/validate.yml` CI gate — v1.3 (Phase 23; DOC-03..04 — Grafana YAML scope dropped with Phase 21 deferral)
- ✓ Tech-debt fixes mid-milestone (Phase 20.1 INSERTED 2026-04-26): drizzle migration journal repair (baseline reset to single `0000_red_lester.sql`), billing scopedDb misuse fix across 7 ctx.db handlers, obsContext.traceId↔OTel server-span bridge at Bun.serve fetch boundary (synthetic OTel SpanContext seed; CIDR trust gate dropped per OTel always-trust default for v1.3), Phase 19 H-01 (locale-cookie decodeURIComponent try/catch), H-02 (x-request-id charset+length validation), H-03 (Bun.serve fetch error-span recordException + setStatus) — v1.3

### Active

**Milestone v1.4: File Storage & Uploads**

**Goal:** Ship a typed file storage port with S3 + S3-compatible + local adapters, signed direct uploads, automatic image transforms via sharp, per-tenant quota tracking, and a reusable UI uploader component — so fork users inherit ready-to-use file handling for both identity assets (avatars, org logos) and tenant content (documents, photos, videos attached to records).

**Target features:**

- File storage port + 3 adapters: S3 (AWS), S3-compatible (configurable endpoint covering MinIO/Garage/Ceph/R2), Local (dev/self-host)
- Signed direct upload flow — server signs short-lived PUT URLs with size + MIME-type constraints; browser uploads directly to storage; server records metadata on success
- Signed read URLs for tenant-private file access (private buckets, short-lived GET URLs)
- Image transforms via sharp — avatars and org logos auto-generate variants (e.g., 64/128/256/512 px) on upload; tenant content stored as-is
- Per-tenant storage quota — bytes-used tracked in `tenant_storage_usage`, enforced at upload-signing time, surfaced in admin dashboard + `/health/detailed`
- Module file-ownership pattern — modules declare file relations (e.g., billing attaches invoice PDFs to subscriptions); central `files` table with tenant + owner + key + metadata
- Identity asset wiring — user avatar + org logo flows through auth + tenant settings UI
- Generic tenant-attachments path — any module can attach files to its records via the shared adapter
- Reusable UI uploader in `packages/ui` — drag-and-drop, progress bar, image preview; used by Next.js customer app and Vite admin app
- Async image transform jobs via BullMQ — variant generation off the upload response path

**Adapter matrix:**

| Port | Adapters shipped |
|------|------------------|
| `FileStorage` | S3 (AWS SDK), S3-compatible (S3 SDK with configurable endpoint), Local (Node FS) |
| `ImageTransform` | sharp (with Bun-compat verification — fallback to imagescript/wasm-vips if needed) |

**Key context:**
- Reuse existing patterns — port + adapters (matching PaymentProvider, ErrorTracker, Tracer), Drizzle schema with tenant_id scoping, BullMQ for async work
- **Sharp under Bun** is a research item — verify Bun-native compatibility; fall back to imagescript/wasm-vips if not stable
- Signed URL flow requires CORS config in the bucket — fork user gets boilerplate + docs
- Quota tracking integrates with existing `/health/detailed` (Phase 22 pattern)
- Storage usage tracked via Drizzle counter on every successful upload + cleanup on delete; reconcile job optional

**Out of scope (v1.5+):**
- Virus scanning (ClamAV/etc adapter) — deferred to a security-focused milestone
- Video transcoding — depth issue, separate milestone
- Bulk CSV/Excel imports — different problem domain (data import, not file storage)
- Browser-side image cropping/editing — frontend feature, not starter-kit core
- Multi-region replication — operational concern, not v1.4 scope
- File-access audit log — folds into future audit-log milestone

**Carry-over from v1.3 (NOT v1.4 scope, still pending):**
- Phase 21 work (OTEL adapters + Grafana stack) — remains deferred; re-evaluate when fork-user demand emerges
- 18-HUMAN-UAT.md operator gate — gates on first production deploy
- 22-VERIFICATION.md manual UAT items — gates on staging deploy + browser testing
- harden-inbound-traceparent-trust-gate todo — production trust hardening when high-volume traffic exposure becomes real

### Out of Scope

- Full event sourcing / event store — practical CQRS only, no projections or replay
- Mobile app — web-first
- tRPC — using Eden Treaty instead
- Turborepo/Nx — keeping it simple with native Bun workspaces
- Schema-per-tenant or DB-per-tenant — starting with shared DB, can migrate later
- Landing page / marketing site — this is a starter kit, not a finished product
- Real-time / WebSockets — Elysia supports it when needed later
- Locale-based URL routing, language switcher UI, backend i18n — v1.2 did not pursue these; revisit for v1.3+ if demand emerges
- Configurable invite expiration with auto-cleanup — v1.2 did not pursue these; revisit for v1.3+ if demand emerges

## Context

This is a personal infrastructure investment. The user builds SaaS products and takes freelance projects — every new project starts from scratch, re-implementing auth, billing, multitenancy. Baseworks eliminates that bootstrap cost.

The backend draws inspiration from Medusa's module system: each module declares its routes, commands, queries, jobs, and events. A central config file determines what loads at startup. Different entrypoints (`bun run api`, `bun run worker`) control the instance role, with env vars for fine-tuning.

The frontend is split into two apps: a Next.js customer-facing app (deployable to Vercel) and a Vite + React admin dashboard (deployed alongside the backend via Docker). Both share a common UI package with shadcn components and Tailwind 4.

v1.0 shipped in 3 days (2026-04-05 to 2026-04-08) across 116 commits and 5 phases (15 plans). All 49 v1 requirements validated.

v1.1 shipped in 6 days (2026-04-08 to 2026-04-14) across 157 commits and 7 phases (24 plans). All 26 v1.1 requirements validated. Added +6,565 lines across 117 files.

v1.2 shipped in 6 days (2026-04-16 to 2026-04-21) across 115 commits and 4 phases (19 plans). All 23 v1.2 requirements validated. Added +5,908 lines across 114 files. Milestone-close work surfaced and fixed three test-infrastructure bugs (Elysia `.mount()` guard against partial mocks, `get-profile` lazy dep resolution for `mock.module()`, `packages/ui` tests routed through Vitest+jsdom), leaving the suite at 56/56 auth + 21/21 UI passing at close.

v1.3 shipped in 13 days (2026-04-22 to 2026-05-05) across 239 commits and 7 phases / 38 plans (Phase 21 deferred to v1.4+). 21/28 requirements satisfied with 5 deferred to v1.4 (Phase 21 — Sentry SaaS covers operator audience for hosted forks) and 2 satisfied with operator UAT carryover (EXT-01 release-tag verification, OPS-02 manual iframe UAT). Decimal Phase 20.1 inserted mid-milestone (2026-04-26) as urgent gap-closure after live UAT against real Sentry DSN + authenticated session + BullMQ producer/consumer round-trip surfaced 3 production-grade issues (drizzle journal repair, billing TypeError, obsContext↔OTel bridge). 8 known deferred items at close (see STATE.md `## Deferred Items` and MILESTONES.md v1.3 entry).

## Constraints

- **Runtime**: Bun — all packages must be Bun-compatible
- **ORM**: Drizzle — no Prisma, no raw SQL for application code
- **Auth**: better-auth — not NextAuth, not custom
- **Payments**: Stripe + Pagar.me via PaymentProvider port — env-based selection
- **Database**: PostgreSQL — single shared instance with tenant isolation via tenant_id
- **Queue**: BullMQ + Redis — no other job queue systems
- **API client**: Eden Treaty — type-safe end-to-end with Elysia
- **Styling**: Tailwind 4 + shadcn/ui — no other CSS frameworks

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Shared DB multitenancy with tenant_id | Simplest to start, scales well, can migrate to schema-per-tenant later if needed | ✓ Good — tenant scoping wrapper works cleanly |
| Medusa-style module registry | Enables configurable instances (API-only, worker-only, specific modules) without code changes | ✓ Good — proven with auth, billing, example modules |
| Practical CQRS (command/query split) | Clean separation of concerns without event sourcing complexity | ✓ Good — clear command/query boundaries across all modules |
| Eden Treaty over tRPC/REST | Native Elysia integration, zero boilerplate, full type inference | ✓ Good — type-safe across both frontends |
| Bun workspaces over Turborepo | Minimal tooling overhead, Bun handles workspace resolution natively | ✓ Good — no issues at 7 packages |
| Vite for admin, Next.js for customer | Admin doesn't need SSR/SEO; Vite is faster for SPA. Customer app benefits from Next.js SSR | ✓ Good — clean separation of concerns |
| Vercel + VPS split deployment | Best of both: Vercel for Next.js edge delivery, VPS/Docker for backend + workers + admin | ✓ Good — Docker Compose + Vercel config ready |
| better-auth organization plugin for tenancy | Reuse battle-tested org primitives instead of custom tenant tables | ✓ Good — avoids schema duplication |
| Static import map for module loading | Bun compatibility + security over string-interpolated dynamic imports | ✓ Good — reliable, type-safe |
| Session-derived tenant context | Tenant from session eliminates spoofable x-tenant-id header | ✓ Good — secure by default |
| Stripe webhook idempotency table | Dedup table prevents duplicate event processing | ✓ Good — reliable webhook handling |
| pino + request ID propagation | Structured logging with trace correlation from API to worker jobs | ✓ Good — production-ready observability |
| Three-tier responsive breakpoints (mobile/tablet/desktop) | Distinct sidebar behavior per tier; tablet gets hover-expand without corrupting localStorage | ✓ Good — clean UX across all viewports |
| next-intl for Next.js, react-i18next for Vite admin | Different SSR requirements; shared packages/i18n JSON source of truth | ✓ Good — each framework gets native i18n |
| PaymentProvider port/adapter pattern | Vendor-agnostic billing; env-based provider selection at startup | ✓ Good — Stripe and Pagar.me adapters work identically |
| better-auth sendInvitationEmail callback for invites | Hooks into org plugin invite flow; enqueues BullMQ email job with @internal suppression for link mode | ✓ Good — clean integration without custom auth tables |
| Responsive before a11y, i18n before invites | a11y audits run on final responsive DOM; invite UI ships translated from day one | ✓ Good — avoided rework from incorrect sequencing |
| JSDoc style guide before volume annotation (v1.2) | A single canonical template prevents divergent JSDoc dialects across modules | ✓ Good — 53 exported files annotated consistently, 14 @example blocks |
| Two-runner test orchestration: `bun test` + `vitest run` (v1.2) | Bun's test runner has no DOM; UI a11y tests need jsdom. Wiring both via root `bun run test` keeps one command, two environments | ✓ Good — eliminated 22 `ReferenceError: document` failures |
| Resolve handler deps lazily via `await import()` when mock pollution is possible (v1.2) | Bun's `mock.module()` updates the registry but does not re-run already-evaluated modules. Handlers that capture deps at module-load time are immune to late mocks. Lazy resolution honors later `mock.module()` calls | ✓ Good — `get-profile` test pollution fixed, pattern now matches 4 billing-module callsites |
| Guard Elysia `.mount()` against partial test mocks (v1.2) | 13 sibling test files register `mock.module("../auth", ...)` with no `.handler`. Guarding the mount site is cheaper than fixing every mock | ✓ Good — zero production impact; tests deterministic |
| `scripts/validate-docs.ts` as phase-close contract (v1.2) | Docs drift is impossible to catch by eyeball at scale; a structural validator makes the contract enforceable | ✓ Good — content-drift audit before Phase 16 produced a concrete punch list |
| Phase 16 content-drift fixes (docs-first over code-first) | Chose Option A: revise docs to match live `event-bus-hook` enqueue path rather than retrofit `ctx.enqueue`. Lower risk, preserves the working pattern | ✓ Good — 6 audit gaps closed, no new code paths introduced |
| Phase 17 OTEL bootstrap: `NodeSDK` without `traceExporter` + dynamic `await import("@baseworks/config")` after `sdk.start()` (v1.3) | Zero-exporter keeps default-noop posture (T-17-03 noop egress); dynamic import preserves D-06 — config load must not run before OTEL patches require/import | ✓ Good — subprocess smoke tests confirm `otel-selftest: ok` with zero outbound traffic; all 4 instrumentation subtests pass |
| Phase 17 `INSTANCE_ROLE` strict `'api' \| 'worker'` union, default 'api' (v1.3) | Two-role model matches Baseworks deployment reality; dropping the speculative 'all' role avoids a leaky abstraction ahead of real need | ✓ Good — role-branched instrumentation matrix cleanly gates HTTP to api only |
| Defer Phase 21 (OTEL adapters + Grafana stack) to v1.4+ (2026-04-27) | Sentry SaaS already provides metrics/dashboards/alerts for hosted forks; the observability ports shipped in Phase 17 are vendor-agnostic, so a future fork wanting self-hosted Grafana can wire OTLP without touching application code. Cuts 1 phase from v1.3 scope; MET-01..03 + DOC-01..02 move to deferred. | Pending — re-evaluate when fork-user demand for self-hosted observability emerges |
| Single `AsyncLocalStorage<ObservabilityContext>` for request-scoped trace correlation (v1.3 Phase 19) | Bridges OTel ambient context, pino log mixin, BullMQ job carriers, and CQRS dispatch spans through one storage primitive. Biome GritQL rule bans `enterWith` so context cannot escape via the unsafe API. | ✓ Good — every log line, every dispatch span, every BullMQ job inherits the same `{requestId, traceId, spanId, tenantId, userId}` |
| External wrapper pattern for CqrsBus + EventBus tracing (v1.3 Phase 19) | `wrapCqrsBus(bus, tracker)` and `wrapEventBus(bus, tracker)` are external — zero edits to `apps/api/src/core/cqrs.ts` or `event-bus.ts`. Same instance the rest of the application reads is replaced at registry boot. | ✓ Good — D-01 invariant preserved end-to-end across Phase 18 + 19 + 20; instrumentation is removable without touching core |
| Single `SentryErrorTracker` class serving both Sentry and GlitchTip via `kind` tag (v1.3 Phase 18) | Rather than two adapter classes implementing the port twice, one class with `kind: 'sentry' \| 'glitchtip'` covers both backends since GlitchTip's API is Sentry-compatible. Adapter conformance test runs the same fixture suite against both, proving parity by structural identity. | ✓ Good — ERR-01 and ERR-02 close simultaneously; future Sentry-compatible backends just add a kind value |
| `scrubPii()` defense-in-depth: regex + denylist + webhook-route rule + per-adapter `beforeSend`/`beforeBreadcrumb` (v1.3 Phase 18) | Single redaction function called from PinoErrorTracker (input gate) AND in Sentry adapter's `beforeSend`/`beforeBreadcrumb` (output gate). Defense in depth: even if a future code path bypasses the input gate, Sentry sees redacted data. | ✓ Good — 39-test PII conformance suite covers 13 fixtures × 3 adapters; one fixture caught a `tenantId` regression in SentryErrorTracker.captureException |
| Synthetic OTel SpanContext seed at Bun.serve fetch boundary (v1.3 Phase 20.1 D-11) | Phase 19 left `obsContext.traceId` and OTel server-span `traceId` divergent — log lines and Tempo traces did not correlate. Phase 20.1 wraps `app.handle` with `context.with(otelCtx, () => obsContext.run(seed, fn))` so OTel ambient context wraps the ALS seed; downstream tracer.startSpan and propagation.inject naturally inherit the request's traceId. | ✓ Good — SC#3 (single-trace continuity API → enqueue → worker) closed at production-code level; no per-adapter wiring needed |
| Drop CIDR-based traceparent trust gate, adopt OTel always-trust default (v1.3 Phase 20.1 D-12) | OBS_TRUST_TRACEPARENT_FROM/HEADER env vars + ipaddr.js trust logic deleted. v1.3 trusts inbound traceparent unconditionally, matching OTel's default posture. Production trust hardening (CIDR allowlist or signed traceparent) deferred to a follow-up todo for v1.4+. | ⚠️ Revisit at v1.4 — `harden-inbound-traceparent-trust-gate` todo captures the trust-boundary work needed before high-volume production exposure |
| 9 incident runbooks + 9 Sentry alert JSONs as the operator surface for v1.3 (v1.3 Phase 23) | Templates beat tooling: a fork user wanting Grafana can import the JSON; a fork user staying on Sentry can import the same JSON. `runbook_url` annotation links every alert to the matching `docs/runbooks/*.md`. CI's `validate-docs.ts` 4th invariant fails the build if a `runbook_url` points to a missing file. | ✓ Good — operator surface ships independent of any specific monitoring backend; CI gate prevents docs drift |
| `HealthContributor` rollup pattern with worst-of-N + 5s cache + race-resolves-not-throws (v1.3 Phase 22) | Each module declares `def.health` returning a typed contribution; ModuleRegistry collects all contributors at boot; aggregator computes worst severity across all modules with a 5s cache and a `Promise.race` timeout that resolves (not throws) so a hung contributor doesn't block the whole `/health/detailed` response. | ✓ Good — one endpoint fans out across 4+ contributors with predictable bounded latency; module-author DX is one function shape |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-05 — v1.3 closed, v1.4 (File Storage & Uploads) goals defined. Active milestone targets a typed FileStorage port + S3/S3-compat/local adapters, signed direct uploads with image transforms, per-tenant quotas, and a reusable UI uploader.*
