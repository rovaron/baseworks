---
phase: 20-bullmq-trace-propagation
plan: 01
subsystem: testing
tags: [bullmq, otel, propagation, tracing, w3c, queue, observability, tdd, smoke-gate]

# Dependency graph
requires:
  - phase: 19-context-logging-http-cqrs-tracing
    provides: wrapProcessorWithAls (Phase 19 D-05 ALS frame seeder), obsContext + getObsContext + ObservabilityContext type
provides:
  - 5-test smoke gate at packages/queue/src/__tests__/carrier-roundtrip.test.ts (D-07b — RED)
  - 3 carrier-extract regression tests appended to packages/queue/src/__tests__/create-worker-als.test.ts (Tests 10/11/12 — Test 12 GREEN, Tests 10/11 RED)
  - W3CTraceContextPropagator beforeAll/afterAll registration pattern (RESEARCH §250 / Pitfall 1 mitigation)
  - buildStubQueue test helper (no-Redis stub Queue with `add` + `addBulk` capture)
affects: [20-02, 20-03]

# Tech tracking
tech-stack:
  added:
    - "@opentelemetry/api ^1.9.1 (direct dep on packages/queue)"
    - "@opentelemetry/core ^2.7.0 (direct dep on packages/queue — provides W3CTraceContextPropagator)"
  patterns:
    - "beforeAll setGlobalPropagator(new W3CTraceContextPropagator()) + afterAll propagation.disable() — REQUIRED in every Phase 20 carrier test, otherwise propagation.inject silently no-ops against the default NoopTextMapPropagator (RESEARCH Pitfall 1)"
    - "buildStubQueue helper — synthetic Queue stub recording `add`/`addBulk` calls without booting Redis; reusable by Plan 20-03 worker-side tests"
    - "fakeJob widening to include queueName + attemptsMade — needed by D-10 attempt-iteration assertion and RESEARCH §626 (consumer span attributes)"

key-files:
  created:
    - packages/queue/src/__tests__/carrier-roundtrip.test.ts
  modified:
    - packages/queue/src/__tests__/create-worker-als.test.ts
    - packages/queue/package.json (added @opentelemetry/api + @opentelemetry/core direct deps)
    - bun.lock

key-decisions:
  - "Added @opentelemetry/api + @opentelemetry/core as direct dependencies of packages/queue. Bun workspace isolated installs do not expose transitive deps from @baseworks/observability to packages/queue test files; explicit deps were the only path to make the test imports resolve."
  - "Fixed createTraceState import path from @opentelemetry/core to @opentelemetry/api — the plan specified the wrong package; createTraceState lives in api in v1.9.1+. Documented as Rule 1 fix; committed separately so future readers see the deviation history."

patterns-established:
  - "Smoke-gate test layout: imports → propagator beforeAll/afterAll → fakeJob + SEED_ALS constants → buildStubQueue helper → describe block with 5 numbered tests covering happy path + D-09 skip + D-04 tracestate + D-10 retry parent inheritance."
  - "Dual-state RED reporting: tests that depend on unshipped exports (wrapQueue) surface as 'Cannot find/Export not found' SyntaxError; tests that depend on unshipped behaviour (extended wrapProcessorWithAls) surface as expect() mismatches. Both are valid RED signals; plan 20-02 turns both GREEN."

requirements-completed: []  # Plan 20-01 is RED-phase TDD scaffolding; CTX-04 + TRC-03 will be marked complete by 20-02 GREEN + 20-03 integration close.

# Metrics
duration: 22min
completed: 2026-04-26
---

# Phase 20 Plan 01: BullMQ Carrier Round-Trip RED Tests Summary

**TDD RED-phase scaffold: 8 new failing tests gating Phase 20 producer/consumer carrier inject/extract behavior, plus W3C propagator setup pattern reusable across the phase.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-04-26T08:04:00Z
- **Completed:** 2026-04-26T08:26:19Z
- **Tasks:** 2 (both committed)
- **Files modified:** 4 (1 created + 3 modified)
- **Commits:** 3 (Task 1 + Rule 1 fix + Task 2)

