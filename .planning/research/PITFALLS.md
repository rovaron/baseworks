# Domain Pitfalls

**Domain:** SaaS starter kit / modular backend monorepo
**Researched:** 2026-04-05
**Overall confidence:** MEDIUM-HIGH (Bun compat data verified via official docs; Stripe/CQRS/multitenancy based on established production patterns; Elysia/better-auth based on training data -- newer libraries with less community battle-testing)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or fundamental architecture problems.

### Pitfall 1: BullMQ Worker Threads Under Bun

**What goes wrong:** BullMQ uses `node:worker_threads` for sandboxed processors (when you pass a file path to `new Worker()`). Bun's `worker_threads` implementation is incomplete -- it does not support `stdin`, `stdout`, `stderr`, or `resourceLimits` options. BullMQ's sandboxed processor mode relies on worker thread features that may not work correctly or may silently degrade under Bun.

**Why it happens:** Developers assume "Bun is a Node.js drop-in" and use BullMQ's recommended sandboxed processor pattern without testing under Bun. The failure mode is often silent -- jobs may hang, crash without useful stack traces, or work in dev but fail under load.

**How to avoid:**
- Use BullMQ's inline processor pattern (pass a function directly to `worker.process()`) instead of sandboxed file-based processors.
- Run a dedicated BullMQ compatibility test early: create a worker, enqueue 100 jobs, verify all complete with correct results.
- Pin a specific BullMQ version and test it before upgrading.
- Keep a fallback plan: BullMQ workers could run on Node.js while the rest of the app runs on Bun, since workers are separate processes anyway.

**Warning signs:** Jobs stuck in "active" state indefinitely. Worker process exits without error logs. Memory usage climbs without explanation.

**Phase to address:** Phase 1 (foundation). Validate BullMQ + Bun compatibility before building any job infrastructure on top of it.

**Confidence:** MEDIUM -- Bun's worker_threads gaps are documented; BullMQ's exact behavior under these gaps needs hands-on verification.

---

### Pitfall 2: Missing Tenant Isolation in Every Query

**What goes wrong:** With shared-DB multitenancy using `tenant_id`, developers forget to scope queries in new features, background jobs, or admin endpoints. A single unscoped query leaks data across tenants. This is not a bug you find in testing -- it shows up when a customer sees another customer's data.

**Why it happens:** There is no database-level enforcement of tenant isolation. Every query, every Drizzle `select()`, every `update()`, every `delete()` must include `.where(eq(table.tenant_id, tenantId))`. Human error is inevitable. Background jobs are especially dangerous because the tenant context is not naturally present in the job execution scope.

**How to avoid:**
- Create a `scopedDb(tenantId)` wrapper that returns Drizzle query builders with tenant_id pre-applied. Make this the ONLY way application code touches the database.
- Use Drizzle's `$defaultFn` or middleware to inject tenant_id on inserts automatically.
- Build a lint rule or test helper that scans for raw `db.select()` / `db.update()` / `db.delete()` calls without tenant scoping.
- For background jobs: always include `tenantId` in the job payload and validate it exists before processing.
- For admin/superadmin endpoints: explicitly mark routes as "cross-tenant" with a decorator or middleware, so unscoped access is intentional and auditable.
- Add integration tests that create data for Tenant A, then query as Tenant B, asserting zero results.

**Warning signs:** Any direct `db.select(...)` without going through the scoped wrapper. Queries that work in dev (single tenant) but behave differently in production. Background jobs that access data without a tenantId parameter.

**Phase to address:** Phase 1 (database/ORM layer). The scoped query pattern must be established before ANY feature code is written. Retrofitting tenant scoping is extremely expensive.

**Confidence:** HIGH -- this is the most well-documented multitenancy mistake in the industry.

---

### Pitfall 3: Stripe Webhook Handler Not Idempotent

