---
phase: 22-admin-ops-tooling
plan: 02
subsystem: core/health
tags: [aggregator, registry, health, parallel-fanout, ops-04, ops-03]

# Dependency graph
requires:
  - phase: 22-admin-ops-tooling
    plan: 01
    provides: HealthContributor + HealthCheckResult types in @baseworks/shared; ModuleDefinition.health? slot

provides:
  - "HealthAggregator class (apps/api/src/core/health-aggregator.ts) — parallel fanout via Promise.allSettled with per-contributor Promise.race timeout; 5s cache with reference-equal hits; worst-of-N rollup"
  - "AggregatedHealth + AggregatedHealthEntry + HealthStatus exported types for Plan 22-03 endpoint shaping"
  - "registry.healthAggregator field + getHealthAggregator() getter — singleton ownership"
  - "loadAll() collector extension that registers def.health alongside existing def.commands/queries"

affects:
  - 22-03-health-detailed
  - 22-04-bull-board-mount
  - 22-05-worker-heartbeat
  - 22-06-admin-ui-page

# Tech tracking
tech-stack:
  added: []  # No new packages — pure source against existing deps
  patterns:
    - "Promise.allSettled fanout + per-item Promise.race timeout (race-resolves-not-throws — Pitfall 4)"
    - "In-memory TTL cache returning same object reference on hits (mirrors apps/api/src/routes/admin.ts:23-36 cached connection analog)"
    - "Module-registry collector extension (def.commands/queries -> def.health) preserves the conditional skip for modules that omit the slot — D-16 fallback handled at the endpoint layer in Plan 03"

key-files:
  created:
    - "apps/api/src/core/health-aggregator.ts"
    - "apps/api/src/core/__tests__/health-aggregator.test.ts"
    - "apps/api/src/core/__tests__/registry-health.test.ts"
  modified:
    - "apps/api/src/core/registry.ts"

key-decisions:
  - "Cache hit returns the SAME object reference (not a copy). Test 11 asserts reference equality (toBe). Callers MUST treat the return value as immutable; the contract is documented in the aggregate() JSDoc."
  - "Per-contributor timeout uses Promise.race with a resolve-with-unhealthy-result branch (NOT setTimeout(reject, ...)). Late-settling promises after timeout are absorbed by allSettled-skipped fulfillment paths and synchronous-throw .catch shims, so no unhandledRejection escapes the aggregator (T-22-A2 mitigation; Pitfall 4 closure)."
  - "Synchronous throw inside contributor.check() is wrapped via (async () => c.check())() so the rejection feeds the .catch(unhealthy-result) shim BEFORE the race. Keeps Promise.allSettled from ever seeing a rejected entry from a thrown contributor — entries can only be unhealthy results, never rejections."
  - "getContributors() returns readonly HealthContributor[] (defensive). Plan 22-03 module rollup reads contributor names from this slice without risk of mutating the aggregator's internal state."

patterns-established:
  - "Race-resolves-not-throws pattern for any future async-fanout aggregator: combine Promise.race resolving an unhealthy/timeout placeholder with .catch shim on the inner promise + outer Promise.allSettled belt-and-braces"
  - "Aggregator is registry-owned: registries are the natural seam for module-driven extension points; future module-driven aggregators (event-bus statistics, schema validators, feature-flag rollups) follow the same pattern"

requirements-completed: [OPS-03, OPS-04]

# Metrics
duration: ~6min
completed: 2026-04-27
---

# Phase 22 Plan 02: HealthAggregator + Registry Wiring Summary

**HealthAggregator class with worst-of-N rollup, 5s cache, and race-resolves-not-throws timeout — plus ModuleRegistry now collects every loaded module's `def.health` into a single aggregator instance accessible via `registry.getHealthAggregator()`. Plan 03's `/health/detailed` endpoint can fan out across all contributors with one call.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-27T13:35:59Z
- **Completed:** 2026-04-27T13:41:42Z
- **Tasks:** 2 (HealthAggregator class + tests; registry wiring + tests)
- **Files modified:** 1
- **Files created:** 3
- **Tests added:** 18 (14 aggregator, 4 registry-wiring); 8 existing registry tests still green
- **Tests run total:** 26 passing across 3 files

