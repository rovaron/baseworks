---
phase: 22-admin-ops-tooling
plan: 01
subsystem: observability
tags: [env, zod, observability, ringbuffer, instance-id, foundation, types]

# Dependency graph
requires:
  - phase: 17-observability-ports-otel-bootstrap
    provides: ErrorTracker port + NoopErrorTracker (decorator base class)
  - phase: 18-observability-error-tracking
    provides: scrubPii (consumed by inner tracker chain — ringbuffer trusts it)

provides:
  - "BULL_BOARD_READ_ONLY env var (z.enum, default 'true', crash-hard at boot)"
  - "WORKER_HEARTBEAT_INTERVAL_MS env var (z.coerce.number, min 1000 max 300000, default 15000)"
  - "HealthContributor + HealthCheckResult types in @baseworks/shared"
  - "ModuleDefinition.health? optional slot for OPS-04 aggregator"
  - "resolveInstanceId() helper exported from @baseworks/observability (D-12 fallback chain)"
  - "RingBufferingErrorTracker decorator + RingBufferEntry type from @baseworks/observability (D-15)"

affects:
  - 22-02-aggregator-mount
  - 22-03-health-detailed
  - 22-04-bull-board-mount
  - 22-05-worker-heartbeat
  - 22-06-admin-ui-page

# Tech tracking
tech-stack:
  added: []  # No new packages — pure source code changes against existing deps
  patterns:
    - "ErrorTracker decorator pattern (pure delegation + side-buffer) — wraps inner adapter without modifying its surface"
    - "Subprocess-based env validation tests — re-uses pattern from packages/config/src/__tests__/env.test.ts"

key-files:
  created:
    - "packages/observability/src/instance-id.ts"
    - "packages/observability/src/lib/ring-buffer-error-tracker.ts"
    - "packages/observability/src/__tests__/instance-id.test.ts"
    - "packages/observability/src/lib/__tests__/ring-buffer-error-tracker.test.ts"
    - "packages/config/src/__tests__/env-bull-board.test.ts"
  modified:
    - "packages/config/src/env.ts (+2 schema fields)"
    - ".env.example (+8 lines documenting new vars)"
    - "packages/shared/src/types/module.ts (+ HealthContributor, HealthCheckResult, ModuleDefinition.health?)"
    - "packages/shared/src/index.ts (re-export new types)"
    - "packages/observability/src/index.ts (re-export resolveInstanceId, RingBufferingErrorTracker)"

key-decisions:
  - "BULL_BOARD_READ_ONLY uses z.enum literal-string default ('true'/'false') instead of z.coerce.boolean — matches existing repo pattern (no other env var coerces booleans) and the Zod enum shape is what crash-hard error messages reference."
  - "WORKER_HEARTBEAT_INTERVAL_MS bounds 1000ms .. 300000ms (1s .. 5min) per D-13. Below 1s would saturate Redis; above 5min would make 'dead' detection (5x interval = 25min) practically useless."
  - "instance-id.ts reads process.env directly with NO @baseworks/config import — mirrors factory.ts header note. The helper must work at module-import time before the config schema is built."
  - "RingBufferingErrorTracker.captureMessage signature aligned to actual ErrorTracker port (message, level) — Plan 22-01 plan text drafted a 3-arg shape with CaptureScope that does not match the deployed Phase 17 port. Aligned per Rule 3 (blocking issue)."
  - "RingBufferingErrorTracker reindexes its dedup Map on eviction (every index drops by 1 after Array.shift) — without this, post-eviction dedup of surviving entries would silently leak duplicates into the buffer."

patterns-established:
  - "ErrorTracker decorator: full-port delegation + private append() side-effect — the template for any future tracker-wrapping decorators"
  - "Crash-hard env validation via Zod (no separate validator function): z.enum for typo-rejection, z.coerce.number with min/max for bounded numbers — Zod throws at createEnv() invocation"

requirements-completed: [OPS-01, OPS-03, OPS-04, EXT-02]

# Metrics
duration: ~25min
completed: 2026-04-27
---

