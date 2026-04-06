# Requirements: Baseworks

**Defined:** 2026-04-05
**Core Value:** Clone, configure, and start building a multitenant SaaS in minutes — not weeks.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [ ] **FNDTN-01**: Module registry loads modules dynamically based on configuration file
- [ ] **FNDTN-02**: Each module declares its routes, commands, queries, jobs, and events in a standard format
- [ ] **FNDTN-03**: CQRS command handlers process mutations and emit domain events
- [ ] **FNDTN-04**: CQRS query handlers execute read-only operations with tenant scoping
- [x] **FNDTN-05**: Drizzle ORM connects to PostgreSQL with typed schema and migration tooling
- [ ] **FNDTN-06**: Tenant-scoped database wrapper auto-injects tenant_id filtering on all queries
- [ ] **FNDTN-07**: Instance can run as API server, worker, or specific module set via entrypoint and env config
- [x] **FNDTN-08**: Bun workspaces monorepo structure with shared packages (db, types, ui, api-client)
- [x] **FNDTN-09**: Environment variable validation at startup with typed config

### Authentication

- [ ] **AUTH-01**: User can sign up with email and password via better-auth
- [ ] **AUTH-02**: User can log in with OAuth providers (Google, GitHub)
- [ ] **AUTH-03**: User can log in via magic link (passwordless email)
- [ ] **AUTH-04**: User session persists securely via database-backed sessions
- [ ] **AUTH-05**: User can reset password via email link
- [ ] **AUTH-06**: Auth module integrates with Elysia as a better-auth plugin/handler

### Multitenancy

- [ ] **TNNT-01**: Every user belongs to at least one tenant
- [ ] **TNNT-02**: All data queries are automatically filtered by tenant_id via scoped DB wrapper
- [ ] **TNNT-03**: Tenant CRUD operations available (create, read, update, delete)
- [ ] **TNNT-04**: Basic RBAC with owner/admin/member roles per tenant
- [ ] **TNNT-05**: User can update their profile (name, email, avatar, password)

### Billing

- [ ] **BILL-01**: Tenant can subscribe to a plan via Stripe Checkout
- [ ] **BILL-02**: Tenant can change or cancel subscription
- [ ] **BILL-03**: Tenant can make one-time payments for services/products
- [ ] **BILL-04**: Usage-based billing tracks consumption per tenant and reports to Stripe
- [ ] **BILL-05**: Stripe Customer Portal accessible for self-service billing management
- [ ] **BILL-06**: Stripe webhook handler processes events with idempotency (dedup table)
- [ ] **BILL-07**: Tenant/user linked to Stripe customer on creation

### Background Jobs

- [ ] **JOBS-01**: BullMQ queue infrastructure with Redis connection management
- [ ] **JOBS-02**: Each module can register jobs with its own queue and handlers
- [ ] **JOBS-03**: Dedicated worker instance mode via `bun run worker` entrypoint
- [ ] **JOBS-04**: Transactional email sending (password reset, welcome, billing notifications)
- [ ] **JOBS-05**: Stripe webhook events processed via job queue for reliability

### Frontend — Customer App

- [ ] **CUST-01**: Next.js app with authentication pages (login, signup, magic link, password reset)
- [ ] **CUST-02**: Dashboard layout with sidebar navigation and protected routes
- [ ] **CUST-03**: Billing pages (plan selection, subscription status, upgrade/downgrade)
- [ ] **CUST-04**: Eden Treaty client wired for type-safe API calls
- [ ] **CUST-05**: Tenant context provider and switcher (if user has multiple tenants)

### Frontend — Admin Dashboard

- [ ] **ADMN-01**: Vite + React admin app with auth (admin-only access)
- [ ] **ADMN-02**: Tenant management panel (list, view, edit, deactivate tenants)
- [ ] **ADMN-03**: User management panel (list users, view details, impersonate, ban/activate)
- [ ] **ADMN-04**: Billing overview (subscription distribution, revenue, invoices)
- [ ] **ADMN-05**: System health panel (BullMQ queue depth, Redis stats, error rates)

### Shared UI

- [ ] **SHUI-01**: Shared UI package with shadcn/ui components and Tailwind 4 configuration
- [ ] **SHUI-02**: Eden Treaty client package shared across customer and admin apps

### Operations

