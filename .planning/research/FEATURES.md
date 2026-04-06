# Feature Landscape

**Domain:** SaaS Starter Kit / Monorepo Boilerplate
**Researched:** 2026-04-05
**Overall Confidence:** MEDIUM (based on training data knowledge of competitors up to May 2025; could not verify against live sources)

## Competitor Feature Matrix

Before defining table stakes, here is what the major SaaS starter kits offer. This establishes what the market considers baseline.

| Feature | ShipFast | Makerkit | Saas UI | Supastarter | Bedrock | Baseworks (planned) |
|---------|----------|----------|---------|-------------|---------|---------------------|
| **Auth (email/pass)** | Yes | Yes | Yes | Yes | Yes | Yes |
| **OAuth providers** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Magic links** | No | Yes | No | Yes | No | Yes |
| **Stripe subscriptions** | Yes | Yes | Partial | Yes | Yes | Yes |
| **Usage-based billing** | No | No | No | Partial | No | Yes |
| **Customer portal** | Yes | Yes | No | Yes | No | Yes |
| **Multitenancy** | No | Yes (org) | No | Yes (org) | Yes | Yes (tenant_id) |
| **Admin dashboard** | No | Yes | No | Yes | Yes | Yes |
| **RBAC / permissions** | Basic | Yes | Yes | Yes | Yes | Planned |
| **Email sending** | Yes | Yes | No | Yes | Yes | Planned |
| **Webhooks (Stripe)** | Yes | Yes | No | Yes | Yes | Yes |
| **Landing page** | Yes | Yes | No | Yes | No | No (out of scope) |
| **SEO setup** | Yes | Yes | No | Yes | No | No (out of scope) |
| **Blog / CMS** | Yes | Yes | No | Yes | No | No (out of scope) |
| **Background jobs** | No | No | No | No | No | Yes (BullMQ) |
| **Modular architecture** | No | No | No | No | No | Yes (module registry) |
| **CQRS** | No | No | No | No | No | Yes |
| **Configurable instances** | No | No | No | No | No | Yes |
| **Type-safe API client** | No | Partial | No | Yes (tRPC) | No | Yes (Eden Treaty) |
| **Docker setup** | No | Partial | No | Partial | Yes | Yes |
| **Monorepo** | No | Yes (Turbo) | N/A | Yes (Turbo) | Yes | Yes (Bun) |
| **i18n** | No | Yes | No | Yes | No | No |
| **Analytics** | Yes | Yes | No | Yes | No | No |
| **Rate limiting** | No | No | No | No | Yes | Planned |
| **Onboarding flow** | Yes | Yes | No | Yes | No | Planned |

**Key takeaway:** Most competitors target indie hackers shipping fast (ShipFast) or small teams wanting org-based tenancy (Makerkit). None offer backend architectural patterns like CQRS, module registries, or configurable instance roles. Baseworks targets a fundamentally different user: someone building production-grade SaaS infrastructure that scales, not just a quick launch.

## Table Stakes

Features users expect from any SaaS starter kit. Missing any of these and the product feels incomplete for its target audience.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Email/password auth** | Every SaaS needs basic auth | Low | better-auth handles this well |
| **OAuth providers** | Google/GitHub/Discord login is standard | Low | better-auth plugin system supports this |
| **Session management** | Secure cookie/token sessions | Low | Built into better-auth |
| **Stripe subscription billing** | Most SaaS products are subscription-based | Medium | Plans, checkout, webhooks, portal |
| **Stripe webhook handling** | Required for billing state sync | Medium | Must handle idempotency, retries |
| **Tenant isolation** | Data must never leak between tenants | Medium | tenant_id on every query, middleware enforcement |
| **RBAC (basic roles)** | Owner/admin/member at minimum | Low | Per-tenant role assignment |
| **Database migrations** | Schema evolution without downtime | Low | Drizzle Kit handles this |
| **Environment configuration** | Dev/staging/prod config management | Low | .env files + validation |
| **Error handling** | Structured error responses, error boundaries | Low | Global error handler + frontend boundaries |
| **API request validation** | Input sanitization and type checking | Low | Elysia's built-in validation with TypeBox |
| **CORS configuration** | Cross-origin request handling | Low | Per-environment CORS setup |
| **Health check endpoints** | Monitoring and uptime verification | Low | /health endpoint for each service |
| **Logging** | Structured request/error logging | Low | JSON structured logs for production |
| **User profile management** | Update name, email, avatar, password | Low | Basic CRUD on user entity |
| **Password reset flow** | Forgot password email flow | Low | better-auth built-in |
| **Type-safe API client** | Frontend-backend type safety | Low | Eden Treaty provides this natively |

