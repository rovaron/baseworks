# Baseworks

## What This Is

A production-grade monorepo starter kit for SaaS and freelance projects. Provides a fully wired foundation — modular backend with CQRS, authentication, billing, multitenancy, admin tooling, job processing, and dual frontend apps — so you can fork it, configure which modules to load, and start building your product immediately. Built with Bun, Elysia, Next.js, and a Medusa-style modular backend architecture.

## Core Value

Clone, configure, and start building a multitenant SaaS in minutes — not weeks.

## Current State

**Shipped:** v1.0 MVP (2026-04-08)
**Codebase:** ~92K lines TypeScript across 428 files
**Tech stack:** Bun + Elysia + Drizzle + PostgreSQL + BullMQ + Redis + Next.js 15 + Vite + React 19 + shadcn/ui + Tailwind 4 + better-auth + Stripe + Docker + pino

**What's working:**
- Config-driven module registry loads modules, routes commands/queries through CQRS, emits domain events
- Tenant-scoped database wrapper with automatic tenant_id filtering on all queries
- Full auth: email/password, OAuth (Google/GitHub), magic links, password reset, RBAC
- Provider-agnostic billing: PaymentProvider port interface with Stripe and Pagar.me adapters, webhook normalization, env-based provider selection with startup validation
- BullMQ workers with per-module job queues, transactional email via Resend + React Email
- Next.js customer app with auth pages, billing management, tenant switching
- Vite admin dashboard with tenant/user management, billing overview, system health
- Eden Treaty type-safe API client shared across both frontends
- 18 shadcn components in shared UI package with Tailwind 4
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

### Active

- [ ] Fully responsive layouts (mobile/tablet/desktop) for both frontends; fix sidebar overlay
- [ ] Accessibility (a11y) — keyboard nav, screen reader support, semantic HTML, ARIA (gap closure v1.1 — A11Y-01 invite page h1 and A11Y-04/05 InviteDialog Form primitives validated in Phase 11)
- [ ] i18n infrastructure + pt-BR and en translations for both frontends
- [ ] Team/org invites — invite-by-email, role assignment, invite links, accept/decline, expiration
- [ ] Payment provider abstraction — port interface, Stripe adapter, one Brazilian provider adapter

## Current Milestone: v1.1 Polish & Extensibility

**Goal:** Make the starter kit production-ready for real users — responsive frontends, internationalized, accessible, with team collaboration and vendor-agnostic payments.

**Target features:**
- Fully responsive layouts for both frontends + sidebar fix
- Accessibility (a11y) across both frontends
- i18n infrastructure with pt-BR and en
- Team/org invites with role assignment and invite links
- Payment provider abstraction with Stripe + Brazilian provider adapters

### Out of Scope

- Full event sourcing / event store — practical CQRS only, no projections or replay
- Mobile app — web-first
- tRPC — using Eden Treaty instead
- Turborepo/Nx — keeping it simple with native Bun workspaces
- Schema-per-tenant or DB-per-tenant — starting with shared DB, can migrate later
- Landing page / marketing site — this is a starter kit, not a finished product
- ~~Team/org invites~~ — moved to v1.1 Active
- ~~i18n / internationalization~~ — moved to v1.1 Active
- Real-time / WebSockets — Elysia supports it when needed later

## Context

This is a personal infrastructure investment. The user builds SaaS products and takes freelance projects — every new project starts from scratch, re-implementing auth, billing, multitenancy. Baseworks eliminates that bootstrap cost.

The backend draws inspiration from Medusa's module system: each module declares its routes, commands, queries, jobs, and events. A central config file determines what loads at startup. Different entrypoints (`bun run api`, `bun run worker`) control the instance role, with env vars for fine-tuning.

The frontend is split into two apps: a Next.js customer-facing app (deployable to Vercel) and a Vite + React admin dashboard (deployed alongside the backend via Docker). Both share a common UI package with shadcn components and Tailwind 4.

v1.0 shipped in 3 days (2026-04-05 to 2026-04-08) across 116 commits and 5 phases (15 plans). All 49 v1 requirements validated.

## Constraints

- **Runtime**: Bun — all packages must be Bun-compatible
- **ORM**: Drizzle — no Prisma, no raw SQL for application code
- **Auth**: better-auth — not NextAuth, not custom
- **Payments**: Stripe only — no other payment providers
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
*Last updated: 2026-04-13 after Phase 11 (A11Y Gap Closure) complete — invite page h1 hierarchy and InviteDialog Form primitive refactor closed A11Y-01/A11Y-04/A11Y-05 audit gaps, verified via Chrome DevTools MCP live-DOM checks*
