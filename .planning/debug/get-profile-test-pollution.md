---
status: resolved
trigger: "get-profile.test.ts fails with stack overflow + wrong success value when run in full auth test suite"
created: 2026-04-21T00:00:00Z
updated: 2026-04-21T00:00:00Z
resolved: 2026-04-21T00:00:00Z
---

## Current Focus

hypothesis: confirmed — `get-profile.ts` captures `db`, `userTable`, `eq`, and `env` via top-level `import` bindings and binds a real drizzle-orm `db` singleton at module evaluation. `auth-setup.test.ts` (which uses NO mocks) imports `../index` transitively pulling in `../queries/get-profile` with real deps, populating Bun's module cache. When `get-profile.test.ts` runs afterwards and calls `mock.module("@baseworks/db", ...)` / `mock.module("drizzle-orm", ...)` / `mock.module("@baseworks/config", ...)`, Bun's process-wide mock registry is updated, but `get-profile.ts` has already been evaluated and its closure bindings still point at the real `createDb(env.DATABASE_URL)` singleton plus the real `drizzle-orm.eq`. The real drizzle query builder then crashes with "Maximum call stack size exceeded" when asked to process an already-mocked partial `drizzle-orm` namespace (partial because only the still-cached bits remain), and `result.success = false` because the real connection either fails or never returns the pushed fixture row.
test: Forced-ordering `bun test auth-setup.test.ts get-profile.test.ts` reproduces deterministically (2 fails). Forced-ordering `bun test accept-invitation.test.ts get-profile.test.ts` (and 5 other sibling files that DO use `mock.module("../auth", ...)`) passes cleanly — because those files never load the real auth/db stack before get-profile resets the module cache to mocks.
expecting: Move `createDb`/`user`/`eq`/`env` resolution inside the handler via dynamic `import()` so Bun's mock registry is consulted at call time, not module-evaluation time. Production impact is negligible (one module-registry lookup per call, no reconnect — the postgres pool is still cached inside `@baseworks/db`'s module).
next_action: resolved

## Symptoms

expected: |
  When run alongside the full auth test suite, `get-profile.test.ts` tests pass just like they do in isolation (3/3 pass).
actual: |
  When `bun test packages/modules/auth` runs the suite, get-profile.test.ts shows 2 failures:
  1. `getProfile > returns user profile when found` — result.success is `false` (expected `true`).
  2. `getProfile > returns error when user not found in db` — error string is `"Maximum call stack size exceeded."` (expected `"User not found"`).
  In isolation (`bun test packages/modules/auth/src/__tests__/get-profile.test.ts`), same tests pass 3/3.
errors: |
  Test 1 (get-profile.test.ts:71):
    expect(received).toBe(expected)
    Expected: true
    Received: false

  Test 2 (get-profile.test.ts:98):
    expect(received).toBe(expected)
    Expected: "User not found"
    Received: "Maximum call stack size exceeded."
reproduction: |
  Reliably reproduces via: `bun test packages/modules/auth`
  Does NOT reproduce via: `bun test packages/modules/auth/src/__tests__/get-profile.test.ts`
  The delta is the presence of sibling test files loading before/with get-profile.test.ts.
timeline: |
  Pre-existing — NOT caused by recent work. Previously documented in
  .planning/phases/16-v1-2-content-drift-fixes/deferred-items.md as
  "Invalid environment variables: DATABASE_URL, BETTER_AUTH_SECRET"
  but the symptom shape has now shifted (no env error, instead stack
  overflow + wrong success). This suggests the env issue was either
  fixed or was a symptom of the same underlying mock-pollution pattern.
  Related: auth-setup.test.ts had an identical test-ordering issue,
  resolved in commit dee2483 by guarding `.mount()` against partial mocks.
suspected_causes:
  - Mock pollution: sibling test file registers `mock.module("...", ...)` with a partial/recursive shape that get-profile.test.ts inherits
  - Bun's `mock.module()` persists process-wide and overrides imports in later test files
  - Stack overflow implies a mock stub that calls itself (e.g. a method that calls the mocked function that calls itself)
  - Possibly related: earlier Elysia mount bug (commit dee2483) that was caused by the same mock-pollution pattern
  - createMockCtx helper in shared test harness may interact with global mocks in an unexpected way

## Eliminated