## Differentiators

Features that set Baseworks apart from competitors. Not expected, but create competitive advantage.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Modular architecture (Medusa-style)** | Load only what you need; swap modules without touching core | High | Central differentiator. No competitor does this. Module declares routes, commands, queries, jobs, events. |
| **Configurable instance roles** | Same codebase runs as API server, worker, or specific module instance | Medium | `bun run api`, `bun run worker`, env-based config. Enables horizontal scaling patterns. |
| **CQRS command/query split** | Clean separation of writes and reads; easier testing and scaling | Medium | Practical CQRS without event sourcing overhead. Commands for mutations, queries for reads. |
| **BullMQ job processing** | First-class background job support with retry, scheduling, priority | Medium | Most starter kits ignore async work entirely. Critical for emails, webhooks, reports. |
| **Usage-based billing** | Meter and bill by consumption, not just flat subscriptions | High | Very few starters support this. Requires metering infrastructure + Stripe usage records. |
| **Multi-billing model support** | Subscriptions + one-time + usage in a single system | Medium | Covers freelance projects (one-time) and SaaS (subscription) in one kit |
| **Admin dashboard (dedicated)** | Full tenant/user/billing/system management panel | Medium | Separate Vite app, not bolted onto the customer app. Clean separation. |
| **Docker-first backend** | Production-ready containerization for backend + workers | Medium | Most starters assume Vercel-only. Docker enables VPS, Kubernetes, fly.io. |
| **Monorepo with shared types** | Single repo, shared TypeScript types across frontend/backend/admin | Medium | End-to-end type safety across all packages |
| **System health monitoring** | Dashboard showing queue depth, error rates, service status | Medium | Built into admin dashboard. Most starters have zero observability. |

## Anti-Features

Features to explicitly NOT build. These either conflict with Baseworks' philosophy, are out of scope, or create maintenance burden that outweighs value.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Landing page / marketing site** | This is a starter kit, not a finished product. Landing pages are product-specific. | Document how to add one. Provide a Next.js route placeholder at most. |
| **Blog / CMS integration** | Highly product-specific. Adds dependencies (MDX, Contentlayer, headless CMS) that most forks will rip out. | Document recommended CMS options in a guide. |
| **i18n / internationalization** | Adds complexity to every string in the app. Most SaaS products start English-only. | Structure code so i18n can be added later (no hardcoded strings in shared packages). |
| **Analytics integration** | Product-specific. Plausible vs PostHog vs Mixpanel vs GA -- every project differs. | Provide event hooks where analytics can plug in. |
| **SEO optimization** | Product-specific meta tags, sitemaps, structured data vary per product. | Next.js already has good SEO primitives. Don't add boilerplate SEO. |
| **Full event sourcing** | Massive complexity for marginal benefit in most SaaS. Event stores, projections, replay -- overkill. | Practical CQRS only. Commands/queries, no event log. |
| **Mobile app / React Native** | Web-first. Mobile adds a massive surface area. | Ensure API is mobile-friendly (REST-like via Elysia). |
| **Team/org invitations** | Important but deferrable. Complex flows (invite email, accept, assign role, handle expired invites). | Defer to v2. Build RBAC in v1 so invites slot in cleanly. |
| **AI features** | Trendy but product-specific. AI chat, copilot features are not infrastructure. | Provide a module template showing how to add AI. |
| **Real-time / WebSockets** | Most SaaS don't need real-time in v1. Adds server complexity (sticky sessions, Redis pub/sub). | Elysia supports WebSockets. Document how to add if needed. |
| **File uploads / S3** | Product-specific. Some need it, many don't. | Provide a module example. Don't bake it into core. |
| **Social features** | Comments, feeds, notifications -- too product-specific. | Notification system could be a separate module later. |

## Feature Dependencies

