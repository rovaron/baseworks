# Architecture Patterns

**Domain:** Modular SaaS Starter Kit / Monorepo Boilerplate
**Researched:** 2026-04-05
**Confidence:** MEDIUM (based on training data for Medusa v2, Elysia, Bun workspaces; web verification unavailable)

## Standard Architecture — System Overview

```
                         +------------------+
                         |   Vercel Edge    |
                         | (Next.js SSR)    |
                         |  apps/customer   |
                         +--------+---------+
                                  |
                          Eden Treaty (typed HTTP)
                                  |
+------------------+     +--------v---------+     +------------------+
|  Admin Dashboard |     |                  |     |    PostgreSQL     |
|  (Vite + React)  +---->+  Elysia Backend  +---->+   (shared DB,    |
|   apps/admin     |     |  apps/backend    |     |   tenant_id)     |
+------------------+     +---+---------+----+     +------------------+
       Eden Treaty            |         |
                              |    Module Registry
                              |    loads modules
                              |         |
                         +----v----+    |
                         | Redis   |    |
                         | (cache  |    |
                         | + queue)|    |
                         +----+----+    |
                              |         |
                         +----v---------v----+
                         |   BullMQ Workers  |
                         |   apps/backend    |
                         |   (worker entry)  |
                         +-------------------+
```

### Instance Roles (Same Codebase, Different Entrypoints)

```
apps/backend/
  src/
    entrypoints/
      api.ts        -->  bun run api      (loads HTTP routes + middleware)
      worker.ts     -->  bun run worker   (loads job processors only)
      all.ts        -->  bun run dev      (loads everything, for local dev)
```

Each entrypoint imports the module registry and requests specific capabilities. The module registry determines what gets loaded based on the entrypoint request plus environment variables.

## Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **apps/customer** (Next.js) | Customer-facing UI, SSR pages, auth flows, billing portal | Backend via Eden Treaty |
| **apps/admin** (Vite+React) | Internal dashboard, tenant/user/billing mgmt, system health | Backend via Eden Treaty |
| **apps/backend** (Elysia) | API routes, business logic, module orchestration, auth | PostgreSQL via Drizzle, Redis, BullMQ |
| **packages/shared-ui** | shadcn components, Tailwind 4 config, shared design tokens | Consumed by customer + admin |
| **packages/db** | Drizzle schema, migrations, tenant-scoped query helpers | Consumed by backend |
| **packages/shared** | TypeScript types, constants, validation schemas (Zod/TypeBox), Eden Treaty contract | Consumed by all apps |
| **Module Registry** (within backend) | Discovers, validates, and loads modules at startup | All backend modules |
| **BullMQ Workers** | Async job processing (emails, webhooks, billing sync) | Redis queue, PostgreSQL |

## Recommended Project Structure

