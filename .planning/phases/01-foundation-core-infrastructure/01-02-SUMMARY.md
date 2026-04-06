---
phase: 01-foundation-core-infrastructure
plan: 02
subsystem: api
tags: [elysia, cqrs, event-bus, module-registry, typebox, pino, medusa-style]

requires:
  - phase: 01-01
    provides: Bun workspace monorepo, CQRS type contracts, Drizzle connection, env validation, schema helpers

provides:
  - Config-driven module registry with static import map (ModuleRegistry)
  - CQRS command/query bus with typed dispatch (CqrsBus)
  - In-process event bus with async error isolation (TypedEventBus)
  - Pino structured logger with dev pretty-printing
  - Example module proving the full module contract (schema, commands, queries, routes)
  - Elysia API entrypoint with health check and module loading
  - App type export for Eden Treaty (Phase 4)

affects: [01-03, 02-auth, 03-billing, 04-frontend]

tech-stack:
  added: [pino, pino-pretty]
  patterns: [static-import-map-for-modules, cqrs-bus-dispatch, event-bus-fire-and-forget, module-definition-contract, elysia-state-injection]

key-files:
  created:
    - apps/api/src/core/registry.ts
    - apps/api/src/core/cqrs.ts
    - apps/api/src/core/event-bus.ts
    - apps/api/src/lib/logger.ts
    - apps/api/src/index.ts
    - packages/modules/example/package.json
    - packages/modules/example/tsconfig.json
    - packages/modules/example/src/index.ts
    - packages/modules/example/src/routes.ts
    - packages/modules/example/src/commands/create-example.ts
    - packages/modules/example/src/queries/list-examples.ts
    - packages/db/src/schema/example.ts
    - apps/api/src/core/__tests__/registry.test.ts
    - apps/api/src/core/__tests__/cqrs.test.ts
    - apps/api/src/core/__tests__/event-bus.test.ts
  modified:
    - packages/db/src/schema/index.ts
    - packages/db/src/index.ts
    - packages/shared/src/types/module.ts
    - tsconfig.json
    - bun.lock

key-decisions:
  - "Used static import map instead of string-interpolated dynamic imports for module loading (Bun compatibility + security)"
  - "ModuleDefinition.routes accepts Elysia plugin instances (not just functions) via union type"
  - "Used Elysia .state() for injecting db, tenantId, emit into route handler context"
  - "Example module manually filters by tenantId (Plan 03 wires scoped db wrapper)"

patterns-established:
  - "Module contract: export default { name, routes, commands, queries, jobs, events } satisfies ModuleDefinition"
  - "Static import map: moduleImportMap in registry.ts maps module names to import functions"
  - "CQRS dispatch: bus.execute('module:command', input, ctx) / bus.query('module:query', input, ctx)"
  - "Event bus: fire-and-forget with async error isolation via try/catch + logger"
  - "Health check: GET /health returns { status, modules[] }"

requirements-completed: [FNDTN-01, FNDTN-02, FNDTN-03]

duration: 5min
completed: 2026-04-06
---

# Phase 01 Plan 02: Module Registry, CQRS Bus, Event Bus, and Example Module Summary

**Config-driven module registry with CQRS command/query dispatch, in-process event bus with async error isolation, and example module proving the full Medusa-style module contract**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-06T02:20:25Z
- **Completed:** 2026-04-06T02:24:55Z
- **Tasks:** 3
- **Files modified:** 19

## Accomplishments
- Module registry loads modules from config via static import map and registers commands/queries into CQRS bus
- CQRS bus dispatches commands and queries to handlers, returns typed Result with proper not-found errors
- Event bus delivers events to subscribers with fire-and-forget semantics (errors logged, not propagated)
- Example module proves the full contract: schema, create command with TypeBox validation, list query, Elysia routes
- 10 unit tests covering all core infrastructure (registry, CQRS bus, event bus)

## Task Commits

Each task was committed atomically:

1. **Task 1: Module registry, CQRS bus, event bus, logger** - `f53df1b` (feat)
2. **Task 2: Example module with schema, commands, queries, routes** - `35be07c` (feat)
3. **Task 3: Tests and API entrypoint** - `986532a` (test) + `c5d558d` (feat)