```
Auth (email/pass, OAuth, sessions)
  |
  +---> Tenant Creation (every user belongs to a tenant)
  |       |
  |       +---> RBAC (roles scoped to tenant)
  |       |
  |       +---> Tenant Isolation Middleware (tenant_id enforcement)
  |               |
  |               +---> All Data Queries (filtered by tenant_id)
  |
  +---> Stripe Customer Creation (user/tenant linked to Stripe)
          |
          +---> Subscription Management
          |       |
          |       +---> Plan Gating (feature access based on plan)
          |       |
          |       +---> Usage Metering (track consumption per tenant)
          |
          +---> Webhook Handling (Stripe event sync)
          |
          +---> Customer Portal (manage billing)

Module Registry (core infrastructure)
  |
  +---> Module Loading (route/handler/job registration)
  |       |
  |       +---> Instance Roles (API vs worker vs specific module)
  |
  +---> CQRS Layer (commands + queries per module)
  |
  +---> Job Workers (BullMQ queues per module)

Database Schema + Drizzle
  |
  +---> Migrations
  |
  +---> Tenant-scoped query helpers
  |
  +---> Seed data (dev environment)

Admin Dashboard
  |
  +---> Requires: Auth (admin role), All backend APIs
  +---> Tenant management (CRUD tenants)
  +---> User management (CRUD users across tenants)
  +---> Billing overview (plan distribution, revenue)
  +---> System health (queue status, error rates)
```

**Critical path:** Module Registry -> Auth -> Multitenancy -> Billing -> Admin Dashboard

The module registry must exist first because auth, billing, and admin are all modules. Auth comes before multitenancy because tenants need users. Billing depends on both auth and tenancy. Admin dashboard consumes everything.

## MVP Recommendation

### Must Have (Phase 1-2)

Prioritize in this order:

1. **Module registry + loader** -- foundation everything else builds on
2. **CQRS command/query layer** -- standardizes how modules handle business logic
3. **Database setup (Drizzle + PostgreSQL)** -- schema, migrations, tenant-scoped helpers
4. **Auth module (better-auth)** -- email/password, OAuth, sessions
5. **Multitenancy middleware** -- tenant_id enforcement on all queries
6. **Basic RBAC** -- owner/admin/member roles per tenant
7. **Stripe billing module** -- subscriptions, webhook handling, customer portal
8. **BullMQ job worker infrastructure** -- queue setup, job registration per module
9. **Eden Treaty client package** -- type-safe frontend calls

### Should Have (Phase 3)

10. **Customer-facing app shell** (Next.js) -- auth pages, dashboard layout, billing pages
11. **Admin dashboard shell** (Vite) -- tenant/user/billing management
12. **Health check + monitoring endpoints**
13. **Email sending (transactional)** -- password reset, welcome, billing notifications
14. **Environment configuration validation**
15. **Docker setup** -- Dockerfile for API, workers, admin

### Could Have (Phase 4+)

16. **Usage-based billing** -- metering infrastructure
17. **Plan gating / feature flags** -- restrict access by subscription tier
18. **Onboarding flow** -- guided setup for new tenants
19. **System health dashboard** -- queue depth, error rates in admin panel
20. **Seed data / dev tooling** -- one-command dev environment setup

### Defer

- Team invitations (v2 -- after RBAC is solid)
- Rate limiting (add when needed)
- File uploads module (product-specific)
- Notification system (product-specific)

## Feature Prioritization Matrix

| Feature | User Value | Technical Risk | Dependency Weight | Priority |
|---------|-----------|---------------|-------------------|----------|
| Module registry | High | High | Critical (blocks everything) | P0 |
| CQRS layer | Medium | Medium | High (standardizes all modules) | P0 |
| Auth (better-auth) | High | Low | High (blocks tenancy, billing) | P0 |
| Database + Drizzle | High | Low | Critical (blocks all data) | P0 |
| Multitenancy middleware | High | Medium | High (blocks data isolation) | P0 |
| Stripe billing | High | Medium | Medium (blocks monetization) | P1 |
| BullMQ workers | Medium | Medium | Medium (blocks async work) | P1 |
| Basic RBAC | Medium | Low | Medium (blocks admin) | P1 |
| Eden Treaty client | Medium | Low | Low | P1 |
| Customer app shell | High | Low | Low (needs auth, billing APIs) | P2 |
| Admin dashboard | Medium | Medium | Low (needs all APIs) | P2 |
| Email sending | Medium | Low | Low | P2 |
| Docker setup | Medium | Low | Low | P2 |
| Usage-based billing | Low | High | Low | P3 |
| Plan gating | Medium | Medium | Low | P3 |
| Health monitoring | Low | Low | Low | P3 |

## Competitor Deep Analysis