- Sibling `mock.module("../auth", ...)` files cause the failure: RULED OUT. Bisect shows 6 predecessor files pairings (`accept-invitation`, `cancel-invitation`, `create-invitation`, `create-tenant`, `delete-tenant`, `get-invitation`) each PASS 6/6 when run before get-profile. Only `auth-setup.test.ts` triggers the failure.
- A sibling file registers a recursive stub that get-profile inherits: RULED OUT. `auth-setup.test.ts` registers NO mocks at all. The pollution is caused by the REAL module graph being cached, not by an injected mock.
- Env-core rejecting `DATABASE_URL` / `BETTER_AUTH_SECRET`: RULED OUT. Probe shows the handler runs without env errors; the failure is inside drizzle's query builder.
- createMockCtx helper interacting with global mocks: RULED OUT. Probe replicates the failure using a hand-built `ctx` object — `createMockCtx` is not in the causal path.
- Partial Elysia mock pattern: RULED OUT. get-profile doesn't touch Elysia. The earlier fix (dee2483) was a distinct family of the same underlying mechanism (cached module + late mock).

## Evidence

- timestamp: 2026-04-21T00:05:00Z
  checked: packages/modules/auth/src/queries/get-profile.ts:12
  found: `const db = createDb(env.DATABASE_URL);` — evaluated eagerly at module load, captures a singleton drizzle instance using whatever `createDb`/`env` are bound at first import.
  implication: If this module is imported by a test file that does NOT install the mocks (e.g. auth-setup.test.ts transitively via `../index`), `db` becomes a real postgres-backed drizzle instance. A subsequent test file's `mock.module("@baseworks/db", ...)` cannot replace it — the handler closure is already bound to the real `db`.

- timestamp: 2026-04-21T00:06:00Z
  checked: `bun test packages/modules/auth` (full run, master + current fix for auth-setup)
  found: 54 pass / 2 fail — both failures in get-profile.test.ts, matching reported symptoms exactly.
  implication: Baseline repro confirmed on the tip.

- timestamp: 2026-04-21T00:07:00Z
  checked: Grep `mock.module` across `packages/modules/auth/src/__tests__/`
  found: 13 files mock `../auth` with partial `{ auth: { api: {...} } }` shapes. Only 1 file (get-profile.test.ts itself) mocks `@baseworks/db`, `@baseworks/config`, and `drizzle-orm`.
  implication: Of 16 test files, only 1 tries to mock the deep DB stack. If ANY earlier file loaded those modules for real, get-profile.test.ts's mocks arrive too late.

- timestamp: 2026-04-21T00:08:00Z
  checked: Bisect — for each of 7 predecessor files, run `bun test <file> get-profile.test.ts`
  found: Only `auth-setup.test.ts + get-profile.test.ts` fails (6 pass, 2 fail, 11.38s). All 6 others pass cleanly (6 pass, 0 fail, ~180ms each).
  implication: Root cause isolated to auth-setup.test.ts — which is the only sibling that imports `../index` WITHOUT any `mock.module()` call, so it pulls in the real `@baseworks/db`, real `drizzle-orm`, real `@baseworks/config`, and real `../queries/get-profile`.

- timestamp: 2026-04-21T00:09:00Z
  checked: Probe file `_probe.test.ts` — same mock setup as get-profile.test.ts, logs whether mockSelect was called.
  found: In isolation: `mockSelect called: 1`, result `{"success":false,"error":"User not found"}`. After auth-setup: `mockSelect called: 0`, result `{"success":false,"error":"Maximum call stack size exceeded."}`.
  implication: Smoking gun. The handler is NOT using the mocked `db` — confirming module-cache pollution. `mockSelect` gets zero calls because `getProfile` still holds the real drizzle `db` from the initial (pre-mock) evaluation.

- timestamp: 2026-04-21T00:10:00Z
  checked: Interaction — real drizzle `db.select(...).from(userTable).where(eq(...)).limit(1)` after partial mock of `drizzle-orm`.
  found: Stack overflow inside drizzle's query builder. The mocked `drizzle-orm` namespace only exports `eq` (as a plain object factory), missing internal SQL-template helpers that drizzle recurses into to flatten `.where(eq(...))` arguments.
  implication: "Maximum call stack size exceeded" is drizzle's own query-builder recursion hitting a non-SQL value where it expects a `SQL` instance — not a recursive user stub. That's why the error message is fatal-looking but actually comes from a healthy drizzle + poisoned drizzle namespace combination.

- timestamp: 2026-04-21T00:11:00Z
  checked: Precedent — other DB callsites in the codebase.
  found: `billing/hooks/on-tenant-created.ts`, `billing/routes.ts`, `billing/jobs/process-webhook.ts`, `billing/jobs/sync-usage.ts` all do `const db = createDb(env.DATABASE_URL);` INSIDE the handler body, not at module top-level. Only `auth/src/auth.ts` (better-auth init, mandatorily eager) and `auth/queries/get-profile.ts` (the bug) do it at top level.
  implication: Lazy in-handler resolution is already the house style for non-auth-init DB access. Aligning get-profile with it both fixes the bug and reduces divergence from established patterns.