```
baseworks/
  package.json                    # Bun workspace root
  bunfig.toml                     # Bun configuration
  docker-compose.yml              # PostgreSQL + Redis for local dev
  drizzle.config.ts               # Drizzle Kit config (at root, points to packages/db)
  turbo.json                      # NOT USED — Bun workspaces only

  apps/
    backend/
      package.json
      Dockerfile
      src/
        entrypoints/
          api.ts                  # HTTP server entrypoint
          worker.ts               # Job worker entrypoint
          all.ts                  # Dev: loads everything
        core/
          registry.ts             # Module registry — discovers + loads modules
          container.ts            # Lightweight DI container for services
          middleware/
            tenant.ts             # Extracts tenant_id, attaches to context
            auth.ts               # better-auth session middleware
            error.ts              # Centralized error handling
        modules/
          auth/
            index.ts              # Module definition (routes, commands, queries, jobs)
            routes.ts             # Elysia route group
            commands/
              register.cmd.ts
              login.cmd.ts
            queries/
              me.query.ts
              users.query.ts
            jobs/
              send-verification.job.ts
            events.ts             # Event declarations this module emits
          billing/
            index.ts
            routes.ts
            commands/
              create-subscription.cmd.ts
              cancel-subscription.cmd.ts
            queries/
              subscription.query.ts
              invoices.query.ts
            jobs/
              sync-stripe.job.ts
              send-invoice.job.ts
            webhooks/
              stripe.webhook.ts
            events.ts
          tenant/
            index.ts
            routes.ts
            commands/
              create-tenant.cmd.ts
              update-tenant.cmd.ts
            queries/
              tenant.query.ts
              tenants.query.ts
            jobs/
              provision-tenant.job.ts
            events.ts
          notification/
            index.ts
            routes.ts
            commands/
              send-email.cmd.ts
            jobs/
              deliver-email.job.ts
              deliver-webhook.job.ts
        lib/
          bullmq.ts               # Queue setup, worker factory
          redis.ts                # Redis connection singleton
          stripe.ts               # Stripe client setup
          logger.ts               # Structured logging (pino or similar)

    customer/
      package.json
      next.config.ts
      src/
        app/                      # Next.js App Router
          (auth)/
            login/page.tsx
            register/page.tsx
          (dashboard)/
            layout.tsx            # Authenticated layout with tenant context
            page.tsx
            settings/page.tsx
            billing/page.tsx
          api/
            auth/[...all]/route.ts  # better-auth API routes (if needed client-side)
        lib/
          api.ts                  # Eden Treaty client instance
          auth.ts                 # better-auth client helpers
        components/               # App-specific components (not shared)

    admin/
      package.json
      vite.config.ts
      src/
        main.tsx
        routes/                   # File-based or manual routing (TanStack Router)
          tenants/
          users/
          billing/
          system/
        lib/
          api.ts                  # Eden Treaty client instance
        components/               # Admin-specific components

  packages/
    db/
      package.json
      src/
        index.ts                  # Re-exports schema + helpers
        schema/
          tenant.ts               # Tenants table
          user.ts                 # Users table (with tenant_id)
          billing.ts              # Subscriptions, invoices
          auth.ts                 # better-auth required tables
        helpers/
          tenant-scope.ts         # Drizzle query wrapper that auto-filters by tenant_id
          pagination.ts           # Cursor/offset pagination helpers
        migrations/               # Drizzle Kit generated migrations

    shared/
      package.json
      src/
        index.ts
        types/
          api.ts                  # Shared API types (if needed beyond Eden inference)
          tenant.ts               # Tenant-related types
          billing.ts              # Billing-related types
        constants/
          plans.ts                # Subscription plan definitions
          permissions.ts          # Role/permission constants
        validation/
          auth.ts                 # Shared validation schemas
          tenant.ts

    shared-ui/
      package.json
      src/
        index.ts
        components/
          ui/                     # shadcn/ui components (Button, Card, etc.)
          composed/               # Higher-level composed components
            data-table.tsx
            form-field.tsx
            stat-card.tsx
        tailwind/
          preset.ts               # Shared Tailwind 4 preset
        lib/
          utils.ts                # cn() and other UI utilities
```

## Architectural Patterns

### Pattern 1: Module Registry (Medusa-Inspired)

Each module is a self-contained unit that declares its capabilities. The registry loads modules at startup based on configuration.

**Module Definition Contract:**

```typescript
// modules/auth/index.ts
import type { ModuleDefinition } from "../../core/registry";

export default {
  name: "auth",
  dependencies: [],  // other module names this depends on
  routes: () => import("./routes"),
  commands: {
    "auth:register": () => import("./commands/register.cmd"),
    "auth:login": () => import("./commands/login.cmd"),
  },
  queries: {
    "auth:me": () => import("./queries/me.query"),
    "auth:users": () => import("./queries/users.query"),
  },
  jobs: {
    "auth:send-verification": () => import("./jobs/send-verification.job"),
  },
  events: ["auth:user-created", "auth:user-verified"],
} satisfies ModuleDefinition;
```

**Registry Implementation:**

```typescript
// core/registry.ts
type InstanceRole = "api" | "worker" | "all";

interface RegistryConfig {
  role: InstanceRole;
  modules: string[];           // which modules to load (or "*" for all)
  exclude?: string[];          // modules to skip
}

class ModuleRegistry {
  private modules = new Map<string, LoadedModule>();
  private commands = new Map<string, CommandHandler>();
  private queries = new Map<string, QueryHandler>();
  private jobs = new Map<string, JobProcessor>();
  private eventBus: EventBus;

  async load(config: RegistryConfig): Promise<void> {
    // 1. Discover all module definitions from modules/ directory
    // 2. Filter based on config.modules and config.exclude
    // 3. Topologically sort by dependencies
    // 4. For each module:
    //    - If role includes "api": load routes, commands, queries
    //    - If role includes "worker": load jobs
    //    - Register event listeners
    // 5. Validate no missing dependencies
  }

  execute<T>(command: string, payload: unknown): Promise<T> {
    // Look up command handler, execute with DI container context
  }

  query<T>(queryName: string, params: unknown): Promise<T> {
    // Look up query handler, execute read-only
  }

  dispatch(event: string, data: unknown): void {
    // Publish to in-process event bus (NOT event sourcing)
    // Other modules can subscribe to react to domain events
  }
}
```

