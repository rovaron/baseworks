# Feature Research: v1.2 Documentation & Quality

**Domain:** Developer documentation, JSDoc annotations, and unit testing for a TypeScript monorepo SaaS starter kit
**Researched:** 2026-04-16
**Confidence:** HIGH (well-established practices; verified against codebase structure)

## Feature Landscape

### Table Stakes (Users Expect These)

For a "fork-and-build" starter kit claiming production-grade status, these are non-negotiable. Developers evaluating Baseworks will compare against Makerkit, Supastarter, and similar kits where documentation quality directly drives adoption.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **JSDoc on all public interfaces (types, ports, CQRS contracts)** | Developers forking the kit need IDE tooltips explaining what each type/interface means without reading source. The `PaymentProvider` port, `ModuleDefinition`, `HandlerContext`, CQRS types are the API surface. | MEDIUM | ~30 exported types/interfaces across `packages/shared`, `packages/modules/*/ports`, `packages/db/schema`. Already partially done (payment-provider.ts has good JSDoc). |
| **JSDoc on all command/query handlers** | CQRS handlers ARE the business logic API. Each handler needs: what it does, params, return type, side effects, events emitted. | MEDIUM | ~25 handlers across auth (8 commands, 6 queries), billing (6 commands, 2 queries), example (1+1). Pattern is consistent so can be templated. |
| **JSDoc on core infrastructure (registry, CQRS bus, event bus, middleware)** | These are the framework internals developers must understand to add modules. Without docs, they reverse-engineer from source. | LOW | ~7 files in `apps/api/src/core/`. Some already have file-level JSDoc. Need method-level docs. |
| **Unit tests for CQRS handlers (commands and queries)** | Handlers are pure-ish functions (input + context -> result). Easy to test, high value. Missing tests = "is this code correct?" uncertainty for forkers. | HIGH | ~25 handlers need tests. Each test needs mock context (db, emit, tenantId). Existing `cqrs.test.ts` shows the pattern. Largest effort item. |
| **Unit tests for core infrastructure** | Registry, CQRS bus, event bus are the backbone. Tests prove they work and serve as living documentation. | LOW | 3 test files already exist (`cqrs.test.ts`, `event-bus.test.ts`, `registry.test.ts`). May need expansion but baseline is there. |
| **Getting Started guide** | First thing a developer reads after cloning. Must cover: prerequisites, install, env setup, run dev, run tests. | LOW | Single markdown file. Follows standard pattern. |
| **Configuration guide** | Module registry config, env vars, provider selection, deployment config -- developers need to know what knobs exist. | MEDIUM | Must document: module config, env vars per package (config/env.ts validates these), Docker env, Vercel env. |
| **Architecture overview** | High-level "how does this thing work" -- module system, CQRS flow, request lifecycle, tenant scoping, auth flow. | MEDIUM | Diagrams (text-based Mermaid or ASCII) showing request flow, module loading, CQRS dispatch, event propagation. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **"Add a Module" tutorial** | Step-by-step guide for adding a new module with commands, queries, routes, jobs, events. THE critical doc for a modular kit. No competitor has this because no competitor has this architecture. | MEDIUM | Uses the existing `example` module as the walkthrough subject. Covers: module definition, schema, commands/queries, routes, jobs, events, registration. |
| **JSDoc with `@example` blocks on key functions** | Code examples in JSDoc show up directly in IDE autocomplete. Dramatically improves DX vs plain descriptions. | LOW | Add to: `createScopedDb()`, `bus.execute()`, `bus.query()`, `registry.loadModules()`, `emit()`. ~10 key functions. |
| **Testing guide with patterns for mocking tenant context** | CQRS testing requires mocking `HandlerContext` (db, tenantId, emit). A guide showing the pattern once saves every forker from figuring it out. | LOW | Document the mock pattern from existing `cqrs.test.ts`. Show how to test commands (verify side effects), queries (verify returns), event handlers. |
| **Third-party integration docs** | How better-auth is configured, how Stripe/Pagar.me adapters work, how BullMQ queues are set up, how email templates work. Each is a "how to customize X" guide. | HIGH | 4-5 separate docs. Each follows: what it does, how it is configured, how to customize, common tasks. Competitors have this but shallow. |
| **Unit tests for payment provider adapters** | Tests proving both adapters conform to the port interface. High confidence for forkers who will modify billing. | MEDIUM | Already have `pagarme-adapter.test.ts`, `provider-factory.test.ts`, `webhook-normalization.test.ts`. Need Stripe adapter test parity. |
| **Unit tests for tenant-scoped DB wrapper** | The `scoped-db` helper is the security boundary. Tests proving tenant isolation works are trust-building. | LOW | `scoped-db.test.ts` exists. May need more edge case coverage (cross-tenant query prevention). |
| **Inline code comments for non-obvious decisions** | Short `// WHY:` comments on tricky code (not JSDoc, just inline). Explains decisions that aren't obvious from types alone. | LOW | Examples: why static import map instead of dynamic imports, why session-derived tenant context, why idempotency table for webhooks. |
| **API reference (auto-generated from JSDoc)** | TypeDoc generates browsable API docs from JSDoc annotations. Zero maintenance after setup. | MEDIUM | TypeDoc supports monorepo via `entryPointStrategy: "packages"`. Generates HTML docs from existing JSDoc. Setup once, runs in CI. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **100% test coverage target** | "High quality means 100% coverage" | Drives writing tests for trivial code (re-exports, type files, config objects). Coverage gaming produces low-value tests. The ~130 source files include many that are pure config/wiring. | Target coverage on business logic (handlers, adapters, core infra). Skip: UI components (already have a11y tests), config re-exports, schema definitions, route wiring. Aim for 80%+ on handlers/core. |
| **E2E tests in this milestone** | "Test the full flow" | E2E tests require running DB + Redis + API + frontend. Different infrastructure, different tooling (Playwright/Cypress), different maintenance burden. Conflates with unit test goals. | Unit tests for handlers + integration tests for core (already exist). E2E is a separate future milestone. |
| **Storybook for all UI components** | "Visual documentation for components" | Storybook adds significant tooling overhead (config, build pipeline, deployment). The 18+ shadcn components are standard -- developers know what a Button or Dialog looks like. | In-repo docs listing available components with their props. shadcn's own docs serve as the component reference. |
| **External documentation site (Docusaurus/Nextra)** | "Professional docs like a real product" | Baseworks is a starter kit, not a SaaS product. External doc sites need hosting, deployment, versioning. Adds maintenance for a personal tool. | In-repo `/docs` directory with markdown files. Readable on GitHub, readable in IDE, no hosting needed. If needed later, any static site generator can consume markdown. |
| **JSDoc on every single function including React components** | "Comprehensive means everything" | React component props are already typed. JSDoc on `<Button variant="default">` adds noise. shadcn components are documented upstream. | JSDoc on: exported types/interfaces, CQRS handlers, core infrastructure, utility functions, hooks with non-obvious behavior. Skip: standard React components, re-exports, trivial wrappers. |
| **Snapshot tests for UI components** | "Catch unintended UI changes" | Snapshots break on any change (even intentional), creating toil. With shadcn components that get customized, snapshots become noise factories. | Accessibility tests (already exist via vitest-axe) + visual review. Component behavior tests where logic exists (e.g., `data-table-cards.test.tsx`). |
| **Video tutorials** | "Some people prefer video" | High production cost, impossible to update when code changes, doesn't work for a personal starter kit. | Written guides with code snippets. Easy to update, searchable, version-controlled. |