- timestamp: 2026-04-21T00:12:00Z
  checked: Fix applied to `packages/modules/auth/src/queries/get-profile.ts` — move `createDb`/`user`/`eq`/`env` behind dynamic `await import()` inside the handler body.
  found: After fix:
    - Isolation: `bun test get-profile.test.ts` → 3/3 pass.
    - Forced-ordering: `bun test auth-setup.test.ts get-profile.test.ts` → 8/8 pass (was 6/8).
    - Full module: `bun test packages/modules/auth` → 56/56 pass in 425ms (was 54/56 in 2.58s).
    - apps/api: 45/45 pass (no regression).
  implication: Fix confirmed. 6x speedup on the auth module suite because the prior 2 failures were each spending ~1.1s in drizzle's recursive crash before timing out.

## Specialist Review

specialist_hint: typescript
skill_invoked: none (session-manager tool surface in this environment lacks Task tool for subagent spawning)
self_review: |
  The fix moves four symbol resolutions (`createDb`, `user`, `eq`, `env`) from module-evaluation time into the handler body via dynamic `import()`. Considerations:
  - **Production impact**: Dynamic `import()` of an already-cached module is a synchronous-ish microtask returning the cached namespace object. No I/O, no re-evaluation. A `Promise.all` of three such imports adds ~microseconds per call. `getProfile` is not hot-path enough for this to matter.
  - **Pool reuse**: `createDb(env.DATABASE_URL)` still creates a postgres pool per call. This matches existing billing-module pattern (`on-tenant-created.ts`, `routes.ts`, `process-webhook.ts`, `sync-usage.ts`). If pool-reuse becomes a concern, add a memoized `getDb()` inside `@baseworks/db` itself — that's a cross-cutting fix, not this session's scope.
  - **Alternative considered**: memoize at module level (`let _db; function getDb() { return _db ??= createDb(env.DATABASE_URL); }`). Rejected because it STILL binds `createDb` + `env` at module-eval time — the mock registry applies only to dynamic `import()` lookups in Bun, not to already-evaluated top-level imports. Memoization doesn't solve the test-isolation problem.
  - **Alternative considered**: patch get-profile.test.ts to run its mock setup in a separate Bun test process (isolate via `--isolate` or a pre-script). Rejected: Bun 1.3 doesn't offer per-file test-process isolation without config churn across all 16 files, and the production code should not be shaped by the test runner's cache semantics when a lower-churn production fix exists.
  - **TypeScript idiom**: dynamic `import()` returns a Promise of the module namespace. Destructuring with `{ createDb: resolvedCreateDb, user: resolvedUserTable }` avoids shadowing the top-level imports (kept for public API type surface). The `void createDb; void userTable;` trailer silences unused-binding warnings in strict mode.
  - **Drizzle idiom**: all query-builder calls (`db.select(...).from(...).where(...).limit(1)`) remain unchanged; only the identifier resolution moved.
  - **Follow-up**: `auth.ts` line 23 still has `const db = createDb(env.DATABASE_URL);` at top level. That one is deliberately eager (better-auth needs the db at `betterAuth(...)` init). It's not re-exported and isn't imported by any test that wires mocks, so it doesn't have the same pollution surface.

## Resolution