**Why this pattern:** It provides configurable loading (run only billing module on one instance, all modules on another), clear module boundaries, and a standardized way for modules to declare and discover each other's capabilities. Unlike Medusa's full DI container, this is lighter-weight -- use explicit imports and a thin container rather than a heavy IoC framework.

### Pattern 2: CQRS Command/Query Split (Practical)

Commands mutate state. Queries read state. They have different interfaces and different execution characteristics.

```typescript
// Core command interface
interface Command<TInput, TOutput> {
  name: string;
  schema: TSchema;  // TypeBox or Zod validation schema
  execute(input: TInput, ctx: CommandContext): Promise<TOutput>;
}

// Core query interface
interface Query<TParams, TResult> {
  name: string;
  schema: TSchema;
  execute(params: TParams, ctx: QueryContext): Promise<TResult>;
}

// Context carries tenant_id, user, db connection
interface CommandContext {
  tenantId: string;
  userId: string;
  db: DrizzleInstance;
  emit: (event: string, data: unknown) => void;
  enqueue: (job: string, data: unknown) => Promise<void>;
}

interface QueryContext {
  tenantId: string;
  userId: string;
  db: DrizzleInstance;  // Could be a read replica in future
}
```

**Why this pattern:** Commands and queries have fundamentally different needs. Commands need validation, authorization, event emission, and potentially job enqueuing. Queries just need to read data efficiently. Separating them makes each simpler and opens the door to read replicas later without changing application code.

### Pattern 3: Tenant-Scoped Database Access

Every database query must be scoped to a tenant. This is enforced at the infrastructure level, not left to individual developers.

```typescript
// packages/db/src/helpers/tenant-scope.ts
export function withTenant(db: DrizzleInstance, tenantId: string) {
  return {
    select: <T extends PgTable>(table: T) =>
      db.select().from(table).where(eq(table.tenantId, tenantId)),
    insert: <T extends PgTable>(table: T) => ({
      values: (data: Omit<InferInsert<T>, "tenantId">) =>
        db.insert(table).values({ ...data, tenantId }),
    }),
    // ... update, delete with automatic tenant_id filtering
  };
}
```

**Why this pattern:** Forgetting a `WHERE tenant_id = ?` clause is the most dangerous bug in shared-DB multitenancy. Wrapping Drizzle's query builder to auto-inject tenant_id makes cross-tenant data leaks structurally impossible for normal operations. Admin/system queries that span tenants use a separate, clearly-marked helper.

### Pattern 4: Elysia Plugin Composition for Module Routes

Each module exposes its routes as an Elysia plugin (group). The API entrypoint composes them.

```typescript
// modules/auth/routes.ts
import { Elysia } from "elysia";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .post("/register", async ({ body, store }) => {
    return store.registry.execute("auth:register", body);
  })
  .post("/login", async ({ body, store }) => {
    return store.registry.execute("auth:login", body);
  })
  .get("/me", async ({ store }) => {
    return store.registry.query("auth:me", {});
  });

// entrypoints/api.ts
import { Elysia } from "elysia";

const app = new Elysia()
  .use(tenantMiddleware)
  .use(authMiddleware)
  .use(errorMiddleware);

// Registry loads and attaches route plugins dynamically
await registry.load({ role: "api", modules: ["*"] });
for (const mod of registry.getLoadedModules()) {
  if (mod.routes) app.use(await mod.routes());
}

app.listen(3000);
```

**Why this pattern:** Elysia's plugin system naturally supports this. Each module's routes are an isolated Elysia instance with its own prefix, validation, and middleware. The API entrypoint just `.use()`s them. Eden Treaty then infers the full combined type for frontend clients.

### Pattern 5: Event Bus for Cross-Module Communication

Modules should not directly call each other's internals. Instead, they communicate through a lightweight in-process event bus.

```typescript
// When auth module creates a user:
ctx.emit("auth:user-created", { userId, tenantId, email });

// Billing module subscribes:
eventBus.on("auth:user-created", async (data) => {
  await registry.execute("billing:create-customer", {
    tenantId: data.tenantId,
    userId: data.userId,
  });
});

// Notification module also subscribes:
eventBus.on("auth:user-created", async (data) => {
  await registry.execute("notification:send-email", {
    template: "welcome",
    to: data.email,
  });
});
```

**Why this pattern:** Direct module-to-module calls create tight coupling and make modules non-optional. With events, the auth module does not need to know that billing or notification modules exist. If billing is not loaded, the event is simply not handled. This is critical for the "configurable modules" goal.