## Feature Dependencies

```
JSDoc Annotations
    |
    +---> Types & interfaces first (packages/shared, ports)
    |       |
    |       +---> Command/query handlers second (reference the types)
    |       |
    |       +---> Core infrastructure third (registry, CQRS bus, event bus)
    |
    +---> No external dependencies. Pure documentation addition.

Unit Tests
    |
    +---> Core infra tests (already partially exist -- expand)
    |       |
    |       +---> Handler tests (depend on understanding mock patterns from core tests)
    |       |
    |       +---> Adapter tests (depend on handler test patterns)
    |
    +---> Depends on: existing test infrastructure (bun:test for backend, vitest for UI)
    +---> Does NOT depend on JSDoc (but benefits from doing JSDoc first -- clarifies intent)

Developer Documentation
    |
    +---> Getting Started guide (no dependencies -- first doc written)
    |
    +---> Architecture overview (depends on understanding codebase -- JSDoc helps)
    |       |
    |       +---> "Add a Module" tutorial (references architecture overview)
    |
    +---> Configuration guide (standalone, references env.ts validation)
    |
    +---> Testing guide (depends on unit tests existing -- documents patterns found)
    |
    +---> Integration docs (standalone per integration -- auth, billing, email, queue)
    |
    +---> Depends on: JSDoc done first (docs reference the same concepts)
```