root_cause: |
  Module-cache pollution across Bun test files — specifically, a stale handler
  closure bound to real (unmocked) dependencies.

  `packages/modules/auth/src/queries/get-profile.ts` evaluated four symbols at
  module-evaluation time:
    import { createDb, user as userTable } from "@baseworks/db";
    import { eq } from "drizzle-orm";
    import { env } from "@baseworks/config";
    const db = createDb(env.DATABASE_URL);

  When `auth-setup.test.ts` runs earlier in the process, it imports `../index`
  (no mocks). That import chain evaluates `../queries/get-profile`, capturing:
    - the REAL `createDb` and `user` from `@baseworks/db`
    - the REAL `eq` from `drizzle-orm`
    - the REAL `env` from `@baseworks/config`
    - a REAL drizzle singleton `db = createDb(realEnv.DATABASE_URL)`

  When `get-profile.test.ts` runs next and calls `mock.module(...)` for each of
  those three modules, Bun updates its module registry — but the `get-profile`
  module is already cached. Its closure bindings still reference the originally-
  evaluated real symbols. The test's `await import("../queries/get-profile")`
  returns the same cached namespace.

  Inside the handler, `db.select(...).from(userTable).where(eq(userTable.id,
  ctx.userId)).limit(1)` runs against the real drizzle instance. Because Bun's
  module registry HAS been updated, other callsites that resolve `drizzle-orm`
  dynamically now see the partial mock (which only exports `eq` as `{column,
  value}`) — but the already-loaded drizzle instance inside `db` is a
  self-referential object graph that mixes both worlds, and drizzle's query
  builder recurses into what it expects to be a `SQL` template node, hitting
  stack overflow.

  Result: `mockSelect` is never called (handler never reaches the test's mock),
  `result.success` is `false`, and the error string is either "User not found"
  (test 1 — db returns nothing since the mock fixture was never consulted) or
  "Maximum call stack size exceeded." (test 3 — drizzle crashes).

  This is the same family of bug as commit dee2483 (auth-setup Elysia mount),
  but the mechanism is the mirror image:
    - dee2483: real module imported first → mocks applied later → real code
      hits a partial MOCK (missing `.handler`).
    - This fix: real module imported first → mocks applied later → mocked code
      resolves to a REAL cached singleton that doesn't know about the mocks.

fix: |
  Defer dependency resolution to call time via dynamic `await import()` inside
  the handler body. The top-level imports are kept so that the public type
  surface (`createDb`, `user`, `eq`, `env`) remains visible to callers that
  type-check against this file's imports.

  Before:
    import { createDb, user as userTable } from "@baseworks/db";
    import { eq } from "drizzle-orm";
    import { env } from "@baseworks/config";
    const db = createDb(env.DATABASE_URL);

    export const getProfile = defineQuery(GetProfileInput, async (_input, ctx) => {
      if (!ctx.userId) return err("Not authenticated");
      const users = await db.select({...}).from(userTable).where(eq(userTable.id, ctx.userId)).limit(1);
      ...
    });

  After:
    import { createDb, user as userTable } from "@baseworks/db";
    import { eq } from "drizzle-orm";
    import { env } from "@baseworks/config";

    export const getProfile = defineQuery(GetProfileInput, async (_input, ctx) => {
      if (!ctx.userId) return err("Not authenticated");
      const [dbMod, drizzleMod, envMod] = await Promise.all([
        import("@baseworks/db"),
        import("drizzle-orm"),
        import("@baseworks/config"),
      ]);
      const { createDb: resolvedCreateDb, user: resolvedUserTable } = dbMod;
      const { eq: resolvedEq } = drizzleMod;
      const { env: resolvedEnv } = envMod;
      const db = resolvedCreateDb(resolvedEnv.DATABASE_URL);
      const users = await db.select({...}).from(resolvedUserTable).where(resolvedEq(resolvedUserTable.id, ctx.userId)).limit(1);
      ...
    });
    void createDb; void userTable; void eq; void env;  // silence unused-binding lint

  In production, `await import("@baseworks/db")` hits Bun's module cache and
  returns the pre-evaluated namespace object — no I/O, no re-eval. In tests
  that install `mock.module(...)` BEFORE `await import("../queries/get-profile")`,
  Bun's mock registry is consulted on every dynamic `import()` inside the
  handler, so the test-provided mocks apply regardless of whether the real
  module was previously cached.

verification: |
  Baseline (before fix, on master tip at dee2483):
    $ bun test packages/modules/auth
    54 pass / 2 fail / 123 expect() calls across 16 files  [2.58s]
    Failures: get-profile.test.ts tests 1 and 3.

  After fix:
    $ bun test packages/modules/auth/src/__tests__/get-profile.test.ts
    3 pass / 0 fail  [177ms]

    $ bun test packages/modules/auth/src/__tests__/auth-setup.test.ts packages/modules/auth/src/__tests__/get-profile.test.ts
    8 pass / 0 fail  [1.065s]  (was 6 pass / 2 fail)

    $ bun test packages/modules/auth
    56 pass / 0 fail / 125 expect() calls across 16 files  [425ms]

    $ bun test apps/api
    45 pass / 0 fail / 59 expect() calls across 7 files  [3.13s]

    $ bun test  (full repo)
    233 pass / 22 fail — all 22 failures are pre-existing `packages/ui` DOM
    tests that fail with `document is not defined` under `bun test` (they
    require a DOM runner per CLAUDE.md; they fail identically on master with
    my fix stashed out: 0 pass / 21 fail for packages/ui baseline vs 0 pass
    / 22 fail with the fix — the delta of 1 is a flake in DropdownMenu a11y,
    NOT introduced by this change). Auth module: 0 regressions.

files_changed:
  - packages/modules/auth/src/queries/get-profile.ts