**What goes wrong:** Stripe sends webhooks at-least-once. Your handler processes the same event multiple times, resulting in duplicate subscription activations, double credit grants, or corrupted billing state. Worse: if your handler is not atomic, a partial failure + retry creates an inconsistent state (e.g., subscription activated but usage quota not set).

**Why it happens:** Developers treat webhooks like single-delivery API calls. They process the event, update the database, and assume it is done. But Stripe retries on 5xx responses, network timeouts, and slow responses (>20 seconds). A handler that takes 25 seconds will succeed AND be retried.

**How to avoid:**
- Store processed event IDs in a `stripe_events` table. Check before processing, skip if already handled.
- Make the event processing idempotent at the business logic level too -- use `INSERT ... ON CONFLICT DO NOTHING` or check current state before mutating.
- Return 200 immediately after signature verification and enqueue the actual processing as a BullMQ job. This prevents timeout-triggered retries.
- Use database transactions for multi-step operations triggered by a single webhook.
- Handle `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, and `customer.subscription.deleted` at minimum. Missing any of these creates billing state drift.

**Warning signs:** Customers reporting double charges. Subscription status out of sync between Stripe dashboard and your database. Webhook endpoint returning 5xx intermittently.

**Phase to address:** Phase 2 (billing/Stripe integration). Build the idempotent webhook processor as the first piece of Stripe integration, before any subscription logic.

**Confidence:** HIGH -- extensively documented in Stripe's own best practices documentation.

---

### Pitfall 4: Elysia Plugin Scope and Type Inference Explosion

**What goes wrong:** Elysia chains plugins using `.use()` and builds up TypeScript types through its type system. In a large application with many plugins, routes, and middleware, TypeScript compilation becomes extremely slow (30+ seconds for type-checking) and IDE autocomplete becomes unusable. Eden Treaty amplifies this because it derives client types from the entire server type.

**Why it happens:** Elysia's type system is "additive" -- each `.use()` call extends the type of the Elysia instance. With 50+ routes across multiple modules, the resulting type is deeply nested and enormous. TypeScript's structural type system struggles with these deep chains. Additionally, Elysia scoping (local vs. global plugins) can cause unexpected behavior where middleware applied in one plugin leaks into or is absent from another.

**How to avoid:**
- Split the Elysia app into sub-apps per module, each with its own typed instance. Compose them at the top level with `.use()` but keep each module's route count manageable (under 20 routes per module).
- Use Elysia's `scoped` and `local` plugin scoping explicitly -- never rely on the default. Test that auth middleware applies where expected and not where it should not.
- For Eden Treaty: generate the type from a specific sub-app or use `treaty` with explicit route groups rather than the entire app type.
- Set `"skipLibCheck": true` in tsconfig for faster builds (standard practice with Elysia).
- Consider generating an OpenAPI spec and using that for client generation as an alternative to Eden Treaty if type performance becomes unacceptable.

**Warning signs:** `tsc --noEmit` taking more than 10 seconds. IDE showing "loading..." on autocomplete for route handlers. Eden Treaty client showing `any` types or timing out during type resolution.

**Phase to address:** Phase 1 (API foundation). Establish the module-to-Elysia-instance pattern from day one. Refactoring route organization later requires changing every import.

**Confidence:** MEDIUM -- known pattern from Elysia community discussions; exact thresholds depend on project scale.

---

### Pitfall 5: CQRS Overengineering Without Event Sourcing Benefits

**What goes wrong:** Developers implement full CQRS with separate read/write models, separate databases, eventual consistency handling, and saga patterns -- when all they needed was a clean command/query separation in the code. The project scopes to "practical CQRS" but gradually adds event buses, projections, and read replicas that create massive complexity without the benefits of a true event-sourced system.

**Why it happens:** CQRS articles and tutorials almost always couple CQRS with event sourcing. Developers follow these patterns incrementally, adding "just one more thing" until they have a half-implemented event sourcing system that is harder to reason about than either a simple CRUD app or a full event-sourced system.

**How to avoid:**
- Define a hard boundary: commands mutate state and return the result. Queries read state. Both hit the SAME database. Period.
- Do NOT add an event bus between commands and queries. If a command needs to trigger side effects, use BullMQ jobs explicitly (not domain events that "might" trigger things).
- Do NOT create separate read models or projections. If you need optimized reads, create database views or materialized queries, not a separate data pipeline.
- Document the "CQRS ceiling" explicitly: when would you graduate to event sourcing? (Answer: probably never for this project's scope.)
- Keep command/query handlers as plain functions, not classes with abstract base types. A command handler is `async (input: CreateUserInput) => Promise<User>`, not `class CreateUserHandler extends CommandHandler<CreateUserInput, User>`.

**Warning signs:** A file called `EventBus.ts`. "Eventually consistent" appearing in code comments. Read models that duplicate data from the write model. Commands that publish events consumed by other commands.

**Phase to address:** Phase 1 (architecture). Define the CQRS pattern once, document the boundary, and enforce it through code review. This is a governance pitfall, not a technical one.

**Confidence:** HIGH -- extremely common pattern in projects that adopt "practical CQRS."

---

### Pitfall 6: better-auth Session/Token Strategy Mismatch Across Services

**What goes wrong:** better-auth is configured for one session strategy (e.g., cookie-based sessions for the Next.js app) but the API server, admin dashboard, and background jobs each need different auth mechanisms. The result is a Frankenstein auth system where some routes check cookies, others check Bearer tokens, some endpoints lack auth entirely, and the admin dashboard cannot authenticate against the same backend.

**Why it happens:** better-auth is designed primarily for framework-specific integrations. Using it across a split architecture (Next.js customer app + Vite admin + Elysia API + BullMQ workers) requires explicit handling of multiple auth flows. Most tutorials show single-app setups.

**How to avoid:**
- Decide auth strategy per app upfront:
  - **Next.js customer app:** Cookie-based sessions via better-auth's Next.js adapter.
  - **Elysia API:** Bearer token auth (better-auth can issue API tokens or use session tokens via header).
  - **Vite admin dashboard:** Bearer token auth (admin authenticates against Elysia API, stores token in memory/localStorage).
  - **BullMQ workers:** No auth -- workers are trusted internal processes. Validate tenant context from job payload, not from an auth token.
- Create a shared auth middleware package in the monorepo that handles token verification for Elysia routes.
- Test cross-app auth flows early: "Can the admin dashboard call a protected API endpoint?" "Can the Next.js app SSR a page that calls a protected API?"
- Do NOT try to share cookies between different domains/ports. Use token-based auth for cross-service communication.

**Warning signs:** Auth working in one app but not another. CORS errors when the admin dashboard calls the API. SSR pages showing "unauthorized" but client-side navigation works fine. Multiple better-auth instances with different configurations.

**Phase to address:** Phase 1 (auth). Establish the auth strategy for all three consumers (customer app, admin app, API) before building any protected routes.

**Confidence:** MEDIUM -- better-auth is a newer library with less community documentation on multi-app architectures.

---

## Technical Debt Patterns

Patterns that work initially but accumulate debt rapidly.

### Debt 1: Monorepo Package Boundaries That Leak

**What:** Bun workspaces make it easy to import anything from anywhere. Without discipline, packages develop circular dependencies and shared state that makes them impossible to use independently. The `@baseworks/core` package ends up importing from `@baseworks/billing` which imports from `@baseworks/core`.

**Prevention:** Enforce a strict dependency direction from day one:
```
@baseworks/shared (types, utils -- zero dependencies)
  <- @baseworks/db (Drizzle schema, scoped queries)
    <- @baseworks/core (module registry, CQRS infra)
      <- @baseworks/auth, @baseworks/billing, @baseworks/admin (feature modules)
        <- @baseworks/api (composes modules into Elysia app)
        <- @baseworks/web (Next.js customer app)
        <- @baseworks/admin-ui (Vite admin dashboard)