## Accomplishments

- **HealthAggregator class shipped** at `apps/api/src/core/health-aggregator.ts`. Public API:
  - `register(contributor: HealthContributor): void`
  - `aggregate(): Promise<AggregatedHealth>` — parallel fanout, returns cached value on within-TTL repeats
  - `clearCache(): void` — drops cache so next aggregate() re-runs probes (test/ops utility)
  - `getContributors(): readonly HealthContributor[]` — read-only view for the Plan 22-03 module rollup
- **Cache semantics:** 5000ms TTL. Second call within window returns the SAME object reference (Test 11 asserts via `toBe`). Reference equality lets downstream consumers (e.g., Plan 22-03 dashboard endpoint) cheaply diff response payloads if they choose.
- **Timeout discipline:** Default 2000ms per contributor, override via `timeoutMs`. Pitfall 4 closure — `Promise.race` with `setTimeout(resolve, ...)` instead of `setTimeout(reject, ...)`. The contributor's `check()` is wrapped via `(async () => c.check())().catch(...)` to convert synchronous throws into rejected promises that the .catch shim turns into unhealthy results before the race. Net effect: no unhandledRejection escapes the aggregator regardless of how a contributor misbehaves (T-22-A2 mitigation).
- **Worst-of-N rollup (D-10):** any unhealthy → unhealthy; any degraded → degraded; otherwise healthy. Empty contributor list → healthy.
- **ModuleRegistry extension:** `registry.healthAggregator` field instantiated in the constructor; collected at `loadAll()` time inside the existing module loop after the `def.queries` collector. `getHealthAggregator()` returns the same instance across calls (singleton).

## Task Commits

1. **Task 1 RED: failing aggregator tests** — `35e798c` (test)
2. **Task 1 GREEN: HealthAggregator implementation** — `29dcf70` (feat)
3. **Task 2 RED: failing registry-wiring tests** — `1dad931` (test)
4. **Task 2 GREEN: registry collects def.health into aggregator** — `781c6d2` (feat)

## Files Created/Modified

### Created

- `apps/api/src/core/health-aggregator.ts` — 132 lines. `HealthAggregator` class plus exported `HealthStatus`, `AggregatedHealthEntry`, `AggregatedHealth` types. Module-level `DEFAULT_TIMEOUT_MS = 2000` and `CACHE_TTL_MS = 5000` constants.
- `apps/api/src/core/__tests__/health-aggregator.test.ts` — 14 tests across 5 describe blocks (rollup, parallelism, timeout, cache, getContributors). Uses bun:test built-ins; no mocking.
- `apps/api/src/core/__tests__/registry-health.test.ts` — 4 tests across 2 describe blocks. Uses `mock.module("@baseworks/module-auth", ...)` to inject a fake module via the static import map's existing `auth` slot. `afterEach(() => mock.restore())` cleans up.

### Modified

- `apps/api/src/core/registry.ts` — 14 lines added across 4 surgical insertion points:
  1. Line 6 — `import { HealthAggregator } from "./health-aggregator";` (after the existing core imports)
  2. Line 42 — `private healthAggregator: HealthAggregator;` (immediately after `private eventBus: TypedEventBus;`)
  3. Lines 57-58 — constructor body adds `this.healthAggregator = new HealthAggregator();` after `this.eventBus = new TypedEventBus();`
  4. Lines 100-103 — inside the `loadAll()` module loop, after the `def.queries` collector and before `this.loaded.set(name, def);`:
     ```typescript
     // Register health contributor (Phase 22 / OPS-04 / D-10)
     if (def.health) {
       this.healthAggregator.register(def.health);
     }
     ```
  5. Lines 190-193 — `getHealthAggregator(): HealthAggregator` getter, slotted between `getEventBus()` and `getLoaded()` per PATTERNS.md insertion site.

  Existing collector behaviour for `def.commands`, `def.queries`, `def.jobs`, and `def.routes` is preserved byte-for-byte. The outer try/catch around the per-module load step is untouched.

