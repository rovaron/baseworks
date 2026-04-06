---
phase: 02-auth-multitenancy
plan: 03
subsystem: auth
tags: [better-auth, cqrs, tenant-crud, profile, organization-plugin, typebox]

requires:
  - phase: 02-01
    provides: better-auth instance with org plugin, auth routes, betterAuthPlugin macro, requireRole guard
  - phase: 02-02
    provides: Session-based tenant middleware, auto-create personal tenant, RBAC enforcement

provides:
  - 4 CQRS commands registered in auth module (create-tenant, update-tenant, delete-tenant, update-profile)
  - 4 CQRS queries registered in auth module (get-tenant, list-tenants, list-members, get-profile)
  - Fully populated auth ModuleDefinition with routes, commands, queries, events
  - get-profile uses ctx.userId + direct DB query (not empty-headers getSession)
  - Auth config verification tests for OAuth, magic link, and password reset

affects: [03-billing, 04-frontend]

tech-stack:
  added: []
  patterns: [auth-api-wrapped-as-cqrs, direct-db-query-for-auth-tables, typebox-validated-commands]

key-files:
  created:
    - packages/modules/auth/src/commands/create-tenant.ts
    - packages/modules/auth/src/commands/update-tenant.ts
    - packages/modules/auth/src/commands/delete-tenant.ts
    - packages/modules/auth/src/commands/update-profile.ts
    - packages/modules/auth/src/queries/get-tenant.ts
    - packages/modules/auth/src/queries/list-tenants.ts
    - packages/modules/auth/src/queries/list-members.ts
    - packages/modules/auth/src/queries/get-profile.ts
    - packages/modules/auth/src/__tests__/tenant-crud.test.ts
    - packages/modules/auth/src/__tests__/profile.test.ts
  modified:
    - packages/modules/auth/src/index.ts
    - packages/modules/auth/package.json

key-decisions:
  - "get-profile uses ctx.userId + direct DB query via createDb, not auth.api.getSession with empty Headers (which would return null)"
  - "Auth/org commands wrap better-auth org plugin API (auth.api.*) rather than using scopedDb, per Pitfall 6"
  - "Added @sinclair/typebox to auth module package.json (was missing, required for TypeBox schemas in commands/queries)"

patterns-established:
  - "Auth CQRS pattern: commands/queries wrap auth.api.* methods, not scopedDb, for auth-managed tables"
  - "Profile query pattern: direct DB connection for non-tenant-scoped auth tables using ctx.userId"
  - "Module definition fully populated: routes + commands + queries + events satisfies ModuleDefinition"

requirements-completed: [TNNT-03, TNNT-05, AUTH-02, AUTH-03, AUTH-05, AUTH-06]

duration: 3min
completed: 2026-04-06
---

# Phase 02 Plan 03: Tenant CRUD Commands/Queries, User Profile Management, and Auth Config Verification Summary

**4 CQRS commands and 4 queries wrapping better-auth org plugin API, with get-profile using direct DB query by ctx.userId and auth config tests verifying OAuth/magic link/password reset**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-06T09:20:39Z
- **Completed:** 2026-04-06T09:23:30Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- 3 tenant CRUD commands (create, update, delete) and 3 tenant queries (get, list, list-members) wrapping better-auth org plugin API via CQRS pattern
- Profile management: update-profile command supports name, email, image, and password change; get-profile query uses ctx.userId with direct DB query (not empty-headers getSession)
- Auth module definition fully populated with 4 commands, 4 queries, routes, and events (D-15 complete)
- 14 new tests: 6 tenant CRUD registration, 4 profile registration, 4 auth config verification (OAuth AUTH-02, magic link AUTH-03, password reset AUTH-05, auth instance)
- All 26 auth module tests pass, typecheck passes

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement tenant CRUD commands and queries** - `78a89ed` (feat)
2. **Task 2: Profile commands/queries, module definition, and tests** - `98e8111` (feat)

## Files Created/Modified
- `packages/modules/auth/src/commands/create-tenant.ts` - CQRS command wrapping auth.api.createOrganization
- `packages/modules/auth/src/commands/update-tenant.ts` - CQRS command wrapping auth.api.updateOrganization
- `packages/modules/auth/src/commands/delete-tenant.ts` - CQRS command wrapping auth.api.deleteOrganization (owner-only)
- `packages/modules/auth/src/commands/update-profile.ts` - Profile update command (name, email, image, password)
- `packages/modules/auth/src/queries/get-tenant.ts` - Full org details via auth.api.getFullOrganization
- `packages/modules/auth/src/queries/list-tenants.ts` - User's orgs via auth.api.listOrganizations
- `packages/modules/auth/src/queries/list-members.ts` - Org members via auth.api.getFullOrganization
- `packages/modules/auth/src/queries/get-profile.ts` - User profile via direct DB query using ctx.userId
- `packages/modules/auth/src/__tests__/tenant-crud.test.ts` - 6 registration tests for tenant commands/queries
- `packages/modules/auth/src/__tests__/profile.test.ts` - 4 profile tests + 4 auth config verification tests
- `packages/modules/auth/src/index.ts` - Updated with all 4 commands and 4 queries in ModuleDefinition
- `packages/modules/auth/package.json` - Added @sinclair/typebox dependency

## Decisions Made
- **get-profile direct DB query:** Uses createDb() + direct select from user table filtered by ctx.userId. This avoids the fatal flaw of calling auth.api.getSession with empty Headers (which always returns null). Auth tables are not tenant-scoped, so scopedDb is not appropriate either.
- **Auth API wrapping pattern:** All tenant commands/queries call auth.api.* methods rather than using scopedDb, because auth/org tables are managed by better-auth (Pitfall 6). The CQRS layer provides the standard interface; better-auth provides the implementation.
- **@sinclair/typebox added as dependency:** The auth module was missing this dependency (present in example module). Added to fix blocking import error (Rule 3 auto-fix).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing @sinclair/typebox dependency**
- **Found during:** Task 1 (tenant commands)
- **Issue:** Auth module package.json lacked @sinclair/typebox, causing typecheck failure on all command/query files
- **Fix:** Added `"@sinclair/typebox": "0.34.49"` to auth module dependencies (same version as example module)
- **Files modified:** packages/modules/auth/package.json, bun.lock
- **Verification:** `bun run typecheck` passes
- **Committed in:** 78a89ed (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary dependency addition. No scope creep.

## Issues Encountered
None beyond the blocking dependency fix documented above.

## User Setup Required
None - no new external service configuration required beyond what Plans 01 and 02 established.

## Next Phase Readiness
- Auth module is complete: routes, commands, queries, events all populated
- Phase 2 is fully complete: auth instance, tenant middleware, RBAC, CRUD, profile management
- Ready for Phase 3 (billing and background jobs) which depends on auth module being operational
- All tenant CQRS operations available for frontend integration in Phase 4

## Self-Check: PASSED

- All 10 created files verified as present on disk
- Both task commits verified in git history (78a89ed, 98e8111)

---
*Phase: 02-auth-multitenancy*
*Completed: 2026-04-06*