### Dependency Notes

- **JSDoc before tests:** Annotating handlers clarifies their contract (params, return, side effects), making test writing faster and more accurate.
- **JSDoc before docs:** Developer documentation references the same types and interfaces. Having JSDoc done means docs can say "see `PaymentProvider` interface" and IDE users get the full picture.
- **Core tests before handler tests:** The mock pattern for `HandlerContext` is established in core tests. Handler tests reuse it.
- **Getting Started is independent:** Can be written anytime. Should be first doc because it is the entry point.
- **Architecture overview before module tutorial:** The tutorial references concepts (module registry, CQRS bus, event system) that the architecture doc explains.

## Scope Definition

### Phase 1: JSDoc Annotations

- [ ] **All exported types and interfaces** -- `packages/shared/src/types/`, `packages/modules/*/ports/`, `packages/db/src/schema/`
- [ ] **All CQRS command and query handlers** -- standardized JSDoc block per handler
- [ ] **Core infrastructure methods** -- `CqrsBus`, `EventBus`, `ModuleRegistry`, middleware
- [ ] **Key utility functions** -- `createScopedDb`, `createUnscopedDb`, result helpers, `cn()`
- [ ] **`@example` blocks on 10-15 key functions** -- the ones developers call most often

### Phase 2: Unit Tests

- [ ] **Expand core infrastructure tests** -- edge cases for registry, CQRS bus, event bus
- [ ] **Auth module handler tests** -- all 8 commands + 6 queries
- [ ] **Billing module handler tests** -- all 6 commands + 2 queries
- [ ] **Adapter conformance tests** -- both payment adapters against port interface
- [ ] **Scoped DB edge cases** -- cross-tenant prevention, empty tenant handling
- [ ] **Config/env validation tests** -- `packages/config` validation logic

### Phase 3: Developer Documentation

- [ ] **Getting Started** -- clone, install, configure, run, test
- [ ] **Architecture Overview** -- module system, CQRS flow, request lifecycle, tenant scoping
- [ ] **"Add a Module" Tutorial** -- step-by-step using example module as reference
- [ ] **Configuration Guide** -- env vars, module config, provider selection, deployment
- [ ] **Testing Guide** -- how to write tests, mock patterns, running tests
- [ ] **Integration Docs** -- better-auth setup, Stripe/Pagar.me customization, BullMQ queues, email templates

### Defer to v1.3+

- [ ] **Auto-generated API reference site (TypeDoc)** -- setup is low effort but hosting/deployment is out of scope
- [ ] **E2E test suite** -- requires separate infrastructure (Playwright + test DB + test Redis)
- [ ] **Contributing guide** -- only relevant if/when the project goes open source
- [ ] **Changelog/migration guide** -- only relevant after multiple major versions exist

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| JSDoc on exported types/interfaces | HIGH | LOW | P1 |
| JSDoc on CQRS handlers | HIGH | MEDIUM | P1 |
| JSDoc on core infrastructure | HIGH | LOW | P1 |
| `@example` blocks on key functions | MEDIUM | LOW | P1 |
| Unit tests for auth command handlers | HIGH | HIGH | P1 |
| Unit tests for auth query handlers | HIGH | MEDIUM | P1 |
| Unit tests for billing command handlers | HIGH | HIGH | P1 |
| Unit tests for billing query handlers | HIGH | LOW | P1 |
| Expand core infrastructure tests | MEDIUM | LOW | P1 |
| Adapter conformance tests | MEDIUM | MEDIUM | P1 |
| Scoped DB edge case tests | MEDIUM | LOW | P1 |
| Config/env validation tests | LOW | LOW | P2 |
| Getting Started guide | HIGH | LOW | P1 |
| Architecture overview with diagrams | HIGH | MEDIUM | P1 |
| "Add a Module" tutorial | HIGH | MEDIUM | P1 |
| Configuration guide | MEDIUM | LOW | P1 |
| Testing guide (mock patterns) | MEDIUM | LOW | P1 |
| Integration docs (auth, billing, email, queue) | MEDIUM | HIGH | P2 |
| Inline `// WHY:` comments on tricky code | LOW | LOW | P2 |
| TypeDoc auto-generation setup | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v1.2 launch
- P2: Should have, add if time permits
- P3: Nice to have, future consideration

## Detailed Feature Specifications

### 1. JSDoc Annotation Strategy

**What to annotate (in priority order):**