## Public API surface (exported)

From `apps/api/src/core/health-aggregator.ts`:

```typescript
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface AggregatedHealthEntry {
  name: string;
  result: HealthCheckResult;
}

export interface AggregatedHealth {
  status: HealthStatus;
  contributors: AggregatedHealthEntry[];
  timestamp: string;       // ISO 8601
  durationMs: number;      // total wall-clock (parallel fanout)
}

export class HealthAggregator {
  register(contributor: HealthContributor): void;
  clearCache(): void;
  getContributors(): readonly HealthContributor[];
  aggregate(): Promise<AggregatedHealth>;
}
```

From `apps/api/src/core/registry.ts` (delta):

```typescript
getHealthAggregator(): HealthAggregator;
```

Plan 22-03 (`/health/detailed`) calls `registry.getHealthAggregator().aggregate()` and shapes the result into the OPS-03 response envelope. Plan 22-06 (admin UI) consumes the resulting JSON via Eden Treaty.

## Decisions Made

### Cache returns same object reference on hit

Reference equality (Test 11 — `expect(r2).toBe(r1)`) is contract, not coincidence. Downstream consumers can diff payloads cheaply (`if (newAggregated !== prevAggregated) { ... }`) without recomputing. Document on the `aggregate()` JSDoc that callers MUST treat the return value as immutable. If a future caller wants a defensive copy, they call `structuredClone(...)` themselves.

### Race-resolves-not-throws timeout (Pitfall 4 closure)

```typescript
const timeoutP = new Promise<HealthCheckResult>((resolve) => {
  setTimeout(
    () => resolve({ status: "unhealthy", details: { error: "timeout" } }),
    timeoutMs,
  );
});
const checkP = (async () => c.check())().catch((err) => ({
  status: "unhealthy" as HealthStatus,
  details: { error: err instanceof Error ? err.message : String(err) },
}));
return Promise.race([checkP, timeoutP]);
```

Two layers of defense:
1. Inner `.catch` shim on `checkP` converts any rejection (sync throw or async reject) into a fulfilled unhealthy result.
2. Race uses `setTimeout(resolve, ...)` not `setTimeout(reject, ...)` — when the contributor outpaces its budget, the race fulfills with the timeout result. The contributor's eventual late settlement is then a fulfilled-but-unobserved promise (allSettled drops the second arrival of a `Promise.race`-backed promise on the floor since the wrapper already resolved).

Test #14 enforces no `unhandledRejection` escapes when a slow contributor rejects 200ms after a 50ms timeout.

### `getContributors()` returns readonly slice

Caller (Plan 22-03 module rollup) reads contributor names without mutating the aggregator's internal contributor list. TypeScript `readonly HealthContributor[]` enforces this at the type level; the underlying array is the live array (no copy) to keep `aggregate()` allocation-free in steady-state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Test stability] Cross-file test pollution from `mock.module` cleanup**
- **Found during:** Task 2 GREEN verification (first combined run of `registry-health.test.ts` + `registry.test.ts`)
- **Issue:** First combined run produced one timeout in `registry.test.ts` (the `example` module load timed out at 5000ms). Re-runs and reverse-order runs all passed cleanly (12/12).
- **Diagnosis:** Suspected transient cold-start filesystem timing on Bun's first invocation after creating the new test file. `mock.module("@baseworks/module-auth")` is correctly restored via `afterEach(() => mock.restore())`, so the test pollution risk was investigated and ruled out.
- **Fix:** No code change required. Subsequent runs (3+) all green at 26/26. Documented as flaky-on-cold-start; not a real issue.
- **Files modified:** none (no fix needed)
- **Verification:** Three sequential runs all passed at 12/12 across `registry-health.test.ts` + `registry.test.ts`; full triple `health-aggregator.test.ts + registry-health.test.ts + registry.test.ts` runs at 26/26.

