# Architecture Research

**Domain:** JSDoc, Unit Tests, and Developer Documentation for a Bun + Elysia + Drizzle + Next.js monorepo SaaS starter kit
**Researched:** 2026-04-16
**Confidence:** HIGH

## System Overview

```
Existing Monorepo Structure (156 source files, 29 test files)
===============================================================

baseworks/
├── apps/
│   ├── api/src/              # Elysia backend (core/, routes, middleware, worker)
│   │   ├── core/             # CQRS bus, event bus, module registry
│   │   │   └── __tests__/    # 3 unit tests (existing)
│   │   └── __tests__/        # 4 integration tests (existing)
│   ├── web/                  # Next.js 15 customer app (App Router)
│   │   └── (no tests)
│   └── admin/src/            # Vite SPA admin dashboard
│       └── (no tests)
├── packages/
│   ├── shared/src/           # Types, Result monad, CQRS helpers
│   ├── db/src/               # Drizzle schema, connection, scoped-db
│   │   └── __tests__/        # 2 tests (existing)
│   ├── config/src/           # Env validation
│   │   └── __tests__/        # 1 test (existing)
│   ├── api-client/src/       # Eden Treaty client, auth client
│   ├── queue/src/            # BullMQ wrapper
│   │   └── __tests__/        # 1 test (existing)
│   ├── i18n/src/             # Shared i18n JSON + exports
│   ├── ui/src/               # shadcn components + hooks
│   │   └── components/__tests__/  # 9 a11y tests (existing, Vitest)
│   └── modules/
│       ├── auth/src/         # Auth module (commands/, queries/, routes, hooks)
│       │   └── __tests__/    # 5 tests (existing)
│       ├── billing/src/      # Billing module (adapters/, commands/, queries/, jobs/, ports/)
│       │   └── __tests__/    # 4 tests (existing)
│       └── example/src/      # Example module
└── docs/                     # NEW - developer documentation (does not exist yet)
```

### Component Responsibilities

| Component | Responsibility | JSDoc Priority | Test Priority |
|-----------|----------------|----------------|---------------|
| `packages/shared` | Type definitions, Result monad, `defineCommand`/`defineQuery` | HIGHEST - every module depends on these types | HIGH - pure functions, easy to test |
| `packages/db` | Schema, connection, tenant-scoped wrapper | HIGH - scoped-db is the security boundary | HIGH - scoped-db is critical path |
| `apps/api/src/core` | CQRS bus, event bus, module registry | HIGH - core infrastructure | MEDIUM - already has 3 tests |
| `packages/modules/auth` | Auth commands, queries, routes, hooks | HIGH - most-used module | HIGH - 5 tests exist, need unit tests for each handler |
| `packages/modules/billing` | Payment adapters, commands, webhooks, jobs | HIGH - money path | HIGH - 4 tests exist, adapters need thorough coverage |
| `packages/config` | Env validation | MEDIUM | LOW - 1 test exists, simple |
| `packages/queue` | BullMQ wrapper | MEDIUM | LOW - 1 test exists |
| `packages/api-client` | Eden Treaty setup | MEDIUM - consumer docs matter | LOW - thin wrappers |
| `packages/ui` | shadcn components | LOW - shadcn components are well-known | MEDIUM - 9 a11y tests, add render tests |
| `packages/i18n` | i18n JSON resources | LOW | LOW - static data |
| `apps/web` | Next.js pages/components | MEDIUM | MEDIUM - page-level tests |
| `apps/admin` | Vite dashboard pages | MEDIUM | MEDIUM - page-level tests |

## Recommended Documentation Structure

```
docs/                              # NEW top-level directory
├── getting-started.md             # Clone, install, configure, run
├── architecture.md                # System overview, module pattern, CQRS, data flow
├── configuration.md               # Env vars, module config, provider selection
├── modules/
│   ├── creating-a-module.md       # Step-by-step module creation guide
│   ├── auth.md                    # Auth module reference
│   └── billing.md                 # Billing module reference
├── testing.md                     # Test conventions, how to write tests, runners
├── deployment.md                  # Docker, Vercel, VPS setup
└── integrations/
    ├── stripe.md                  # Stripe setup, webhooks, testing
    ├── pagarme.md                 # Pagar.me setup
    ├── resend.md                  # Email setup, React Email templates
    ├── better-auth.md             # Auth configuration, OAuth providers
    └── i18n.md                    # Adding languages, namespaces
```

### Structure Rationale

