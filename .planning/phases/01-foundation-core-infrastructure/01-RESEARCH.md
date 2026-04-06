# Phase 1: Foundation & Core Infrastructure - Research

**Researched:** 2026-04-05
**Domain:** Monorepo setup, Elysia server architecture, CQRS pattern, Drizzle ORM tenant scoping, TypeBox validation
**Confidence:** HIGH

## Summary

Phase 1 establishes the architectural foundation for Baseworks: a Bun workspace monorepo with an Elysia API server, a config-driven module registry, CQRS command/query dispatch with TypeBox validation, Drizzle ORM with tenant-scoped query wrappers, and environment validation at startup. Every subsequent phase builds on these patterns.

The research confirms that Elysia 1.4.x provides mature plugin composition, derive/resolve lifecycle hooks for context injection, and native TypeBox validation. Drizzle ORM 0.45.x supports both the postgres.js driver and a native Bun SQL driver. TypeBox 0.34.x can be used standalone (outside Elysia routes) via its TypeCompiler for CQRS handler validation. The `drizzle-typebox` package (0.3.3) bridges Drizzle schemas to TypeBox for route validation, keeping the validation layer unified.

**Primary recommendation:** Use Elysia's `derive` hook (scoped to plugin) for tenant context injection, TypeBox `TypeCompiler` for standalone CQRS handler validation, and a Drizzle query wrapper that returns pre-filtered builders -- making cross-tenant data access structurally impossible in normal module code.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Config-driven registration -- a central config file lists which modules to load. No auto-discovery.
- **D-02:** Each module exports a single index.ts with a standard shape: `{ name, routes, commands, queries, jobs, events }`. Medusa-inspired flat declaration.
- **D-03:** No inter-module dependencies at the registry level. Modules communicate through CQRS (commands/queries/events), not direct imports.
- **D-04:** Modules live as workspace packages under `packages/modules/<name>/`. Each module is its own Bun workspace package.
- **D-05:** Function-based handlers -- each handler is a plain `async (input, ctx) => result` function. No classes, no decorators.
- **D-06:** Simple in-process event bus -- commands can emit typed domain events (e.g., `user.created`). Other modules subscribe. No event store, no replay. Just pub/sub.
- **D-07:** TypeBox for input validation -- use Elysia's native TypeBox for both route validation and CQRS handler validation. Do NOT use drizzle-zod; keep validation unified under TypeBox.
- **D-08:** Typed result pattern for errors -- handlers return `{ success: true, data }` or `{ success: false, error: 'CODE' }`. No thrown exceptions for business logic errors.
- **D-09:** Request context object -- Elysia middleware extracts tenant from session/header and injects into a typed context object. All handlers receive `ctx.tenantId`. Explicit, framework-native.
- **D-10:** Scoped query builder -- `scopedDb(tenantId)` returns a Drizzle instance that auto-adds `.where(eq(table.tenantId, id))` to all queries. Transparent tenant filtering.
- **D-11:** Separate admin DB instance -- `unscopedDb()` for admin/system operations that need cross-tenant access. Explicit escape hatch, audit-friendly.
- **D-12:** Three shared packages from day one: `packages/db`, `packages/shared`, `packages/config`.
- **D-13:** Only `apps/api` scaffolded in Phase 1. Worker shares the same codebase with a different entrypoint.
- **D-14:** Bun workspace aliases -- import as `@baseworks/db`, `@baseworks/shared`, `@baseworks/config`. Bun resolves via `workspace:*` in package.json.

