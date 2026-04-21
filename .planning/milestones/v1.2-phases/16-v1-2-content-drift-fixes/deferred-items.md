# Phase 16 Deferred Items

Items observed during Phase 16 execution that are out of scope for the current plans.
These are NOT caused by the Phase 16 changes — they are pre-existing issues in the
worktree environment / base commit confirmed by running the broader `bun test
packages/modules/auth/` sweep against the stashed base.

## Pre-existing auth test failures (out of scope for 16-03)

Observed while executing plan 16-03 (get-tenant.test.ts convention-drift fix).
Confirmed on base commit `58c3844` by stashing the 16-03 edit and re-running.

- **`packages/modules/auth/src/__tests__/auth-setup.test.ts`** — fails with
  `TypeError: undefined is not an object (evaluating 'path.length')` inside
  Elysia's `mount` at `packages/modules/auth/src/routes.ts:55`. Appears to be an
  Elysia 1.4+ API / better-auth handler compatibility issue (or local
  `node_modules` state). Not related to test helpers.

- **`packages/modules/auth/src/__tests__/get-profile.test.ts`** — fails with
  `Invalid environment variables: DATABASE_URL, BETTER_AUTH_SECRET required` from
  `@t3-oss/env-core`. The test loads `packages/config/src/env.ts` at module-load
  time; in a worktree with no `.env`, this validator throws. Environment
  bootstrap issue, not a code issue.

Both failures pre-date Phase 16 and are isolated from the 16-03 scope (test
helper convention). Plan 16-03 modifies only one file (`get-tenant.test.ts`),
which continues to pass (`3 pass, 0 fail`) after the convention migration.
