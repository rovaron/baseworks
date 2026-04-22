---
phase: 17-observability-ports-otel-bootstrap
plan: 03
subsystem: config
tags: [observability, env-validation, zod, crash-hard, t3-env]

# Dependency graph
requires:
  - phase: 10-payments-billing
    provides: validatePaymentProviderEnv pattern (D-08/D-09 byte-for-byte template)
provides:
  - TRACER/METRICS_PROVIDER/ERROR_TRACKER env schema fields (all z.enum(["noop"]).optional().default("noop"))
  - validateObservabilityEnv() exported startup validator (skeleton; Phase 17 has no required keys)
  - @baseworks/config barrel re-export of validateObservabilityEnv
  - Positive-path subprocess tests for the validator
affects: [17-04-telemetry-bootstrap, 18-error-tracking, 21-otel-exporters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Crash-hard env validator mirroring validatePaymentProviderEnv shape (D-08/D-09)"
    - "Per-adapter switch skeleton — Phase 17 lays the structure; Phases 18/21 drop in required-key branches without re-deriving the pattern"
    - "Subprocess-based positive-path test pattern for env validators (matches env.test.ts / validatePaymentProviderEnv suite)"

key-files:
  created:
    - packages/config/src/__tests__/validate-observability-env.test.ts
  modified:
    - packages/config/src/env.ts
    - packages/config/src/index.ts

key-decisions:
  - "D-07 honored: TRACER/METRICS_PROVIDER/ERROR_TRACKER use z.enum(['noop']) — unknown values crash at env-import time via Zod, not at validator call time"
  - "D-08 honored: validateObservabilityEnv mirrors validatePaymentProviderEnv shape (JSDoc, switch-per-adapter, @throws contract) byte-for-byte"
  - "D-09 honored: crash-hard discipline — validator body has per-adapter switches ready for Phases 18/21 to insert throw-on-missing-key branches"
  - "Negative-path coverage (TRACER=otel crashes boot) deferred to Plan 04 subprocess smoke test (17-VALIDATION row 17-04-05, threat T-17-01) — avoids duplicating the same subprocess plumbing in two places and avoids the module-import-time trap of trying to mutate process.env after createEnv has evaluated it"

patterns-established:
  - "Observability env fields grow adapter-by-adapter, not upfront — Phase 17 ships noop-only; 18 widens ERROR_TRACKER + adds SENTRY_DSN/GLITCHTIP_DSN; 21 widens TRACER/METRICS_PROVIDER + adds OTEL_EXPORTER_OTLP_ENDPOINT"
  - "Validator skeleton pattern: the function is exported from day one so downstream callers (telemetry.ts Plan 04) wire imports once; per-adapter logic is filled in phase-by-phase"

requirements-completed: [OBS-04]

# Metrics
duration: ~25min
completed: 2026-04-22
---

# Phase 17 Plan 03: Observability Env Validator Summary

**TRACER/METRICS_PROVIDER/ERROR_TRACKER env schema (noop-defaulted) + validateObservabilityEnv() skeleton exported from @baseworks/config, mirroring the validatePaymentProviderEnv pattern for downstream (Plans 04/18/21) to extend.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-22T02:44:00Z (approx)
- **Completed:** 2026-04-22T03:09:42Z
- **Tasks:** 1 (with TDD RED/GREEN commits)
- **Files modified:** 3

## Accomplishments

- Added three env schema fields to `serverSchema` in `packages/config/src/env.ts`, each `z.enum(["noop"]).optional().default("noop")` per D-07
- Exported `validateObservabilityEnv(): void` with per-adapter switch skeletons for ERROR_TRACKER, TRACER, and METRICS_PROVIDER — structurally identical to `validatePaymentProviderEnv`
- Wired the named export through `packages/config/src/index.ts` barrel so `telemetry.ts` (Plan 04) can `import { validateObservabilityEnv } from "@baseworks/config"` without further barrel changes
- Added three passing positive-path subprocess tests that mirror the existing validatePaymentProviderEnv test pattern (spawns real bun processes with controlled env vars)

## Task Commits

TDD RED → GREEN cycle:

1. **RED:** Add failing test for validateObservabilityEnv — `27a830f` (test)
2. **GREEN:** Add validateObservabilityEnv + TRACER/METRICS_PROVIDER/ERROR_TRACKER schema — `dd5f967` (feat)

No refactor commit needed — the skeleton validator matches the validatePaymentProviderEnv shape on first write.

## Schema Diff

Inserted in `serverSchema` after the PAGARME_WEBHOOK_SECRET line, before RESEND_API_KEY:

```typescript
// Observability adapter ports (Phase 17 / OBS-04 / D-07).
TRACER: z.enum(["noop"]).optional().default("noop"),
METRICS_PROVIDER: z.enum(["noop"]).optional().default("noop"),
ERROR_TRACKER: z.enum(["noop"]).optional().default("noop"),
```

## Validator Signature

```typescript
export function validateObservabilityEnv(): void
```

Body contains three switches — `env.ERROR_TRACKER`, `env.TRACER`, `env.METRICS_PROVIDER` — each with a `case "noop": break` arm only (Phase 17 has no required keys). Phases 18/21 will insert additional `case "sentry":`, `case "otel":` arms that `throw new Error(...)` when DSNs/endpoints are missing.

## Test-Seam Rationale (why negative cases are NOT here)

`@t3-oss/env-core` evaluates the server schema at module-import time (inside `createEnv({ server: serverSchema, runtimeEnv: process.env, ... })`). Once `env.ts` has been imported by the test runner, mutating `process.env.TRACER = "otel"` in a `beforeEach` has no effect — the `env` object is already frozen with whatever process.env looked like at the moment `env.ts` first loaded.

Therefore:

- **Positive-path tests (this file):** subprocess-per-test spawning `bun -e 'import {...}; ...'` with controlled env. 3 tests, all green.
- **Negative-path coverage:** deferred to Plan 04's telemetry-boot smoke test (17-VALIDATION.md row 17-04-05, threat T-17-01), which already plans to spawn subprocesses with `TRACER=otel` / `ERROR_TRACKER=sentry` and assert the process exits non-zero with Zod citing the offending key. Putting negative cases here would duplicate the same subprocess plumbing in two places while exercising the same seam (Zod enum + createEnv module-import evaluation). The test file comments document this seam clearly so a future maintainer does not "fix" this by adding a broken in-process `beforeEach(() => { process.env.TRACER = "otel" })` test.

## Forward Pointer

- **Phase 18 (error-tracking):** widens `ERROR_TRACKER` enum to `["noop", "pino", "sentry", "glitchtip"]`, adds `SENTRY_DSN` / `GLITCHTIP_DSN` optional fields, and inserts throw-on-missing branches in the validator's ERROR_TRACKER switch.
- **Phase 21 (otel-exporters):** widens `TRACER` and `METRICS_PROVIDER` enums to include `"otel"`, adds `OTEL_EXPORTER_OTLP_ENDPOINT` optional field, and inserts throw-on-missing branches in the TRACER + METRICS_PROVIDER switches.

Both phases extend the skeleton without rewriting it — the whole point of D-08's "mirrors validatePaymentProviderEnv shape byte-for-byte" discipline.

## Files Created/Modified

- `packages/config/src/env.ts` — added TRACER/METRICS_PROVIDER/ERROR_TRACKER schema fields + validateObservabilityEnv() function
- `packages/config/src/index.ts` — added validateObservabilityEnv to the barrel named re-export
- `packages/config/src/__tests__/validate-observability-env.test.ts` — new subprocess-based positive-path test file (3 passing tests)

## Decisions Made

- **Subprocess test pattern (not in-process)** — aligns with existing `validatePaymentProviderEnv` / `assertRedisUrl` tests in `env.test.ts` and sidesteps the module-import-time createEnv trap. Documented in the test file's doc comment so future maintainers don't attempt an in-process fix.
- **Skeleton validator body (not empty function)** — per D-09 the switches must exist now so Phases 18/21 insert branches into an already-patterned scaffold rather than re-deriving the shape. The `default` arms are intentionally omitted, mirroring validatePaymentProviderEnv's trust in its enum-typed PAYMENT_PROVIDER (Zod already rejects unknown values at env-import time, no runtime default arm needed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Ran `bun install` to populate worktree node_modules**
- **Found during:** Task 17-03-01 (first attempt at `bun test packages/config/src/__tests__/validate-observability-env.test.ts`)
- **Issue:** Fresh worktree had no `node_modules` — module resolution failed with "Cannot find module '@t3-oss/env-core'"
- **Fix:** Ran `bun install` at the worktree root (workspaces-aware install)
- **Files modified:** (node_modules only — no committed files affected after reverting the incidental bun.lock drift)
- **Verification:** Tests now execute successfully; `bun.lock` change was reverted (it drifted due to missing `@radix-ui/react-switch` dep unrelated to this plan) before committing
- **Committed in:** (not committed — infrastructure step, lockfile drift unrelated to Plan 17-03 was reverted)

**2. [Rule 2 - Test Seam Clarification] Rewrote positive-path tests to use subprocess pattern**
- **Found during:** Task 17-03-01 (test execution after GREEN implementation)
- **Issue:** The plan's initial test file used direct in-process imports. `@t3-oss/env-core` fails to validate at module-import time when DATABASE_URL/BETTER_AUTH_SECRET are not set in the host's process.env — so the test file could not even load in a fresh worktree without a `.env` file
- **Fix:** Rewrote tests to use `Bun.spawn(['bun', '-e', '...'], { env: baseEnv })` pattern, matching the existing `validatePaymentProviderEnv` tests in env.test.ts. This correctly exercises the validator with controlled env vars.
- **Files modified:** `packages/config/src/__tests__/validate-observability-env.test.ts`
- **Verification:** 3 tests pass (`bun test packages/config/src/__tests__/validate-observability-env.test.ts` → 3 pass, 0 fail, 6 expect calls)
- **Committed in:** `dd5f967` (GREEN commit, included as part of the implementation)

---

**Total deviations:** 2 auto-fixed (1 blocking dependency install, 1 test-harness alignment with existing project pattern)
**Impact on plan:** No scope creep. Both fixes were necessary to execute the plan as written. The test-harness change is an improvement — it aligns the new test file with the project's existing env-validator test conventions, which the plan already pointed at (via the @read_first reference to env.test.ts's validatePaymentProviderEnv suite).

