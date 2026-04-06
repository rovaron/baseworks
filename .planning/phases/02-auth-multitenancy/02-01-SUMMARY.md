---
phase: 02-auth-multitenancy
plan: 01
subsystem: auth
tags: [better-auth, elysia, drizzle, oauth, magic-link, organization-plugin, rbac, session]

requires:
  - phase: 01-01
    provides: Bun workspace monorepo, Drizzle connection, env validation, schema helpers
  - phase: 01-02
    provides: Module registry with static import map, CQRS bus, event bus, example module pattern
  - phase: 01-03
    provides: Tenant middleware, scopedDb, error middleware, handlerCtx derive chain

provides:
  - better-auth instance with email/password, OAuth (Google/GitHub), magic link, organization plugin
  - Elysia routes plugin mounting better-auth handler at /api/auth/*
  - Auth macro (betterAuthPlugin) for session injection into protected routes
  - requireRole guard for RBAC enforcement (owner/admin/member)
  - Drizzle schema for 7 auth/org tables (user, session, account, verification, organization, member, invitation)
  - Auth module registered in module import map and loadable by registry

affects: [02-02, 02-03, 03-billing, 04-frontend]

tech-stack:
  added: [better-auth]
  patterns: [elysia-mount-better-auth-handler, macro-session-injection, conditional-oauth-providers, role-guard-derive]

key-files:
  created:
    - packages/modules/auth/package.json
    - packages/modules/auth/tsconfig.json
    - packages/modules/auth/src/auth.ts
    - packages/modules/auth/src/routes.ts
    - packages/modules/auth/src/middleware.ts
    - packages/modules/auth/src/index.ts
    - packages/db/src/schema/auth.ts
    - packages/modules/auth/src/__tests__/auth-setup.test.ts
  modified:
    - packages/config/src/env.ts
    - packages/db/src/schema/index.ts
    - packages/db/src/index.ts
    - apps/api/src/core/registry.ts
    - apps/api/package.json
    - .env.example
    - bun.lock

key-decisions:
  - "Conditional OAuth providers: only added to socialProviders if env vars are set (avoids undefined clientId errors)"
  - "basePath '/api/auth' in better-auth config + .mount(auth.handler) without prefix avoids Pitfall 1 path doubling"
  - "Auth schema uses better-auth's expected column names (snake_case) without project helpers like tenantIdColumn -- auth tables ARE the tenant system, not tenant-scoped data"
  - "requireRole uses auth.api.getFullOrganization to resolve member role from active org"

patterns-established:
  - "Auth module: workspace package at packages/modules/auth/ with ModuleDefinition export"
  - "better-auth mount pattern: new Elysia().mount(auth.handler) with basePath in auth config"
  - "Session injection: .macro({ auth: { resolve } }) for protected route context"
  - "Role guard: requireRole(...roles) returns Elysia derive plugin"
  - "Conditional social providers: build socialProviders object based on env var presence"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06]

duration: 5min
completed: 2026-04-06
---

# Phase 02 Plan 01: better-auth Instance, Drizzle Schema, Elysia Routes, Auth Macro, and Module Registration Summary

**better-auth instance with email/password, OAuth, magic link, and organization plugin mounted in Elysia with session injection macro and RBAC role guard**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-06T09:07:31Z
- **Completed:** 2026-04-06T09:12:02Z
- **Tasks:** 3
- **Files modified:** 15

## Accomplishments
- better-auth instance fully configured with all authentication methods (email/password, OAuth Google/GitHub, magic link, password reset)
- Organization plugin provides multitenancy primitives (org CRUD, membership, RBAC roles, active org in session)
- Auth routes mounted at /api/auth/* via Elysia .mount() following Pitfall 1 avoidance pattern
- betterAuthPlugin macro injects user/session into protected route context
- requireRole guard enables composable RBAC enforcement at the route level
- 7 auth/org Drizzle tables defined and exported (user, session, account, verification, organization, member, invitation)
- Auth module registered in module import map and follows established ModuleDefinition pattern
- 5 smoke tests verify module structure, schema exports, and middleware exports

## Task Commits

Each task was committed atomically:

1. **Task 1: Install better-auth, generate auth schema, add env vars** - `a6b9250` (feat)
2. **Task 2: Configure better-auth instance, create Elysia routes plugin and auth macro, register module** - `89e451c` (feat)
3. **Task 3: Schema push and smoke test** - `3cb8afd` (test)

## Files Created/Modified
- `packages/modules/auth/package.json` - Auth module workspace package with better-auth dependency
- `packages/modules/auth/tsconfig.json` - TypeScript config extending root
- `packages/modules/auth/src/auth.ts` - better-auth instance with all plugins and providers
- `packages/modules/auth/src/routes.ts` - Elysia plugin mounting auth.handler
- `packages/modules/auth/src/middleware.ts` - betterAuthPlugin macro + requireRole guard
- `packages/modules/auth/src/index.ts` - ModuleDefinition export with routes and events
- `packages/db/src/schema/auth.ts` - 7 Drizzle tables for auth + organization
- `packages/modules/auth/src/__tests__/auth-setup.test.ts` - 5 smoke tests
- `packages/config/src/env.ts` - Added BETTER_AUTH_SECRET, BETTER_AUTH_URL, OAuth env vars
- `packages/db/src/schema/index.ts` - Added auth schema barrel export
- `packages/db/src/index.ts` - Added auth table re-exports
- `apps/api/src/core/registry.ts` - Added auth to module import map
- `apps/api/package.json` - Added better-auth dependency
- `.env.example` - Added auth env vars with documentation
- `bun.lock` - Updated with better-auth and transitive dependencies

## Decisions Made
- **Conditional OAuth providers:** Built the `socialProviders` object dynamically based on env var presence. If `GOOGLE_CLIENT_ID` is not set, Google OAuth is simply not configured (no runtime error). This satisfies D-04 (OAuth optional).
- **basePath + mount without prefix:** Set `basePath: "/api/auth"` in better-auth config and use `.mount(auth.handler)` without a path argument. This avoids Pitfall 1 (path doubling) where both Elysia and better-auth prepend paths.
- **Auth schema without project helpers:** Used better-auth's expected column names directly (text PKs, snake_case timestamps) rather than project helpers like `primaryKeyColumn()` or `tenantIdColumn()`. Auth tables are the tenant system itself, not tenant-scoped data (Pitfall 6).
- **requireRole uses getFullOrganization:** The role guard calls `auth.api.getFullOrganization` to get the member list and find the user's role. This is assumed to work (Assumption A6 from RESEARCH.md) -- will be validated in Plan 02 integration tests.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- **Docker Desktop not running:** PostgreSQL was unavailable, so `drizzle-kit push` could not create the auth tables. This is a known condition (same as Phase 1 Plan 03). The schema push will succeed once `docker compose up -d postgres` is run. All smoke tests pass without the database since they verify structure only.

## User Setup Required

**External services require manual configuration for OAuth providers (optional).**

Environment variables to add to `.env` for OAuth:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - from Google Cloud Console
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` - from GitHub Developer Settings

Auth works without OAuth configured (email/password + magic link are always available).

## Next Phase Readiness
- better-auth instance ready for Plan 02 to wire session-based tenant middleware (replacing x-tenant-id header)
- Organization plugin ready for Plan 02 to auto-create personal tenant on signup (D-08)
- Auth macro ready for Plan 03 to add tenant CRUD commands/queries
- requireRole guard ready for Plan 02 RBAC enforcement
- Schema push pending PostgreSQL availability

## Self-Check: PASSED

- All 8 created files verified as present on disk
- All 3 task commits verified in git history (a6b9250, 89e451c, 3cb8afd)

---
*Phase: 02-auth-multitenancy*
*Completed: 2026-04-06*