- [ ] **OPS-01**: Dockerfiles for API server, worker process, and admin dashboard
- [ ] **OPS-02**: Docker Compose for local development (PostgreSQL, Redis, API, worker, admin)
- [ ] **OPS-03**: Health check endpoints for API and worker with dependency status
- [ ] **OPS-04**: Structured JSON logging via pino for all backend services
- [ ] **OPS-05**: Next.js app configured for Vercel deployment

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Team Management

- **TEAM-01**: Tenant owner can invite users via email to join organization
- **TEAM-02**: Invited user can accept invite and join tenant with assigned role
- **TEAM-03**: Tenant admin can remove members from organization

### Advanced Billing

- **ADVB-01**: Plan gating restricts feature access based on subscription tier
- **ADVB-02**: Onboarding flow guides new tenants through setup

### Platform

- **PLAT-01**: Rate limiting per tenant/API key
- **PLAT-02**: CI/CD pipeline configuration (GitHub Actions)
- **PLAT-03**: Seed data and one-command dev environment setup

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Landing page / marketing site | Product-specific; this is a starter kit, not a finished product |
| Blog / CMS integration | Product-specific; adds dependencies most forks will remove |
| i18n / internationalization | Adds complexity to every string; most SaaS starts English-only |
| Analytics integration | Product-specific; Plausible vs PostHog vs Mixpanel varies per project |
| Full event sourcing | Massive complexity for marginal benefit; practical CQRS only |
| Mobile app / React Native | Web-first; API is mobile-friendly if needed later |
| Real-time / WebSockets | Most SaaS don't need real-time in v1; Elysia supports it when needed |
| File uploads / S3 | Product-specific; provide as module example, not core |
| Social features | Comments, feeds, notifications are product-specific |
| AI features | Trendy but product-specific; provide module template |
| SEO optimization | Product-specific; Next.js has built-in primitives |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FNDTN-01 | Phase 1 | Pending |
| FNDTN-02 | Phase 1 | Pending |
| FNDTN-03 | Phase 1 | Pending |
| FNDTN-04 | Phase 1 | Pending |
| FNDTN-05 | Phase 1 | Complete |
| FNDTN-06 | Phase 1 | Pending |
| FNDTN-07 | Phase 1 | Pending |
| FNDTN-08 | Phase 1 | Complete |
| FNDTN-09 | Phase 1 | Complete |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 2 | Pending |
| AUTH-05 | Phase 2 | Pending |
| AUTH-06 | Phase 2 | Pending |
| TNNT-01 | Phase 2 | Pending |
| TNNT-02 | Phase 2 | Pending |
| TNNT-03 | Phase 2 | Pending |
| TNNT-04 | Phase 2 | Pending |
| TNNT-05 | Phase 2 | Pending |
| BILL-01 | Phase 3 | Pending |
| BILL-02 | Phase 3 | Pending |
| BILL-03 | Phase 3 | Pending |
| BILL-04 | Phase 3 | Pending |
| BILL-05 | Phase 3 | Pending |
| BILL-06 | Phase 3 | Pending |
| BILL-07 | Phase 3 | Pending |
| JOBS-01 | Phase 3 | Pending |
| JOBS-02 | Phase 3 | Pending |
| JOBS-03 | Phase 3 | Pending |
| JOBS-04 | Phase 3 | Pending |
| JOBS-05 | Phase 3 | Pending |
| CUST-01 | Phase 4 | Pending |
| CUST-02 | Phase 4 | Pending |
| CUST-03 | Phase 4 | Pending |
| CUST-04 | Phase 4 | Pending |
| CUST-05 | Phase 4 | Pending |
| ADMN-01 | Phase 4 | Pending |
| ADMN-02 | Phase 4 | Pending |
| ADMN-03 | Phase 4 | Pending |
| ADMN-04 | Phase 4 | Pending |
| ADMN-05 | Phase 4 | Pending |
| SHUI-01 | Phase 4 | Pending |
| SHUI-02 | Phase 4 | Pending |
| OPS-01 | Phase 5 | Pending |
| OPS-02 | Phase 5 | Pending |
| OPS-03 | Phase 5 | Pending |
| OPS-04 | Phase 5 | Pending |
| OPS-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 49 total (note: original count of 42 was incorrect; actual count from listed requirements)
- Mapped to phases: 49
- Unmapped: 0

---
*Requirements defined: 2026-04-05*
*Last updated: 2026-04-05 after roadmap creation*
