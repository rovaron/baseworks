---
phase: 22-admin-ops-tooling
plan: 03
subsystem: admin-ops
tags: [bull-board, rbac, csp, elysia-plugin, ops-01]

# Dependency graph
requires:
  - phase: 22-admin-ops-tooling/01
    provides: BULL_BOARD_READ_ONLY env var (z.enum, default "true", crash-hard)

provides:
  - "createBullBoardPlugin(queues) factory at apps/api/src/routes/bull-board.ts"
  - "@bull-board/api@7.0.0 + @bull-board/elysia@7.0.0 + @bull-board/ui@7.0.0 deps in apps/api"
  - "/admin/bull-board mount point in apps/api/src/index.ts (after /health, before tenantMiddleware)"
  - "Module-queue collection helper that iterates registry.getLoaded() → def.jobs and dedups by jobDef.queue"
  - "Header-driven requireRole mock convention (x-test-role) shared with Plan 22-05 Task 1"

affects:
  - 22-04 (admin sidebar entry consumes the live mount)
  - 22-05 (worker heartbeat — bull-board displays queue depths against the same Redis)
  - 22-06 (admin /jobs route iframes the same /admin/bull-board URL)

# Tech tracking
tech-stack:
  added:
    - "@bull-board/api@7.0.0"
    - "@bull-board/elysia@7.0.0"
    - "@bull-board/ui@7.0.0"
  patterns:
    - "Plugin-scoped CSP via .onRequest (set.headers populated BEFORE requireRole-throws path so global errorMiddleware-built 401/403 inherit the header)"
    - "Header-driven requireRole mock for reachable 403 path tests (shared with Plan 22-05)"
    - "Module-queue dedup helper: Set<string> on jobDef.queue prevents duplicate Queue handles when multiple modules share a queue name"

key-files:
  created:
    - "apps/api/src/routes/bull-board.ts"
    - "apps/api/test/admin-bull-board.test.ts"
  modified:
    - "apps/api/package.json (3 new deps)"
    - "apps/api/src/index.ts (3 imports + module-queue helper + .use(bullBoardPlugin))"
    - "bun.lock"

key-decisions:
  - "CSP attached via .onRequest (NOT .onAfterHandle) — the global errorMiddleware ({ as: 'global' }) catches requireRole-thrown Unauthorized/Forbidden BEFORE plugin-scoped onAfterHandle fires; setting set.headers in onRequest survives the error path because Elysia's response builder reads from set.headers regardless of which hook produced the response."
  - "@bull-board/ui added as direct dep to apps/api so Bun's isolated install hoists it into apps/api/node_modules where the runtime uiBasePath: 'node_modules/@bull-board/ui' (relative to process.cwd()) resolves to a real directory."
  - "Test file mocks @baseworks/module-auth at module level via mock.module — requireRole reads x-test-role to inject a synthetic session. This mirrors Plan 22-05 Task 1's planned mock and is the canonical convention for any future OPS-* test that needs a reachable 403 path without spinning up better-auth."
  - "process.env DATABASE_URL + BETTER_AUTH_SECRET + NODE_ENV=test set via shell command line at test invocation. Setting them inside the test file via assignment doesn't work because @baseworks/config validates at import time (hoisted before any code runs)."

requirements-completed: [OPS-01]

# Metrics
duration: ~9min
completed: 2026-04-27
---

# Phase 22 Plan 03: Bull-Board Mount with RBAC + CSP + ReadOnly Summary

