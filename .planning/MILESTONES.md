# Milestones

## v1.3 Observability & Operations (Shipped: 2026-05-05)

**Phases completed:** 7 phases (17-23, with 21 deferred to v1.4+), 38 plans

**Stats:**

- Git commits: 239 (a363a60 → 9ec3d60 range)
- Timeline: 13 days (2026-04-22 → 2026-05-05)
- Requirements: 21/28 satisfied, 5 deferred to v1.4 (Phase 21), 2 satisfied with operator UAT carryover (EXT-01 release-tag verification, OPS-02 manual iframe UAT)
- Decimal phase inserted: 20.1 (close v1.3 milestone gaps from observability UAT, urgent — drizzle migration journal repair, billing TypeError, obsContext↔OTel trace_id bridge)

**Key accomplishments:**

- **Observability ports + OTEL bootstrap** (Phase 17): typed `ErrorTracker`, `MetricsProvider`, `Tracer` ports with Noop adapters, factory-selected via `@t3-oss/env-core`; OTEL SDK bootstrapped as first-imports in apps/api + apps/worker entrypoints with Bun smoke-test gate
- **Error tracking adapters** (Phase 18): Sentry/GlitchTip parity via single `SentryErrorTracker` with kind tag (D-05), Pino-sink default fallback, scrubPii (17 keys + 5 regex patterns + webhook-route rule), 39-test cross-adapter PII conformance suite, GitHub Actions release workflow at `.github/workflows/release.yml` shipping debug-id source maps to Sentry on tag push
- **Context + structured tracing** (Phase 19): single `AsyncLocalStorage<ObservabilityContext>`, Elysia `observabilityMiddleware` populating ALS per request, pino logger mixin auto-injecting `{trace_id, span_id, requestId, tenantId}` on every log line, span-per-HTTP-request + per-CQRS-dispatch via external bus wrappers (zero edits to handlers)
- **BullMQ trace propagation** (Phase 20 + 20.1): W3C `traceparent` injection on `.add()` and `propagation.extract` on consumer side, end-to-end traceId continuity API → enqueue → worker verified live; obsContext.traceId↔OTel server-span bridge ensures producer log, consumer log, and BullMQ carrier all share one traceId
- **Admin ops tooling** (Phase 22): `@bull-board/elysia` mounted at `/admin/bull-board` with RBAC + readOnly + CSP frame-ancestors, `/health/detailed` endpoint with `HealthContributor` rollup pattern (worst-of-N aggregator, 5s cache, timeout-resolves-not-throws), worker heartbeat publisher (Redis SET with TTL=2*interval)
- **Operator runbooks + alert templates + observability docs** (Phase 23): 9 incident runbooks under `docs/runbooks/` (Trigger → Symptoms → Triage → Resolution → Escalation), 9 Sentry alert JSON templates with `runbook_url` cross-links, 4 observability concept docs (attributes glossary, cardinality guide, trace-propagation flow), CI validate.yml gate with smoke-tested runbook_url integrity check
- **Tech-debt fixes during milestone** (Phase 20.1, urgent insert): drizzle migration journal repair, billing `getSubscriptionStatus` TypeError fix, locale-cookie decodeURIComponent try/catch (H-01), x-request-id charset+length validation (H-02), Bun.serve fetch error-span recordException + setStatus (H-03)

**Known deferred items at close** (8 — see STATE.md `## Deferred Items`):

- Phase 21 stack (MET-01..03, DOC-01..02) deferred to v1.4 — Sentry SaaS covers operator audience for hosted forks
- 18-HUMAN-UAT.md: 4 tests skipped pending production deploy (Sentry release workflow secrets + test tag + demangled stack-trace + .map 404)
- 20-HUMAN-UAT.md: Tempo visual confirmation blocked on Phase 21
- 22-VERIFICATION.md: 4 manual UAT items (CSP iframe, cookie-share, worker dead-status, pt-BR locale)
- harden-inbound-traceparent-trust-gate todo (api boundary)

---

## v1.2 Documentation & Quality (Shipped: 2026-04-21)

**Phases completed:** 4 phases (13-16), 19 plans

**Stats:**

- Files modified: 114
- Lines changed: +5,908 / −312
- Git commits: 115 (22e7738 → ef2fcaa range)
- Timeline: 6 days (2026-04-16 → 2026-04-21)
- Requirements: 23/23 v1.2 requirements validated
- Test files: 43 total, 56/56 auth tests + 21/21 UI tests passing at close

**Key accomplishments:**

