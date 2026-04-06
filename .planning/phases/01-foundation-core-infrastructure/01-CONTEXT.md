# Phase 1: Foundation & Core Infrastructure - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the monorepo skeleton, Elysia API server, module registry, CQRS command/query layer with event bus, Drizzle + PostgreSQL connection with tenant-scoped queries, environment validation, and dual entrypoint support (API server and worker mode). This phase produces the architectural foundation that every subsequent phase builds on.

</domain>

<decisions>
## Implementation Decisions

### Module Registry Design
- **D-01:** Config-driven registration — a central config file lists which modules to load. No auto-discovery.
- **D-02:** Each module exports a single index.ts with a standard shape: `{ name, routes, commands, queries, jobs, events }`. Medusa-inspired flat declaration.
- **D-03:** No inter-module dependencies at the registry level. Modules communicate through CQRS (commands/queries/events), not direct imports.
- **D-04:** Modules live as workspace packages under `packages/modules/<name>/`. Each module is its own Bun workspace package.

### CQRS Conventions
- **D-05:** Function-based handlers — each handler is a plain `async (input, ctx) => result` function. No classes, no decorators.
- **D-06:** Simple in-process event bus — commands can emit typed domain events (e.g., `user.created`). Other modules subscribe. No event store, no replay. Just pub/sub.
- **D-07:** TypeBox for input validation — use Elysia's native TypeBox for both route validation and CQRS handler validation. Do NOT use drizzle-zod; keep validation unified under TypeBox.
- **D-08:** Typed result pattern for errors — handlers return `{ success: true, data }` or `{ success: false, error: 'CODE' }`. No thrown exceptions for business logic errors.

### Tenant Scoping Strategy
- **D-09:** Request context object — Elysia middleware extracts tenant from session/header and injects into a typed context object. All handlers receive `ctx.tenantId`. Explicit, framework-native.
- **D-10:** Scoped query builder — `scopedDb(tenantId)` returns a Drizzle instance that auto-adds `.where(eq(table.tenantId, id))` to all queries. Transparent tenant filtering.
- **D-11:** Separate admin DB instance — `unscopedDb()` for admin/system operations that need cross-tenant access. Explicit escape hatch, audit-friendly.

### Monorepo Package Layout
- **D-12:** Three shared packages from day one: `packages/db` (Drizzle schema, migrations, connection, tenant wrapper), `packages/shared` (TypeScript types, CQRS interfaces, module types, error types, utilities), `packages/config` (env validation via @t3-oss/env, shared configuration).
- **D-13:** Only `apps/api` scaffolded in Phase 1. Worker shares the same codebase with a different entrypoint (per FNDTN-07). Frontend apps wait for Phase 4.
- **D-14:** Bun workspace aliases — import as `@baseworks/db`, `@baseworks/shared`, `@baseworks/config`. Bun resolves via `workspace:*` in package.json.

### Claude's Discretion
- Module registry initialization order and lifecycle hooks
- Event bus implementation details (EventEmitter vs custom typed bus)
- Drizzle migration tooling configuration (drizzle-kit setup)
- Worker entrypoint implementation (separate file vs env-flag in same entrypoint)
- Specific TypeBox schema patterns for CQRS handlers
- Logging approach within Phase 1 (structured logging deferred to Phase 5, but basic console/pino setup is Claude's call)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Configuration
- `CLAUDE.md` — Full technology stack, version constraints, what NOT to use, integration patterns
- `.planning/PROJECT.md` — Core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — FNDTN-01 through FNDTN-09 acceptance criteria
- `.planning/ROADMAP.md` — Phase 1 goal and success criteria

No external specs — requirements fully captured in decisions above and CLAUDE.md technology stack.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project. No existing code to reuse.

### Established Patterns
- None yet — Phase 1 establishes the patterns all subsequent phases follow.

### Integration Points
- Module registry is the central integration point — all Phase 2+ modules plug into it
- CQRS layer is the communication bus between modules
- Tenant-scoped DB wrapper is the data access gateway for all tenant-aware code

</code_context>

<specifics>
## Specific Ideas

- Medusa-style module system is the explicit inspiration for the registry design
- TypeBox chosen over Zod for validation unification with Elysia (diverges from CLAUDE.md's drizzle-zod suggestion — user explicitly chose TypeBox)
- The scoped query builder pattern (`scopedDb(tenantId)`) should make it impossible to accidentally query cross-tenant data in normal module code

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-core-infrastructure*
*Context gathered: 2026-04-05*