- **Top-level `docs/`:** Not inside any package -- these are cross-cutting guides that reference multiple packages. Co-locating with a single package would be misleading.
- **`modules/`:** Each module gets a reference doc. The "creating a module" guide is the most valuable doc for the starter kit's purpose (fork and extend).
- **`integrations/`:** Third-party service setup is configuration-heavy and changes independently of the codebase architecture.
- **No auto-generated API docs:** The codebase is 16K lines. JSDoc annotations serve as inline docs read in-editor, not as an auto-generated doc site. A `typedoc` build is unnecessary overhead for a starter kit.

## Architectural Patterns

### Pattern 1: Co-located Tests in `__tests__/` Directories

**What:** Tests live in `__tests__/` subdirectories alongside the code they test, NOT in a separate top-level `tests/` folder.
**When to use:** All packages and apps in this monorepo.
**Trade-offs:** Keeps tests close to implementation (easy to find, easy to maintain). Slightly noisier file tree, but standard for the JS ecosystem.

**This is already the established pattern** -- all 29 existing test files follow it. Do not change it.

```
packages/modules/auth/src/
├── commands/
│   ├── create-tenant.ts
│   └── ...
├── queries/
│   └── ...
├── __tests__/                     # Existing: integration tests
│   ├── auth-setup.test.ts
│   ├── tenant-crud.test.ts
│   └── ...
└── commands/__tests__/            # NEW: unit tests per command
    ├── create-tenant.test.ts
    └── ...
```

**Key decision: Where to add NEW unit tests.**

The existing `__tests__/` at module root contains integration tests (they spin up auth, hit routes). New unit tests for individual command/query handlers should go in `__tests__/` subdirectories within `commands/` and `queries/` folders to maintain separation:

```
packages/modules/auth/src/
├── commands/
│   ├── create-tenant.ts
│   ├── update-tenant.ts
│   └── __tests__/                 # NEW - unit tests for commands
│       ├── create-tenant.test.ts
│       └── update-tenant.test.ts
├── queries/
│   ├── get-tenant.ts
│   └── __tests__/                 # NEW - unit tests for queries
│       └── get-tenant.test.ts
└── __tests__/                     # EXISTING - integration tests (keep as-is)
    ├── auth-setup.test.ts
    └── tenant-crud.test.ts
```

This gives clear separation: root `__tests__` = integration, subdirectory `__tests__` = unit.

### Pattern 2: JSDoc for CQRS Handlers (Commands and Queries)

**What:** A standardized JSDoc template for every command and query handler.
**When to use:** Every file in `commands/` and `queries/` across all modules.
**Trade-offs:** Slightly verbose but provides essential context for anyone forking the starter kit.

**Template for commands:**
```typescript
/**
 * Create a new tenant (organization) via better-auth's org plugin.
 *
 * @remarks
 * Uses better-auth's org API directly (not scopedDb) because auth/org
 * tables are managed by better-auth and not tenant-scoped.
 *
 * Emits: `tenant.created` with `{ tenantId, createdBy }`
 *
 * @param input - Validated against CreateTenantInput schema (name, optional slug)
 * @param ctx - Handler context with userId, tenantId, db, emit, enqueue
 * @returns Ok with organization object, or Err with error message
 *
 * @example
 * ```typescript
 * const result = await cqrs.execute("auth:create-tenant", {
 *   name: "Acme Corp",
 *   slug: "acme-corp"
 * }, ctx);
 * ```
 */
```

**Key JSDoc elements for CQRS handlers:**
1. What the handler does (one sentence)
2. `@remarks` for architectural notes (why scopedDb vs raw, auth API quirks)
3. Events emitted (critical for understanding side effects)
4. `@param` with schema reference
5. `@returns` with Result type explanation
6. `@example` showing CQRS bus invocation

### Pattern 3: JSDoc for Port/Adapter Interfaces

**What:** Document the port interface methods with contract-level JSDoc, then each adapter documents implementation-specific behavior.
**When to use:** `PaymentProvider` port and its adapters (Stripe, Pagar.me).
**Trade-offs:** More upfront doc work, but essential for anyone adding a new payment adapter.

```typescript
/**
 * Payment provider port interface.
 *
 * All payment provider adapters MUST implement this interface.
 * The billing module calls these methods through the factory-resolved adapter --
 * it never knows which provider is active.
 *
 * @remarks
 * - `createPortalSession` returns null when the provider has no hosted portal (e.g., Pagar.me)
 * - `reportUsage` is optional -- only providers with usage metering implement it
 * - `normalizeEvent` converts provider-specific webhook events into the shared NormalizedEvent shape
 *
 * @see StripeAdapter - Stripe implementation
 * @see PagarmeAdapter - Pagar.me implementation
 */
export interface PaymentProvider {
  /**
   * Create a customer record in the payment provider.
   *
   * Called during tenant creation (via `on-tenant-created` hook).
   * The returned `providerCustomerId` is stored in the billing_customers table.
   *
   * @param params - Customer email and optional metadata
   * @returns Provider customer with ID for storage
   * @throws When provider API is unreachable or rate-limited
   */
  createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer>;
  // ...
}
```