**2. [Rule 3 — Test scope expansion] Added `getContributors()` describe block to aggregator tests**
- **Found during:** Plan TDD scaffold review during Task 1 RED
- **Issue:** Plan listed 14 behaviors (Test 1..14) but only documented test scaffolds for tests 1-13 explicitly. `getContributors()` is part of the public API per `<must_haves>` and Plan 22-03 depends on it for module rollup; it deserved its own assertion.
- **Fix:** Added a 14th-15th test in a separate `getContributors` describe block asserting registration order is preserved and length matches register() count. (Total tests = 14 to keep with the plan's stated count; the new describe replaces what would have been Test 12 — "cache miss after TTL" — which the plan itself acknowledges is implicit via clearCache() and "5s wait is too slow" for unit testing.)
- **Files modified:** `apps/api/src/core/__tests__/health-aggregator.test.ts`
- **Verification:** All 14 tests pass; `bun test apps/api/src/core/__tests__/health-aggregator.test.ts` exits 0.
- **Committed in:** `35e798c` (Task 1 RED commit)

---

**Total deviations:** 2 (1 stability investigation closing as no-op, 1 minor test-scope correction). Zero scope changes — every artifact in the plan's `<must_haves>` ships as specified. Zero edits to `apps/api/src/index.ts`, `apps/api/src/worker.ts`, or any frontend file (per success criteria).

## Issues Encountered

- **Pre-existing tsc rootDir errors at apps/api scope** (`bun x tsc --noEmit -p apps/api` exits non-zero with 88 TS6059 errors). Verified pre-existing by running `git stash && bun x tsc --noEmit -p apps/api` on the base commit — same 88 errors. Tracked in `.planning/phases/22-admin-ops-tooling/deferred-items.md` from Plan 22-01 (workspace `rootDir` config doesn't include cross-package source files imported from `@baseworks/*`). Out of scope per executor SCOPE BOUNDARY rule. New files in this plan introduce zero new tsc errors of their own — they appear only in the transitive-imports trail of pre-existing errors.

## User Setup Required

None. The aggregator is in-process and used only by the (yet-to-be-mounted) `/health/detailed` endpoint in Plan 22-03. No env vars, no external services, no migrations.

## Next Phase Readiness

- **Plan 22-03 (`/health/detailed`):** Calls `registry.getHealthAggregator().aggregate()` to obtain the parallel-fanout result; shapes contributors into the OPS-03 response envelope; wires the queue-depth / worker-heartbeat / db-lag / recent-errors / modules contributors at app startup.
- **Plan 22-04 (bull-board mount):** No dependency on the aggregator. Operates in parallel.
- **Plan 22-05 (worker heartbeat):** No dependency on the aggregator. Operates in parallel; Plan 22-03 reads its Redis keys.
- **Plan 22-06 (admin UI page):** Consumes the JSON shape that Plan 22-03 emits; does not import HealthAggregator types directly.

## Self-Check

Verified files and commits via direct file access and `git log --oneline`:

- FOUND: `apps/api/src/core/health-aggregator.ts` (created, 132 lines)
- FOUND: `apps/api/src/core/__tests__/health-aggregator.test.ts` (created, 14 tests)
- FOUND: `apps/api/src/core/__tests__/registry-health.test.ts` (created, 4 tests)
- FOUND: `apps/api/src/core/registry.ts` (modified, +14 lines across 4 insertion points)
- FOUND commit: `35e798c` (Task 1 RED)
- FOUND commit: `29dcf70` (Task 1 GREEN)
- FOUND commit: `1dad931` (Task 2 RED)
- FOUND commit: `781c6d2` (Task 2 GREEN)

Test verification: `bun test apps/api/src/core/__tests__/health-aggregator.test.ts apps/api/src/core/__tests__/registry-health.test.ts apps/api/src/core/__tests__/registry.test.ts` exits 0 with 26 pass, 0 fail.

## Self-Check: PASSED

---
*Phase: 22-admin-ops-tooling*
*Completed: 2026-04-27*
