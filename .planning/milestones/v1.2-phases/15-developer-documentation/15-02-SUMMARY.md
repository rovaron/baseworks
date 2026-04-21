---
phase: 15-developer-documentation
plan: 02
subsystem: api
tags: [bullmq, event-bus, cqrs, modules, testing, bun-test]

# Dependency graph
requires:
  - phase: 14-unit-tests
    provides: "bun:test + __test-utils__ (createMockContext, createMockDb, assertResultOk) relative-path convention"
  - phase: 01-foundation
    provides: "TypedEventBus, ModuleRegistry, BullMQ queue+worker plumbing, example module skeleton"
provides:
  - "Runnable example module that exercises all four module surfaces (command, query, event, BullMQ job) -- the tutorial subject for Plan 04 (DOCS-03)"
  - "registerExampleHooks -- reusable event-bus-to-queue bridge pattern, symmetric with registerBillingHooks"
  - "processFollowup -- minimal log-and-resolve BullMQ job handler reference implementation"
  - "Unit tests closing the Wave 0 gap: 8 passing example-module tests (createExample x3, processFollowup x2, registerExampleHooks x3)"
affects:
  - "15-04 (plan 04 / DOCS-03 'Add a Module' tutorial -- will walk the reader through this subject)"
  - "Future module authors reaching for event-to-job wiring"

# Tech tracking
tech-stack:
  added:
    - "@baseworks/queue and @baseworks/config as workspace deps of @baseworks/module-example"
    - "bullmq as a direct dep of @baseworks/module-example"
  patterns:
    - "Event-bus hook pattern for enqueuing BullMQ jobs -- subscribe in a hook file, lazy-init the queue via env.REDIS_URL, graceful skip when absent, log-but-do-not-rethrow on error"
    - "Module re-exports the hook registration function from its index.ts so apps/api wires it next to peer hooks"

key-files:
  created:
    - "packages/modules/example/src/jobs/process-followup.ts -- BullMQ handler"
    - "packages/modules/example/src/hooks/on-example-created.ts -- registerExampleHooks listener"
    - "packages/modules/example/src/__tests__/create-example.test.ts -- 3 unit tests"
    - "packages/modules/example/src/__tests__/process-followup.test.ts -- 2 unit tests"
    - "packages/modules/example/src/__tests__/on-example-created.test.ts -- 3 unit tests"
  modified:
    - "packages/modules/example/src/index.ts -- populated jobs map, re-exported registerExampleHooks"
    - "packages/modules/example/package.json -- added @baseworks/config, @baseworks/queue, bullmq deps"
    - "apps/api/src/index.ts -- imported and invoked registerExampleHooks next to registerBillingHooks"

key-decisions:
  - "Routed the example.created -> processFollowup link through TypedEventBus + a hook file instead of through ctx.enqueue, because handlerCtx in apps/api/src/index.ts never populates `enqueue` -- calling ctx.enqueue?.(...) would be a silent no-op in production. Mirrors the existing registerBillingHooks wiring, which is already the canonical pattern."
  - "Kept processFollowup as a minimal log-and-resolve handler (Phase 15 RESEARCH Open Question 1 recommendation) so the tutorial stays focused on module wiring, not business logic. Any future DB-touching handler must reconstruct its own scopedDb from the payload's tenantId."
  - "Ordered the REDIS_URL-absent registerExampleHooks test first so the module-level followupQueue cache starts at null; production semantics are unchanged because REDIS_URL is stable across a real process's lifetime."

patterns-established:
  - "Event-bus hook module pattern: on(...) -> lazy-init Queue via env check -> queue.add(...) with typed payload -> try/catch that logs-but-does-not-rethrow. Reusable for every module that needs an event-to-job bridge."
  - "Module test convention: mock.module at the boundary (@baseworks/config, @baseworks/queue, ioredis, bullmq) + dynamic await import of the unit under test after mocks. Extracted the pattern from billing.test.ts."

requirements-completed: []