### Claude's Discretion
- Module registry initialization order and lifecycle hooks
- Event bus implementation details (EventEmitter vs custom typed bus)
- Drizzle migration tooling configuration (drizzle-kit setup)
- Worker entrypoint implementation (separate file vs env-flag in same entrypoint)
- Specific TypeBox schema patterns for CQRS handlers
- Logging approach within Phase 1 (structured logging deferred to Phase 5, but basic console/pino setup is Claude's call)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FNDTN-01 | Module registry loads modules dynamically based on configuration file | Elysia plugin `.use()` composition + config-driven loading pattern documented below |
| FNDTN-02 | Each module declares its routes, commands, queries, jobs, and events in a standard format | Module definition contract with TypeScript `satisfies` + Elysia plugin pattern |
| FNDTN-03 | CQRS command handlers process mutations and emit domain events | TypeBox TypeCompiler standalone validation + typed event bus pattern |
| FNDTN-04 | CQRS query handlers execute read-only operations with tenant scoping | `scopedDb(tenantId)` wrapper pattern + derive-based context injection |
| FNDTN-05 | Drizzle ORM connects to PostgreSQL with typed schema and migration tooling | Drizzle 0.45.x + postgres.js 3.4.x (or Bun SQL) + drizzle-kit 0.31.x |
| FNDTN-06 | Tenant-scoped database wrapper auto-injects tenant_id filtering on all queries | Drizzle query wrapper pattern with pre-applied where clauses |
| FNDTN-07 | Instance can run as API server, worker, or specific module set via entrypoint and env config | Separate entrypoint files + registry role parameter |
| FNDTN-08 | Bun workspaces monorepo structure with shared packages | Bun 1.3.x workspace:* protocol + glob patterns in root package.json |
| FNDTN-09 | Environment variable validation at startup with typed config | @t3-oss/env-core 0.13.x with TypeBox or Zod schemas |
</phase_requirements>

## Standard Stack

### Core (Phase 1 only)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.3.10 (installed) | Runtime, package manager, workspaces | Native TypeScript, built-in workspace support. Already installed. [VERIFIED: local check] |
| Elysia | 1.4.28 | HTTP framework | Bun-native, plugin architecture for modular routes, TypeBox validation built-in, Eden Treaty type inference. [VERIFIED: npm registry] |
| @elysiajs/cors | 1.4.1 | CORS handling | Required for admin dashboard (different origin) calling API. [VERIFIED: npm registry] |
| @elysiajs/swagger | 1.3.1 | API docs | Auto-generates OpenAPI from TypeBox schemas. Free docs from existing types. [VERIFIED: npm registry] |
| drizzle-orm | 0.45.2 | ORM / query builder | Type-safe SQL, no codegen, lightweight, Bun-compatible. [VERIFIED: npm registry] |
| drizzle-kit | 0.31.10 | Migration tooling | `generate` + `migrate` for production migrations. [VERIFIED: npm registry] |
| drizzle-typebox | 0.3.3 | Schema-to-TypeBox bridge | Generates TypeBox schemas from Drizzle table definitions for Elysia route validation. [VERIFIED: npm registry] |
| postgres | 3.4.9 | PostgreSQL driver | Fastest PostgreSQL driver for Bun. Drizzle recommends postgres.js over pg. [VERIFIED: npm registry] |
| @sinclair/typebox | 0.34.49 | Validation schemas | Elysia's native validation. Used for both route schemas and standalone CQRS handler validation. [VERIFIED: npm registry] |
| @t3-oss/env-core | 0.13.11 | Env validation | Framework-agnostic env validation at startup. Works with Zod or Standard Schema validators. [VERIFIED: npm registry] |
| pino | 10.3.1 | Structured logging | JSON output, fast, low overhead. Basic setup in P1, full structured logging in P5. [VERIFIED: npm registry] |
| pino-pretty | 13.1.3 | Dev log formatting | Pretty-prints pino JSON logs in development. [VERIFIED: npm registry] |
| nanoid | 5.1.7 | ID generation | Public-facing IDs (tenant slugs, invite codes). Primary keys use PostgreSQL UUIDs. [VERIFIED: npm registry] |

### Supporting (scaffolded in P1, full use later)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bullmq | 5.73.0 | Job queue | Scaffolded in P1 (queue infrastructure types/interfaces). Full use in P3. [VERIFIED: npm registry] |
| ioredis | 5.10.1 | Redis client | Required by BullMQ. Connection factory created in P1, used in P3+. [VERIFIED: npm registry] |

### Development Tools

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| @biomejs/biome | 2.4.10 | Linter + formatter | Replaces ESLint + Prettier. Single tool, faster. [VERIFIED: npm registry] |
| typescript | 5.5+ | Type system | Strict mode. Bun runs TS natively. Check installed version at setup. [ASSUMED] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| postgres.js driver | Bun SQL (`drizzle-orm/bun-sql`) | Bun SQL is native and faster, but locks you to Bun runtime entirely. postgres.js works on both Bun and Node.js, providing a fallback if BullMQ workers need Node.js. Use postgres.js for portability. [VERIFIED: Drizzle docs] |
| @t3-oss/env-core | @yolk-oss/elysia-env | elysia-env uses TypeBox natively (matches the stack), but is a community plugin with uncertain maintenance. @t3-oss/env-core is battle-tested. [VERIFIED: npm, GitHub] |
| TypeBox standalone | Zod for CQRS validation | User explicitly chose TypeBox (D-07). Zod would fragment the validation layer. TypeBox TypeCompiler provides standalone validation outside Elysia. |

**Installation (Phase 1 packages):**
```bash
# From monorepo root -- apps/api dependencies
cd apps/api && bun add elysia @elysiajs/cors @elysiajs/swagger pino pino-pretty

# packages/db dependencies
cd packages/db && bun add drizzle-orm postgres drizzle-typebox @sinclair/typebox
bun add -D drizzle-kit

# packages/config dependencies
cd packages/config && bun add @t3-oss/env-core zod

# packages/shared dependencies
cd packages/shared && bun add @sinclair/typebox nanoid

# Root dev dependencies
bun add -D @biomejs/biome typescript
```

**Note on @t3-oss/env-core:** This library uses Zod (or Standard Schema validators) internally. Since the user chose TypeBox for application validation (D-07), the env validation layer is the one place where Zod is acceptable -- it is used only at startup for env parsing, not for runtime request/response validation. This is a pragmatic exception: @t3-oss/env-core is battle-tested and the env validation layer has no overlap with Elysia's TypeBox.

## Architecture Patterns

### Recommended Project Structure (Phase 1)

```
baseworks/
  package.json                    # Root: "workspaces": ["packages/*", "packages/modules/*", "apps/*"]
  bunfig.toml                     # Bun configuration
  biome.json                      # Linter/formatter config
  tsconfig.json                   # Root tsconfig with paths
  docker-compose.yml              # PostgreSQL + Redis for local dev

  apps/
    api/
      package.json                # @baseworks/api
      src/
        index.ts                  # API server entrypoint (bun run api)
        worker.ts                 # Worker entrypoint (bun run worker)
        core/
          registry.ts             # Module registry -- load, register, dispatch
          cqrs.ts                 # Command/query bus -- execute, query
          event-bus.ts            # In-process typed event bus
          middleware/
            tenant.ts             # derive hook: extracts tenantId into context
            error.ts              # onError hook: consistent error responses
        lib/
          logger.ts               # pino instance (basic for P1)

  packages/
    db/
      package.json                # @baseworks/db
      src/
        index.ts                  # Re-exports: schema, connection, helpers
        connection.ts             # postgres.js + drizzle setup
        schema/
          index.ts                # Barrel export of all tables
          base.ts                 # Shared column helpers (tenantId, timestamps, uuid pk)
        helpers/
          scoped-db.ts            # scopedDb(tenantId) wrapper
          unscoped-db.ts          # unscopedDb() for admin queries
      drizzle.config.ts           # drizzle-kit configuration
      migrations/                 # Generated migration files

    shared/
      package.json                # @baseworks/shared
      src/
        index.ts                  # Barrel export
        types/
          module.ts               # ModuleDefinition interface
          cqrs.ts                 # Command, Query, Result types
          context.ts              # HandlerContext, TenantContext types
          events.ts               # Event bus types
        result.ts                 # Result<T> helper (success/error pattern)

    config/
      package.json                # @baseworks/config
      src/
        index.ts
        env.ts                    # createEnv() with server schema

    modules/
      example/
        package.json              # @baseworks/module-example
        src/
          index.ts                # Module definition: { name, routes, commands, queries, jobs, events }
          routes.ts               # Elysia plugin with route group
          commands/
            create-example.ts     # Command handler function
          queries/
            list-examples.ts      # Query handler function
```

### Pattern 1: Module Registry (Config-Driven)

**What:** A registry that reads a config array of module names, dynamically imports each module's definition, and registers its routes/commands/queries into the Elysia app and CQRS bus.

**When to use:** Always -- this is the core of the architecture.

**Example:**

```typescript
// packages/shared/src/types/module.ts
import type { Elysia } from 'elysia'

export interface ModuleDefinition {
  name: string
  routes?: (app: Elysia) => Elysia   // Returns Elysia plugin
  commands?: Record<string, CommandHandler<any, any>>
  queries?: Record<string, QueryHandler<any, any>>
  jobs?: Record<string, JobDefinition>
  events?: string[]   // Event names this module emits
}

// apps/api/src/core/registry.ts
// Source: Elysia plugin composition pattern [VERIFIED: elysiajs.com/essential/plugin]
type InstanceRole = 'api' | 'worker' | 'all'

interface RegistryConfig {
  role: InstanceRole
  modules: string[]   // e.g., ['example', 'auth', 'billing']
}

export class ModuleRegistry {
  private loaded = new Map<string, ModuleDefinition>()
  private commandBus = new Map<string, CommandHandler>()
  private queryBus = new Map<string, QueryHandler>()
  private eventBus: TypedEventBus

  constructor(private config: RegistryConfig) {
    this.eventBus = new TypedEventBus()
  }

  async loadAll(): Promise<void> {
    for (const name of this.config.modules) {
      // Dynamic import from workspace package
      const mod = await import(`@baseworks/module-${name}`)
      const def: ModuleDefinition = mod.default

      // Register commands and queries
      if (def.commands) {
        for (const [key, handler] of Object.entries(def.commands)) {
          this.commandBus.set(key, handler)
        }
      }
      if (def.queries) {
        for (const [key, handler] of Object.entries(def.queries)) {
          this.queryBus.set(key, handler)
        }
      }

      this.loaded.set(name, def)
    }
  }

  // Attach routes to Elysia app (only for 'api' and 'all' roles)
  attachRoutes(app: Elysia): void {
    if (this.config.role === 'worker') return
    for (const [, def] of this.loaded) {
      if (def.routes) {
        app.use(def.routes)
      }
    }
  }

  async execute<T>(command: string, input: unknown, ctx: HandlerContext): Promise<Result<T>> {
    const handler = this.commandBus.get(command)
    if (!handler) return { success: false, error: 'COMMAND_NOT_FOUND' }
    return handler(input, ctx)
  }

  async query<T>(queryName: string, input: unknown, ctx: HandlerContext): Promise<Result<T>> {
    const handler = this.queryBus.get(queryName)
    if (!handler) return { success: false, error: 'QUERY_NOT_FOUND' }
    return handler(input, ctx)
  }
}
```

### Pattern 2: Elysia Context Injection via derive

**What:** Use Elysia's `derive` lifecycle hook to extract tenant context from headers/session and inject it into the handler context as `ctx.tenantId`.

**When to use:** Every protected route group that requires tenant scoping.

**Example:**

```typescript
// apps/api/src/core/middleware/tenant.ts
// Source: Elysia derive pattern [VERIFIED: elysiajs.com/patterns/extends-context]
import { Elysia } from 'elysia'

export const tenantMiddleware = new Elysia({ name: 'tenant-context' })
  .derive({ as: 'scoped' }, ({ headers }) => {
    // Phase 1: extract from header (Phase 2 will extract from session)
    const tenantId = headers['x-tenant-id']
    if (!tenantId) {
      throw new Error('Missing tenant context')
    }
    return { tenantId }
  })
```

**Key insight:** Using `as: 'scoped'` means this derive applies to the current plugin and its parent, but not globally. This allows public routes (health check, auth endpoints) to exist without tenant context. [VERIFIED: elysiajs.com/essential/plugin]

### Pattern 3: CQRS Handler with TypeBox Validation

**What:** Function-based command/query handlers that validate input using TypeBox TypeCompiler before executing business logic.

**When to use:** Every command and query handler.

**Example:**

```typescript
// packages/shared/src/types/cqrs.ts
import { type TSchema, TypeCompiler } from '@sinclair/typebox/compiler'
import { Type, type Static } from '@sinclair/typebox'

// Result type (D-08)
export type Result<T> = 
  | { success: true; data: T }
  | { success: false; error: string }

export interface HandlerContext {
  tenantId: string
  userId?: string
  db: ScopedDb          // tenant-scoped Drizzle instance
  emit: (event: string, data: unknown) => void
  enqueue?: (job: string, data: unknown) => Promise<void>
}

// Helper to create a validated command handler
export function defineCommand<S extends TSchema, R>(
  schema: S,
  handler: (input: Static<S>, ctx: HandlerContext) => Promise<Result<R>>
) {
  const compiled = TypeCompiler.Compile(schema)
  return async (input: unknown, ctx: HandlerContext): Promise<Result<R>> => {
    if (!compiled.Check(input)) {
      const errors = [...compiled.Errors(input)]
      return { success: false, error: `VALIDATION_ERROR: ${errors[0]?.message}` }
    }
    return handler(input as Static<S>, ctx)
  }
}

// Usage in a module:
// packages/modules/example/src/commands/create-example.ts
import { Type } from '@sinclair/typebox'
import { defineCommand } from '@baseworks/shared'

const CreateExampleInput = Type.Object({
  title: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
})

export const createExample = defineCommand(CreateExampleInput, async (input, ctx) => {
  const result = await ctx.db.insert(examples).values({
    title: input.title,
    description: input.description,
  }).returning()

  ctx.emit('example.created', { id: result[0].id })

  return { success: true, data: result[0] }
})
```

### Pattern 4: Tenant-Scoped Database Wrapper

**What:** A wrapper around Drizzle that pre-applies `WHERE tenant_id = ?` to all select/update/delete operations and auto-injects tenant_id on inserts.

**When to use:** All module code that accesses tenant data. The ONLY exception is `unscopedDb()` for admin/system operations.

**Example:**

```typescript
// packages/db/src/helpers/scoped-db.ts
// Source: Drizzle query builder pattern [VERIFIED: orm.drizzle.team]
import { eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'

export function scopedDb(db: DrizzleInstance, tenantId: string) {
  return {
    // Select with automatic tenant filtering
    select: <T extends PgTable & { tenantId: any }>(table: T) =>
      db.select().from(table).where(eq(table.tenantId, tenantId)),

    // Insert with automatic tenant_id injection
    insert: <T extends PgTable & { tenantId: any }>(table: T) => ({
      values: (data: Omit<typeof table.$inferInsert, 'tenantId'>) =>
        db.insert(table).values({ ...data, tenantId } as any),
    }),

    // Update with automatic tenant filtering
    update: <T extends PgTable & { tenantId: any }>(table: T) =>
      db.update(table).where(eq(table.tenantId, tenantId)),

    // Delete with automatic tenant filtering
    delete: <T extends PgTable & { tenantId: any }>(table: T) =>
      db.delete(table).where(eq(table.tenantId, tenantId)),

    // Raw Drizzle for complex queries (still scoped via tenantId param)
    tenantId,
    raw: db,
  }
}

// packages/db/src/helpers/unscoped-db.ts
export function unscopedDb(db: DrizzleInstance) {
  // Returns the raw Drizzle instance -- explicitly for admin/system use
  return db
}
```

### Pattern 5: In-Process Typed Event Bus

**What:** A typed wrapper around Node.js EventEmitter for cross-module domain events. No persistence, no replay -- just pub/sub.

**When to use:** When a command in one module needs to trigger side effects in other modules without direct coupling.

**Example:**

```typescript
// apps/api/src/core/event-bus.ts
import { EventEmitter } from 'node:events'

// Type-safe event map (expanded as modules are added)
export interface DomainEvents {
  'example.created': { id: string; tenantId: string }
  'example.deleted': { id: string; tenantId: string }
  // Phase 2 will add: 'user.created', 'tenant.created', etc.
}

export class TypedEventBus {
  private emitter = new EventEmitter()

  emit<K extends keyof DomainEvents>(event: K, data: DomainEvents[K]): void {
    this.emitter.emit(event as string, data)
  }

  on<K extends keyof DomainEvents>(event: K, handler: (data: DomainEvents[K]) => void | Promise<void>): void {
    this.emitter.on(event as string, handler)
  }

  off<K extends keyof DomainEvents>(event: K, handler: (data: DomainEvents[K]) => void | Promise<void>): void {
    this.emitter.off(event as string, handler)
  }
}
```

**Recommendation:** Use Node.js `EventEmitter` (works in Bun) rather than a custom implementation. It is simple, well-tested, and exactly matches the "no event store, no replay, just pub/sub" requirement (D-06). The typed wrapper adds compile-time safety without runtime overhead. [ASSUMED -- EventEmitter is a standard Node.js API that Bun supports]

### Pattern 6: Environment Validation at Startup

**What:** Use @t3-oss/env-core to validate all required environment variables at import time, crashing immediately if anything is missing.

**Example:**

```typescript
// packages/config/src/env.ts
// Source: @t3-oss/env-core docs [VERIFIED: env.t3.gg/docs/core]
import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    REDIS_URL: z.string().url().optional(),  // Optional in P1, required in P3
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
```

### Pattern 7: Module Route as Elysia Plugin

**What:** Each module's routes are an Elysia instance with a prefix. The registry `.use()`s them into the main app.

**Example:**

```typescript
// packages/modules/example/src/routes.ts
// Source: Elysia plugin/group pattern [VERIFIED: elysiajs.com/essential/plugin]
import { Elysia, t } from 'elysia'
import { createExample } from './commands/create-example'
import { listExamples } from './queries/list-examples'

export const exampleRoutes = new Elysia({ prefix: '/examples' })
  .post('/', async ({ body, tenantId, store }) => {
    const ctx = { tenantId, db: scopedDb(store.db, tenantId), emit: store.eventBus.emit }
    return createExample(body, ctx)
  }, {
    body: t.Object({
      title: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
    })
  })
  .get('/', async ({ tenantId, store }) => {
    const ctx = { tenantId, db: scopedDb(store.db, tenantId) }
    return listExamples({}, ctx)
  })

// packages/modules/example/src/index.ts
import type { ModuleDefinition } from '@baseworks/shared'
import { exampleRoutes } from './routes'
import { createExample } from './commands/create-example'
import { listExamples } from './queries/list-examples'

export default {
  name: 'example',
  routes: exampleRoutes,
  commands: { 'example:create': createExample },
  queries: { 'example:list': listExamples },
  jobs: {},
  events: ['example.created', 'example.deleted'],
} satisfies ModuleDefinition
```

### Anti-Patterns to Avoid

- **Cross-module direct imports:** Module A must NOT import Module B's internal files. Use the CQRS bus or event bus for cross-module communication (D-03).
- **Raw db access in modules:** Always go through `scopedDb()`. Any raw `db.select()` in module code is a cross-tenant data leak waiting to happen.
- **Class-based CQRS handlers:** Use plain functions (D-05). Classes add ceremony without benefit at this scale.
- **Event bus for command-to-command chains:** Commands should NOT emit events that trigger other commands in a chain. Use explicit command calls via the registry for synchronous flows. Events are for fire-and-forget side effects.
- **Elysia framework types in shared packages:** `@baseworks/shared` and `@baseworks/db` must NOT depend on Elysia. Only `apps/api` and module route files depend on Elysia.
- **Using `drizzle-kit push` for anything beyond local dev:** Use `drizzle-kit generate` + `drizzle-kit migrate` for reproducible migrations.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Env validation | Custom process.env parsers | @t3-oss/env-core | Handles coercion, defaults, empty strings, type safety. Battle-tested. |
| TypeBox validation at runtime | Manual if/else checks | TypeBox TypeCompiler | JIT-compiled validation, 100x faster than manual checks, produces structured errors. |
| Drizzle-to-TypeBox conversion | Manual schema duplication | drizzle-typebox | Generates TypeBox schemas from Drizzle table definitions. Single source of truth. |
| Event emitter | Custom pub/sub implementation | Node.js EventEmitter + typed wrapper | Well-tested, memory-safe, handles errors. Just add a type layer. |
| CORS handling | Manual header management | @elysiajs/cors | Handles preflight, credentials, origin matching. Edge cases are subtle. |
| OpenAPI docs | Manual route documentation | @elysiajs/swagger | Auto-generates from TypeBox schemas. Zero maintenance. |
| UUID generation | Custom ID generators | `crypto.randomUUID()` (built-in) | Cryptographically secure, built into Bun/Node.js runtime. |

**Key insight:** The biggest temptation in Phase 1 is to hand-roll the CQRS bus and event bus as elaborate systems. Keep them as thin as possible -- a Map of handlers and an EventEmitter with types. The module registry is the only "framework" code; everything else should be utility functions.

## Common Pitfalls

### Pitfall 1: TypeBox Version Mismatch Between Elysia and drizzle-typebox

**What goes wrong:** Elysia bundles its own version of @sinclair/typebox internally. If drizzle-typebox or your direct TypeBox dependency uses a different version, TypeScript will report type incompatibilities ("Type instantiation is possibly infinite" errors). [VERIFIED: elysiajs.com/integrations/drizzle]

**Why it happens:** Multiple packages depend on @sinclair/typebox at different versions. Bun's hoisting may pick the wrong one.

**How to avoid:**
- Pin `@sinclair/typebox` to the same version Elysia uses internally. Check with: `bun pm ls @sinclair/typebox`
- Add overrides in root package.json: `"overrides": { "@sinclair/typebox": "0.34.x" }`
- When using drizzle-typebox schemas in Elysia routes, declare variables separately before referencing in the schema (do not nest inline).

**Warning signs:** "Type instantiation is possibly infinite" errors. TypeBox schemas not matching Elysia's `t.*` types.

### Pitfall 2: Elysia Plugin Scope Leaking

**What goes wrong:** A derive hook or middleware applied in one module plugin leaks into unrelated routes, or conversely does not apply where expected.

**Why it happens:** Elysia's default plugin scope is `local`. Developers assume middleware applied in a plugin will propagate to the parent app, but it does not unless `as: 'scoped'` or `as: 'global'` is specified. [VERIFIED: elysiajs.com/essential/plugin]

**How to avoid:**
- Always explicitly specify scope: `{ as: 'scoped' }` for middleware that should apply to the parent, `{ as: 'local' }` for module-internal hooks.
- The tenant middleware should use `as: 'scoped'` so it applies to routes in modules `.use()`d after it.
- Test: a health check route registered before tenant middleware should NOT have tenantId in context.

**Warning signs:** Routes returning unexpected undefined context values. Auth working on some routes but not others.

### Pitfall 3: Workspace Resolution Failures

**What goes wrong:** `import { ... } from '@baseworks/shared'` fails with "module not found" or resolves to stale code.

**Why it happens:** Bun workspace resolution requires: (1) correct "name" field in each package.json, (2) `"workspace:*"` in consuming package's dependencies, (3) `bun install` run from root after adding new workspace packages.

**How to avoid:**
- Every package.json must have `"name": "@baseworks/<pkg>"` and `"main": "./src/index.ts"` (Bun resolves TypeScript directly).
- Run `bun install` from the monorepo root after creating any new package.
- Use `"exports"` field in package.json for explicit entry points if needed.

**Warning signs:** Import errors pointing to node_modules instead of local packages. Types not updating after changing shared package code.

### Pitfall 4: Missing Tenant ID in Background Jobs

**What goes wrong:** A command handler enqueues a BullMQ job but forgets to include tenantId in the job payload. The worker processes the job without tenant context, accessing data across all tenants or crashing.

**Why it happens:** In HTTP request context, tenantId is automatically available via derive middleware. In job context, there is no HTTP request -- the job must carry its own tenant context.

**How to avoid:**
- Define a `JobPayload` base type that always includes `tenantId`.
- The `enqueue()` function in HandlerContext should auto-inject tenantId into every job payload.
- Workers must validate that `tenantId` exists in the payload before processing.

**Warning signs:** Jobs working correctly in tests (where tenantId is hardcoded) but failing in production.

### Pitfall 5: Drizzle Migration Ordering Issues

**What goes wrong:** Module schemas reference tables from other modules (e.g., billing references users). If migrations run in the wrong order, foreign key constraints fail.

**Why it happens:** `drizzle-kit generate` creates timestamped migration files, but if two modules add schemas simultaneously, the order is arbitrary.

**How to avoid:**
- All schemas live in `packages/db/src/schema/` -- a single package. No schema definitions in module packages.
- Modules define their CQRS handlers and routes; the db schema is centralized.
- Use `drizzle-kit generate` and review the generated SQL before running `drizzle-kit migrate`.

**Warning signs:** Migration failures referencing tables that "don't exist yet."

## Code Examples

### Bun Workspace Root package.json

```json
{
  "name": "baseworks",
  "private": true,
  "workspaces": [
    "packages/*",
    "packages/modules/*",
    "apps/*"
  ],
  "scripts": {
    "api": "bun run --watch apps/api/src/index.ts",
    "worker": "bun run apps/api/src/worker.ts",
    "db:generate": "bun drizzle-kit generate --config packages/db/drizzle.config.ts",
    "db:migrate": "bun drizzle-kit migrate --config packages/db/drizzle.config.ts",
    "db:push": "bun drizzle-kit push --config packages/db/drizzle.config.ts",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.10",
    "typescript": "^5.5.0"
  },
  "overrides": {
    "@sinclair/typebox": "0.34.49"
  }
}
```

### Workspace Package Example (packages/shared/package.json)

```json
{
  "name": "@baseworks/shared",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "@sinclair/typebox": "workspace:*"
  }
}
```

**Note:** With Bun, you can point `"main"` directly at `.ts` files. Bun resolves TypeScript natively without a build step. [VERIFIED: Bun docs]

### Drizzle Connection Setup (packages/db/src/connection.ts)

```typescript
// Source: Drizzle postgres.js setup [VERIFIED: orm.drizzle.team/docs/get-started/postgresql-new]
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createDb(connectionString: string) {
  const sql = postgres(connectionString)
  return drizzle(sql, { schema, logger: process.env.NODE_ENV === 'development' })
}
```

### API Server Entrypoint (apps/api/src/index.ts)

```typescript
import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { env } from '@baseworks/config'
import { createDb } from '@baseworks/db'
import { ModuleRegistry } from './core/registry'
import { TypedEventBus } from './core/event-bus'
import { tenantMiddleware } from './core/middleware/tenant'
import { logger } from './lib/logger'

const db = createDb(env.DATABASE_URL)
const eventBus = new TypedEventBus()

const registry = new ModuleRegistry({
  role: 'api',
  modules: ['example'],   // Config-driven (D-01)
})

await registry.loadAll()

const app = new Elysia()
  .use(cors({ origin: ['http://localhost:3000'] }))
  .use(swagger())
  .decorate('db', db)
  .decorate('eventBus', eventBus)
  .decorate('registry', registry)
  .get('/health', () => ({ status: 'ok' }))
  .use(tenantMiddleware)

// Attach module routes
registry.attachRoutes(app)

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API server started')
})

export type App = typeof app   // Eden Treaty type export
```

### Worker Entrypoint (apps/api/src/worker.ts)

```typescript
import { env } from '@baseworks/config'
import { createDb } from '@baseworks/db'
import { ModuleRegistry } from './core/registry'
import { logger } from './lib/logger'

const db = createDb(env.DATABASE_URL)

const registry = new ModuleRegistry({
  role: 'worker',
  modules: ['example'],
})

await registry.loadAll()

// Worker does not start HTTP server -- it starts BullMQ workers
// (BullMQ worker setup scaffolded here, full implementation in Phase 3)

logger.info('Worker started')

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Worker shutting down...')
  // Close BullMQ workers, drain connections
  process.exit(0)
})
```

### drizzle.config.ts

```typescript
// Source: drizzle-kit configuration [VERIFIED: orm.drizzle.team]
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

### Base Schema Helpers (packages/db/src/schema/base.ts)

```typescript
import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core'

// Shared column factories
export const tenantIdColumn = () => varchar('tenant_id', { length: 36 }).notNull()
export const primaryKeyColumn = () => uuid('id').primaryKey().defaultRandom()
export const timestampColumns = () => ({
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Elysia 1.0 scoping | Elysia 1.4 `as: 'scoped'/'local'/'global'` | Elysia 1.1+ | Explicit scope control on all lifecycle hooks [VERIFIED: elysiajs.com] |
| drizzle-orm/postgres-js separate adapter | drizzle-orm unified `drizzle()` constructor | Drizzle 0.36+ | Simplified setup, auto-detects driver [VERIFIED: orm.drizzle.team] |
| Drizzle + Zod only | Drizzle + TypeBox via drizzle-typebox | 2024 | Can now generate TypeBox schemas from Drizzle tables, matching Elysia's native validation [VERIFIED: npm registry] |
| postgres.js only for Bun | Bun SQL native driver option | Bun 1.2+ | Native Bun SQL driver available as alternative to postgres.js [VERIFIED: orm.drizzle.team/docs/connect-bun-sql] |
| @sinclair/typebox 0.32 | @sinclair/typebox 0.34 | 2024-2025 | Better Transform types, improved compiler. Pin version to match Elysia. [VERIFIED: npm registry] |

**Deprecated/outdated:**
- `drizzle-kit push` for production: Use `generate` + `migrate` instead. `push` is for development only.
- `pg` (node-postgres) driver: Use `postgres` (postgres.js) or Bun SQL. pg has worse Bun compatibility.
- Zod for Elysia route validation: Elysia uses TypeBox natively. Using Zod requires an adapter and loses performance.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Node.js EventEmitter works in Bun for the typed event bus | Pattern 5 | LOW -- Bun documents Node.js EventEmitter as supported, but edge cases in error handling possible |
| A2 | Dynamic import of workspace packages (`import('@baseworks/module-example')`) works in Bun | Pattern 1 | MEDIUM -- If Bun's dynamic import doesn't resolve workspace packages, the module registry needs a different loading strategy (e.g., a static import map) |
| A3 | drizzle-typebox 0.3.3 is compatible with Drizzle 0.45.2 and TypeBox 0.34.49 | Standard Stack | MEDIUM -- Version mismatch could cause type errors. Verify at install time. |

## Open Questions

1. **Dynamic import of workspace packages in Bun**
   - What we know: Bun resolves `workspace:*` dependencies statically in import statements. Dynamic `import()` with workspace package names may or may not work.
   - What's unclear: Whether `await import('@baseworks/module-example')` resolves correctly at runtime.
   - Recommendation: Test early. If dynamic import fails, use a static import map in the registry config that maps module names to their exports.

2. **TypeBox version alignment with Elysia 1.4.28**
   - What we know: Elysia uses TypeBox internally. drizzle-typebox also depends on TypeBox.
   - What's unclear: The exact TypeBox version Elysia 1.4.28 uses internally.
   - Recommendation: After `bun install`, run `bun pm ls @sinclair/typebox` to check for version conflicts. Add overrides if needed.

3. **scopedDb wrapper completeness**
   - What we know: The wrapper covers select, insert, update, delete with tenant filtering.
   - What's unclear: How to handle Drizzle's relational queries (`db.query.table.findMany()`) with tenant scoping, and how to handle raw SQL when needed.
   - Recommendation: Start with the basic wrapper. Add relational query support when Phase 2 needs it. For raw SQL, require explicit `unscopedDb()`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Runtime | Yes | 1.3.10 | -- |
| Docker | PostgreSQL + Redis containers | Yes | 28.2.2 | Install PostgreSQL and Redis natively |
| PostgreSQL | Database | No (not running) | -- | `docker compose up` to start containerized PostgreSQL |
| Redis | BullMQ (scaffolded P1, used P3) | No (not running) | -- | `docker compose up` to start containerized Redis. Optional in P1. |
| Biome | Linting/formatting | No (not installed globally) | -- | Install as dev dependency: `bun add -D @biomejs/biome`. Run via `bunx biome`. |

**Missing dependencies with no fallback:**
- None -- all missing items have clear solutions (Docker for databases, npm install for tools).

**Missing dependencies with fallback:**
- PostgreSQL: Start via docker-compose (needs a docker-compose.yml with PostgreSQL service).
- Redis: Start via docker-compose. Not strictly required until Phase 3. Can defer.
- Biome: Install as project dev dependency, not global.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test runner (built-in) |
| Config file | None needed -- Bun test works with zero config |
| Quick run command | `bun test` |
| Full suite command | `bun test --timeout 30000` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FNDTN-01 | Module registry loads modules from config | unit | `bun test apps/api/src/core/__tests__/registry.test.ts -x` | Wave 0 |
| FNDTN-02 | Module declares standard shape | unit | `bun test packages/shared/src/__tests__/module-types.test.ts -x` | Wave 0 |
| FNDTN-03 | Command handler processes mutation + emits event | unit | `bun test apps/api/src/core/__tests__/cqrs.test.ts -x` | Wave 0 |
| FNDTN-04 | Query handler returns tenant-scoped results | integration | `bun test packages/db/src/__tests__/scoped-db.test.ts -x` | Wave 0 |
| FNDTN-05 | Drizzle connects to PostgreSQL with schema | integration | `bun test packages/db/src/__tests__/connection.test.ts -x` | Wave 0 |
| FNDTN-06 | Tenant-scoped wrapper filters by tenant_id | integration | `bun test packages/db/src/__tests__/scoped-db.test.ts -x` | Wave 0 |
| FNDTN-07 | API and worker entrypoints start with different roles | unit | `bun test apps/api/src/__tests__/entrypoints.test.ts -x` | Wave 0 |
| FNDTN-08 | Workspace imports resolve correctly | smoke | `bun test apps/api/src/__tests__/workspace-imports.test.ts -x` | Wave 0 |
| FNDTN-09 | Missing env vars crash at startup | unit | `bun test packages/config/src/__tests__/env.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test`
- **Per wave merge:** `bun test --timeout 30000`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/api/src/core/__tests__/registry.test.ts` -- covers FNDTN-01, FNDTN-07
- [ ] `apps/api/src/core/__tests__/cqrs.test.ts` -- covers FNDTN-03
- [ ] `packages/db/src/__tests__/connection.test.ts` -- covers FNDTN-05
- [ ] `packages/db/src/__tests__/scoped-db.test.ts` -- covers FNDTN-04, FNDTN-06
- [ ] `packages/config/src/__tests__/env.test.ts` -- covers FNDTN-09
- [ ] `packages/shared/src/__tests__/module-types.test.ts` -- covers FNDTN-02
- [ ] `apps/api/src/__tests__/workspace-imports.test.ts` -- covers FNDTN-08
- [ ] `docker-compose.yml` -- PostgreSQL container for integration tests

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (Phase 2) | -- |
| V3 Session Management | No (Phase 2) | -- |
| V4 Access Control | Yes (tenant isolation) | Tenant-scoped DB wrapper enforces data boundaries |
| V5 Input Validation | Yes | TypeBox via Elysia route schemas + TypeCompiler for CQRS |
| V6 Cryptography | No | -- |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant data leakage | Information Disclosure | `scopedDb()` wrapper auto-injects tenant_id on all queries |
| Tenant ID from client input | Tampering | Derive tenant from session/header in middleware, never from request body |
| Module registry loading arbitrary code | Elevation of Privilege | Hardcoded allowlist of valid module names; config selects from allowlist only |
| Env var injection | Tampering | @t3-oss/env-core validates all env vars at startup with strict schemas |
| Missing input validation | Tampering | TypeBox validation on all Elysia routes and CQRS handlers |

## Sources

### Primary (HIGH confidence)
- [npm registry] -- All package versions verified via `npm view <pkg> version` on 2026-04-05
- [elysiajs.com/essential/plugin] -- Plugin composition, `.use()`, scoping, deduplication
- [elysiajs.com/essential/life-cycle] -- Lifecycle hooks: derive, resolve, beforeHandle, onError
- [elysiajs.com/patterns/extends-context] -- derive vs resolve for context injection
- [elysiajs.com/essential/best-practice] -- Feature-based module structure, MVC patterns, service patterns
- [elysiajs.com/integrations/drizzle] -- drizzle-typebox integration, TypeBox version pinning
- [orm.drizzle.team/docs/rqb] -- Drizzle relational query builder
- [orm.drizzle.team/docs/connect-bun-sql] -- Bun SQL driver alternative
- [env.t3.gg/docs/core] -- @t3-oss/env-core createEnv usage

### Secondary (MEDIUM confidence)
- [bun.com/docs/guides/install/workspaces] -- Bun workspace:* protocol, glob patterns
- [elysiajs.com/patterns/typebox] -- TypeBox standalone usage
- [elysiajs.com/patterns/macro] -- Macro pattern for reusable route hooks

### Tertiary (LOW confidence)
- [github.com/yolk-oss/elysia-env] -- Alternative env validation plugin (not recommended, noted for awareness)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All versions verified against npm registry. Core APIs verified against official docs.
- Architecture: HIGH -- Elysia plugin composition, derive/resolve, CQRS patterns all verified against current documentation.
- Pitfalls: HIGH -- TypeBox version mismatch verified in Elysia's own Drizzle integration docs. Scope leaking documented in Elysia plugin docs.

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (30 days -- stack is stable, Elysia 1.4.x is current major)