# Phase 22 Plan 01: Foundation Primitives Summary

**Two crash-hard env vars (BULL_BOARD_READ_ONLY, WORKER_HEARTBEAT_INTERVAL_MS), HealthContributor type slot on ModuleDefinition, instance-id resolver, and a RingBufferingErrorTracker decorator — every Wave 2+ plan now has its required primitives.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-27T13:06Z (approx)
- **Completed:** 2026-04-27T13:31Z
- **Tasks:** 3 (env vars, types + instance-id, ringbuffer decorator)
- **Files modified:** 5
- **Files created:** 5
- **Tests added:** 25 (8 env, 4 instance-id, 13 ringbuffer)

## Accomplishments

- **Env validation:** `BULL_BOARD_READ_ONLY: z.enum(["true", "false"]).default("true")` and `WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().min(1000).max(300_000).default(15_000)` added to `serverSchema` — boot crashes on typo or out-of-range value before `Bun.serve.listen()` (T-22-02 mitigated).
- **Health type slot:** `HealthContributor` (name, async check, optional timeoutMs) + `HealthCheckResult` ('healthy'/'degraded'/'unhealthy', optional details) added to `@baseworks/shared`. `ModuleDefinition.health?` is the wire-up point for the Plan 22-02 aggregator.
- **Instance-id resolver:** `resolveInstanceId(): string` returns `INSTANCE_ID || HOSTNAME || os.hostname()` — direct `process.env` read, no `@baseworks/config` coupling. Plan 22-05 worker heartbeat uses this verbatim for the Redis key suffix.
- **RingBufferingErrorTracker:** Full ErrorTracker-port decorator (delegates every method to inner tracker) + private 50-entry ring buffer deduped by `${message}::${firstFrame}`. Messages truncated to 500 chars (T-22-07 mitigation). `snapshot()` returns a defensive copy for Plan 22-03 `/health/detailed`.

## Task Commits

1. **Task 1: env vars + .env.example + tests** — `9470775` (feat)
2. **Task 2: HealthContributor types + resolveInstanceId helper** — `f6a1d0a` (feat)
3. **Task 3: RingBufferingErrorTracker decorator** — `6904c94` (feat)

## Files Created/Modified

### Created

- `packages/config/src/__tests__/env-bull-board.test.ts` — 8 subprocess-spawn tests covering BULL_BOARD_READ_ONLY (4) + WORKER_HEARTBEAT_INTERVAL_MS (4)
- `packages/observability/src/instance-id.ts` — single `resolveInstanceId()` export, 18 lines including header comment
- `packages/observability/src/__tests__/instance-id.test.ts` — 4 tests covering full D-12 fallback chain + INSTANCE_ID precedence
- `packages/observability/src/lib/ring-buffer-error-tracker.ts` — `RingBufferingErrorTracker` class + `RingBufferEntry` type, 130 lines
- `packages/observability/src/lib/__tests__/ring-buffer-error-tracker.test.ts` — 13 tests across 4 describe blocks (delegation, capture/dedup, capacity/eviction, snapshot immutability)

### Modified

- `packages/config/src/env.ts` — appended 2 z-schema fields after `WORKER_HEALTH_PORT` (lines 48-52)
- `.env.example` — appended 8 lines documenting both new vars after `WORKER_HEALTH_PORT=3001`
- `packages/shared/src/types/module.ts` — extended `ModuleDefinition` with `health?: HealthContributor`; appended `HealthCheckResult` + `HealthContributor` interface declarations
- `packages/shared/src/index.ts` — added `HealthContributor` and `HealthCheckResult` to existing module-types re-export block
- `packages/observability/src/index.ts` — appended re-exports for `resolveInstanceId`, `RingBufferingErrorTracker`, `RingBufferEntry`

## Decisions Made

### Final shapes (so downstream plans pick them up deterministically)

**Env schema additions** (`packages/config/src/env.ts`, after line 47):
```typescript
BULL_BOARD_READ_ONLY: z.enum(["true", "false"]).default("true"),
WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().min(1000).max(300_000).default(15_000),
```

