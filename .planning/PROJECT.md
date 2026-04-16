# Baseworks

## What This Is

A production-grade monorepo starter kit for SaaS and freelance projects. Provides a fully wired foundation — modular backend with CQRS, authentication, billing, multitenancy, admin tooling, job processing, and dual frontend apps — so you can fork it, configure which modules to load, and start building your product immediately. Built with Bun, Elysia, Next.js, and a Medusa-style modular backend architecture.

## Core Value

Clone, configure, and start building a multitenant SaaS in minutes — not weeks.

## Current Milestone: v1.2 Documentation & Quality

**Goal:** Annotate the entire codebase with comprehensive JSDoc, increase test coverage with high-quality unit tests, and create in-repo developer documentation covering configuration, testing, and third-party integrations.

**Target features:**
- Comprehensive JSDoc annotations across all source files (backend, frontend, shared packages)
- High-quality unit tests increasing coverage across the full stack
- In-repo developer documentation: configuration guides, testing guides, third-party integration docs

## Current State

**Shipped:** v1.1 Polish & Extensibility (2026-04-16)
**Codebase:** ~16K lines TypeScript across apps/packages
**Tech stack:** Bun + Elysia + Drizzle + PostgreSQL + BullMQ + Redis + Next.js 15 + Vite + React 19 + shadcn/ui + Tailwind 4 + better-auth + Stripe + Pagar.me + Docker + pino + next-intl + react-i18next

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

### Active

- [ ] Comprehensive JSDoc annotations across all source files
- [ ] High-quality unit tests increasing coverage across the full stack
- [ ] In-repo developer documentation (configuration, testing, third-party integrations)

### Out of Scope

- Full event sourcing / event store — practical CQRS only, no projections or replay
- Mobile app — web-first
- tRPC — using Eden Treaty instead
- Turborepo/Nx — keeping it simple with native Bun workspaces
- Schema-per-tenant or DB-per-tenant — starting with shared DB, can migrate later
- Landing page / marketing site — this is a starter kit, not a finished product
- Real-time / WebSockets — Elysia supports it when needed later
- Locale-based URL routing, language switcher UI, backend i18n — deferred to v1.2
- Configurable invite expiration with auto-cleanup — deferred to v1.2

## Context

This is a personal infrastructure investment. The user builds SaaS products and takes freelance projects — every new project starts from scratch, re-implementing auth, billing, multitenancy. Baseworks eliminates that bootstrap cost.

The backend draws inspiration from Medusa's module system: each module declares its routes, commands, queries, jobs, and events. A central config file determines what loads at startup. Different entrypoints (`bun run api`, `bun run worker`) control the instance role, with env vars for fine-tuning.

The frontend is split into two apps: a Next.js customer-facing app (deployable to Vercel) and a Vite + React admin dashboard (deployed alongside the backend via Docker). Both share a common UI package with shadcn components and Tailwind 4.

v1.0 shipped in 3 days (2026-04-05 to 2026-04-08) across 116 commits and 5 phases (15 plans). All 49 v1 requirements validated.

v1.1 shipped in 6 days (2026-04-08 to 2026-04-14) across 157 commits and 7 phases (24 plans). All 26 v1.1 requirements validated. Added +6,565 lines across 117 files.

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
*Last updated: 2026-04-16 after v1.2 milestone started — Documentation & Quality*