## Issues Encountered

- **Pre-existing test failure in env.test.ts:48** — `env validation > succeeds with valid environment variables` fails in the worktree on baseline (confirmed via `git stash` of Plan 17-03 changes). Logged to `.planning/phases/17-observability-ports-otel-bootstrap/deferred-items.md`. Out of scope for Phase 17 (observability), in scope for a later hermetic-test-harness cleanup.

## Deferred Issues

- `env.test.ts:48` baseline failure (see `deferred-items.md`) — pre-existing, not caused by Plan 17-03. Hypothesis: the subprocess `bun -e` invocation does not correctly propagate DATABASE_URL / BETTER_AUTH_SECRET from the host shell on Windows bash in a fresh worktree. Needs a dedicated investigation; tracked as follow-up.

## User Setup Required

None — this plan is pure code/config additions with safe defaults. Operators who do nothing see `TRACER=noop`, `METRICS_PROVIDER=noop`, `ERROR_TRACKER=noop` and no observability behavior change. Phase 18 will add SENTRY_DSN-like keys that operators must provide to opt into sentry/glitchtip error tracking.

## Next Phase Readiness

- `validateObservabilityEnv` is exported and ready for Plan 04's `telemetry.ts` to call on the line after `sdk.start()` per D-06.
- Schema skeleton is in place for Phase 18 (ERROR_TRACKER widening + DSN required-key branches) and Phase 21 (TRACER/METRICS_PROVIDER widening + OTEL endpoint required-key branches).
- Positive-path coverage green; negative-path coverage intentionally deferred to Plan 04's boot-level smoke test.