## Accomplishments
- Authored `carrier-roundtrip.test.ts` — 5 smoke tests covering D-07b's full enumeration (producer inject, round-trip equality, D-09 no-ALS skip, D-04 tracestate forwarding, D-10 retry parent inheritance).
- Extended `create-worker-als.test.ts` — 3 new Tests 10/11/12 for Phase 20 D-05 consumer-extract behavior, with all 9 Phase 19 tests preserved byte-for-byte (modulo fakeJob widening that adds non-breaking fields).
- Established the W3CTraceContextPropagator beforeAll/afterAll registration pattern as the standard for every Phase 20 carrier-touching test. Without it, `propagation.inject` is a silent no-op and the smoke gate would silently pass on a broken implementation.
- Added @opentelemetry/api + @opentelemetry/core as direct deps of packages/queue (transitive-via-observability is not exposed to the queue test files under Bun workspace isolated installs).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create carrier-roundtrip.test.ts smoke gate (D-07b — 5 tests RED)** — `76dfee0` (test)
2. **Rule 1 auto-fix: createTraceState import path correction** — `c4b8422` (fix)
3. **Task 2: Extend create-worker-als with carrier-extract Tests 10/11/12** — `73457b6` (test)

## Files Created/Modified
- `packages/queue/src/__tests__/carrier-roundtrip.test.ts` — NEW. 5-test smoke suite registering W3CTraceContextPropagator in beforeAll, with stub Queue helper and SEED_ALS constant for the producer-side assertions.
- `packages/queue/src/__tests__/create-worker-als.test.ts` — MODIFIED. Added Tests 10/11/12 + beforeAll/afterAll propagator setup + widened fakeJob (queueName + attemptsMade); 9 Phase 19 tests preserved.
- `packages/queue/package.json` — MODIFIED. Added @opentelemetry/api ^1.9.1 + @opentelemetry/core ^2.7.0 as direct dependencies.
- `bun.lock` — MODIFIED. Reflects the queue package's new direct deps (resolved versions already cached in node_modules/.bun via the observability package).

## Test State at Plan Close

| Test file | Pass | Fail | Notes |
|-----------|------|------|-------|
| `create-worker-als.test.ts` | 10 (Tests 1–9 + Test 12) | 2 (Tests 10 + 11) | Tests 10/11 RED waiting for Plan 20-02 to extend `wrapProcessorWithAls` with carrier-extract behaviour; Test 12 GREEN as fresh-fallback regression guard. |
| `carrier-roundtrip.test.ts` | 0 | 5 (all) | All RED via SyntaxError "Export named 'wrapQueue' not found in module '@baseworks/observability'". Plan 20-02 ships `wrapQueue` and turns the file GREEN. |

## Decisions Made
- **Direct otel deps on packages/queue.** Required to make either test file load. Phase 19 didn't need them because it stayed entirely inside `@baseworks/observability` re-exports; Phase 20 requires direct access to `propagation`, `trace`, `context`, `W3CTraceContextPropagator`, `createTraceState`, etc.
- **Separate fix commit for `createTraceState` import.** Could have amended Task 1, but a fresh `fix(20-01): ...` commit preserves audit history and explicitly flags the plan-vs-actual divergence per the deviation protocol.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] createTraceState imported from wrong package**
- **Found during:** Task 2 verification (running `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` after deps were resolved)
- **Issue:** Plan 20-01 Task 1 specified `import { createTraceState } from "@opentelemetry/core";`. In `@opentelemetry/api ^1.9.1` and `@opentelemetry/core ^2.7.0`, `createTraceState` is exported from `@opentelemetry/api` (see `node_modules/.bun/@opentelemetry+api@1.9.1/.../build/src/index.d.ts` line: `export { createTraceState } from './trace/internal/utils';`). With the plan's import path, the file failed to load with `SyntaxError: Export named 'createTraceState' not found in module '@opentelemetry/core'`, masking the true documented RED state ("wrapQueue not found").
- **Fix:** Moved `createTraceState` into the existing `@opentelemetry/api` import group; removed the standalone `@opentelemetry/core` line for it.
- **Files modified:** `packages/queue/src/__tests__/carrier-roundtrip.test.ts`
- **Verification:** After fix, the test file loads to its expected RED state (`SyntaxError: Export named 'wrapQueue' not found in module '@baseworks/observability'`) — exactly the documented RED signal in the plan's `<verify>` block.
- **Committed in:** `c4b8422` (separate fix commit between Task 1 and Task 2)