1. **Exported types and interfaces** -- the API surface that forkers depend on
   - `packages/shared/src/types/` (ModuleDefinition, HandlerContext, CommandHandler, QueryHandler, DomainEvent, Result)
   - `packages/modules/billing/src/ports/` (PaymentProvider, all param/result types)
   - `packages/db/src/schema/` (table definitions, column helpers)

2. **CQRS handlers** -- the business logic layer
   - Standardized block: purpose, `@param`, `@returns`, `@throws`, `@emits` (custom tag for domain events), `@example`
   - Example template:
   ```typescript
   /**
    * Creates a new tenant and assigns the requesting user as owner.
    *
    * @param input - Tenant creation params (name, slug)
    * @param ctx - Handler context with authenticated user's tenantId and scoped DB
    * @returns Result with created tenant data or SLUG_TAKEN / TENANT_LIMIT_REACHED error
    * @emits tenant:created - Triggers billing customer creation via on-tenant-created hook
    *
    * @example
    * const result = await bus.execute("auth:create-tenant", { name: "Acme", slug: "acme" }, ctx);
    */
   ```

3. **Core infrastructure** -- method-level JSDoc on public methods
   - `CqrsBus.execute()`, `CqrsBus.query()`, `CqrsBus.registerCommand()`, `CqrsBus.registerQuery()`
   - `EventBus.emit()`, `EventBus.on()`
   - `ModuleRegistry.loadModules()`, `ModuleRegistry.getModule()`
   - Each middleware function (error, tenant, request-trace)

4. **Utility functions** with non-obvious behavior
   - `createScopedDb()` -- explain tenant isolation mechanism
   - `createUnscopedDb()` -- explain when/why to use unscoped
   - `ok()`, `err()` result helpers
   - `cn()` utility in UI package

**What NOT to annotate:**
- Standard shadcn components (Button, Dialog, etc.) -- documented upstream
- Re-export barrel files (`index.ts` that just re-export)
- Obvious getter/setter methods
- Test files

### 2. Unit Testing Strategy

**Test runner split (already established):**
- `bun test` -- backend (apps/api, packages/modules, packages/db, packages/config, packages/queue, packages/shared)
- `vitest` -- frontend components (packages/ui, accessibility tests)

**Existing test inventory (29 test files):**
- Core infra: 3 tests (cqrs, event-bus, registry)
- API integration: 4 tests (admin-auth, entrypoints, integration, workspace-imports)
- packages/config: 1 test (env)
- packages/db: 2 tests (connection, scoped-db)
- Auth module: 5 tests (auth-setup, invitation, profile, tenant-crud, tenant-session)
- Billing module: 4 tests (billing, pagarme-adapter, provider-factory, webhook-normalization)
- Queue: 1 test (queue)
- UI: 9 tests (7 a11y tests + data-table-cards + skip-link)

**What to add:**
- Auth command handlers: `create-tenant`, `update-tenant`, `delete-tenant`, `update-profile`, `create-invitation`, `accept-invitation`, `cancel-invitation`, `reject-invitation` -- test happy path + error cases
- Auth query handlers: `get-tenant`, `list-tenants`, `get-profile`, `list-members`, `get-invitation`, `list-invitations` -- test return shapes + tenant scoping
- Billing command handlers: `create-checkout-session`, `create-one-time-payment`, `cancel-subscription`, `change-subscription`, `create-portal-session`, `record-usage` -- test provider delegation + error handling
- Billing query handlers: `get-subscription-status`, `get-billing-history` -- test data shaping
- Stripe adapter: parity with existing `pagarme-adapter.test.ts`
- Edge cases for scoped-db, env validation

**Mock strategy for CQRS handler tests:**
```typescript
// Reusable mock context factory
function createMockContext(overrides?: Partial<HandlerContext>): HandlerContext {
  return {
    tenantId: "test-tenant-id",
    db: createMockScopedDb(),   // Mock Drizzle operations
    emit: mock(() => {}),        // Spy on domain events
    ...overrides,
  };
}
```

**Testing patterns by handler type:**
- **Commands:** Assert return value (ok/err) + verify side effects (db writes via mock, events emitted via spy)
- **Queries:** Assert return shape + verify tenant scoping (ensure tenantId is used in queries)
- **Adapters:** Assert interface conformance + verify provider SDK calls via mocks

### 3. Developer Documentation Structure

**Location:** `docs/` directory at repo root. Markdown files, readable on GitHub and in IDE.