## Data Flow

### Request Lifecycle (API)

```
1. HTTP Request arrives at Elysia
2. Error middleware wraps the handler
3. Tenant middleware extracts tenant_id from:
   - JWT claim (after auth)
   - Subdomain (customer app)
   - Header (admin app with super-admin context)
4. Auth middleware validates session via better-auth
5. Route handler receives typed request
6. Handler calls registry.execute() or registry.query()
7. Command/Query handler receives tenant-scoped context
8. Handler uses withTenant(db, tenantId) for all DB access
9. Commands may emit events and/or enqueue jobs
10. Response returns through Elysia (auto-serialized, typed)
11. Eden Treaty on frontend receives fully-typed response
```

### Job Processing Flow

```
1. Command handler calls ctx.enqueue("billing:sync-stripe", data)
2. BullMQ adds job to Redis queue
3. Worker entrypoint picks up job
4. Worker looks up job processor from registry
5. Job processor executes with its own tenant-scoped context
6. Job may emit events or enqueue follow-up jobs
7. Job result stored in Redis (success/failure/retry)
```

### Authentication Flow (better-auth)

```
Customer App:
1. User submits credentials to /api/auth/* (Next.js route handler proxies to backend)
   OR directly to backend auth routes
2. better-auth validates, creates session
3. Session token returned as HTTP-only cookie
4. Subsequent requests include cookie
5. Tenant middleware resolves tenant from user's association

Admin App:
1. Admin logs in through backend /auth/admin/*
2. better-auth validates admin credentials
3. Admin session includes role + accessible tenants
4. Admin can impersonate tenant context for management
```

### Eden Treaty Type Flow

```
Backend (Elysia):
  Module routes define request/response types via Elysia schema
  -> Elysia compiles to single typed App instance
  -> Type exported from backend package

Frontend (Next.js / Vite):
  -> Eden Treaty client created with backend's App type
  -> api.auth.register.post({ email, password })
  -> Full autocomplete + type checking
  -> Response is typed automatically
```

## Scaling Considerations

| Concern | At 10 Tenants | At 1K Tenants | At 100K Tenants |
|---------|---------------|---------------|-----------------|
| **Database** | Single PostgreSQL, no optimization needed | Add connection pooling (PgBouncer), index on tenant_id columns | Consider read replicas; evaluate schema-per-tenant for noisy neighbors |
| **Job Processing** | Single worker process | Multiple worker processes, BullMQ concurrency tuning | Dedicated worker instances per queue/module, rate limiting per tenant |
| **API** | Single instance | Horizontal scaling behind load balancer, stateless (Redis sessions) | Module-specific instances (auth on one, billing on another) |
| **Redis** | Single instance for cache + queue | Separate Redis for cache vs. queue | Redis Cluster or managed Redis with replication |
| **Tenant Isolation** | tenant_id column is sufficient | Row-level security (RLS) in PostgreSQL for defense-in-depth | Schema-per-tenant for high-value tenants, shared for rest |

## Anti-Patterns to Avoid

### Anti-Pattern 1: Cross-Module Direct Imports
**What:** Module A imports Module B's internal services directly.
**Why bad:** Creates hard coupling, makes modules non-optional, breaks configurable loading.
**Instead:** Use the event bus for reactions, or the registry's execute/query for explicit cross-module calls. Both go through the registry, so missing modules produce clear errors at startup.

### Anti-Pattern 2: Tenant ID in Application Logic
**What:** Every query manually adds `.where(eq(table.tenantId, ctx.tenantId))`.
**Why bad:** One missed clause = cross-tenant data leak. Impossible to audit at scale.
**Instead:** Use the `withTenant()` wrapper. Raw Drizzle access should be limited to admin/system operations with explicit `// SYSTEM: no tenant scope` comments.

### Anti-Pattern 3: Fat Modules
**What:** Putting everything tangentially related into one module (e.g., "user" module handles auth + profiles + preferences + notifications + billing associations).
**Why bad:** Defeats the purpose of modularity. Cannot load auth without billing.
**Instead:** Keep modules focused. Auth handles authentication. Billing handles payments. A user's billing association is in billing module, not auth module.

### Anti-Pattern 4: Shared Mutable State Between Entrypoints
**What:** API and worker sharing in-memory state or singletons that assume single-process.
**Why bad:** API and worker run as separate processes in production. In-memory state is not shared.
**Instead:** All shared state goes through Redis or PostgreSQL. The module registry is loaded independently per process.

