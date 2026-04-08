# Baseworks

## What This Is

A production-grade monorepo starter kit for SaaS and freelance projects. It provides a fully wired foundation — auth, billing, multitenancy, admin tooling, job processing — so you can fork it, configure which modules to load, and start building your product immediately. Built with Bun, Elysia, Next.js, and a Medusa-style modular backend architecture.

## Core Value

Clone, configure, and start building a multitenant SaaS in minutes — not weeks.

## Requirements

### Validated

- [x] Modular backend architecture (Medusa-style module registry with configurable loading) — Validated in Phase 1
- [x] Multitenant data isolation (shared PostgreSQL DB with tenant_id column) — Validated in Phase 2
- [x] Authentication via better-auth (email/password, OAuth providers, magic links) — Validated in Phase 2
- [x] Stripe integration (subscriptions, one-time payments, usage-based billing, customer portal) — Validated in Phase 3
- [x] CQRS command/query split with separate handlers — Validated in Phase 1
- [x] BullMQ job workers with Redis — Validated in Phase 3
- [x] Admin dashboard (Vite + React + shadcn) — tenant/user/billing management + system health — Validated in Phase 4
- [x] Customer-facing app base (Next.js + shadcn + Tailwind 4) — Validated in Phase 4
- [x] Eden Treaty for type-safe frontend-backend communication — Validated in Phase 4
- [x] Drizzle ORM with PostgreSQL — Validated in Phase 1
- [x] Bun workspaces monorepo structure — Validated in Phase 1
- [x] Configurable instance roles (API, workers, specific modules) via entrypoints + env config — Validated in Phase 1
- [x] Docker setup for backend/workers, Vercel-ready Next.js — Validated in Phase 5: Production Hardening

### Active

(All v1.0 requirements validated)

### Out of Scope

- Full event sourcing / event store — practical CQRS only, no projections or replay
- Mobile app — web-first
- tRPC — using Eden Treaty instead
- Turborepo/Nx — keeping it simple with native Bun workspaces
- Schema-per-tenant or DB-per-tenant — starting with shared DB, can migrate later
- Landing page / marketing site — this is a starter kit, not a finished product
- Team/org invites — defer to v2

## Context

This is a personal infrastructure investment. The user builds SaaS products and takes freelance projects — every new project starts from scratch, re-implementing auth, billing, multitenancy. Baseworks eliminates that bootstrap cost.

The backend draws inspiration from Medusa's module system: each module declares its routes, commands, queries, jobs, and events. A central config file determines what loads at startup. Different entrypoints (`bun run api`, `bun run worker`) control the instance role, with env vars for fine-tuning.

The frontend is split into two apps: a Next.js customer-facing app (deployable to Vercel) and a Vite + React admin dashboard (deployed alongside the backend). Both share a common UI package with shadcn components and Tailwind 4.

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
| Shared DB multitenancy with tenant_id | Simplest to start, scales well, can migrate to schema-per-tenant later if needed | — Pending |
| Medusa-style module registry | Enables configurable instances (API-only, worker-only, specific modules) without code changes | — Pending |
| Practical CQRS (command/query split) | Clean separation of concerns without event sourcing complexity | — Pending |
| Eden Treaty over tRPC/REST | Native Elysia integration, zero boilerplate, full type inference | — Pending |
| Bun workspaces over Turborepo | Minimal tooling overhead, Bun handles workspace resolution natively | — Pending |
| Vite for admin, Next.js for customer | Admin doesn't need SSR/SEO; Vite is faster for SPA. Customer app benefits from Next.js SSR | — Pending |
| Vercel + VPS split deployment | Best of both: Vercel for Next.js edge delivery, VPS/Docker for backend + workers + admin | — Pending |

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
*Last updated: 2026-04-08 after Phase 5 (Production Hardening) completion — all v1.0 milestone phases complete*