### Pattern 4: JSDoc for Tenant-Scoped Database Wrapper

**What:** Document the scoped-db security boundary clearly, especially the `raw` escape hatch.
**When to use:** `packages/db/src/helpers/scoped-db.ts`

```typescript
/**
 * Tenant-scoped Drizzle query wrapper.
 *
 * @remarks
 * **SECURITY BOUNDARY** -- This wrapper automatically applies `WHERE tenant_id = ?`
 * on all select/update/delete and injects `tenantId` on all inserts.
 * Using this wrapper makes cross-tenant data access structurally impossible.
 *
 * The `raw` property exposes the underlying Drizzle instance for queries that
 * genuinely need cross-tenant access (e.g., admin endpoints, migrations).
 *
 * @warning The `raw` property bypasses tenant isolation. Only use for admin
 * operations that explicitly need cross-tenant access. Document WHY when using it.
 */
```

### Pattern 5: Module Definition JSDoc

**What:** Each module's `index.ts` export gets a comprehensive JSDoc block documenting the full module surface area.
**When to use:** Every module's default export.

This pattern already exists (see auth and billing module indexes). Enhance it with:
- `@see` links to relevant docs pages
- Full list of CQRS command/query names with brief descriptions
- Job queue names and their purposes
- Event names and their payloads

## Data Flow

### JSDoc Coverage Flow (Build Order)

```
Phase 1: Foundation Types
    packages/shared/src/types/*.ts     (Result, HandlerContext, ModuleDefinition)
    packages/shared/src/result.ts      (ok, err helpers)
    packages/db/src/helpers/scoped-db.ts (ScopedDb interface)
         |
Phase 2: Core Infrastructure
    apps/api/src/core/cqrs.ts          (CqrsBus class)
    apps/api/src/core/event-bus.ts     (TypedEventBus class)
    apps/api/src/core/registry.ts      (ModuleRegistry class)
    apps/api/src/core/middleware/*.ts   (tenant, error, request-trace)
         |
Phase 3: Database and Config Layer
    packages/db/src/schema/*.ts        (all table definitions)
    packages/db/src/connection.ts      (DB connection setup)
    packages/config/src/env.ts         (env validation)
    packages/queue/src/*.ts            (BullMQ wrapper)
         |
Phase 4: Module Handlers
    packages/modules/auth/src/commands/*.ts
    packages/modules/auth/src/queries/*.ts
    packages/modules/billing/src/commands/*.ts
    packages/modules/billing/src/queries/*.ts
    packages/modules/billing/src/ports/*.ts
    packages/modules/billing/src/adapters/**/*.ts
    packages/modules/billing/src/jobs/*.ts
         |
Phase 5: Routes and Frontend Integration
    packages/modules/*/src/routes.ts
    packages/api-client/src/*.ts
    apps/web/**/*.ts(x)
    apps/admin/**/*.ts(x)
    packages/ui/src/components/*.tsx
```

### Test Coverage Flow (Build Order)

```
Phase 1: Pure Functions (easiest, highest value)
    packages/shared/src/result.ts      -> ok(), err() return correct shapes
    packages/shared/src/types/cqrs.ts  -> defineCommand/defineQuery validation
    packages/db/src/helpers/scoped-db.ts -> tenant filtering correctness
         |
Phase 2: Core Infrastructure (already partially tested)
    apps/api/src/core/cqrs.ts          -> expand existing 4 tests
    apps/api/src/core/event-bus.ts     -> async error handling, off()
    apps/api/src/core/registry.ts      -> module loading, error paths
         |
Phase 3: Command/Query Handlers (highest business value)
    Each handler gets a unit test:
    - Mock HandlerContext (db, emit, enqueue)
    - Test validation (invalid input -> VALIDATION_ERROR)
    - Test happy path (valid input -> ok result)
    - Test error paths (external failure -> err result)
    - Test event emission (handler calls ctx.emit with correct args)
         |
Phase 4: Adapters and Jobs
    Billing adapters: mock Stripe/Pagar.me SDK, verify mapping
    Job handlers: mock dependencies, verify side effects
    Webhook normalization: existing tests, expand edge cases
         |
Phase 5: Frontend Components
    UI components: render tests (already have a11y tests)
    Admin routes: component render + data display tests (Vitest)
    Web pages: basic render tests (Vitest)
```

