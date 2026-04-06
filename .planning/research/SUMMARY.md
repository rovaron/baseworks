# Project Research Summary

**Project:** Baseworks (SaaS Starter Kit Monorepo)
**Domain:** SaaS infrastructure / developer tooling
**Researched:** 2026-04-05
**Confidence:** MEDIUM

## Executive Summary

Baseworks is a production-grade monorepo starter kit for SaaS and freelance projects, built on Bun, Elysia, Next.js, and PostgreSQL. Research across stack, features, architecture, and pitfalls converges on a clear conclusion: the project's primary differentiator is its Medusa-inspired modular backend with configurable instance roles and practical CQRS -- capabilities no existing SaaS starter kit offers. The recommended stack (Elysia + Eden Treaty, Drizzle, better-auth, BullMQ, shadcn/Tailwind 4) is modern and cohesive, with end-to-end TypeScript type safety as the unifying principle. All core technologies are Bun-compatible, though several (Elysia, better-auth, Drizzle) had version numbers based on May 2025 training data and need verification before implementation begins.

The recommended approach is foundation-first: establish the module registry, tenant-scoped database access, and auth strategy before building any feature modules. This ordering is driven by two critical pitfalls identified in research -- cross-tenant data leakage from missing tenant scoping, and auth strategy fragmentation across the three consuming apps (Next.js, Vite admin, Elysia API). Both must be solved architecturally before feature code is written; retrofitting either is extremely expensive.

The key risks are: (1) BullMQ worker thread compatibility with Bun, which needs early validation with a Node.js fallback plan; (2) Elysia type inference explosion as routes scale across modules, requiring disciplined sub-app splitting from day one; (3) Stripe webhook idempotency, which must be built before any subscription logic. All three risks have concrete mitigation strategies documented in PITFALLS.md and are addressable with early attention in the correct phase.

## Key Findings

### Recommended Stack