```
Add a simple lint check: if package A depends on package B, package B must NOT depend on package A. Bun workspaces will not enforce this for you.

**Phase to address:** Phase 1.

### Debt 2: "God Module" Registry

**What:** The Medusa-style module registry starts clean but gradually accumulates cross-cutting concerns. The registry ends up handling module loading, dependency injection, lifecycle management, configuration, health checks, and inter-module communication. It becomes a framework within a framework.

**Prevention:** The module registry does exactly three things: (1) load modules based on config, (2) register their routes/commands/queries/jobs, (3) shut them down gracefully. Everything else (DI, health checks, config) lives in separate infrastructure, not the registry.

**Phase to address:** Phase 1.

### Debt 3: Drizzle Schema Sprawl Without Migration Strategy

**What:** Drizzle schemas grow across modules but migrations are managed centrally. When module A adds a column that module B depends on, the migration ordering becomes critical. Without a migration naming convention and dependency tracking, you get migration conflicts and broken deployments.

**Prevention:** All schemas live in a single `@baseworks/db` package with a numbered migration strategy. Modules declare their schema in the db package, not in their own package. Use `drizzle-kit generate` and `drizzle-kit migrate` as the single source of truth. Never use `drizzle-kit push` in production.

**Phase to address:** Phase 1 (database layer).

---

## Integration Gotchas

### Gotcha 1: Eden Treaty + Elysia Across Monorepo Boundary

**Problem:** Eden Treaty derives its types from the Elysia app type. If the Elysia app is in `@baseworks/api` and the Next.js app is in `@baseworks/web`, TypeScript needs to resolve the full Elysia type across the workspace boundary. This can cause stale types if the API package is not rebuilt, or type errors if TypeScript versions differ between packages.

**Fix:** Export only the app type (not the app instance) from the API package: `export type App = typeof app`. Use a shared `tsconfig.base.json` with identical TypeScript settings across all packages. In development, use TypeScript project references or ensure the API package is in the `references` of the web package's tsconfig.

### Gotcha 2: Drizzle + better-auth Schema Integration

**Problem:** better-auth expects specific database tables (users, sessions, accounts, etc.) with specific column names. Drizzle schemas define tables programmatically. If the Drizzle schema does not exactly match what better-auth expects -- column names, types, nullable vs. non-nullable -- auth silently fails or produces cryptic errors.

**Fix:** Use better-auth's Drizzle adapter and let it generate the schema types. Start from better-auth's expected schema and extend it, rather than defining your own user table and trying to make better-auth use it. Add `tenant_id` to better-auth's tables as an additional column, not by replacing the table definitions.

### Gotcha 3: Stripe Customer ID Lifecycle

**Problem:** When do you create a Stripe customer? At signup? At first payment? If at signup, you create Stripe customers for users who never pay. If at first payment, you need to handle the "no Stripe customer yet" state throughout the billing UI. Worse: if a user signs up, gets a Stripe customer, then the webhook to store the customer ID fails, you have orphaned Stripe customers.

**Fix:** Create the Stripe customer synchronously during signup (not via webhook). Store the `stripe_customer_id` on the user/tenant record immediately. This costs nothing (Stripe does not charge for customer objects) and eliminates the "missing customer" edge case. Use `stripe.customers.create()` in the signup command handler, in the same transaction that creates the user record.

### Gotcha 4: Redis Connection Management (BullMQ + better-auth + Caching)

**Problem:** BullMQ needs Redis. If you also use Redis for session storage (better-auth), rate limiting, or caching, you end up with multiple Redis connection pools that are configured differently or fight for connections. BullMQ specifically recommends separate connections for Worker and Queue instances.

**Fix:** Create a centralized Redis connection factory that returns properly configured `ioredis` instances. BullMQ Workers need `maxRetriesPerRequest: null` on their Redis connection -- this is different from the default. Use separate Redis databases (db 0 for BullMQ, db 1 for sessions, db 2 for cache) or separate Redis instances in production.

### Gotcha 5: Next.js + Elysia API CORS in Development

**Problem:** Next.js runs on port 3000, Elysia runs on port 3001 (or wherever). In development, the browser blocks API requests due to CORS. Developers "fix" this by adding `Access-Control-Allow-Origin: *` and forget to restrict it in production.

**Fix:** Configure CORS in the Elysia app using `@elysiajs/cors` plugin with explicit origin allowlists. In development, allow `localhost:3000`. In production, allow only your actual domain. Set this up in the API foundation phase, not as an afterthought. For the admin dashboard (different origin again), include its origin in the allowlist.

---

## Performance Traps

### Trap 1: N+1 Queries in CQRS Query Handlers

**Problem:** CQRS query handlers often load an aggregate, then its related data, then each related item's children. Without explicit join strategies in Drizzle, each handler becomes an N+1 query factory. This is invisible in development with 5 records but catastrophic with 5,000.

**Fix:** Use Drizzle's relational query API (`db.query.users.findMany({ with: { subscriptions: true } })`) for read-heavy queries. Profile query handlers with `EXPLAIN ANALYZE` during development. Set a query count threshold in tests (e.g., a single query handler should produce no more than 3 SQL statements).

### Trap 2: BullMQ Job Serialization Overhead

**Problem:** BullMQ serializes job data to JSON and stores it in Redis. Passing large payloads (full database records, file contents, HTML templates) into jobs bloats Redis memory and slows processing.

**Fix:** Job payloads should contain only IDs and minimal context. The worker fetches full data from the database. A job payload should rarely exceed 1KB. Add a `maxSizeBytes` check in the job creation utility.

### Trap 3: Elysia Response Serialization on Large Datasets

**Problem:** Elysia's type-safe response validation runs on every response. Returning large arrays (1000+ items) through a validated endpoint adds measurable overhead because every item is type-checked at runtime.

**Fix:** Paginate all list endpoints (default page size of 20-50). For bulk data exports, skip response validation and stream directly. Set pagination as a mandatory pattern in the API design, not an optimization for later.

### Trap 4: Tailwind 4 + shadcn Build Times in Monorepo

**Problem:** Tailwind 4's new engine scans source files differently. In a monorepo with shared UI components, misconfigured content paths cause either missing styles (component styles not included) or massive CSS output (scanning all packages including backend code).

**Fix:** Configure Tailwind's content paths explicitly per app. The shared UI package should export pre-styled components; the consuming app's Tailwind config should scan both its own source and the shared package, but NOT the backend packages. Test that styles work in both the Next.js app and Vite admin dashboard independently.

---

## Security Mistakes

### Mistake 1: Tenant ID From Client Instead of Session

**Problem:** API endpoints accept `tenant_id` as a request parameter instead of deriving it from the authenticated session. An attacker changes the tenant_id in the request body and accesses another tenant's data.

**Fix:** NEVER accept tenant_id from the client. Extract it from the authenticated session/token in middleware. The tenant_id should be injected into the request context by auth middleware and used by all downstream handlers automatically. The only exception is superadmin endpoints that explicitly allow cross-tenant access.

### Mistake 2: Stripe Webhook Signature Verification Skipped in Dev

**Problem:** Developers disable Stripe webhook signature verification in development (because Stripe CLI webhook forwarding is annoying to set up). The `if (process.env.NODE_ENV !== 'production')` check ships to staging or production due to misconfigured env vars.

**Fix:** ALWAYS verify webhook signatures, including in development. Use `stripe listen --forward-to localhost:3001/webhooks/stripe` during development. The Stripe CLI handles signing automatically. If the verification code has an env-based bypass, it is a security vulnerability.

### Mistake 3: Admin Dashboard Exposed Without Auth

**Problem:** The Vite admin dashboard is deployed alongside the backend. During early development, it has no auth because "we will add it later." A search engine indexes it. A user discovers it. Admin operations are available to anyone.

**Fix:** Admin auth is a Phase 1 requirement, not a "nice to have." Even a simple shared secret / password gate is better than nothing. The admin API endpoints should require an admin role check in middleware, independent of the dashboard UI.

### Mistake 4: Module Registry Allows Arbitrary Code Loading

**Problem:** The Medusa-style module registry loads modules by path or name from configuration. If the config is influenced by environment variables or external input, an attacker could load malicious modules.

**Fix:** The module registry should have a hardcoded allowlist of valid module names. Config determines which modules from the allowlist are active, not what code gets loaded. Never `import()` a path derived from user input or unsanitized environment variables.

---

## "Looks Done But Isn't" Checklist

Things that appear to work in development but fail in production.

| Feature | Looks Done When... | Actually Done When... |
|---------|-------------------|----------------------|
| Multitenancy | Queries return correct data for test tenant | Cross-tenant leakage test passes, all queries go through scoped wrapper, background jobs scope correctly |
| Stripe subscriptions | Checkout flow works | Webhook handles all lifecycle events (create, update, cancel, payment failure, invoice paid), idempotent processing verified, subscription status syncs from Stripe (not local state) |
| Auth | Login/logout works | Session expiry handled, token refresh works, auth works across all three apps (customer, admin, API), protected routes return 401 not 500 |
| CQRS | Commands and queries execute | Command validation rejects invalid input with useful errors, queries handle empty results gracefully, error responses are consistent |
| BullMQ jobs | Jobs execute in dev | Failed jobs retry correctly, dead letter queue exists, job timeout configured, stalled job recovery works, worker graceful shutdown on SIGTERM |
| Module loading | Modules load at startup | Modules load in correct order (respecting dependencies), failing module does not crash the entire app, health check reports module status |
| Eden Treaty | Types work in IDE | Types update when API changes (no stale builds), error responses are typed correctly (not just success), large response types do not crash TypeScript |
| Docker deployment | Container starts | Graceful shutdown (SIGTERM handling), health check endpoint works, env vars are validated at startup (crash early on missing config), Redis/Postgres connections retry on failure |
| Monorepo builds | `bun run build` works | Incremental builds work, changing a shared package triggers rebuild of dependents, CI build is reproducible (lockfile committed) |

---

## Recovery Strategies

When pitfalls are hit, here is how to recover without a full rewrite.

### Recovery: Tenant Data Leaked

1. Immediately audit all database queries for missing tenant scoping.
2. Add the `scopedDb` wrapper and refactor all queries through it.
3. Write a cross-tenant data audit script that checks for records accessible to wrong tenants.
4. Notify affected tenants per your incident response policy.
5. Add the integration test suite for tenant isolation.

### Recovery: Stripe State Out of Sync

1. Do NOT try to "fix" local state manually.
2. Write a reconciliation script that fetches all subscriptions from Stripe API and updates local records to match.
3. Stripe is the source of truth -- your database is the cache.
4. Run the reconciliation on a schedule (daily cron job) as an ongoing safety net.
5. Fix the webhook handler to be idempotent, then replay missed events from Stripe dashboard.

### Recovery: TypeScript Performance Degraded (Elysia types)

1. Profile with `tsc --generateTrace`.
2. Identify which `.use()` chain is causing the type explosion.
3. Split into sub-apps with explicit type boundaries.
4. As a last resort, use `as any` at the composition boundary and maintain API client types manually or via OpenAPI codegen.

### Recovery: BullMQ Jobs Failing Silently Under Bun

1. Switch the worker process to run under Node.js (`node worker.js` instead of `bun worker.js`).
2. BullMQ workers are separate processes -- they can use a different runtime from the API server.
3. Keep the API server on Bun; run workers on Node.js.
4. This is a valid long-term architecture, not just a workaround.

---

## Pitfall-to-Phase Mapping

| Phase | Topic | Likely Pitfall | Severity | Mitigation |
|-------|-------|---------------|----------|------------|
| Phase 1 | Monorepo setup | Circular package dependencies | High | Define dependency direction, lint for violations |
| Phase 1 | Database layer | No tenant scoping pattern | Critical | Build `scopedDb` wrapper before any feature code |
| Phase 1 | Database layer | Drizzle migration conflicts across modules | Medium | Centralize schemas in `@baseworks/db` package |
| Phase 1 | Auth setup | Session strategy mismatch across apps | High | Document auth strategy per consumer before implementation |
| Phase 1 | Auth setup | better-auth schema mismatch with Drizzle | Medium | Start from better-auth's expected schema, extend it |
| Phase 1 | API foundation | Elysia plugin scope confusion | High | Use explicit `scoped`/`local` on every plugin |
| Phase 1 | API foundation | TypeScript performance with Elysia types | Medium | Split into sub-apps per module, set `skipLibCheck` |
| Phase 1 | CQRS setup | Overengineering toward event sourcing | High | Document hard boundary, no event bus, no read models |
| Phase 1 | Module registry | Registry becomes a God object | Medium | Limit to three responsibilities: load, register, shutdown |
| Phase 2 | Stripe integration | Non-idempotent webhook handlers | Critical | Build event deduplication table first |
| Phase 2 | Stripe integration | Stripe customer lifecycle mismanagement | Medium | Create Stripe customer synchronously at signup |
| Phase 2 | Stripe integration | Missing webhook event handlers | High | Handle all subscription lifecycle events, not just checkout |
| Phase 2 | Job processing | BullMQ worker_threads under Bun | High | Test early, have Node.js fallback ready |
| Phase 2 | Job processing | Large job payloads in Redis | Medium | IDs-only payload convention, max size check |
| Phase 3 | Admin dashboard | Admin routes exposed without auth | Critical | Auth middleware on all admin endpoints from day one |
| Phase 3 | Frontend integration | Eden Treaty type staleness | Medium | TypeScript project references, rebuild on API changes |
| Phase 3 | Frontend integration | CORS misconfiguration | Medium | Explicit origin allowlists, test in both dev and prod configs |
| Phase 3 | Frontend integration | Tailwind content path misconfiguration | Low | Explicit per-app content paths, visual regression tests |
| All | Redis management | Connection pool conflicts | Medium | Centralized connection factory, separate Redis databases |
| All | Deployment | Missing graceful shutdown | High | Handle SIGTERM, drain connections, complete in-flight jobs |

---

## Sources

- Bun Node.js compatibility page (https://bun.sh/docs/runtime/nodejs-compat) -- verified 2026-04-05. Key finding: `worker_threads` is partially implemented with missing `stdin/stdout/stderr/resourceLimits`. Confidence: HIGH.
- Stripe webhook best practices (https://docs.stripe.com/webhooks/best-practices) -- based on training data. Confidence: HIGH (Stripe docs are well-established and stable).
- BullMQ production guide (https://docs.bullmq.io/) -- based on training data. Confidence: HIGH.
- Elysia type system behavior -- based on training data and community patterns. Confidence: MEDIUM (library is newer, less battle-tested at scale).
- better-auth multi-app patterns -- based on training data. Confidence: MEDIUM (newer library, multi-app documentation sparse).
- Drizzle ORM patterns -- based on training data. Confidence: HIGH.
- CQRS overengineering patterns -- based on extensive industry experience documentation. Confidence: HIGH.
- Multitenancy shared-DB patterns -- based on extensive industry documentation. Confidence: HIGH.