```
docs/
  getting-started.md         -- Clone, install, configure, run
  architecture.md            -- System overview, module system, CQRS, data flow
  add-a-module.md            -- Step-by-step tutorial
  configuration.md           -- Env vars, module config, provider selection
  testing.md                 -- How to write and run tests, mock patterns
  integrations/
    auth.md                  -- better-auth configuration and customization
    billing.md               -- Payment provider setup, adding new providers
    email.md                 -- Email templates, Resend config, BullMQ email jobs
    queue.md                 -- BullMQ setup, adding new job types
```

**Getting Started content:**
1. Prerequisites (Bun, Docker, PostgreSQL, Redis)
2. Clone and install (`bun install`)
3. Environment setup (copy `.env.example`, explain each var)
4. Start dependencies (`docker-compose up`)
5. Run migrations (`bun run db:push` or `db:migrate`)
6. Start dev servers (`bun run dev` for API, `bun run dev:web`, `bun run dev:admin`)
7. Run tests (`bun test`, `bun run test:ui`)
8. Next steps: point to architecture.md and add-a-module.md

**Architecture overview content:**
1. Monorepo structure diagram (packages, apps, their relationships)
2. Request lifecycle (HTTP request -> Elysia -> middleware -> CQRS bus -> handler -> response)
3. Module system (how modules register, what a ModuleDefinition contains)
4. CQRS flow (command dispatch, query dispatch, when to use which)
5. Event system (domain events, event handlers, cross-module communication)
6. Tenant scoping (how tenant context flows from session to DB queries)
7. Auth flow (better-auth integration points, session management)
8. Job processing (BullMQ workers, job dispatch from handlers)

**"Add a Module" tutorial content:**
1. Define module schema (Drizzle table with tenantId)
2. Create commands and queries (with types from shared package)
3. Define routes (Elysia plugin with Eden Treaty types)
4. Register jobs (BullMQ queue + worker handler)
5. Emit and handle events (domain event types, event handlers)
6. Register in module config (add to registry, configure loading)
7. Add translations (i18n namespace for the module)
8. Write tests (using established mock patterns)

## Competitor Feature Analysis

| Feature | Makerkit | Supastarter | ixartz/SaaS-Boilerplate | Baseworks v1.2 Plan |
|---------|----------|-------------|-------------------------|---------------------|
| **JSDoc coverage** | Partial (key files) | Minimal | Good (exported types) | Comprehensive (all public API + handlers + core) |
| **Unit tests** | Basic (auth flows) | Basic | Good (Jest suite) | Comprehensive (all handlers + adapters + core) |
| **Getting Started** | Yes (docs site) | Yes (docs site) | Yes (README) | Yes (in-repo markdown) |
| **Architecture docs** | Minimal | Yes (docs site) | Minimal | Yes (detailed with diagrams) |
| **"Add a feature" tutorial** | No | No | No | Yes ("Add a Module" -- unique due to modular architecture) |
| **Testing guide** | No | No | Minimal | Yes (patterns, mocks, strategy) |
| **API reference** | No | No | No | JSDoc-powered IDE tooltips (TypeDoc deferred) |
| **Integration docs** | Partial (auth only) | Partial (auth + billing) | No | Yes (auth, billing, email, queue) |

## Sources

- [TypeDoc monorepo support](https://typedoc.org/) -- entryPointStrategy: "packages" for monorepo docs (HIGH confidence)
- [TSDoc standard](https://tsdoc.org/) -- comment standard for TypeScript (HIGH confidence)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) -- JSDoc conventions for TS (HIGH confidence)
- [Testing Strategies for CQRS Applications](https://reintech.io/blog/testing-strategies-cqrs-applications) -- mocks for commands, stubs for queries pattern (HIGH confidence)
- [Bun test runner docs](https://bun.com/docs/test) -- bun:test API, mocking, lifecycle hooks (HIGH confidence)
- [ixartz/SaaS-Boilerplate](https://github.com/ixartz/SaaS-Boilerplate) -- competitor reference for docs/testing scope (MEDIUM confidence)
- Existing Baseworks test files -- verified patterns in `cqrs.test.ts`, `pagarme-adapter.test.ts`, `scoped-db.test.ts` (HIGH confidence)
- Existing Baseworks JSDoc -- verified `payment-provider.ts` has comprehensive JSDoc, `registry.ts` has partial (HIGH confidence)

---
*Feature research for: Baseworks v1.2 Documentation & Quality*
*Researched: 2026-04-16*
