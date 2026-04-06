# Phase 1: Foundation & Core Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-05
**Phase:** 01-foundation-core-infrastructure
**Areas discussed:** Module registry design, CQRS conventions, Tenant scoping strategy, Monorepo package layout

---

## Module Registry Design

| Option | Description | Selected |
|--------|-------------|----------|
| Config-driven | Central config file lists modules. Simple, explicit, toggleable. | ✓ |
| File-convention auto-discovery | Scan modules/ dir, auto-register by pattern. Less config, harder to control. | |

**User's choice:** Config-driven
**Notes:** Recommended option selected — aligns with Medusa-style explicit loading.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Single index file | Module exports { name, routes, commands, queries, jobs, events } from index.ts | ✓ |
| Directory convention | Separate files: routes.ts, commands.ts, queries.ts per module | |
| Decorator/class-based | NestJS-style classes with decorators | |

**User's choice:** Single index file
**Notes:** Flat, Medusa-inspired approach.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, explicit depends array | Module declares deps, registry validates and orders | |
| No, keep it flat | Modules independent at registry level, communicate via CQRS | ✓ |
| You decide | Claude picks | |

**User's choice:** No, keep it flat
**Notes:** Cross-module communication through CQRS, not direct dependencies.

---

| Option | Description | Selected |
|--------|-------------|----------|
| packages/modules/<name>/ | Each module as own workspace package | ✓ |
| apps/api/src/modules/<name>/ | Modules inside API app | |
| You decide | Claude picks | |

**User's choice:** packages/modules/<name>/
**Notes:** Clean isolation, independent deps, extractable.

---

## CQRS Conventions

| Option | Description | Selected |
|--------|-------------|----------|
| Function-based | Plain async (input, ctx) => result functions | ✓ |
| Class-based with execute() | Classes with execute() method, constructor injection | |
| You decide | Claude picks | |

**User's choice:** Function-based
**Notes:** Simple, testable, no class overhead.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, simple event bus | In-process typed event bus, pub/sub, no event store | ✓ |
| No events in v1 | Pure CQRS without events | |
| You decide | Claude picks | |

**User's choice:** Yes, simple event bus
**Notes:** Practical CQRS with lightweight pub/sub.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Zod schemas from Drizzle | drizzle-zod for single source of truth | |
| TypeBox (Elysia built-in) | Use Elysia's native TypeBox for all validation | ✓ |
| Both — TypeBox at route, Zod at handler | Two validation layers | |

**User's choice:** TypeBox (Elysia built-in)
**Notes:** User chose TypeBox for consistency with Elysia over drizzle-zod. This diverges from CLAUDE.md stack recommendation — intentional user override.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Typed result pattern | Return { success, data/error }. No thrown exceptions. | ✓ |
| Throw custom errors | Typed error classes caught by Elysia error handler | |
| You decide | Claude picks | |

**User's choice:** Typed result pattern
**Notes:** Caller decides how to handle errors.

---

## Tenant Scoping Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Request context object | Elysia middleware injects tenantId into typed context | ✓ |
| AsyncLocalStorage | Implicit tenant via AsyncLocalStorage | |
| You decide | Claude picks | |

**User's choice:** Request context object
**Notes:** Explicit, framework-native, traceable.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Scoped query builder | scopedDb(tenantId) auto-adds tenant filtering | ✓ |
| Helper functions per operation | findByTenant() wrappers | |
| You decide | Claude picks | |

**User's choice:** Scoped query builder
**Notes:** Transparent, hard to forget.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Separate admin DB instance | unscopedDb() for admin/system operations | ✓ |
| Flag on scoped builder | scopedDb(id, { admin: true }) | |
| No escape hatch | All queries scoped, admin uses 'system' tenant | |

**User's choice:** Separate admin DB instance
**Notes:** Explicit escape hatch, audit-friendly.

---

## Monorepo Package Layout

| Option | Description | Selected |
|--------|-------------|----------|
| packages/db | Drizzle schema, migrations, connection, tenant wrapper | ✓ |
| packages/shared | Types, CQRS interfaces, module types, utilities | ✓ |
| packages/config | Env validation, shared configuration | ✓ |
| packages/ui | shadcn/ui + Tailwind 4 (could wait for Phase 4) | |

**User's choice:** packages/db, packages/shared, packages/config (ui deferred to Phase 4)

---

| Option | Description | Selected |
|--------|-------------|----------|
| apps/api only | Just Elysia server, worker shares codebase | ✓ |
| apps/api + apps/worker | Separate worker app | |
| You decide | Claude picks | |

**User's choice:** apps/api only
**Notes:** Worker uses same codebase, different entrypoint per FNDTN-07.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Bun workspace aliases | @baseworks/db, @baseworks/shared via workspace:* | ✓ |
| Relative paths with tsconfig | @/db mapped to relative paths | |

**User's choice:** Bun workspace aliases
**Notes:** Standard monorepo pattern, clean import paths.

---

## Claude's Discretion

- Module registry initialization order and lifecycle hooks
- Event bus implementation details
- Drizzle migration tooling configuration
- Worker entrypoint implementation approach
- TypeBox schema patterns for CQRS
- Basic logging approach in Phase 1

## Deferred Ideas

None — discussion stayed within phase scope