### Documentation Flow (Build Order)

```
Phase 1: Architecture and Getting Started
    docs/architecture.md        -> system overview for new developers
    docs/getting-started.md     -> clone-to-running guide
         |
Phase 2: Module Development Guide
    docs/modules/creating-a-module.md  -> THE most valuable doc
         |
Phase 3: Configuration and Testing
    docs/configuration.md       -> env vars, module config
    docs/testing.md             -> test conventions, mocking patterns
         |
Phase 4: Integration Guides
    docs/integrations/stripe.md
    docs/integrations/better-auth.md
    docs/integrations/resend.md
    docs/integrations/pagarme.md
    docs/integrations/i18n.md
         |
Phase 5: Module References
    docs/modules/auth.md
    docs/modules/billing.md
    docs/deployment.md
```

## Key Integration Points

### Test Runner Configuration

| Package/App | Test Runner | Config | Reason |
|-------------|-------------|--------|--------|
| `apps/api` | `bun test` | bunfig.toml (if needed) | Backend, Bun-native, existing pattern |
| `packages/shared` | `bun test` | None needed | Pure TS, no DOM |
| `packages/db` | `bun test` | None needed | Existing pattern |
| `packages/config` | `bun test` | None needed | Existing pattern |
| `packages/queue` | `bun test` | None needed | Existing pattern |
| `packages/modules/*` | `bun test` | None needed | Existing pattern |
| `packages/ui` | Vitest | `vitest.config.ts` (exists) | React components need jsdom/happy-dom |
| `apps/web` | Vitest | Need to add config | React components, Next.js |
| `apps/admin` | Vitest | Need to add config | React components, Vite |

**New files needed:**
- `apps/web/vitest.config.ts` -- for Next.js page component tests
- `apps/admin/vitest.config.ts` -- for admin dashboard tests (if not reusing Vite config)
- Root `package.json` needs `test` and `test:unit` scripts

**Suggested root scripts to add:**
```json
{
  "test": "bun test && cd packages/ui && bun run test",
  "test:api": "bun test --filter 'apps/api'",
  "test:modules": "bun test --filter 'packages/modules'",
  "test:ui": "cd packages/ui && bun run test"
}
```

### JSDoc and TypeScript Integration

- `tsconfig.json` already has `"declaration": true` and `"declarationMap": true` -- JSDoc comments in `.ts` files will appear in generated `.d.ts` files and in IDE hover
- No additional tooling needed. JSDoc works natively with TypeScript. No `typedoc` build step required.
- Biome does not lint JSDoc quality (it lints syntax, not doc content). JSDoc quality is enforced by review, not tooling.

### Mocking Patterns for Unit Tests

The codebase already demonstrates the correct mocking approach:

**For command/query handler unit tests:**
```typescript
import { describe, expect, it } from "bun:test";
import type { HandlerContext } from "@baseworks/shared";

// Minimal mock context -- just what the handler uses
const mockCtx: HandlerContext = {
  tenantId: "test-tenant-id",
  userId: "test-user-id",
  db: {}, // Mock scoped DB -- per-test overrides
  emit: () => {}, // Spy on this for event emission tests
};
```

**For adapter tests (mocking external SDKs):**
```typescript
import { mock } from "bun:test";

// Mock external SDK BEFORE importing the module under test
mock.module("stripe", () => ({
  default: class MockStripe { /* ... */ },
}));

const { createCheckoutSession } = await import("../commands/create-checkout-session");
```

**For React component tests (Vitest):**
```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
```

## Anti-Patterns

### Anti-Pattern 1: Generating API Documentation Sites

**What people do:** Set up typedoc/api-extractor to auto-generate HTML documentation from JSDoc
**Why it's wrong:** This is a starter kit, not a library. Nobody reads auto-generated API docs for a project they fork and own. The maintenance burden of keeping generated docs in sync is pure overhead.
**Do this instead:** Write JSDoc for IDE consumption (hover, autocomplete). Write prose docs in `docs/` for concepts and guides.

### Anti-Pattern 2: Testing Through the HTTP Layer When You Can Test Handlers Directly

**What people do:** Write all tests as HTTP integration tests hitting Elysia routes
**Why it's wrong:** Integration tests are slow, require full app bootstrap, and conflate routing/auth/validation failures with business logic failures. The existing integration tests at `apps/api/src/__tests__/` are valuable but insufficient for coverage.
**Do this instead:** Unit test command/query handlers directly by calling the function with a mock `HandlerContext`. Keep integration tests for route-level concerns (auth, middleware, serialization).