## Self-Check

Verifying claims before completion:

- `packages/config/src/env.ts` contains `TRACER: z.enum(["noop"]).optional().default("noop")` — FOUND (line 33)
- `packages/config/src/env.ts` contains `METRICS_PROVIDER: z.enum(["noop"])` — FOUND (line 34)
- `packages/config/src/env.ts` contains `ERROR_TRACKER: z.enum(["noop"])` — FOUND (line 35)
- `packages/config/src/env.ts` contains `export function validateObservabilityEnv(): void` — FOUND (line 109)
- `packages/config/src/env.ts` contains all three switches (`env.ERROR_TRACKER ?? "noop"`, `env.TRACER ?? "noop"`, `env.METRICS_PROVIDER ?? "noop"`) — FOUND (lines 112, 122, 129)
- `packages/config/src/index.ts` re-exports `validateObservabilityEnv` — FOUND
- `packages/config/src/__tests__/validate-observability-env.test.ts` exists and imports from `"../index"` via subprocess — FOUND
- `bun test packages/config/src/__tests__/validate-observability-env.test.ts` — 3 pass, 0 fail
- `bun run --cwd packages/config tsc --noEmit` — exits 0
- Commit `27a830f` (RED) — FOUND in git log
- Commit `dd5f967` (GREEN) — FOUND in git log

## Self-Check: PASSED

---
*Phase: 17-observability-ports-otel-bootstrap*
*Plan: 03*
*Completed: 2026-04-22*