### Anti-Pattern 5: Leaking Elysia Types Across Packages
**What:** Importing Elysia's internal types in packages/shared or packages/db.
**Why bad:** Creates framework coupling in shared packages. If you switch frameworks, shared packages break.
**Instead:** Define plain TypeScript interfaces in packages/shared. Elysia route handlers map to/from these types. Only apps/backend depends on Elysia.

### Anti-Pattern 6: God Registry
**What:** Registry handles validation, authorization, logging, caching, and business logic.
**Why bad:** Single point of complexity. Hard to test, hard to understand.
**Instead:** Registry only handles discovery, loading, and dispatch. Cross-cutting concerns are middleware (Elysia plugins) or decorators on command/query handlers.

## Integration Points

### better-auth Integration
- better-auth provides session management, OAuth, magic links
- Backend creates better-auth instance as part of the auth module
- Tables (user, session, account, verification) defined in packages/db schema
- Admin app needs separate auth configuration (admin roles, not tenant-scoped)
- Customer app auth can either proxy through Next.js API routes or call backend directly

### Stripe Integration
- Stripe webhook endpoint lives in billing module as a special route (no tenant middleware -- tenant resolved from Stripe customer metadata)
- Subscription lifecycle managed via commands: create, update, cancel
- Stripe customer ID stored alongside tenant in DB
- BullMQ jobs handle async Stripe operations (retry-safe)
- Stripe customer portal URL generated on-demand

### Eden Treaty Integration
- Backend exports its Elysia app type from a dedicated file
- Both frontend apps import this type to create Eden Treaty clients
- The type includes all loaded module routes
- Challenge: if modules are dynamically loaded, the full type must still be statically known at build time. Solution: always export the "all modules" type, even if a specific deployment does not load all modules.

### Drizzle + PostgreSQL
- Schema defined in packages/db, shared across backend
- Migrations generated by Drizzle Kit, run as a CLI command
- Connection pool managed by backend, passed to modules via DI container
- Tenant-scoped helpers wrap Drizzle queries

## Suggested Build Order

Build order follows dependency chains. Each layer depends on the one before it.

```
Phase 1: Foundation
  packages/shared        (types, constants, validation)
  packages/db            (Drizzle schema, tenant-scope helpers, migrations)
  packages/shared-ui     (Tailwind preset, shadcn components, cn utility)

Phase 2: Core Backend
  apps/backend/core      (registry, container, middleware, entrypoints)
  Module: auth           (first module, proves the registry pattern works)
  Module: tenant         (tenant CRUD, needed by everything else)

Phase 3: Frontend Shells
  apps/customer          (Next.js skeleton, Eden Treaty wired, auth flows)
  apps/admin             (Vite skeleton, Eden Treaty wired, basic layout)

Phase 4: Business Modules
  Module: billing        (Stripe integration, subscriptions, webhooks)
  Module: notification   (email delivery, in-app notifications)

Phase 5: Operations
  BullMQ worker setup    (job processing infrastructure)
  Docker configuration   (backend + worker + PostgreSQL + Redis)
  Admin system health    (queue monitoring, tenant overview)
```

**Build order rationale:**
- packages/* must come first because everything depends on them
- The registry + first module (auth) must be built together to prove the pattern works before committing to it for all modules
- Tenant module is second because billing, notification, and admin features all need tenant context
- Frontend shells come after at least one working module so Eden Treaty types are meaningful
- Billing is deferred because Stripe integration is complex and benefits from a stable module pattern
- Worker infrastructure is deferred because it is needed only when jobs exist (billing sync, email delivery)

## Sources

- Medusa.js v2 module architecture: based on training data knowledge of Medusa's module/service/subscriber pattern (MEDIUM confidence -- could not verify against current docs)
- Elysia plugin/group system: based on training data knowledge of Elysia's `.use()` and `new Elysia({ prefix })` patterns (MEDIUM confidence)
- Bun workspaces: based on training data knowledge of Bun's `workspaces` field in package.json (MEDIUM confidence)
- CQRS patterns: well-established architectural pattern, HIGH confidence on the concepts, MEDIUM on TypeScript-specific implementation
- better-auth integration patterns: based on training data (MEDIUM confidence -- library is relatively new)
- BullMQ patterns: well-established, HIGH confidence
- Drizzle ORM patterns: based on training data (MEDIUM confidence -- API has evolved)

**Note:** Web search and documentation fetch were unavailable during this research session. All findings are based on training data. Recommend verifying Elysia plugin composition patterns and better-auth table schema against current documentation before implementation.