**Health type exports** (`packages/shared/src/index.ts`):
```typescript
export type {
  ModuleDefinition,
  JobDefinition,
  HealthContributor,
  HealthCheckResult,
} from "./types/module";
```

Plans 22-02 (aggregator), 22-06 (admin UI consumes the result type) import these by name from `@baseworks/shared`.

**resolveInstanceId() resolution-chain semantics** (`packages/observability/src/instance-id.ts`):
```typescript
export function resolveInstanceId(): string {
  return process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? os.hostname();
}
```
Plan 22-05 wires this into the worker heartbeat publisher with no further configuration — the resolver is callable from any thread/process.

**RingBufferingErrorTracker dedup-key formula and capacity**:
- Default capacity: **50 entries** (constructor-overridable for tests)
- Dedup key: `` `${message}::${firstFrame}` `` where `message` is truncated to 500 chars and `firstFrame` is the first non-`node_modules` stack line trimmed and capped at 200 chars
- On dedup hit: existing entry's `count++` and `timestamp` is refreshed to `new Date().toISOString()`
- On eviction: `Array.shift()` removes oldest, then every value in `dedupIndex` is decremented by 1 to keep indices valid (CRITICAL — without this, post-eviction merges would target the wrong entry)
- `snapshot()` returns `[...this.buffer]` so callers cannot mutate the live buffer

Plan 22-03 wires `recentErrorsSnapshot` by calling `tracker.snapshot()` from the aggregator's `recent-errors` contributor — no further interface negotiation required.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing node_modules in worktree**
- **Found during:** Task 1 verification (test subprocess could not resolve `@t3-oss/env-core`)
- **Issue:** The worktree was created without `bun install`, so the test runner's spawned subprocesses couldn't import `@baseworks/config`.
- **Fix:** Ran `bun install` (1432 packages installed). Bun's monorepo workspace resolution then satisfied all subprocess imports.
- **Files modified:** none (only `bun.lock` is touched, but it was already in tree)
- **Verification:** All 8 env tests pass after install
- **Committed in:** N/A (install is a worktree-setup step, not a code change)

**2. [Rule 3 - Blocking] Test cwd path off by one level**
- **Found during:** Task 1 first test run
- **Issue:** Plan-supplied cwd `import.meta.dir + "/../../.."` resolves to `packages/` from `packages/config/src/__tests__/` — module resolution still failed because Bun couldn't locate workspace `node_modules`.
- **Fix:** Adjusted to `import.meta.dir + "/../../../.."` to reach the repo root where the lock file and `node_modules` live.
- **Files modified:** `packages/config/src/__tests__/env-bull-board.test.ts`
- **Verification:** All 8 env tests pass
- **Committed in:** `9470775` (Task 1 commit)

**3. [Rule 3 - Port mismatch] captureMessage signature drift in plan vs deployed port**
- **Found during:** Task 3 (RingBuffer decorator design)
- **Issue:** Plan 22-01 plan text drafted `RingBufferingErrorTracker.captureMessage(message, level, scope)` and a test scaffold passing scope as a third arg. The deployed `ErrorTracker` port at `packages/observability/src/ports/error-tracker.ts:106` declares `captureMessage(message: string, level?: LogLevel)` — no scope parameter.
- **Fix:** Aligned the decorator with the actual port: `captureMessage(message: string, level?: LogLevel)`. Message captures default to source `"global"` since they have no scope to read `tags.source` from. Test scaffold updated to drop the third argument.
- **Files modified:** `packages/observability/src/lib/ring-buffer-error-tracker.ts`, `packages/observability/src/lib/__tests__/ring-buffer-error-tracker.test.ts`
- **Verification:** All 13 ringbuffer tests pass; `bun x tsc --noEmit -p packages/observability` exits 0
- **Committed in:** `6904c94` (Task 3 commit)

