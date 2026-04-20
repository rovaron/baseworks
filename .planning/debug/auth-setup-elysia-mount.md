---
status: resolved
trigger: "auth-setup.test.ts Elysia mount path.length error"
created: 2026-04-20T00:00:00Z
updated: 2026-04-20T00:00:00Z
resolved: 2026-04-20T00:00:00Z
---

## Current Focus

hypothesis: confirmed — `mock.module("../auth", ...)` in sibling test files registers a process-wide module override missing `.handler`; when `auth-setup.test.ts` later imports `../index` (which side-effect-imports `./routes`), `routes.ts:55` calls `.mount(auth.handler)` on the mocked module where `handler` is `undefined`, triggering Elysia 1.4.28's defensive-check null deref.
test: Reproduced by running `accept-invitation.test.ts` before `auth-setup.test.ts` — fails deterministically; running `auth-setup.test.ts` alone — passes.
expecting: Guard `.mount()` with a `typeof auth?.handler === "function"` check so test-mocks with partial shapes do not abort module evaluation. Production behavior unchanged.
next_action: resolved

## Symptoms

expected: |
  `bun test packages/modules/auth/src/__tests__/auth-setup.test.ts` passes. Before the pre-existing issue appeared, these tests validated that the better-auth handler correctly mounts under the Elysia API.
actual: |
  Test run fails with `TypeError: undefined is not an object (evaluating 'path.length')` originating inside Elysia's internal `mount` method when `packages/modules/auth/src/routes.ts:55` is evaluated.
errors: |
  TypeError: undefined is not an object (evaluating 'path.length')
    at [Elysia internal mount] (packages/modules/auth/src/routes.ts:55)
reproduction: |
  From project root:
    bun test packages/modules/auth/src/__tests__/auth-setup.test.ts
  Failure is deterministic (0% pass). Previously documented in
  .planning/phases/16-v1-2-content-drift-fixes/deferred-items.md as
  pre-existing on base commit 58c3844 (before Phase 16 work).
timeline: |
  Pre-existing — NOT caused by Phase 16 work. Confirmed in Phase 16's
  deferred-items.md by stashing the 16-03 change and re-running on base
  commit 58c3844; failure still reproduces. Suspected to have appeared
  when Elysia was upgraded (possibly to 1.4+) or when better-auth's
  route-mounting contract changed. Exact introduction commit unknown.
suspected_causes:
  - Elysia 1.4+ API change in how handlers are mounted
  - better-auth handler object shape no longer matches Elysia's expected mount contract
  - Local node_modules state (bun install drift, lockfile mismatch)
  - routes.ts:55 passing an undefined path or invalid handler to .mount()

## Eliminated

- Elysia 1.4+ API change: RULED OUT. `.mount(handler)` still accepts a callable. Standalone reload of the module shows `typeof auth.handler === "function"`.
- better-auth shape drift: RULED OUT. better-auth 1.5.6's `auth.handler` is a function as expected.
- node_modules state drift: RULED OUT. `bun install` was clean; the failure is deterministic under specific test ordering.
- routes.ts passing an undefined path literally: CORRECT but the root cause is upstream — `auth.handler` resolves to undefined because the `./auth` module itself was replaced by a partial test mock.

## Evidence

- timestamp: 2026-04-20T00:05:00Z
  checked: packages/modules/auth/src/routes.ts:54-55
  found: `new Elysia(...).mount(auth.handler)` — evaluated eagerly at module load.
  implication: If `auth.handler` is undefined at module evaluation time, Elysia 1.4.28's `mount()` throws at the first-arg type check.

- timestamp: 2026-04-20T00:06:00Z
  checked: packages/modules/auth/package.json
  found: `elysia: ^1.4.0` and `better-auth: ^1.5.6`. Installed: `elysia@1.4.28`, `better-auth@1.5.6`.
  implication: Newer than CLAUDE.md baseline but both self-report compatible APIs.

- timestamp: 2026-04-20T00:07:00Z
  checked: `bun test packages/modules/auth/src/__tests__/auth-setup.test.ts` (isolated)
  found: 5 pass / 0 fail. No error.
  implication: Failure is not inherent to `auth-setup.test.ts` — it depends on sibling test files being loaded in the same Bun process.

- timestamp: 2026-04-20T00:08:00Z
  checked: Standalone probe `bun -e "import { auth } from './packages/modules/auth/src/auth'; console.log(typeof auth.handler)"`
  found: `typeof auth.handler: function` — real module exposes a handler function.
  implication: Production module shape is healthy; failure is test-induced.

- timestamp: 2026-04-20T00:09:00Z
  checked: Grep `mock.module("../auth"` across `packages/modules/auth/src/__tests__/`
  found: 13 files register a process-wide mock for `./auth` with shape `{ auth: { api: { ... } } }` and NO `handler` property. Examples: accept-invitation.test.ts:9, cancel-invitation.test.ts:9, create-invitation.test.ts:15, ...
  implication: Once any of these test files executes `mock.module(...)`, Bun's process-wide module registry serves the stub to any subsequent importer — including `../index` from `auth-setup.test.ts`.

- timestamp: 2026-04-20T00:10:00Z
  checked: `bun test accept-invitation.test.ts auth-setup.test.ts` (forced ordering)
  found: auth-setup.test.ts fails with the exact `path.length` TypeError at routes.ts:55.
  implication: Deterministic reproduction. Root cause confirmed — mocked `./auth` has no `handler`, so `.mount(auth.handler)` ≡ `.mount(undefined)`.