### Anti-Pattern 3: Duplicating JSDoc Between Interface and Implementation

**What people do:** Copy the same JSDoc from the `PaymentProvider` interface onto `StripeAdapter.createCustomer()` and `PagarmeAdapter.createCustomer()`
**Why it's wrong:** JSDoc on interface methods is inherited by implementations in IDEs. Duplicating it means maintaining two copies that drift apart.
**Do this instead:** Put the contract-level JSDoc on the interface. On the adapter implementation, only add `@remarks` for adapter-specific behavior (e.g., Stripe-specific rate limit handling).

### Anti-Pattern 4: Putting Module-Specific Docs in the Module Package

**What people do:** Create `packages/modules/auth/docs/` with module documentation
**Why it's wrong:** Cross-cutting concerns (how auth interacts with billing, how modules register into the CQRS bus) get split across packages and nobody finds them. The starter kit's docs should be a cohesive narrative, not scattered per-package fragments.
**Do this instead:** Top-level `docs/` directory with module reference pages. Each page covers one module end-to-end, including its integration points with other modules.

### Anti-Pattern 5: Writing Tests That Test the Framework

**What people do:** Test that Elysia returns 200, that Drizzle inserts rows, that BullMQ enqueues jobs
**Why it's wrong:** You are testing third-party code, not your business logic. These tests are slow and fragile.
**Do this instead:** Test YOUR logic -- validation rules, business rules, event emissions, error handling. Trust that Elysia routes work; test that your handler returns the correct Result shape.

## New Directories and Files Summary

### New Directories

| Directory | Purpose |
|-----------|---------|
| `docs/` | Top-level developer documentation |
| `docs/modules/` | Module reference docs |
| `docs/integrations/` | Third-party integration guides |
| `packages/shared/src/__tests__/` | Unit tests for Result monad, defineCommand, defineQuery |
| `packages/modules/auth/src/commands/__tests__/` | Unit tests for auth commands |
| `packages/modules/auth/src/queries/__tests__/` | Unit tests for auth queries |
| `packages/modules/billing/src/commands/__tests__/` | Unit tests for billing commands |
| `packages/modules/billing/src/queries/__tests__/` | Unit tests for billing queries |
| `packages/modules/billing/src/jobs/__tests__/` | Unit tests for job handlers |
| `packages/modules/billing/src/adapters/stripe/__tests__/` | Unit tests for Stripe adapter |
| `packages/modules/billing/src/adapters/pagarme/__tests__/` | Unit tests for Pagar.me adapter |

### Modified Existing Files (JSDoc annotations added)

All 156 source files get JSDoc. No structural changes -- just adding documentation comments above exports, classes, interfaces, functions, and non-obvious logic.

### New Config Files

| File | Purpose |
|------|---------|
| `apps/web/vitest.config.ts` | Vitest config for Next.js page tests |
| `apps/admin/vitest.config.ts` | Vitest config for admin dashboard tests (if not reusing Vite config) |

## Build Order Rationale

**JSDoc before tests before docs** because:
1. JSDoc forces you to understand each function's contract before writing tests
2. Writing tests exposes undocumented edge cases that improve JSDoc
3. Prose docs are easiest to write after you have annotated and tested everything

**Bottom-up within each phase** (shared -> core -> modules -> apps) because:
1. `packages/shared` types are imported everywhere -- annotating them first means IDE hints propagate immediately
2. Core infrastructure (CQRS, registry) is the framework's "API" -- getting these docs right helps everything downstream
3. Module handlers are the most numerous files and benefit from established patterns
4. Frontend files have the least documentation need (React components are largely self-documenting via props types)

**Priority within modules: auth before billing** because:
1. Auth has more handlers (8 commands + 6 queries vs 6 + 2)
2. Auth patterns (better-auth API wrapping, org plugin quirks) are less obvious than billing patterns
3. Auth module is used by every other module

## Sources

- Direct codebase analysis (29 existing test files, 156 source files examined)
- Existing test patterns in `apps/api/src/core/__tests__/` and `packages/modules/billing/src/__tests__/`
- TypeScript handbook on JSDoc annotations (training data, HIGH confidence)
- Bun test runner documentation (training data, HIGH confidence -- `bun test` features are stable)
- Vitest documentation for React component testing (training data, HIGH confidence)

---
*Architecture research for: Documentation and Quality milestone*
*Researched: 2026-04-16*