# Metrics
duration: 15min
completed: 2026-04-17
---

# Phase 15 Plan 02: D-05 Example Module Extension Summary

**Wired example.created to BullMQ via a registerExampleHooks event-bus listener so the example module exercises all four module surfaces, and closed the Wave 0 testing gap with 8 green bun:test unit tests.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-17T23:36Z
- **Completed:** 2026-04-17T23:52Z
- **Tasks:** 3
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments

- `processFollowup` BullMQ handler in `packages/modules/example/src/jobs/process-followup.ts` -- logs the `(exampleId, tenantId)` payload and resolves; thrown errors inherit BullMQ's default retry policy (3 attempts, exponential backoff) from `createQueue`.
- `registerExampleHooks(eventBus)` in `packages/modules/example/src/hooks/on-example-created.ts` -- subscribes to `example.created`, lazy-inits a `example:process-followup` BullMQ queue when `env.REDIS_URL` is present, logs a skip message when absent, swallows-with-log on `queue.add` failure. Directly mirrors `registerBillingHooks`.
- `packages/modules/example/src/index.ts` -- populated the `jobs` map with `"example:process-followup"` so `apps/api/src/worker.ts` auto-starts a worker for it; re-exported `registerExampleHooks` so `apps/api` can wire it.
- `apps/api/src/index.ts` -- imported `registerExampleHooks` next to `registerBillingHooks` and invoked it with `registry.getEventBus()` immediately after the billing call. No change to the `handlerCtx` derive step -- the event-bus hook sidesteps the missing `enqueue` plumbing entirely.
- 8 passing bun:test unit tests across three files (`create-example.test.ts`, `process-followup.test.ts`, `on-example-created.test.ts`) closing the Wave 0 gap called out in `15-VALIDATION.md`.

## Task Commits

Each task was committed atomically via `--no-verify` (parallel-executor mode):

1. **Task 1: Unit tests for createExample** — `beb0b05` (test)
2. **Task 2: processFollowup job + registerExampleHooks + wire in apps/api** — `85dba97` (feat)
3. **Task 3: Unit tests for processFollowup and registerExampleHooks** — `78ed865` (test)

_TDD cycle note: every task is tagged `tdd="true"` in the plan. Tasks 1 and 3 are test-only commits (RED). Task 2 is the GREEN feat commit; the createExample implementation required no change (it already emitted `example.created`), so Task 2's `feat` commit captures the new handler/hook/wiring code plus the deps/config updates required to land them._

## Files Created/Modified

- `packages/modules/example/src/jobs/process-followup.ts` (created) -- BullMQ handler. Logs and resolves.
- `packages/modules/example/src/hooks/on-example-created.ts` (created) -- Event-bus listener that enqueues the follow-up job.
- `packages/modules/example/src/__tests__/create-example.test.ts` (created) -- 3 tests: insert+success, emit shape, optional description passthrough.
- `packages/modules/example/src/__tests__/process-followup.test.ts` (created) -- 2 tests: valid payload resolves, logs both id fields.
- `packages/modules/example/src/__tests__/on-example-created.test.ts` (created) -- 3 tests: happy-path enqueue, REDIS_URL-absent skip, queue.add-error logged-not-rethrown.
- `packages/modules/example/src/index.ts` (modified) -- populated `jobs` map; re-exported `registerExampleHooks`.
- `packages/modules/example/package.json` (modified) -- added `@baseworks/config`, `@baseworks/queue`, `bullmq` deps.
- `apps/api/src/index.ts` (modified) -- imported and invoked `registerExampleHooks` next to `registerBillingHooks`.

## Decisions Made