### ShipFast (shipfa.st)
**Target:** Solo founders shipping in a weekend. "Don't waste time on boilerplate."
**Strengths:** Excellent onboarding, landing page templates, SEO setup, Stripe integration. Very polished DX.
**Weaknesses:** No multitenancy. No admin panel. No background jobs. No modular architecture. Monolithic Next.js. No Docker. Essentially a "pretty MVP template" not a production foundation.
**Price:** ~$199 one-time.
**Lesson for Baseworks:** ShipFast proves landing pages and SEO templates drive indie hacker purchases. Baseworks deliberately skips this market -- our user already knows what they're building and needs infrastructure, not templates.

### Makerkit (makerkit.dev)
**Target:** Small teams building multi-org SaaS. More serious than ShipFast.
**Strengths:** Organization-based multitenancy, RBAC, Stripe + Lemon Squeezy, i18n, good documentation, Turborepo monorepo.
**Weaknesses:** No background jobs. No CQRS. No configurable instances. Turborepo adds tooling complexity. Frontend-heavy (most logic in Next.js API routes).
**Price:** $299-$999 depending on kit variant.
**Lesson for Baseworks:** Makerkit shows org-based tenancy is valued. But their backend is thin -- API routes in Next.js, no dedicated backend service. Baseworks' dedicated Elysia backend with module system is a clear differentiator.

### Saas UI (saas-ui.dev)
**Target:** Developers who want pre-built React components for SaaS UIs.
**Strengths:** Excellent component library (auth forms, data tables, billing UI, onboarding). Built on Chakra UI.
**Weaknesses:** Not a full starter kit -- it's a component library. No backend. No billing integration. No auth backend. You bring your own everything.
**Price:** $299-$999 for pro components.
**Lesson for Baseworks:** Saas UI shows there's demand for polished SaaS-specific UI components. Baseworks uses shadcn instead, which covers most of these patterns. Don't try to compete on component richness -- compete on backend infrastructure.

### Supastarter (supastarter.dev)
**Target:** Supabase-native teams wanting a full-stack starter.
**Strengths:** Deep Supabase integration (auth, DB, storage, realtime), Turborepo, tRPC, i18n, good admin panel, multiple frontend framework support.
**Weaknesses:** Locked to Supabase ecosystem. No background jobs (relies on Supabase Edge Functions). No modular architecture. If you outgrow Supabase, you outgrow the starter.
**Price:** $299-$799.
**Lesson for Baseworks:** Supastarter shows the appeal of deep ecosystem integration (everything works together). But Supabase lock-in is a real risk. Baseworks' approach (PostgreSQL + BullMQ + Redis directly) gives more control.

### Bedrock (bedrock.computer)
**Target:** Production-focused teams wanting a battle-tested foundation.
**Strengths:** Docker-first, good multitenancy, admin panel, background jobs (Bull), more production-oriented than most.
**Weaknesses:** Older patterns, less modern DX, smaller community.
**Lesson for Baseworks:** Bedrock is the closest competitor philosophically. But it lacks modular architecture, CQRS, and configurable instances. Baseworks is "Bedrock but with Medusa-style modularity."

## Where Baseworks Uniquely Wins

1. **Modular architecture with configurable loading** -- no competitor offers this. You can run just the billing module, or just workers, or the full API. This is how Medusa works and it's proven at scale.

2. **CQRS as a first-class pattern** -- command/query split baked into the module system. Every module follows the same pattern. This creates consistency across any product built on Baseworks.

3. **Background job infrastructure** -- BullMQ with Redis, job declaration per module, separate worker instances. Most starters pretend async work doesn't exist.

4. **Multi-deployment topology** -- Vercel for Next.js frontend, Docker for backend/workers/admin. This is how production SaaS actually deploys. Most starters assume everything runs on one platform.

5. **Backend-first architecture** -- dedicated Elysia API server, not "Next.js API routes pretending to be a backend." This scales, this deploys independently, this can serve mobile clients too.

## Sources

- Training data knowledge of ShipFast, Makerkit, Saas UI, Supastarter, Bedrock (up to May 2025)
- Medusa.js architecture patterns (Context7 knowledge)
- SaaS industry patterns from building and evaluating multiple production SaaS products
- **Confidence note:** All competitor feature data is from training data and could not be verified against live sources. Feature sets may have changed since May 2025. Mark as MEDIUM confidence overall.