The stack centers on Bun as runtime and package manager, Elysia as the HTTP framework (chosen specifically for Eden Treaty's zero-codegen type-safe API client), Drizzle ORM with PostgreSQL, and better-auth for framework-agnostic authentication. The frontend splits into Next.js for the customer app (SSR/SEO) and Vite + React for the admin dashboard (SPA, no SSR overhead). Both share a shadcn/ui + Tailwind 4 component library. BullMQ + Redis handles background jobs, and Stripe handles all payments.

**Core technologies:**
- **Bun**: Runtime, package manager, workspace tool, test runner -- native TypeScript, no transpilation
- **Elysia + Eden Treaty**: HTTP framework with zero-codegen type-safe API client -- the primary reason to choose Elysia over Hono
- **Drizzle ORM + PostgreSQL**: Type-safe SQL-like ORM with no codegen step, migration tooling, and Zod schema generation via drizzle-zod
- **better-auth**: Framework-agnostic auth supporting email/password, OAuth, magic links -- works across Elysia, Next.js, and Vite without framework lock-in
- **BullMQ + Redis**: Battle-tested job queue with retry, scheduling, priorities -- most starter kits ignore async work entirely
- **Stripe**: Subscriptions, one-time payments, usage-based billing, customer portal
- **shadcn/ui + Tailwind 4**: Component library (copy-paste, not npm dependency) with utility-first CSS
- **Biome**: Replaces ESLint + Prettier as a single, dramatically faster linter/formatter

**Critical version note:** All versions are from May 2025 training data. Run `bun add <package>@latest` to verify before implementation.

### Expected Features

Research identified a clear market gap: existing SaaS starters (ShipFast, Makerkit, Supastarter, Bedrock) target indie hackers and quick launches. None offer modular backend architecture, CQRS, configurable instance roles, or first-class background job support. Baseworks targets developers building production-grade SaaS infrastructure.

**Must have (table stakes):**
- Email/password + OAuth authentication with session management
- Stripe subscription billing with webhook handling and customer portal
- Tenant isolation via tenant_id on every query with middleware enforcement
- Basic RBAC (owner/admin/member per tenant)
- Database migrations, environment config validation, structured error handling
- Type-safe API client (Eden Treaty)
- CORS configuration, health check endpoints, structured logging

**Should have (differentiators):**
- Modular architecture with configurable module loading (Medusa-style)
- CQRS command/query split baked into module system
- Configurable instance roles (API server, worker, specific module instances)
- BullMQ job processing with per-module queue declarations
- Dedicated admin dashboard (Vite SPA, not bolted onto customer app)
- Docker-first backend deployment
- Usage-based billing and multi-billing-model support

**Defer (v2+):**
- Team/org invitations (build after RBAC is solid)
- Rate limiting, file uploads, notification system (product-specific)
- i18n, analytics, SEO optimization (product-specific)
- Real-time/WebSockets (most SaaS do not need in v1)

### Architecture Approach

The architecture follows a Medusa-inspired module registry pattern where each module is a self-contained unit declaring its routes, commands, queries, jobs, and events. The registry loads modules at startup based on configuration and entrypoint (API vs worker vs all). Modules communicate through a lightweight in-process event bus, never through direct imports. All database access goes through tenant-scoped Drizzle helpers that auto-inject tenant_id, making cross-tenant data leaks structurally impossible for normal operations.

**Major components:**
1. **Module Registry** (apps/backend/core) -- discovers, validates, and loads modules at startup based on instance role configuration
2. **CQRS Layer** (per module) -- commands mutate state with validation and event emission; queries read state; both receive tenant-scoped context
3. **Tenant Middleware** (apps/backend/core) -- extracts tenant_id from session, injects into request context for all downstream handlers
4. **packages/db** -- centralized Drizzle schema, migrations, and tenant-scoped query helpers shared by all modules
5. **packages/shared-ui** -- shadcn components and Tailwind 4 preset consumed by both Next.js and Vite apps
6. **Eden Treaty client** (packages/api-client) -- typed HTTP client generated from Elysia app type, used by both frontends

### Critical Pitfalls

1. **Cross-tenant data leakage** -- Build a `scopedDb(tenantId)` wrapper before any feature code. Never allow raw `db.select()` in application code. Add integration tests that query as Tenant B and assert zero results from Tenant A.

2. **BullMQ worker_threads under Bun** -- Bun's worker_threads implementation is incomplete. Use inline processor pattern (pass functions, not file paths). Test early with 100+ jobs. Keep a Node.js fallback plan for workers.

3. **Stripe webhook non-idempotency** -- Store processed event IDs in a `stripe_events` table. Return 200 immediately after signature verification and enqueue actual processing via BullMQ. Handle all subscription lifecycle events, not just checkout.

4. **Elysia type inference explosion** -- Split into sub-apps per module (under 20 routes each). Use explicit `scoped`/`local` plugin scoping. Set `skipLibCheck: true`. Consider OpenAPI codegen as fallback if Eden Treaty types degrade.

5. **better-auth session strategy mismatch** -- Decide auth strategy per app upfront: cookies for Next.js, Bearer tokens for API and admin dashboard, no auth for workers (trusted internal processes). Test cross-app auth flows early.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation and Core Infrastructure
**Rationale:** Everything depends on the module registry, database layer, and auth. These must be proven correct before any feature modules are built. The architecture research and pitfalls research both converge on this: tenant scoping, auth strategy, and module patterns must be established first because retrofitting any of them is extremely expensive.
**Delivers:** Bun monorepo structure, packages (shared, db, shared-ui), module registry with CQRS layer, auth module (first module proving the pattern), tenant module, tenant-scoped DB helpers, docker-compose for PostgreSQL + Redis.
**Addresses:** Module registry, CQRS layer, auth (email/password, OAuth, sessions), multitenancy middleware, basic RBAC, database setup with Drizzle.
**Avoids:** Cross-tenant data leakage (by building scopedDb first), auth strategy mismatch (by deciding strategy for all apps upfront), CQRS overengineering (by documenting hard boundary -- no event sourcing), module registry becoming a God object (by limiting to three responsibilities).

### Phase 2: Billing and Background Jobs
**Rationale:** Stripe integration is complex and benefits from the stable module pattern established in Phase 1. BullMQ workers are needed for async Stripe operations (webhook processing, subscription sync). These two are tightly coupled and should be built together.
**Delivers:** Billing module (Stripe subscriptions, webhooks, customer portal), BullMQ worker infrastructure (queue setup, job registration per module, worker entrypoint), email module (transactional emails via React Email + Resend).
**Addresses:** Stripe subscription billing, webhook handling, BullMQ job processing, email sending.
**Avoids:** Non-idempotent webhooks (by building event deduplication table first), BullMQ Bun incompatibility (by validating early with inline processors), large job payloads (by enforcing IDs-only convention).

### Phase 3: Frontend Applications
**Rationale:** Frontend shells need working backend APIs (auth, tenancy, billing) to be meaningful. Eden Treaty types require a compiled Elysia app type. Building frontends after Phase 2 means both apps can demonstrate the full user journey: signup, tenant creation, billing, and dashboard.
**Delivers:** Next.js customer app (auth pages, dashboard layout, billing pages, settings), Vite admin dashboard (tenant/user/billing management, system health overview), Eden Treaty client package wired to both apps.
**Addresses:** Customer-facing app shell, admin dashboard shell, Eden Treaty integration, health check/monitoring endpoints.
**Avoids:** Eden Treaty type staleness (by using TypeScript project references), CORS misconfiguration (by setting up explicit origin allowlists from the start), admin dashboard exposed without auth (by requiring admin role middleware from day one), Tailwind content path misconfiguration (by configuring explicit per-app content paths).

### Phase 4: Production Hardening
**Rationale:** Docker setup, environment validation, and operational tooling are best done after the application architecture is stable. Building Docker configurations while the app structure is still changing creates churn.
**Delivers:** Dockerfiles for API, workers, and admin dashboard with multi-stage builds, environment configuration validation (@t3-oss/env), graceful shutdown handling (SIGTERM), CI/CD pipeline, seed data tooling.
**Addresses:** Docker setup, environment configuration, deployment topology (Vercel for Next.js + VPS/Docker for backend).
**Avoids:** Missing graceful shutdown (by handling SIGTERM in all entrypoints), missing env validation (by crashing early on missing config).

### Phase 5: Advanced Features
**Rationale:** Usage-based billing, plan gating, and onboarding flows are valuable but not essential for the starter kit to be functional. They build on top of the billing and auth infrastructure from earlier phases.
**Delivers:** Usage-based billing (metering infrastructure + Stripe usage records), plan gating / feature flags, onboarding flow for new tenants, system health dashboard in admin panel (queue depth, error rates).
**Addresses:** Usage-based billing, plan gating, onboarding flow, system health monitoring.

### Phase Ordering Rationale

- **Dependency chain drives order:** Module registry must exist before any modules. Auth must exist before tenancy. Tenancy must exist before billing. All backend APIs must exist before frontends are meaningful.
- **Architectural patterns proven early:** Phase 1 builds one complete module (auth) end-to-end through the registry + CQRS pattern. If the pattern does not work, it is discovered before 4 more modules are built on it.
- **Critical pitfalls addressed at their natural insertion point:** Tenant scoping is built in Phase 1 before any data-accessing code. Webhook idempotency is built in Phase 2 as the first piece of Stripe integration. Admin auth is required from Phase 3 day one.
- **Frontend deferred until APIs exist:** Building UI before backend APIs leads to mocked data, stale types, and rework. Phase 3 frontends connect to real, working APIs.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** better-auth + Drizzle schema integration -- newer library, multi-app session strategies are sparsely documented. Verify against current better-auth docs.
- **Phase 1:** Elysia plugin composition and scoping behavior -- verify `scoped` vs `local` vs default behavior with current Elysia version.
- **Phase 2:** BullMQ + Bun compatibility -- run hands-on validation before building job infrastructure. Have Node.js fallback plan documented.
- **Phase 2:** Stripe webhook event handling -- verify which events are needed for full subscription lifecycle with current Stripe API version.

Phases with standard patterns (skip research-phase):
- **Phase 3:** Next.js App Router, Vite + React SPA, shadcn/ui setup -- well-documented, established patterns.
- **Phase 4:** Docker multi-stage builds, environment validation -- standard devops patterns.
- **Phase 5:** Stripe usage-based billing has good Stripe documentation; plan gating is straightforward feature flag logic.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | All version numbers from May 2025 training data. Core choices (Bun, Elysia, Drizzle, better-auth) are sound but versions need verification. Elysia and better-auth are newer libraries with less battle-testing at scale. |
| Features | MEDIUM | Competitor analysis based on training data -- feature sets may have changed. Table stakes and differentiators are well-reasoned but competitor landscape could not be verified live. |
| Architecture | MEDIUM | Module registry pattern is proven (Medusa), CQRS concepts are HIGH confidence, but TypeScript-specific implementation details (Elysia plugin composition, Eden Treaty type flow) are MEDIUM due to library newness. |
| Pitfalls | MEDIUM-HIGH | Multitenancy, Stripe, and CQRS pitfalls are well-documented industry patterns (HIGH). Bun compatibility and better-auth multi-app patterns are MEDIUM due to less community experience. |

**Overall confidence:** MEDIUM

The architectural approach is sound and well-reasoned. The primary uncertainty is in library-specific integration details (Elysia scoping, better-auth multi-app, BullMQ under Bun) that can only be resolved through hands-on validation in Phase 1.

### Gaps to Address

- **Elysia version and API stability:** Elysia may have reached 1.2+ or higher by April 2026. Plugin APIs, scoping behavior, and Eden Treaty integration details need verification against current docs.
- **better-auth multi-app architecture:** Documentation on using better-auth across three different frontend/backend consumers (Next.js SSR, Vite SPA, Elysia API) is sparse. Needs hands-on validation in Phase 1.
- **BullMQ + Bun worker compatibility:** Must be validated with a practical test (100+ jobs, inline processors) before committing to this combination. Node.js fallback for workers is a viable permanent architecture if needed.
- **Tailwind 4 + shadcn/ui in monorepo:** Tailwind 4's CSS-first config and `@source` directive behavior in a Bun workspace monorepo needs validation. Was in early adoption as of May 2025.
- **Drizzle ORM version:** Was at 0.36.x in training data, may have reached 1.0. API changes could affect schema definition and query patterns.
- **@elysiajs/zod plugin existence:** Unclear if a native Zod plugin exists for Elysia. Recommended approach is TypeBox at Elysia boundary, Zod everywhere else, but this needs verification.

## Sources

### Primary (HIGH confidence)
- Bun Node.js compatibility docs (https://bun.sh/docs/runtime/nodejs-compat) -- worker_threads gaps verified
- Stripe webhook best practices (https://docs.stripe.com/webhooks/best-practices) -- idempotency patterns
- BullMQ production guide (https://docs.bullmq.io/) -- job processing patterns
- Drizzle ORM documentation (https://orm.drizzle.team) -- schema and migration patterns
- CQRS and multitenancy patterns -- well-established industry knowledge

### Secondary (MEDIUM confidence)
- Elysia documentation (https://elysiajs.com) -- plugin system, Eden Treaty, type inference behavior
- better-auth documentation (https://www.better-auth.com) -- Drizzle adapter, multi-app patterns
- Medusa.js v2 architecture -- module/service/subscriber patterns used as inspiration
- SaaS starter kit competitor analysis (ShipFast, Makerkit, Supastarter, Bedrock) -- feature landscape
- Tailwind CSS v4 (https://tailwindcss.com) -- CSS-first configuration
- shadcn/ui (https://ui.shadcn.com) -- component library patterns

### Tertiary (LOW confidence)
- Elysia type performance at scale -- based on community discussions, not production validation
- better-auth + Elysia + Next.js + Vite integration -- inferred from individual library docs, no end-to-end reference architecture found

---
*Research completed: 2026-04-05*
*Ready for roadmap: yes*