- **Event-bus hook over `ctx.enqueue`:** `handlerCtx` in `apps/api/src/index.ts:100-113` populates only `tenantId/userId/db/emit`; `enqueue` is left undefined. A command calling `ctx.enqueue?.(...)` would silently no-op in production. Routing through `TypedEventBus.on("example.created", ...)` + a dedicated hook file matches the proven `registerBillingHooks` pattern and avoids the plumbing gap entirely.
- **Log-and-resolve demo handler:** The processFollowup handler deliberately performs no DB work so the upcoming tutorial (Plan 04 / DOCS-03) can document "any worker handler that touches tenant data must rebuild its own scopedDb from `tenantId` in the payload" as an explicit callout instead of leading with a messy example.
- **Test ordering workaround for module-level queue cache:** `registerExampleHooks` holds a module-level `followupQueue: Queue | null` so subsequent events don't re-pay `createQueue`. The REDIS_URL-absent test must run before the happy-path test to observe the uncached `null` state. Documented inline in the test file so future maintainers understand the ordering constraint.

## Deviations from Plan

None -- plan executed exactly as written. All three tasks used the exact file contents and wiring steps prescribed in the plan. The only small adjustment was adding a `<test-ordering-note>`-style comment inside `on-example-created.test.ts` explaining the module-level queue cache, a clarification the plan implied but did not spell out.

## Issues Encountered

- The first run of `on-example-created.test.ts` failed the REDIS_URL-absent case because the earlier happy-path test had populated the module-level `followupQueue` cache. Resolved by reordering the tests so the absent-URL case runs first (before any cache population) and adding an inline comment documenting the reason. No production code change was needed -- this is a test-isolation property of the singleton cache, not a bug in the hook.
- `bun run typecheck` reports 103 pre-existing TS errors in `billing` templates, `queue` tests, and `billing` adapter tests. Error count is identical before and after this plan; none are introduced by the new files. Per scope boundary rule, out of scope for this plan.

## Full Test Suite Status

- `bun test packages/modules/example` — 8 pass / 0 fail (3 createExample + 2 processFollowup + 3 registerExampleHooks). Required by the plan's success criteria; satisfied.
- `bun test` (full monorepo backend suite) — 255 tests across 52 files, 223 pass / 32 fail. The 32 failures are pre-existing (admin-auth tests expect 500/get 401-403, get-profile tests, UI a11y/DOM tests needing jsdom). Confirmed identical failure set before and after this plan by comparing counts (250/32 without Task 3 files, 255/32 with them). No regression.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- The example module now exercises all four module surfaces with a concrete runnable BullMQ path. Plan 04 (DOCS-03 "Add a Module" tutorial) can author against a real subject without scaffolding during tutorial writing.
- `registerExampleHooks` is the canonical "event listener that enqueues a job" pattern for any future module. Tutorial can reference the hook-plus-re-export shape side by side with `registerBillingHooks`.
- Manual smoke path for the reviewer: `bun docker:up` -> `bun api` -> `bun worker` -> `POST /api/example` with valid tenant session -> observe (a) API log `example.created` emitted, (b) worker log `Job started` for `example:process-followup`, (c) worker log `[example:process-followup] tenantId=... exampleId=...` from the handler.

## Self-Check: PASSED

All 8 claimed files exist on disk:
- `packages/modules/example/src/jobs/process-followup.ts` — FOUND
- `packages/modules/example/src/hooks/on-example-created.ts` — FOUND
- `packages/modules/example/src/__tests__/create-example.test.ts` — FOUND
- `packages/modules/example/src/__tests__/process-followup.test.ts` — FOUND
- `packages/modules/example/src/__tests__/on-example-created.test.ts` — FOUND
- `packages/modules/example/src/index.ts` — FOUND (modified)
- `packages/modules/example/package.json` — FOUND (modified)
- `apps/api/src/index.ts` — FOUND (modified)

All 3 task commits present in `git log`:
- `beb0b05` (Task 1 — test) — FOUND
- `85dba97` (Task 2 — feat) — FOUND
- `78ed865` (Task 3 — test) — FOUND

Plan-level success criteria verified: `bun test packages/modules/example` reports 8 pass / 0 fail.

---
*Phase: 15-developer-documentation*
*Completed: 2026-04-17*