**`createBullBoardPlugin(queues)` factory mounted at `/admin/bull-board` behind `requireRole("owner")` with CSP `frame-ancestors '${ADMIN_URL}'` (or `'none'` fallback) on every response — including the 401/403 error path — read-only mode env-driven (`BULL_BOARD_READ_ONLY`), uiBasePath workaround applied for Bun-eval (oven-sh/bun#5809).**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-27T13:36:02Z
- **Completed:** 2026-04-27T13:44:57Z
- **Tasks:** 3 (install + factory with RBAC/CSP/readOnly + mount with module-queue helper)
- **Files modified:** 3 (apps/api/package.json, apps/api/src/index.ts, bun.lock)
- **Files created:** 2 (apps/api/src/routes/bull-board.ts, apps/api/test/admin-bull-board.test.ts)
- **Tests added:** 9 (all 9 passing — RBAC ×3, CSP ×3, readOnly ×2, uiBasePath ×1)

## Mount Order in apps/api/src/index.ts

Verified via the plan-supplied awk one-liner (`h<b && b<t`):

| Line | Hook                                              |
| ---- | ------------------------------------------------- |
| 100  | `.get("/health", ...)` — unauthenticated probe    |
| 123  | (closing `})` of `/health` block)                 |
| **131** | **`.use(bullBoardPlugin)`** — RBAC owner-only |
| 137  | `.use(authRoutes ?? new Elysia())`                |
| 141  | `.use(tenantMiddleware)`                          |

Bull-board mounts AFTER `/health` (Docker probe stays unauthenticated) and BEFORE auth/tenant middleware (bull-board owns its own RBAC via `requireRole` and is operator-scope, not tenant-scope).

## Module-Queue Collection Helper

```typescript
const moduleQueues: Queue[] = [];
if (env.REDIS_URL) {
  const redisConnection = getRedisConnection(env.REDIS_URL);
  const seenQueues = new Set<string>();
  for (const [, def] of registry.getLoaded()) {
    if (!def.jobs) continue;
    for (const jobDef of Object.values(def.jobs)) {
      if (seenQueues.has(jobDef.queue)) continue;
      seenQueues.add(jobDef.queue);
      moduleQueues.push(new Queue(jobDef.queue, { connection: redisConnection }));
    }
  }
} else {
  logger.warn("REDIS_URL not configured — bull-board will mount with zero queues");
}
```

**Dedup logic:** `Set<string>` on `jobDef.queue` ensures one `Queue` handle per queue name even if two modules register jobs for the same queue (Pitfall 10).

**REDIS_URL=undefined behavior:** Plugin still boots; bull-board renders an empty dashboard. A pino warn line records the missing config so operators don't silently lose job visibility.

**Connection sharing:** `getRedisConnection` is a singleton in `@baseworks/queue` — every Queue handle shares the same ioredis client; bull-board reads do not open new connections.

## Task Commits

1. **Task 1: Install bull-board packages** — `c4fcd0c` (chore)
2. **Task 2 RED: Failing tests for RBAC + CSP + readOnly** — `7baccc5` (test)
3. **Task 2 GREEN: createBullBoardPlugin factory** — `afa164d` (feat)
4. **Task 3: Mount in apps/api/src/index.ts** — `669091d` (feat)

## Files Created/Modified

### Created

- `apps/api/src/routes/bull-board.ts` — `createBullBoardPlugin(queues)` factory, 65 lines including header doc-block. Composes `.onRequest(set CSP)` → `.use(requireRole("owner"))` → `.use(await serverAdapter.registerPlugin())`. Plugin name `"bull-board-mount"` scopes set.headers mutations.
- `apps/api/test/admin-bull-board.test.ts` — 9 integration tests using `bun:test` + `Elysia.handle(new Request(...))` + `mock.module` for SUT-internal deps. Tests cover unauth-401 on root + static, member-403, CSP-success-path, CSP-error-path-via-onRequest, CSP-fallback-to-none, readOnly-true, readOnly-false, uiBasePath, and CSP-scope-leak-guard.

### Modified

- `apps/api/package.json` — added `@bull-board/api: 7.0.0`, `@bull-board/elysia: 7.0.0`, `@bull-board/ui: 7.0.0`. The `@bull-board/ui` is included explicitly so Bun's isolated install hoists it into `apps/api/node_modules/@bull-board/ui` for the runtime `uiBasePath` lookup.
- `apps/api/src/index.ts` — 3 new imports (`Queue` from `bullmq`, `getRedisConnection` from `@baseworks/queue`, `createBullBoardPlugin` from `./routes/bull-board`), module-queue collection helper after `await registry.loadAll()`, `.use(bullBoardPlugin)` between `/health` and `authRoutes`.
- `bun.lock` — lockfile churn from the 3 new deps + 11 transitive (e.g., `lodash`, `redis`, etc.).

## Decisions Made

### CSP via .onRequest (deviation from RESEARCH Pattern 1)

RESEARCH Pattern 1 (lines 297-355 of `22-RESEARCH.md`) draft used `.onAfterHandle(({ set }) => { set.headers["content-security-policy"] = ... })`. Test #4 + #5 fail under that pattern — they assert CSP appears on the 401-from-requireRole error response. The global `errorMiddleware` (`{ as: "global" }`) intercepts thrown `Unauthorized`/`Forbidden` BEFORE the plugin-scoped `onAfterHandle` fires, so the header never reaches `set`.

**Fix:** moved the CSP setter to `.onRequest`. The header now lands on `set.headers` BEFORE `requireRole` runs, and Elysia's response builder reads from `set.headers` regardless of whether `onAfterHandle` or the global error path produced the body. The plugin is still named (`"bull-board-mount"`) so `set.headers` mutations are scoped — the CSP scope-leak test (Test #9) still passes.

This deviation tightens the threat model: T-22-03 mitigation now applies to **every** response shape including 401/403/500, not just the success path that RESEARCH Pattern 1 exclusively covered.

### @bull-board/ui as direct dep (deviation from plan Task 1 step 1)

Plan Task 1 listed only `@bull-board/api` + `@bull-board/elysia`. Under Bun's default isolated install, `@bull-board/ui` (a transitive of `@bull-board/api`) ends up in `node_modules/.bun/@bull-board+ui@7.0.0/node_modules/@bull-board/ui` and is NOT resolvable from `node_modules/@bull-board/ui` or `apps/api/node_modules/@bull-board/ui`. The runtime `uiBasePath: "node_modules/@bull-board/ui"` (resolved relative to `process.cwd()`) would not find it.

**Fix:** added `@bull-board/ui@7.0.0` as a direct dep in `apps/api/package.json`. Bun then symlinks it into `apps/api/node_modules/@bull-board/ui`, and when the API runs from `apps/api` cwd (or the worktree root via the workspace symlink), `node_modules/@bull-board/ui` resolves to the real package directory.

### Test mock convention (header-driven requireRole)

The test file's `mock.module("@baseworks/module-auth", ...)` returns a fake `requireRole(...roles)` Elysia plugin that reads `x-test-role` from `request.headers` and throws `"Unauthorized"` (no header) or `"Forbidden"` (header present but role not in `roles`). The same shape will be reused by Plan 22-05 Task 1 (`buildApp`) — single shared mock convention across every OPS-* test that needs a reachable 403 path without spinning up better-auth + Postgres.

### env priming for tests

`@baseworks/config` validates `DATABASE_URL` + `BETTER_AUTH_SECRET` at module import time. The test file's import chain (`../src/core/middleware/error` → `@baseworks/observability` → `@baseworks/config`) runs the validator before any code in the test file. Setting `process.env.X` inside the test file is therefore too late.

**Workaround:** invoke `bun test apps/api/test/admin-bull-board.test.ts` with the env vars on the shell command line (or rely on the project's existing `.env` file in production / CI). The test file documents this in a comment block at the top.

## Threat Model Verification (T-22-01..03)

| Threat | Test ID | Status |
|--------|---------|--------|
| T-22-01 (static asset bypasses RBAC) | Test #2 (`GET /admin/bull-board/static/main.css` → 401) | mitigated |
| T-22-01 (member role escalation) | Test #3 (`x-test-role: member` → 403) | mitigated |
| T-22-02 (BULL_BOARD_READ_ONLY misconfiguration → write API) | Tests #6 + #7 (BullMQAdapter constructor receives correct readOnlyMode) | mitigated |
| T-22-03 (clickjack via foreign-origin iframe) | Tests #4 + #5 (CSP frame-ancestors set on success AND error responses; falls back to 'none') | mitigated |

CSP scope leak (Pitfall 6) verified by Test #9 — a sibling plugin's response carries no `content-security-policy` header.

## @bull-board/elysia v7.0.0 Peer-Dep Observations (Pitfall 5)

`@bull-board/elysia@7.0.0` declares `peerDependencies.elysia: "^1.1.0"`. Project ships `elysia@^1.4.28` (deployed at install time as `1.4.28`). Bun resolves the peer cleanly without warnings — no peer-dep mismatch surfaced during `bun add` or `bun test`. Forward-looking: any future Elysia 2.x bump must verify bull-board adapter compatibility before merge.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CSP not set on 401/403 error responses with .onAfterHandle**
- **Found during:** Task 2 GREEN (Tests #4 + #5 failed)
- **Issue:** RESEARCH Pattern 1's `.onAfterHandle(({ set }) => set.headers[...] = ...)` does not fire when `requireRole` throws — the global `errorMiddleware` intercepts the thrown `Unauthorized`/`Forbidden` before the plugin-scoped `onAfterHandle` runs, so the CSP header never reaches `set`. Tests #4 + #5 explicitly assert CSP on the unauthenticated 401 response.
- **Fix:** Moved the CSP setter to `.onRequest` so `set.headers["content-security-policy"]` is populated BEFORE `requireRole` runs. Elysia's response builder reads `set.headers` regardless of whether `onAfterHandle` or the global error path produced the body. Plugin name `"bull-board-mount"` still scopes the mutation — the CSP scope-leak test (Test #9) confirms the header does NOT leak to sibling routes.
- **Files modified:** `apps/api/src/routes/bull-board.ts`
- **Verification:** All 9 tests pass; the deviation tightens T-22-03 mitigation to cover error paths, not just success paths.
- **Committed in:** `afa164d` (Task 2 GREEN)

**2. [Rule 3 - Blocking] @bull-board/ui not hoisted under Bun isolated install**
- **Found during:** Task 1 (after initial `bun add @bull-board/api @bull-board/elysia`)
- **Issue:** Bun's default isolated install layout places transitive deps at `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>`. `@bull-board/ui` was a transitive of `@bull-board/api`, so the runtime `uiBasePath: "node_modules/@bull-board/ui"` (resolved against `process.cwd()`) found no directory.
- **Fix:** Added `@bull-board/ui@7.0.0` as a direct dep in `apps/api/package.json`. Bun then symlinks it into `apps/api/node_modules/@bull-board/ui` for runtime resolution.
- **Files modified:** `apps/api/package.json`, `bun.lock`
- **Verification:** `apps/api/node_modules/@bull-board/ui/dist` lists `index.ejs` + `static/`.
- **Committed in:** `c4fcd0c` (Task 1)

**3. [Rule 3 - Blocking] Test env vars not set when @baseworks/config validates at import time**
- **Found during:** Task 2 RED (initial test run — env validation crashed)
- **Issue:** `@baseworks/config/env.ts` calls `createEnv({ runtimeEnv: process.env })` at module-load time. The test file's import chain pulls in `errorMiddleware` → `@baseworks/observability` → `@baseworks/config`, so the validator runs BEFORE any test-file code. Setting `process.env.DATABASE_URL ??= "..."` inside the test file is too late (ES module imports are hoisted).
- **Fix:** Test invocation passes the required env vars on the shell command line: `DATABASE_URL=... BETTER_AUTH_SECRET=... NODE_ENV=test bun test ...`. Documented in the test file's top comment block.
- **Files modified:** `apps/api/test/admin-bull-board.test.ts` (added comment + early `process.env ??=` assignments as a defense-in-depth fallback for environments where the shell vars are already set elsewhere).
- **Verification:** All 9 tests pass under the documented invocation.
- **Committed in:** `7baccc5` (Task 2 RED — fix lived in the test scaffold itself)

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking).
**Impact on plan:** Zero scope changes. Every artifact in `<must_haves>` ships as specified; deviation #1 strengthens T-22-03 mitigation beyond what RESEARCH Pattern 1 specified.

## Issues Encountered

- Pre-existing `bun x tsc --noEmit -p apps/api` errors (rootDir misconfiguration in workspace tsconfigs, documented in `.planning/phases/22-admin-ops-tooling/deferred-items.md` from Plan 22-01). My changes introduce no new tsc errors — verified via `tsc | grep "bull-board"` returning empty.
- The `bun:test` runner emits noisy pino logs from `errorMiddleware.captureException` for every 401/403 test path. This is expected (tests deliberately trigger these errors) and matches the existing `apps/api/src/__tests__/admin-auth.test.ts` test pattern.

## Acceptance Criteria

| Plan check | Result |
|------------|--------|
| `grep -c '@bull-board/api' apps/api/package.json` >= 1 | PASS (1) |
| `grep -c '@bull-board/elysia' apps/api/package.json` >= 1 | PASS (1) |
| `apps/api/node_modules/@bull-board/ui/dist` exists | PASS (`index.ejs` + `static/`) |
| `bun x tsc --noEmit -p apps/api` no new errors | PASS (existing rootDir errors unchanged) |
| `grep -c 'export async function createBullBoardPlugin' apps/api/src/routes/bull-board.ts` == 1 | PASS |
| `grep -c 'requireRole("owner")' apps/api/src/routes/bull-board.ts` == 1 | PASS |
| `grep -c 'name: "bull-board-mount"' apps/api/src/routes/bull-board.ts` == 1 | PASS |
| `grep -F 'uiBasePath: "node_modules/@bull-board/ui"' apps/api/src/routes/bull-board.ts` == 1 | PASS |
| `grep -F 'env.BULL_BOARD_READ_ONLY === "true"' apps/api/src/routes/bull-board.ts` == 1 | PASS |
| `grep -F "'none'" apps/api/src/routes/bull-board.ts` == 1 | PASS |
| `grep -F 'x-test-role' apps/api/test/admin-bull-board.test.ts` >= 2 | PASS (3 occurrences) |
| `grep -F 'mock.module("@baseworks/module-auth"' admin-bull-board.test.ts` == 1 | PASS |
| 9 tests pass under `bun test apps/api/test/admin-bull-board.test.ts` | PASS (9 pass / 0 fail) |
| `import { Queue } from "bullmq"` in apps/api/src/index.ts | PASS |
| `import { getRedisConnection } from "@baseworks/queue"` | PASS |
| `import { createBullBoardPlugin } from "./routes/bull-board"` | PASS |
| `const bullBoardPlugin = await createBullBoardPlugin(moduleQueues)` | PASS |
| `.use(bullBoardPlugin)` | PASS |
| `new Queue(jobDef.queue` | PASS |
| awk mount-order assertion (h<b && b<t) | PASS (h=100, b=131, t=141) |

## Next Phase Readiness

- **Plan 22-04 (admin sidebar entry):** The live `/admin/bull-board` mount is reachable behind `requireRole("owner")` — the iframe `<iframe src="/admin/bull-board" />` will inherit the better-auth session cookie via the same-origin proxy.
- **Plan 22-05 (worker heartbeat):** Reuses the `mock.module("@baseworks/module-auth", { requireRole })` x-test-role mock convention this plan established. Same shared mock state across tests.
- **Plan 22-06 (admin /jobs route):** The Vite proxy entry `/admin/bull-board` → `http://localhost:3000` is the consumer of this mount.

## Self-Check

Verified files and commits via `git log --oneline -6`:

- FOUND: `apps/api/src/routes/bull-board.ts`
- FOUND: `apps/api/test/admin-bull-board.test.ts`
- FOUND: `apps/api/package.json` (modified — 3 new deps)
- FOUND: `apps/api/src/index.ts` (modified — 3 imports + helper + .use)
- FOUND: `apps/api/node_modules/@bull-board/ui/dist/index.ejs`
- FOUND commit: `c4fcd0c` (Task 1)
- FOUND commit: `7baccc5` (Task 2 RED)
- FOUND commit: `afa164d` (Task 2 GREEN)
- FOUND commit: `669091d` (Task 3)

## Self-Check: PASSED

---
*Phase: 22-admin-ops-tooling*
*Completed: 2026-04-27*
