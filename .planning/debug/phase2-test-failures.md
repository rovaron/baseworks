---
status: resolved
trigger: "10 tests fail across 2 test files after Phase 2 changed tenant middleware from x-tenant-id header to session-based auth."
created: 2026-04-06T00:00:00Z
updated: 2026-04-06T00:00:00Z
resolved: 2026-04-06T00:00:00Z
---

## Current Focus

hypothesis: TWO distinct root causes confirmed — see Evidence (resolved; see Resolution section below — `bun test` 83 pass / 0 fail)
test: All evidence gathered from code reading and test runs
expecting: Fixes to both test files will resolve all 9 failures (count revised from 10 to 9)
next_action: Fix both issues

## Symptoms

expected: All tests pass (73 pass currently, 10 fail)
actual: 10 failures in 2 files — integration.test.ts (5) and tenant-session.test.ts (5)
errors: "Error: Unauthorized" from tenant.ts:27, "APIError: status: UNAUTHORIZED, body: undefined, statusCode: 401"
reproduction: Run `bun test` — 10 failures consistently
started: Phase 2 execution when tenant middleware changed from header-based to session-based

## Eliminated

## Evidence

- timestamp: 2026-04-06T00:01:00Z
  checked: apps/api/src/core/middleware/tenant.ts
  found: Middleware now calls auth.api.getSession() and throws "Unauthorized" if no session. No x-tenant-id header fallback.
  implication: integration.test.ts sends x-tenant-id headers but middleware ignores them entirely.

- timestamp: 2026-04-06T00:02:00Z
  checked: apps/api/src/__tests__/integration.test.ts
  found: All 5 failing tests send x-tenant-id header. 4 tests expect 200 with tenant data, 1 expects error code "MISSING_TENANT_CONTEXT" (but middleware now throws generic "Unauthorized" mapped to "INTERNAL_ERROR").
  implication: integration.test.ts must be rewritten to use session-based auth or test must mock tenant middleware.

- timestamp: 2026-04-06T00:03:00Z
  checked: packages/modules/auth/src/auth.ts databaseHooks.user.create.after
  found: Auto-create tenant hook calls auth.api.createOrganization() with `headers: new Headers()` (empty headers). The organization plugin requires authentication to create an org — empty headers = no session = 401 UNAUTHORIZED.
  implication: This is why no personal tenant is created on signup, causing tenant-session tests to fail (no orgs found, no tenantId).

- timestamp: 2026-04-06T00:04:00Z
  checked: bun test output
  found: 9 failures (not 10): integration.test.ts has 5 fail + 1 pass (health check), tenant-session.test.ts has 4 fail + 2 pass (health check + unauthenticated rejection). Total: 74 pass, 9 fail.
  implication: Original symptom count was slightly off.

## Resolution

root_cause: |
  TWO distinct root causes:
  1. integration.test.ts: Tests use x-tenant-id header but tenant middleware (rewritten in Phase 2) now requires session-based auth via better-auth. The tests never adapted.
  2. tenant-session.test.ts: The auto-create-tenant hook in auth.ts calls auth.api.createOrganization() with empty headers (new Headers()). The organization plugin requires authentication, so this always returns 401. No personal tenant is ever created, causing all downstream tests that depend on orgs to fail.
fix: |
  1. auth.ts hook: Removed `headers: new Headers()` and added `userId: user.id` to the createOrganization body. better-auth's org plugin supports a `userId` body param for server-side calls without a session — it bypasses the session check and looks up the user directly.
  2. create-tenant.ts command: Same fix — removed empty `headers: new Headers()` (already had userId in body).
  3. error.ts middleware: Added handlers for "Unauthorized", "No active tenant", and "Forbidden" error messages from the session-based tenant middleware. Previously only matched "Missing tenant context".
  4. integration.test.ts: Rewrote to use session-based auth — signs up two users via better-auth, uses session cookies instead of x-tenant-id headers, and updated error expectations.
verification: |
  `bun test` — 83 pass, 0 fail, 178 expect() calls across 15 files.
  Previously: 74 pass, 9 fail, 164 expect() calls.
  Integration tests now execute (not skipped) and all pass.
  Auth tenant-session tests all pass with auto-created tenants.
files_changed:
  - packages/modules/auth/src/auth.ts
  - packages/modules/auth/src/commands/create-tenant.ts
  - apps/api/src/core/middleware/error.ts
  - apps/api/src/__tests__/integration.test.ts