- JSDoc style guide (`docs/jsdoc-style-guide.md`) + comprehensive annotations across packages/shared, packages/db, auth module (8 commands + 6 queries), billing module (6 commands + 2 queries), example module, and core infrastructure (CqrsBus, EventBus, ModuleRegistry, middleware) — every exported symbol documents intent and contracts, not TypeScript signatures
- Unit test coverage for every CQRS handler — 8 auth commands + 6 auth queries + 6 billing commands + 2 billing queries, plus Stripe adapter conformance tests at parity with Pagar.me, scoped-db cross-tenant prevention, and core infrastructure edge cases
- Canonical `createMockContext` helper at `packages/modules/__test-utils__/mock-context.ts` — unified test convention across auth handlers
- In-repo developer documentation — Getting Started, Architecture Overview (4 Mermaid diagrams), Add-a-Module tutorial, Configuration + Testing guides, and integration docs for better-auth, Stripe/Pagar.me, BullMQ, Resend/React Email (11 doc pages total)
- Example module extended (D-05) — event emission + BullMQ job handler + Wave 0 tests, serving as the canonical "how to build a module" reference
- `scripts/validate-docs.ts` phase-close validator — enforces forbidden-import, secret-shape, and Mermaid floor invariants to prevent docs drift
- Phase 16 content-drift cleanup — closed 6 audit gaps (2 FAIL + 4 WARN) so every cited symbol / path / count matches live code
- Milestone-close bug fixes — guarded Elysia `.mount()` against partial test mocks (`auth-setup-elysia-mount`); resolved `get-profile` deps lazily so `mock.module()` from later test files is honored (`get-profile-test-pollution`); routed `packages/ui` tests through Vitest+jsdom eliminating 22 `ReferenceError: document` failures (quick task 260420-a4t)

**Known deferred items at close:** 0 (all open artifacts resolved during close workflow)

---

## v1.1 Polish & Extensibility (Shipped: 2026-04-16)

**Phases completed:** 7 phases, 24 plans, 33 tasks

**Key accomplishments:**

- DataTableCards component with priority-based column rendering, tap-to-expand, sort dropdown, and filter chips -- wired into admin tenants/users lists with responsive mobile/desktop switching
- Replaced div-based CardTitle with semantic h1 headings on all 6 auth pages
- Shared i18n package with 280 translation keys (en + pt-BR), next-intl wired into Next.js customer app, react-i18next wired into Vite admin dashboard
- All 7 pages and 2 components in apps/web now render strings from next-intl translation files with zero hardcoded English
- All 8 routes and 1 layout in apps/admin now render strings from react-i18next translation files with zero hardcoded English
- sendInvitationEmail callback with @internal link-mode suppression, TeamInviteEmail template via BullMQ, invite i18n namespace (en/pt-BR), and Switch UI component
- Public invite accept page with 5 user states, login redirect with token preservation, and signup auto-accept per D-08
- Replaced 5 `<CardTitle>` usages with `<h1>` on the invite accept page, closing the A11Y-01 heading hierarchy regression flagged by the v1.1 milestone audit.
- SkipToContent primitive refactored to require a translated `label` prop, wiring all three app layouts (auth/dashboard/admin) to `common.skipToContent` — TypeScript now structurally blocks regressions to the old hardcoded English string.
- Before (relevant excerpt):
- 1. [Rule 3 - Blocking] Added `@baseworks/i18n` workspace dep to `packages/modules/auth/package.json`

---

## v1.0 MVP (Shipped: 2026-04-08)

**Phases completed:** 5 phases, 15 plans, 41 tasks

**Key accomplishments:**

- Bun workspace monorepo with 4 packages, Drizzle+postgres.js connection factory, CQRS type contracts with TypeBox validation, and @t3-oss/env-core crash-on-missing env validation
- Config-driven module registry with CQRS command/query dispatch, in-process event bus with async error isolation, and example module proving the full Medusa-style module contract
- Tenant-scoped database wrapper with automatic tenant_id filtering, Elysia tenant/error middleware, worker entrypoint for dual-mode operation, and 13 integration tests proving tenant isolation
- better-auth instance with email/password, OAuth, magic link, and organization plugin mounted in Elysia with session injection macro and RBAC role guard
- Session-derived tenant context replacing x-tenant-id header, auto-create personal org on signup via databaseHooks, and requireRole("owner") guarding DELETE /api/tenant
- 4 CQRS commands and 4 queries wrapping better-auth org plugin API, with get-profile using direct DB query by ctx.userId and auth config tests verifying OAuth/magic link/password reset
- Vite admin dashboard SPA with role-based auth, tenant/user data tables, billing stats, and auto-refreshing system health

---