## Files Created/Modified
- `apps/api/src/core/registry.ts` - Config-driven ModuleRegistry with static import map
- `apps/api/src/core/cqrs.ts` - CqrsBus with command/query dispatch and not-found handling
- `apps/api/src/core/event-bus.ts` - TypedEventBus wrapping EventEmitter with async error isolation
- `apps/api/src/lib/logger.ts` - Pino logger with dev pretty-printing
- `apps/api/src/index.ts` - Elysia server entrypoint with cors, swagger, health check, module loading
- `packages/modules/example/src/index.ts` - Module definition (name, routes, commands, queries, events)
- `packages/modules/example/src/routes.ts` - POST / and GET / routes at /examples
- `packages/modules/example/src/commands/create-example.ts` - TypeBox-validated create command with event emission
- `packages/modules/example/src/queries/list-examples.ts` - List query with manual tenant filtering
- `packages/db/src/schema/example.ts` - Examples table with tenantId, title, description, timestamps, index
- `apps/api/src/core/__tests__/registry.test.ts` - 3 tests: load module, empty config, invalid module
- `apps/api/src/core/__tests__/cqrs.test.ts` - 4 tests: command dispatch, query dispatch, not-found errors
- `apps/api/src/core/__tests__/event-bus.test.ts` - 3 tests: emit/subscribe, sync error catch, async error catch
- `tsconfig.json` - Added module-* path mappings and modules include glob
- `packages/shared/src/types/module.ts` - Updated routes type to accept Elysia plugin instances

## Decisions Made
- **Static import map over string interpolation:** Module names are mapped to import functions in a `moduleImportMap` constant. This ensures imports are statically analyzable by Bun and prevents arbitrary string-based dynamic imports (security per T-01-04).
- **ModuleDefinition.routes union type:** Changed from `(app: any) => any` to `((app: any) => any) | any` because Elysia plugins are instances passed to `.use()`, not functions.
- **Elysia .state() for context injection:** Used `.state()` to put db, tenantId, and emit on the store. Routes access via `store`. Plan 03 will replace with proper derive/middleware.
- **Manual tenant filtering in example query:** The list-examples query manually filters by tenantId. Plan 03 wires the scopedDb wrapper for automatic filtering.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed drizzle-orm version mismatch in example module**
- **Found during:** Task 2 (typecheck)
- **Issue:** Example module had `drizzle-orm: ^0.36.0` while db package has `^0.45.0`, causing incompatible types
- **Fix:** Updated example module to `^0.45.0` to match db package
- **Files modified:** packages/modules/example/package.json
- **Verification:** `bun run typecheck` passes cleanly
- **Committed in:** 35be07c (Task 2 commit)

**2. [Rule 3 - Blocking] Added drizzle-orm dependency to example module**
- **Found during:** Task 2 (typecheck)
- **Issue:** `drizzle-orm` not resolvable from example module for `eq` import
- **Fix:** Added `drizzle-orm` to example module dependencies
- **Files modified:** packages/modules/example/package.json
- **Verification:** `bun run typecheck` passes cleanly
- **Committed in:** 35be07c (Task 2 commit)

**3. [Rule 3 - Blocking] Cast app to any for attachRoutes**
- **Found during:** Task 3 (typecheck)
- **Issue:** Elysia's complex generic type inference makes `app` incompatible with `Elysia<any>` parameter
- **Fix:** Cast `app as any` in the `attachRoutes` call (known Elysia limitation per RESEARCH.md)
- **Files modified:** apps/api/src/index.ts
- **Verification:** `bun run typecheck` passes cleanly
- **Committed in:** c5d558d (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (3 blocking issues)
**Impact on plan:** All auto-fixes necessary for TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the auto-fixed blocking issues above.

## Known Stubs

| File | Line | Stub | Reason |
|------|------|------|--------|
| apps/api/src/index.ts | 26 | `tenantId: "dev-tenant"` | Plan 03 wires real tenant context from session middleware |
| packages/modules/example/src/routes.ts | 17,27 | `tenantId: store.tenantId ?? "dev-tenant"` | Plan 03 wires real tenant context |
| packages/modules/example/src/routes.ts | 18,28 | `db: store.db` | DB access via store works but Plan 03 wires scoped db wrapper |

These stubs are intentional -- Plan 03 (Tenant scoping, dual entrypoint) will replace all placeholder tenant context with real session-derived values.

## User Setup Required
None - no external service configuration required. Tests run without PostgreSQL (unit tests only).

## Next Phase Readiness
- Module registry pattern proven and ready for auth, billing, and other modules
- CQRS bus ready for command/query dispatch across all modules
- Event bus ready for domain events (e.g., user.created, subscription.changed)
- API entrypoint structured for Plan 03 to add tenant middleware and worker entrypoint
- Example module serves as template for all future modules

## Self-Check: PASSED

- All 13 key files verified as present on disk
- All 4 task commits verified in git history (f53df1b, 35be07c, 986532a, c5d558d)

---
*Phase: 01-foundation-core-infrastructure*
*Completed: 2026-04-06*