**4. [Rule 3 - Test pattern alignment] Cache-bust import vs subprocess pattern**
- **Found during:** Task 1 test scaffolding
- **Issue:** Plan suggested `import("../env?t=" + Date.now())` cache-busting to re-evaluate `createEnv` per test case. The repo's existing `env.test.ts` uses `Bun.spawn` subprocesses for the exact same scenario, which is proven against the t3-oss/env-core schema-eval timing.
- **Fix:** Used the established `Bun.spawn` subprocess pattern. Each test spawns a fresh Bun child with the env overrides and asserts on exit code + stdout. Same coverage, proven reliability.
- **Files modified:** `packages/config/src/__tests__/env-bull-board.test.ts`
- **Verification:** All 8 tests pass; pattern matches `env.test.ts`
- **Committed in:** `9470775` (Task 1 commit)

---

**Total deviations:** 4 auto-fixed (3 blocking, 1 pattern alignment)
**Impact on plan:** All deviations resolve plan-vs-reality drift discovered at execution time (missing install, wrong cwd depth, port signature drift, test-pattern proven-vs-experimental). Zero scope changes — every artifact in the plan's `<must_haves>` ships as specified.

## Issues Encountered

- Pre-existing `bun x tsc --noEmit` errors at repo root (apps/api/observability.test.ts Elysia generic-inference, packages/modules/billing JSX/template type holes, packages/queue test KeepJobs typing, @radix-ui/react-switch types). Documented in `.planning/phases/22-admin-ops-tooling/deferred-items.md`. Per-package tsc on `packages/observability`, `packages/shared`, `packages/config` exits 0.
- One flaky timeout in `packages/observability/src/__tests__/context.test.ts` when the full `bun test packages/observability` is parallelised. Passes when run isolated. Pre-existing, unrelated to Plan 22-01 changes.

## User Setup Required

None — Plan 22-01 introduces only env-var defaults that boot cleanly without operator action. The new `BULL_BOARD_READ_ONLY=true` and `WORKER_HEARTBEAT_INTERVAL_MS=15000` defaults are documented in `.env.example` for operators who want to override.

## Next Phase Readiness

- **Plan 22-02 (aggregator):** Imports `HealthContributor` from `@baseworks/shared` — slot is in place.
- **Plan 22-03 (`/health/detailed`):** Imports `RingBufferingErrorTracker` + `RingBufferEntry` from `@baseworks/observability` — both exported. Aggregator wires `tracker.snapshot()` directly.
- **Plan 22-04 (bull-board mount):** Reads `env.BULL_BOARD_READ_ONLY` from `@baseworks/config` — schema field is in place.
- **Plan 22-05 (worker heartbeat):** Imports `resolveInstanceId` from `@baseworks/observability` and `env.WORKER_HEARTBEAT_INTERVAL_MS` from `@baseworks/config` — both available.
- **Plan 22-06 (admin UI page):** Imports the public types `HealthContributor` / `HealthCheckResult` / `RingBufferEntry` for the response-shape contract — all exported from package barrels.

## Self-Check

Verified files and commits via `git log --oneline -5` and direct file access:

- FOUND: `packages/config/src/env.ts` (modified — schema additions present)
- FOUND: `.env.example` (modified — new var docs present)
- FOUND: `packages/shared/src/types/module.ts` (modified — HealthContributor + HealthCheckResult + health? slot present)
- FOUND: `packages/shared/src/index.ts` (modified — re-exports updated)
- FOUND: `packages/observability/src/instance-id.ts`
- FOUND: `packages/observability/src/index.ts` (modified — barrel re-exports added)
- FOUND: `packages/observability/src/lib/ring-buffer-error-tracker.ts`
- FOUND: `packages/observability/src/__tests__/instance-id.test.ts`
- FOUND: `packages/observability/src/lib/__tests__/ring-buffer-error-tracker.test.ts`
- FOUND: `packages/config/src/__tests__/env-bull-board.test.ts`
- FOUND commit: `9470775` (Task 1)
- FOUND commit: `f6a1d0a` (Task 2)
- FOUND commit: `6904c94` (Task 3)

## Self-Check: PASSED

---
*Phase: 22-admin-ops-tooling*
*Completed: 2026-04-27*
