# Roadmap: Baseworks

## Overview

Baseworks delivers a production-grade SaaS starter kit monorepo in five phases. The module registry is the load-bearing wall -- it must be proven before any feature modules are built on it. Phase 1 establishes the core infrastructure (module registry, CQRS, database, monorepo structure). Phase 2 validates the architecture by building the first real modules (auth and multitenancy). Phase 3 adds billing and background job processing. Phase 4 builds both frontend applications on top of working backend APIs. Phase 5 hardens everything for production deployment.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Core Infrastructure** - Module registry, CQRS layer, database setup, monorepo structure, and environment config
- [ ] **Phase 2: Auth & Multitenancy** - First real modules proving the architecture: user authentication and tenant-scoped data isolation
- [ ] **Phase 3: Billing & Background Jobs** - Stripe integration, BullMQ worker infrastructure, and transactional email
- [ ] **Phase 4: Frontend Applications** - Next.js customer app, Vite admin dashboard, shared UI package, and Eden Treaty client
- [ ] **Phase 5: Production Hardening** - Docker deployment, structured logging, health checks, and Vercel configuration

## Phase Details

### Phase 1: Foundation & Core Infrastructure
**Goal**: A running Elysia server with a working module registry that can dynamically load modules, route commands/queries through CQRS handlers, connect to PostgreSQL via Drizzle, and scope all data access by tenant
**Depends on**: Nothing (first phase)
**Requirements**: FNDTN-01, FNDTN-02, FNDTN-03, FNDTN-04, FNDTN-05, FNDTN-06, FNDTN-07, FNDTN-08, FNDTN-09
**Success Criteria** (what must be TRUE):
  1. A module can be added to the config file and its routes, commands, and queries are automatically available at startup
  2. A command handler can process a mutation and a query handler can return tenant-scoped results through the CQRS layer
  3. Database queries through the tenant-scoped wrapper only return data belonging to the requesting tenant -- never cross-tenant data
  4. The same codebase can start as an API server or a worker by changing the entrypoint/env config
  5. The application crashes immediately on startup if required environment variables are missing or invalid
**Plans:** 3 plans

Plans:
- [ ] 01-01-PLAN.md -- Monorepo structure, shared packages, environment config, database connection
- [ ] 01-02-PLAN.md -- Module registry, CQRS bus, event bus, example module
- [ ] 01-03-PLAN.md -- Tenant scoping, dual entrypoint (API/worker), integration testing

### Phase 2: Auth & Multitenancy
**Goal**: Users can create accounts, log in through multiple methods, and operate within tenant boundaries with role-based permissions
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, TNNT-01, TNNT-02, TNNT-03, TNNT-04, TNNT-05
**Success Criteria** (what must be TRUE):
  1. A user can sign up with email/password, log in with Google/GitHub OAuth, or use a magic link -- and a database-backed session persists across requests
  2. A user can reset their forgotten password via an email link
  3. Every user belongs to a tenant, and creating/reading/updating/deleting tenants works through the module's CQRS handlers
  4. A tenant member with "member" role cannot perform admin-only actions; an "owner" can perform all actions
  5. A user can update their profile (name, email, avatar, password) within their tenant context
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD
- [ ] 02-03: TBD

### Phase 3: Billing & Background Jobs
**Goal**: Tenants can subscribe to plans, manage billing through Stripe, and asynchronous work (webhooks, emails) processes reliably through job queues
**Depends on**: Phase 2
**Requirements**: BILL-01, BILL-02, BILL-03, BILL-04, BILL-05, BILL-06, BILL-07, JOBS-01, JOBS-02, JOBS-03, JOBS-04, JOBS-05
**Success Criteria** (what must be TRUE):
  1. A tenant can subscribe to a plan via Stripe Checkout, change plans, cancel, and access the Stripe Customer Portal for self-service billing
  2. Stripe webhook events are received, verified, deduplicated via an idempotency table, and processed reliably through BullMQ jobs
  3. A module can register its own job queue and handlers, and a dedicated worker instance processes jobs via `bun run worker`
  4. Transactional emails (password reset, welcome, billing notifications) send reliably through the job queue
  5. Usage-based billing tracks tenant consumption and reports metered usage to Stripe
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Frontend Applications
**Goal**: A complete customer-facing app and admin dashboard both connected to the backend via type-safe Eden Treaty, sharing a common UI component library
**Depends on**: Phase 3
**Requirements**: CUST-01, CUST-02, CUST-03, CUST-04, CUST-05, ADMN-01, ADMN-02, ADMN-03, ADMN-04, ADMN-05, SHUI-01, SHUI-02
**Success Criteria** (what must be TRUE):
  1. A user can sign up, log in, reset password, and navigate a protected dashboard with sidebar navigation in the Next.js customer app
  2. A user can view their subscription status, select a plan, and upgrade/downgrade through billing pages in the customer app
  3. An admin can log into the admin dashboard and manage tenants (list, view, edit, deactivate) and users (list, view, impersonate, ban)
  4. Both apps make type-safe API calls via Eden Treaty with full TypeScript inference -- no manual type definitions
  5. Both apps share UI components from the shared-ui package with consistent Tailwind 4 styling
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD
- [ ] 04-03: TBD

### Phase 5: Production Hardening
**Goal**: The entire stack is deployable via Docker (backend, workers, admin) and Vercel (customer app), with structured logging, health monitoring, and validated configuration
**Depends on**: Phase 4
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05
**Success Criteria** (what must be TRUE):
  1. Running `docker compose up` starts PostgreSQL, Redis, API server, worker, and admin dashboard -- all functional for local development
  2. Health check endpoints report dependency status (database connected, Redis connected, queues healthy) for both API and worker
  3. All backend services emit structured JSON logs via pino with request tracing
  4. The Next.js customer app deploys to Vercel with zero configuration beyond environment variables
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Core Infrastructure | 0/3 | Planned | - |
| 2. Auth & Multitenancy | 0/3 | Not started | - |
| 3. Billing & Background Jobs | 0/3 | Not started | - |
| 4. Frontend Applications | 0/3 | Not started | - |
| 5. Production Hardening | 0/2 | Not started | - |