**2. [Rule 3 - Blocking] @opentelemetry/api + /core not resolvable from packages/queue**
- **Found during:** Task 2 verification (initial test run after `bun install`)
- **Issue:** Plan interfaces section claimed `@opentelemetry/api ^1.9.1` was available "transitive via @baseworks/observability". Under Bun's workspace isolated installs, transitive deps of a workspace dep are NOT hoisted into the consuming package's `node_modules/`. `apps/api` lists @opentelemetry/api directly and works; `packages/queue` did not, and both Phase 20 test files crashed on `Cannot find module '@opentelemetry/api'`.
- **Fix:** Added `"@opentelemetry/api": "^1.9.1"` and `"@opentelemetry/core": "^2.7.0"` to `packages/queue/package.json` dependencies. Versions chosen to match the resolved versions already cached at `node_modules/.bun/@opentelemetry+api@1.9.1` and `@opentelemetry+core@2.7.0`. `bun install` ran clean (no new downloads, just symlink updates).
- **Files modified:** `packages/queue/package.json`, `bun.lock`
- **Verification:** After install, `ls packages/queue/node_modules/@opentelemetry/` returns `api  core`. Both test files load past the import phase.
- **Committed in:** `73457b6` (folded into Task 2 commit because the dep is required for both test files to run, and Task 2's tests were the first to actually exercise the package via the `propagation.inject` happy path)

**3. [Environmental — not strictly a deviation] .env file copied from parent repo into worktree**
- **Found during:** Task 2 verification
- **Issue:** Worktrees in the GSD parallel-execution model don't inherit `.env` from the parent repo. `@baseworks/observability` transitively imports `@baseworks/config`, which validates DATABASE_URL/BETTER_AUTH_SECRET at module load time and crashes on missing env. Even original Phase 19 tests fail in a fresh worktree without `.env`.
- **Fix:** Copied `.env` from `C:\Projetos\baseworks\.env` to the worktree root. `.env` is gitignored so this is not committed.
- **Files modified:** None tracked.
- **Verification:** Tests run; this is local environment setup, not a code change.
- **Committed in:** N/A (gitignored)

---

**Total deviations:** 2 code-level auto-fixes (1 Rule 1 bug, 1 Rule 3 blocking) + 1 environmental setup
**Impact on plan:** All necessary for the plan's documented test states to be achievable. The Rule 3 dep addition is a one-time-per-package fix; future Phase 20 plans (20-02, 20-03) inherit the resolved deps without further action.

## Issues Encountered

- The `createTraceState` import path bug (Rule 1) initially surfaced as a different error than the documented expected RED, almost masking it. Resolved by reading the actual @opentelemetry/api index.d.ts to confirm export location, then patching the import.
- The `@opentelemetry/api` resolution failure (Rule 3) initially looked like the documented "Cannot find module" RED state for `wrapQueue`, but on closer inspection was a different module (api, not @baseworks/observability) — a category-different error. Fixed by adding direct deps; afterward the test reaches the documented "wrapQueue not found" state.
- `.env` not present in the worktree caused `@baseworks/config`'s schema validator to crash before any test code ran. This is a worktree-environment issue, not a code issue, and exists for Phase 19 tests too. Worked around by copying parent repo's `.env`.

## Hand-off to Plan 20-02

Plan 20-02 must satisfy these assertions to flip RED → GREEN:

| Test file | Test | What 20-02 must ship |
|-----------|------|----------------------|
| carrier-roundtrip.test.ts | (file load) | Export `wrapQueue` from `@baseworks/observability/src/index.ts` |
| carrier-roundtrip.test.ts | Test 1 | `wrapQueue(q).add(...)` calls inside `obsContext.run` must mutate `data._otel.traceparent` (W3C format) AND copy `_requestId`/`_tenantId`/`_userId` from active ALS |
| carrier-roundtrip.test.ts | Test 2 | `wrapProcessorWithAls` must read `job.data._otel` via `propagation.extract(...)` and seed `obsContext` traceId from the extracted span context. Also propagate `_requestId`/`_tenantId`/`_userId` from `job.data` into the ALS frame. |
| carrier-roundtrip.test.ts | Test 3 | `wrapQueue(q).add(...)` OUTSIDE `obsContext.run` must NOT mutate data (no `_otel`, no flat fields). D-09 skip. |
| carrier-roundtrip.test.ts | Test 4 | Producer wrapper must open its own span via `tracer.startSpan` inside `context.active()` so the new span inherits the active context's tracestate; injection then includes `tracestate: 'vendor=value'` in the carrier. |
| carrier-roundtrip.test.ts | Test 5 | Per-attempt fresh consumer span (distinct spanId) but shared producer parent (same traceId) when wrapProcessorWithAls is called twice with the same carrier and `attemptsMade` 0 → 1. |
| create-worker-als.test.ts | Test 10 | Same as carrier-roundtrip Test 2 — extracted producer traceId seeds inner ALS. |
| create-worker-als.test.ts | Test 11 | Same as carrier-roundtrip Test 2 for `_tenantId`/`_userId`. |

Plan 20-02 should NOT need to modify any of the test files in this plan; the tests are the contract. If 20-02 finds a test assertion it disagrees with, that's a 20-PATTERNS.md / 20-CONTEXT.md re-discussion item, not a test rewrite.

## User Setup Required

None — Phase 20 Plan 01 is pure test infrastructure scaffolding. No env vars, no external services, no DB migrations.

## Next Phase Readiness

- **Plan 20-02 (next):** Ready to execute. Test contracts are committed and unambiguous; the dep additions to packages/queue mean 20-02 can `import` from @opentelemetry/api/core directly without further package.json work.
- **Plan 20-03:** Ready in parallel — uses the same `buildStubQueue` helper pattern + `propagation.setGlobalPropagator(new W3CTraceContextPropagator())` setup pattern, both established here.

## Self-Check: PASSED

**Created files exist:**
- FOUND: `packages/queue/src/__tests__/carrier-roundtrip.test.ts`

**Modified files exist:**
- FOUND: `packages/queue/src/__tests__/create-worker-als.test.ts`
- FOUND: `packages/queue/package.json` (with new otel deps)

**Commits exist:**
- FOUND: `76dfee0` (Task 1 — test(20-01): add carrier-roundtrip smoke gate)
- FOUND: `c4b8422` (Rule 1 fix — createTraceState import path)
- FOUND: `73457b6` (Task 2 — test(20-01): extend create-worker-als with carrier-extract tests 10/11/12)

**Acceptance criteria spot-checks:**
- `grep -c "propagation.setGlobalPropagator(new W3CTraceContextPropagator())" packages/queue/src/__tests__/carrier-roundtrip.test.ts` = 1 ✓
- `grep -c "propagation.setGlobalPropagator(new W3CTraceContextPropagator())" packages/queue/src/__tests__/create-worker-als.test.ts` = 1 ✓
- `grep -cE "test\(\"Test [1-5]:" packages/queue/src/__tests__/carrier-roundtrip.test.ts` = 5 ✓
- `grep -c "Test 10:" packages/queue/src/__tests__/create-worker-als.test.ts` = 1 ✓
- `grep -c "Test 11:" packages/queue/src/__tests__/create-worker-als.test.ts` = 1 ✓
- `grep -c "Test 12:" packages/queue/src/__tests__/create-worker-als.test.ts` = 1 ✓
- `bun test packages/queue/src/__tests__/create-worker-als.test.ts` exits non-zero with 10 pass / 2 fail ✓ (matches plan's "≥10 pass, ≤2 fail")
- `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` exits non-zero with documented "wrapQueue not found" SyntaxError ✓

---
*Phase: 20-bullmq-trace-propagation*
*Plan: 01*
*Completed: 2026-04-26*
