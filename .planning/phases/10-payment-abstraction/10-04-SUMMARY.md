---
phase: 10-payment-abstraction
plan: 04
subsystem: payments
tags: [env-validation, startup-guard, pagarme, stripe, fail-fast]

# Dependency graph
requires:
  - phase: 10-payment-abstraction
    provides: validatePaymentProviderEnv function in packages/config/src/env.ts (plan 03)
provides:
  - Startup env validation wired into both API and worker entrypoints
  - Fail-fast behavior when PAYMENT_PROVIDER=pagarme without PAGARME_SECRET_KEY
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Startup validation pattern: call environment validators before module loading"

key-files:
  created: []
  modified:
    - apps/api/src/index.ts
    - apps/api/src/worker.ts

key-decisions:
  - "Placed validatePaymentProviderEnv() after DB creation but before module registry loading"

patterns-established:
  - "Startup guards: validate provider-specific env vars before any module loads"

requirements-completed: [PAY-05]

# Metrics
duration: 1min
completed: 2026-04-11
---

# Phase 10 Plan 04: Startup Env Validation Wiring Summary

**Wired validatePaymentProviderEnv() into API server and worker entrypoints for fail-fast startup on missing payment provider secrets**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-11T18:18:07Z
- **Completed:** 2026-04-11T18:18:38Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Wired validatePaymentProviderEnv() call into apps/api/src/index.ts at startup (line 22, before module registry)
- Wired validatePaymentProviderEnv() call into apps/api/src/worker.ts at startup (line 15, before DB/worker creation)
- Closed T-10-09 threat: app now fails fast if PAYMENT_PROVIDER=pagarme without PAGARME_SECRET_KEY

## Task Commits

Each task was committed atomically:

1. **Task 1: Add validatePaymentProviderEnv() calls to API and worker entrypoints** - `85def56` (feat)

## Files Created/Modified
- `apps/api/src/index.ts` - Added import and call to validatePaymentProviderEnv() after DB init, before module registry
- `apps/api/src/worker.ts` - Added import and call to validatePaymentProviderEnv() after Redis URL assertion, before DB init

## Decisions Made
- Placed the validation call after basic env/DB setup but before module loading, consistent with the existing assertRedisUrl pattern in worker.ts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PAY-05 (startup env validation) is fully satisfied
- All payment abstraction plans (10-01 through 10-04) are complete
- The payment provider abstraction layer is ready for use

## Self-Check: PASSED

- All modified files exist on disk
- Task commit 85def56 verified in git log
- validatePaymentProviderEnv appears in both index.ts and worker.ts (import + call)

---
*Phase: 10-payment-abstraction*
*Completed: 2026-04-11*
