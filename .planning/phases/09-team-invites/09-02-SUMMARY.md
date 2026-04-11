---
phase: 09-team-invites
plan: 02
subsystem: auth
tags: [better-auth, invitation, cqrs, elysia, rbac, nanoid]

# Dependency graph
requires:
  - phase: 09-team-invites/01
    provides: better-auth organization plugin config with sendInvitationEmail callback and @internal suppression
provides:
  - CQRS commands for create, accept, reject, cancel invitation
  - CQRS queries for list and get invitation
  - HTTP API routes for invitation CRUD with RBAC
  - Email suppression contract via @internal placeholder for link mode
affects: [09-team-invites/03, 09-team-invites/04]

# Tech tracking
tech-stack:
  added: []
  patterns: [invitation CQRS command/query with auth.api delegation, email suppression via @internal placeholder, public vs protected route split]

key-files:
  created:
    - packages/modules/auth/src/commands/create-invitation.ts
    - packages/modules/auth/src/commands/accept-invitation.ts
    - packages/modules/auth/src/commands/reject-invitation.ts
    - packages/modules/auth/src/commands/cancel-invitation.ts
    - packages/modules/auth/src/queries/list-invitations.ts
    - packages/modules/auth/src/queries/get-invitation.ts
  modified:
    - packages/modules/auth/src/index.ts
    - packages/modules/auth/src/routes.ts

key-decisions:
  - "CQRS handlers call auth.api directly as plain functions, matching billing routes pattern"
  - "Routes use set.status for error responses instead of new Response() for Elysia consistency"
  - "Accept/reject not exposed as custom routes -- better-auth mounted handler handles them via client SDK"
  - "Resend detects original mode from @internal email suffix to preserve email vs link distinction"

patterns-established:
  - "Public vs protected route split: public GET outside group, protected CRUD inside group with requireRole"
  - "makeCtx helper for CQRS calls that use auth.api (not tenant-scoped DB)"

requirements-completed: [INVT-01, INVT-03, INVT-04, INVT-05]

# Metrics
duration: 4min
completed: 2026-04-11
---

# Phase 9 Plan 02: Invitation CQRS & API Routes Summary

**CQRS commands/queries for invitation lifecycle with email/link mode support, plus role-protected HTTP routes for create, list, cancel, resend, and public get**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-11T14:38:21Z
- **Completed:** 2026-04-11T14:42:29Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created 4 CQRS commands (create, accept, reject, cancel) and 2 queries (list, get) for invitation lifecycle
- createInvitation supports dual mode: email (real address) and link (@internal placeholder for email suppression)
- Added 5 HTTP endpoints: public GET for invite page, protected POST/GET/DELETE/POST-resend with requireRole(owner, admin)
- Registered all new commands, queries, and events in auth module definition

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CQRS commands and queries for invitation lifecycle** - `971b0c0` (feat)
2. **Task 2: Create invitation API routes with role-based access control** - `f804dea` (feat)

## Files Created/Modified
- `packages/modules/auth/src/commands/create-invitation.ts` - Create invitation with email/link mode, @internal suppression
- `packages/modules/auth/src/commands/accept-invitation.ts` - Accept invitation via auth.api.acceptInvitation
- `packages/modules/auth/src/commands/reject-invitation.ts` - Reject invitation via auth.api.rejectInvitation
- `packages/modules/auth/src/commands/cancel-invitation.ts` - Cancel invitation via auth.api.cancelInvitation
- `packages/modules/auth/src/queries/list-invitations.ts` - List pending invitations for an org
- `packages/modules/auth/src/queries/get-invitation.ts` - Get single invitation details (public)
- `packages/modules/auth/src/index.ts` - Added 4 command keys, 2 query keys, 4 event names
- `packages/modules/auth/src/routes.ts` - Added invitation HTTP endpoints with RBAC

## Decisions Made
- CQRS handlers invoked as plain functions (not `.handler` property) matching the established billing routes pattern
- Used `set.status` for error responses instead of `new Response()` to stay consistent with Elysia patterns
- Accept/reject operations are NOT exposed as custom Elysia routes -- they are handled by better-auth's mounted handler via the client SDK (`auth.organization.acceptInvitation/rejectInvitation`)
- Resend endpoint detects original mode by checking `@internal` suffix on stored email, then re-creates with same mode
- Created `makeCtx` helper in routes.ts for constructing minimal HandlerContext since invitation operations use `auth.api.*` not tenant-scoped DB

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed CQRS calling convention in routes**
- **Found during:** Task 2 (route implementation)
- **Issue:** Plan code used `command.handler()` syntax, but `defineCommand` returns a plain function (not an object with `.handler`)
- **Fix:** Called commands/queries directly as functions matching billing routes pattern: `await createInvitation(input, ctx)`
- **Files modified:** packages/modules/auth/src/routes.ts
- **Verification:** Pattern matches existing billing routes confirmed via code inspection
- **Committed in:** f804dea (Task 2 commit)

**2. [Rule 1 - Bug] Fixed Result type property names in routes**
- **Found during:** Task 2 (route implementation)
- **Issue:** Plan code checked `result.ok` but actual Result type uses `result.success` and `result.error`
- **Fix:** Used `result.success` / `result.error` / `result.data` matching the existing billing routes pattern
- **Files modified:** packages/modules/auth/src/routes.ts
- **Verification:** Matches Result<T> type from @baseworks/shared
- **Committed in:** f804dea (Task 2 commit)

**3. [Rule 1 - Bug] Used set.status instead of new Response() for errors**
- **Found during:** Task 2 (route implementation)
- **Issue:** Plan code used `new Response(JSON.stringify(...))` for error responses, but billing routes use `set.status` with object returns
- **Fix:** Used `set.status = 400/404` with `return { success: false, error }` matching billing routes pattern
- **Files modified:** packages/modules/auth/src/routes.ts
- **Verification:** Pattern matches billing routes verified via code inspection
- **Committed in:** f804dea (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs -- calling convention and response pattern mismatches in plan)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep. Plan intent fully preserved.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Invitation API fully available for frontend plans (03 and 04) to consume via Eden Treaty
- Public GET endpoint ready for invite accept page at /invite/[token]
- Protected CRUD endpoints ready for settings Team tab
- Accept/reject available via better-auth client SDK (auth.organization.acceptInvitation/rejectInvitation)

## Self-Check: PASSED

All 9 files verified present. Both task commits (971b0c0, f804dea) verified in git log.

---
*Phase: 09-team-invites*
*Completed: 2026-04-11*