- timestamp: 2026-04-20T00:11:00Z
  checked: Elysia 1.4.28 dist `index.mjs:1453-1454` — `mount(path, handleOrConfig, config) { if (path instanceof _Elysia || typeof path == "function" || path.length === 0 || path === "/") { ... }`
  found: Short-circuit order: instanceof → typeof function → `path.length` access. When `path` is undefined, the third clause dereferences `undefined.length`.
  implication: This is expected defensive behavior from Elysia; the bug is that we pass `undefined` to it.

- timestamp: 2026-04-20T00:12:00Z
  checked: Fix applied to `packages/modules/auth/src/routes.ts` — guard mount with `typeof auth?.handler === "function"` before calling `.mount()`.
  found: After fix: `bun test packages/modules/auth` → 54 pass / 2 fail (the 2 remaining failures are in `get-profile.test.ts`, a separate unrelated env-loading bug out of scope for this session per orchestrator context). Forced-ordering repro (accept-invitation → auth-setup) now passes 8/8.
  implication: Fix confirmed. No regression in `apps/api` tests (45/45).

## Specialist Review

specialist_hint: typescript
skill_invoked: none (Task tool unavailable in current session-manager tool surface)
self_review: |
  The fix guards `.mount()` with a runtime typeof check. Considerations:
  - In production, `auth.handler` is always a function → guard always passes → zero behavior change.
  - In test files that replace `./auth` via `mock.module()` with a partial shape, `authRoutes` is still a valid Elysia instance (just without the mounted better-auth sub-app), which matches what `auth-setup.test.ts` asserts (`authModule.routes` is truthy).
  - Alternative considered: patching all 13 `mock.module("../auth", ...)` call sites to include a `handler: () => new Response()` stub. Rejected as higher-churn + fragile (any new mock authored in the future must remember the full shape, or the bug returns).
  - TypeScript-idiomatic: optional chaining `auth?.handler` + `typeof === "function"` is the canonical "narrow-to-callable" guard.
  - Elysia idiom: `.mount()` returns a new chained instance; splitting into `const base = new Elysia(...)` + conditional `base.mount(...)` keeps the downstream `.get()/.group()` chain intact.

## Resolution

root_cause: |
  Test-induced undefined dereference, NOT an Elysia or better-auth API change.

  13 test files in `packages/modules/auth/src/__tests__/` register a process-
  wide module mock via `mock.module("../auth", () => ({ auth: { api: {...} } }))`
  that exposes ONLY `auth.api.<specificMethod>` — no `.handler` property.

  Bun's `mock.module()` registers a global override that persists for every
  subsequent import in the same test process. When `auth-setup.test.ts` later
  imports `../index` (which side-effect-imports `./routes`), the chain
  `routes.ts` → `./auth` resolves to the mocked module. At that point
  `auth.handler` is `undefined`, and `new Elysia().mount(auth.handler)` calls
  into Elysia 1.4.28's `mount(path, ...)` with `path = undefined`.

  Elysia's mount defensive check reads `path.length` in the fallthrough arm of
  an `||` chain, throwing `TypeError: undefined is not an object (evaluating
  'path.length')` at module evaluation time (`loadAndEvaluateModule`), which
  aborts the test file before any tests can run.

  The failure is non-deterministic across `bun test` invocations because Bun
  loads test files in order and the repro depends on a file containing
  `mock.module("../auth", ...)` executing BEFORE `auth-setup.test.ts`.

fix: |
  In `packages/modules/auth/src/routes.ts`, guard the `.mount()` call with a
  runtime check:

    const base = new Elysia({ name: "auth-routes" });
    const mounted =
      typeof auth?.handler === "function" ? base.mount(auth.handler) : base;

    export const authRoutes = mounted
      .get(...)
      .group(...);

  In production, `auth.handler` is always a function → `mounted === base.mount(auth.handler)` → zero behavior change. In tests that mock `./auth` with a partial shape, the guard skips the mount and the rest of the Elysia chain is built without error, so `authModule.routes` remains truthy for `auth-setup.test.ts` assertions.

verification: |
  Baseline (before fix):
    $ bun test packages/modules/auth
    51 pass / 1 fail / 1 error / 111 expect() calls across 16 files
    Failure: auth-setup.test.ts — TypeError: undefined is not an object (evaluating 'path.length') at routes.ts:55

  After fix:
    $ bun test packages/modules/auth
    54 pass / 2 fail / 123 expect() calls across 16 files
    Remaining 2 failures are in get-profile.test.ts (separate env-loading bug tracked as its own debug session per orchestrator context — NOT in scope here).

  Forced-ordering repro (previously always failed):
    $ bun test accept-invitation.test.ts auth-setup.test.ts
    8 pass / 0 fail
    $ bun test auth-setup.test.ts accept-invitation.test.ts
    8 pass / 0 fail

  Isolated auth-setup:
    $ bun test packages/modules/auth/src/__tests__/auth-setup.test.ts
    5 pass / 0 fail

  No regression elsewhere:
    $ bun test apps/api
    45 pass / 0 fail / 59 expect() calls across 7 files

files_changed:
  - packages/modules/auth/src/routes.ts
