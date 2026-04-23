---
phase: 18-error-tracking-adapters
plan: 06
subsystem: observability
tags: [app-wiring, entrypoints, elysia, bullmq, capture-boundaries, tdd]

# Dependency graph
requires:
  - phase: 18-error-tracking-adapters
    provides: "Plan 01: validateObservabilityEnv() crash-hard branches; Plan 03: installGlobalErrorHandlers + wrapCqrsBus; Plan 05: getErrorTracker() factory dispatching pino/sentry/glitchtip/noop"
provides:
  - apps/api/src/index.ts wired with validateObservabilityEnv + installGlobalErrorHandlers + wrapCqrsBus (D-02, D-09, D-01)
  - apps/api/src/worker.ts wired with all three plus D-04 one-liner capture inside worker.on('failed')
  - apps/api/src/core/middleware/error.ts extended with captureException before status-mapping switch (D-03, A4)
  - apps/api/src/__tests__/worker-failed-capture.test.ts — 3 tests asserting D-04 call shape + inner-try/catch-log-only contract
affects:
  - 19-context-logging-tracing (wrapCqrsBus call site is now locked; Phase 19 extends the same wrapper with ALS-derived tenant/user/request_id — same signature, no rework)
  - 20-bullmq-trace-propagation (worker.on('failed') capture site is now the canonical BullMQ error boundary — trace-context extraction wires adjacent to it)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extend-in-place errorMiddleware (A4) — single on-error site preserved; captureException inserted BEFORE switch(code) without adding a second .onError plugin"
    - "Destructure request from Elysia onError context — enables method+code tags + path extras without reaching for non-existent request.route (A3)"
    - "worker.on('failed') single-call-site discipline (D-04) — one capture line next to existing logger.error; inner try/catch at lines 58-65 stays log-only to prevent double-reporting"
    - "RecordingTracker test-double (in-test factory) — minimal ErrorTracker implementation that records captureException calls for shape assertions; avoids booting real BullMQ/Redis"
    - "Bun.file(...).text() + line-window grep for cross-file-state invariant tests — Test 3 reads worker.ts source, extracts the inner try/catch region, and asserts getErrorTracker/captureException do not appear (D-04 regression guard)"

key-files:
  created:
    - apps/api/src/__tests__/worker-failed-capture.test.ts
  modified:
    - apps/api/src/index.ts
    - apps/api/src/worker.ts
    - apps/api/src/core/middleware/error.ts

key-decisions:
  - "Imports from @baseworks/observability placed AFTER existing imports in both entrypoints — groups all observability-barrel imports together, leaves line-1 telemetry side-effect import untouched (T-18-40 invariant)"
  - "A4 enforced byte-for-byte — captureException was added INSIDE the existing errorMiddleware onError callback (before switch), NOT as a separate .onError plugin. Verified by grep -c '.onError(' returning exactly 1"
  - "A3 enforced — request.route is absent from Elysia Context at onError time; grep for 'request.route' in error.ts returns 0. Tags use method + String(code); concrete path goes to extra (cardinality discipline per Pitfall 4)"
  - "D-01 invariant preserved — git diff apps/api/src/core/cqrs.ts apps/api/src/core/event-bus.ts across all three Task commits produces zero lines. The wrap happens externally at registry boot time via wrapCqrsBus(registry.getCqrs(), tracker)"
  - "wrapCqrsBus call placed immediately after await registry.loadAll() in both entrypoints — single boot wrap per Claude's Discretion (RESEARCH lines 553-557). Applied to the same bus instance the rest of the application reads via registry.getCqrs()"

patterns-established:
  - "Structured reasoning: Task 1 was a direct-edit task with structural acceptance criteria (grep-based) rather than behavioral TDD — writing a test for Elysia onError behavior would require booting an app instance; the grep assertions + existing-tests-still-pass loop provides the same regression guard at lower cost"
  - "Test 3 in worker-failed-capture.test.ts establishes a cross-file-state invariant pattern — the test reads the source file of the production code it guards, extracts a line window, and asserts specific tokens are absent. Useful for any D-XX discipline that depends on the absence of a call at a specific location"

requirements-completed: [ERR-01, ERR-04]

# Metrics
duration: ~6min
completed: 2026-04-23
tasks_completed: 3
tests_added: 3
commits: 3
---

# Phase 18 Plan 06: Application Wire-up Summary

## One-liner

Wires the Phase 18 capture pipeline into four boundary sites — extends `apps/api/src/index.ts` + `apps/api/src/worker.ts` with `validateObservabilityEnv()` (D-09) + `installGlobalErrorHandlers(getErrorTracker())` (D-02) + `wrapCqrsBus(registry.getCqrs(), getErrorTracker())` (D-01), extends the existing `errorMiddleware.onError` in place with `captureException` before the status-mapping switch (D-03/A4), extends the existing `worker.on('failed')` handler at worker.ts line 70 with a one-line `captureException` call (D-04), and ships a unit test that asserts the D-04 call shape plus a cross-file-state guard against the inner try/catch ever double-capturing.

## Performance

- **Duration:** ~6 min (actual clock; 5:38 from first-task-start to final-commit)
- **Started:** 2026-04-23T09:46:04Z
- **Completed:** 2026-04-23T09:51:42Z
- **Tasks:** 3 (all completed atomically with per-task commits)
- **Files created:** 1
- **Files modified:** 3
- **Tests added:** 3
- **Commits:** 3 (b7e3afa, fb94746, f044f97)

## Accomplishments

- **Task 1 — Extended `errorMiddleware` with captureException.** Added `getErrorTracker` import to `apps/api/src/core/middleware/error.ts`; destructured `request` from the onError context; inserted `getErrorTracker().captureException(error, { tags: { method: request.method, code: String(code) }, extra: { path: new URL(request.url).pathname } })` between the existing `logger.error(...)` call and the `switch (code)` block. Single `.onError` site preserved (A4 verified: grep count = 1). `request.route` not referenced (A3 verified: grep count = 0). All 60 existing apps/api tests still pass.
- **Task 2 — Wired both entrypoints.** Extended the existing destructure imports in `apps/api/src/index.ts` and `apps/api/src/worker.ts` to include `validateObservabilityEnv` from `@baseworks/config`; added a grouped import block for `getErrorTracker` + `installGlobalErrorHandlers` + `wrapCqrsBus` from `@baseworks/observability`; called `validateObservabilityEnv()` + `installGlobalErrorHandlers(getErrorTracker())` immediately after the existing `validatePaymentProviderEnv()` call; called `wrapCqrsBus(registry.getCqrs(), getErrorTracker())` immediately after `await registry.loadAll()`. Extended the existing `worker.on('failed', ...)` handler at worker.ts line 70 with the D-04 one-liner `getErrorTracker().captureException(err, { tags: { queue: jobDef.queue }, extra: { jobId: job?.id, jobName } })`. The line-1 telemetry invariant is preserved in both files; the telemetry-line1.test.ts gate still passes (6/6). D-01 invariant preserved: `git diff apps/api/src/core/cqrs.ts apps/api/src/core/event-bus.ts` across all three commits produces zero lines.
- **Task 3 — worker-failed-capture unit test.** Created `apps/api/src/__tests__/worker-failed-capture.test.ts` with 3 tests (9 expects): (1) the D-04 call shape — `captureException` called once with `{ tags: { queue }, extra: { jobId, jobName } }`; (2) undefined-job handling — `jobId: undefined` in extras when BullMQ passes no job object; (3) cross-file-state guard — reads `apps/api/src/worker.ts` source via `Bun.file`, extracts the inner try/catch region around `jobLog.info("Job started")`, asserts `getErrorTracker` + `captureException` are absent from that region (D-04 "log-only" invariant). Uses `setErrorTracker(recording)` in `beforeEach` + `resetErrorTracker()` in `afterEach` for clean test isolation. All 3 tests pass; full apps/api suite remains green at 63/63.

## Task Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 | `b7e3afa` | feat(18-06): extend errorMiddleware with captureException (D-03/A4) |
| 2 | `fb94746` | feat(18-06): wire Phase 18 capture pipeline in both entrypoints |
| 3 | `f044f97` | test(18-06): worker-failed-capture asserts D-04 call shape |

Task 1 is a non-TDD direct edit — Elysia onError behavior is not easily unit-testable without booting the app, so the RED gate is replaced with structural grep acceptance criteria + the existing-tests-still-pass loop. Task 2 is similarly structural. Task 3 IS the TDD deliverable for the D-04 shape; the test was written to mirror the post-Task-2 worker.on('failed') body and passes on first run because the production code already implements the asserted shape.

## Decisions Made

### Import grouping in entrypoints

The `@baseworks/observability` triple-import (`getErrorTracker`, `installGlobalErrorHandlers`, `wrapCqrsBus`) was placed at the END of the existing import block in both `apps/api/src/index.ts` (after `logger`) and `apps/api/src/worker.ts` (after `logger`). This:
- Keeps line-1 `import "./telemetry";` untouched (T-18-40 regression guard).
- Groups all observability barrel imports together, making the Phase 18 additions easy to locate and diff.
- Matches the existing convention where related imports are grouped (e.g., `@baseworks/module-auth` + `@baseworks/module-billing` + `@baseworks/module-example` in index.ts).

### A4 enforcement — extend in place, do not supplement

The plan's A4 ("existing onError is EXTENDED, not supplemented") was enforced byte-for-byte. The captureException call lives INSIDE the existing `errorMiddleware.onError(...)` callback at line 36-39 of error.ts — between the `logger.error(...)` call and the `switch (code)` block. No new `.onError` registration was added. Verified by `grep -c '.onError(' apps/api/src/core/middleware/error.ts` returning 1.

### A3 enforcement — request.method + String(code) on tags, path on extra

The plan anticipated the A3 concern: Elysia's Context does NOT have a `request.route` field; accessing it would silently produce `undefined` and pollute tag space. The implementation uses `request.method` (metric-safe: ~7 values: GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD) and `String(code)` (Elysia codes: VALIDATION/NOT_FOUND/UNAUTHORIZED/FORBIDDEN/INTERNAL_SERVER_ERROR/etc — a small closed set) on tags. The concrete URL path goes on `extra` (not a metric dimension, per Pitfall 4). Phase 19 will add matched-route-template extraction via a separate middleware that has access to Elysia's internal routing state.

### D-04 single-call-site discipline

Only ONE `getErrorTracker().captureException` call exists in worker.ts — inside `worker.on('failed', ...)`. The inner try/catch at lines 58-65 (around `jobLog.error({ err: String(err) }, "Job handler error"); throw err;`) remains log-only. Adding capture there would double-report every job failure (once from the inner catch, once from the outer `worker.on('failed')` listener that fires after the re-throw propagates out of the job). Test 3 in `worker-failed-capture.test.ts` enforces this as a cross-file-state regression guard.

### Test 3 cross-file grep guard for D-04

A conventional unit test can assert what a function DOES. The D-04 discipline requires asserting what a function DOES NOT do — specifically, that the inner try/catch block in worker.ts does not call captureException. The solution: read the worker.ts source in the test via `Bun.file("apps/api/src/worker.ts").text()`, locate the anchor line (`jobLog.info("Job started")`), extract a 15-line window starting from there, and assert the tokens `getErrorTracker()` and `captureException` are absent. This is a less-common test pattern but the right tool for a "prohibited addition at specific location" invariant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Comment substring matched `request.route` regex in Task 1 acceptance**

- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** The initial implementation added a comment explaining the A3 resolution that literally contained the phrase `request.route does not exist on Elysia Context`. The acceptance criterion `grep -E "request\\.route" apps/api/src/core/middleware/error.ts` returns ZERO matches was failing (returned 1 — the comment line).
- **Fix:** Rephrased the comment from "request.route does not exist on Elysia Context" to "the matched-route template is NOT available on Elysia's Context at onError time" — same meaning, no forbidden token. Verified: `grep -c 'request.route' apps/api/src/core/middleware/error.ts` now returns 0.
- **Files modified:** `apps/api/src/core/middleware/error.ts`
- **Commit:** folded into `b7e3afa` (Task 1 commit — fix was applied before the commit so the forbidden token never entered the repo)

No other deviations. No architectural questions (Rule 4) surfaced. No authentication gates. Plan executed as written with just the one grep-compliance rephrase.

## Verification

All plan-level verification checks pass:

- [x] `bun test apps/api` exits 0 — 63 pass, 0 fail, 109 expect() calls across 11 files
- [x] `bun test apps/api/__tests__/telemetry-line1.test.ts` exits 0 — 6 pass, 0 fail (line-1 gate green)
- [x] `bun test apps/api/src/__tests__/worker-failed-capture.test.ts` exits 0 — 3 pass, 0 fail
- [x] `git diff b7e3afa^..HEAD -- apps/api/src/core/cqrs.ts apps/api/src/core/event-bus.ts | wc -l` returns 0 (D-01 invariant)
- [x] `grep -c '.onError(' apps/api/src/core/middleware/error.ts` returns 1 (A4 invariant)
- [x] `grep -c 'request.route' apps/api/src/core/middleware/error.ts` returns 0 (A3 resolution)
- [x] `grep -l 'validateObservabilityEnv()' apps/api/src/index.ts apps/api/src/worker.ts` returns both files
- [x] `grep -l 'installGlobalErrorHandlers' apps/api/src/index.ts apps/api/src/worker.ts` returns both files
- [x] `grep -l 'wrapCqrsBus' apps/api/src/index.ts apps/api/src/worker.ts` returns both files
- [x] `grep -c 'getErrorTracker().captureException' apps/api/src/worker.ts` returns 1 (D-04 single call site)
- [x] First line of both entrypoints is `import "./telemetry";` (Phase 17 invariant preserved)
- [x] Existing `logger.error(...)` call at error.ts line 29 preserved (server-side logging still happens before capture)
- [x] Existing `logger.error(...)` call at worker.ts line 71 preserved (job failure still logged before capture)
- [x] Existing SIGTERM/SIGINT graceful-shutdown block in worker.ts lines 148-158 unchanged

## Success Criteria

- [x] Four capture boundaries wired end-to-end: global handlers (D-02), Elysia onError (D-03, A4), CqrsBus wrap (D-01), worker failed (D-04)
- [x] `validateObservabilityEnv()` called at boot in both entrypoints (D-09 crash-hard)
- [x] Zero edits to `apps/api/src/core/cqrs.ts` and `apps/api/src/core/event-bus.ts`
- [x] Line-1 invariant preserved in both entrypoints (telemetry-line1.test.ts still green)
- [x] `worker-failed-capture.test.ts` asserts the D-04 call shape and the inner-try/catch-log-only invariant
- [x] All existing apps/api tests pass (no regressions)

## Must-haves Delivered

- [x] Operator sees `validateObservabilityEnv()` called in both API and worker entrypoints immediately after `validatePaymentProviderEnv()`
- [x] Operator sees `installGlobalErrorHandlers(getErrorTracker())` called in BOTH `apps/api/src/index.ts` AND `apps/api/src/worker.ts` after validators
- [x] Operator sees `wrapCqrsBus(registry.getCqrs(), getErrorTracker())` applied once after `await registry.loadAll()` in both entrypoints
- [x] Operator sees the existing Elysia `errorMiddleware` EXTENDED with `tracker.captureException(...)` before the status-mapping switch — single on-error site preserved (A4)
- [x] Operator sees `worker.on('failed')` handler capture job failures via `getErrorTracker().captureException(err, { tags: { queue }, extra: { jobId, jobName } })`
- [x] Operator sees NO edits to `apps/api/src/core/cqrs.ts` (D-01 invariant)

## Tests Added

**3 new tests** in `apps/api/src/__tests__/worker-failed-capture.test.ts` (9 expects):

1. **captureException called once with queue tag + jobId/jobName extras** — Asserts the D-04 call shape: `tags: { queue: "test-queue" }`, `extra: { jobId: "job-1", jobName: "handleProcessFollowup" }`, err identity preserved.
2. **job undefined → jobId undefined in extras (no throw)** — Asserts graceful handling when BullMQ passes `undefined` as job (connection errors). No throw, `jobId: undefined` in extras.
3. **inner try/catch staying log-only is a CONTRACT (grep guard)** — Reads `apps/api/src/worker.ts` source, extracts the inner try/catch region around `jobLog.info("Job started")`, asserts `getErrorTracker()` + `captureException` are absent (D-04 regression guard).

## Threat Model Compliance

| Threat ID | Status | Evidence |
|-----------|--------|----------|
| T-18-34 (A4 violation — second .onError plugin) | mitigated | `grep -c '.onError(' apps/api/src/core/middleware/error.ts` returns 1. Existing middleware extended, no second plugin added. |
| T-18-35 (A3 violation — request.route reintroduced) | mitigated | `grep -c 'request.route' apps/api/src/core/middleware/error.ts` returns 0. Tags use `request.method` + `String(code)`. |
| T-18-36 (high-cardinality path on tags) | mitigated | Path sent via `extra: { path: new URL(request.url).pathname }`, NOT tags. |
| T-18-37 (D-04 violation — inner try/catch double-captures) | mitigated | Test 3 in worker-failed-capture.test.ts asserts the inner region around `jobLog.info("Job started")` does not contain `getErrorTracker` or `captureException`. |
| T-18-38 (D-01 violation — cqrs.ts edited) | mitigated | `git diff apps/api/src/core/cqrs.ts apps/api/src/core/event-bus.ts` across Phase 18 produces zero lines. wrapCqrsBus applied externally at registry boot. |
| T-18-39 (installGlobalErrorHandlers before validateObservabilityEnv) | accepted | Design decision from CONTEXT: validateObservabilityEnv is a BOOT-TIME crash; raw stack trace desired so operator sees missing env var name directly. Post-validation, installGlobalErrorHandlers covers everything. |
| T-18-40 (line-1 invariant broken) | mitigated | `apps/api/__tests__/telemetry-line1.test.ts` still passes (6/6). Line 1 of both entrypoints is `import "./telemetry";`. |
| T-18-41 (stale tracker after env mutation) | accepted | Factory is lazy-singleton by design. Production mutates env only at boot. Tests use set/reset trio. |

## Known Stubs

None. All four capture boundaries are wired to real production code paths. The RecordingTracker in the test file is a legitimate test double, not a production stub.

## Threat Flags

None new. This plan IS the wiring layer for the adapter pipeline shipped in Plans 01-05; every capture boundary goes through code that already existed in the repo (Elysia onError, BullMQ worker.on('failed'), process signals via Plan 03's installGlobalErrorHandlers, CQRS bus via Plan 03's wrapCqrsBus). No new trust boundaries introduced.

## TDD Gate Compliance

Plan type: `execute` with three `tdd="true"` tasks.

- **Task 1:** Non-behavioral TDD substitute — Elysia onError behavior is not easily unit-testable without booting the app. The plan's acceptance criteria are structural (grep-verifiable) + existing-tests-still-pass. This is documented in the plan's Task 1 `<verify>` block (runs `bun test apps/api` as the regression guard) and matches the precedent from Phase 17 for similarly-structural middleware changes. No RED gate commit; GREEN commit `b7e3afa` ships implementation + structural verification.

- **Task 2:** Non-behavioral TDD substitute for the same reason — entrypoint wiring is a bootstrap-ordering concern verified by grep assertions + the telemetry-line1.test.ts regression gate. GREEN commit `fb94746` ships the wiring.

- **Task 3:** True TDD deliverable — the test file IS the deliverable for the D-04 shape assertion. The test was written against the post-Task-2 worker.on('failed') body and passes on first run because Task 2 already implements the asserted shape. In strict RED→GREEN terms, Task 2 is the GREEN commit and Task 3 is the verification commit (`f044f97`) that locks the shape in place against future refactors. The plan explicitly structures this way — Task 3's `<read_first>` block depends on the post-Task-2 worker.ts state.

## Self-Check: PASSED

- [x] `apps/api/src/core/middleware/error.ts` — modified (captureException + request destructure + getErrorTracker import)
- [x] `apps/api/src/index.ts` — modified (validateObservabilityEnv + installGlobalErrorHandlers + wrapCqrsBus + observability imports)
- [x] `apps/api/src/worker.ts` — modified (same three + D-04 one-liner in worker.on('failed'))
- [x] `apps/api/src/__tests__/worker-failed-capture.test.ts` — FOUND (3 tests, 9 expects)
- [x] Commit `b7e3afa` (Task 1) present in git log
- [x] Commit `fb94746` (Task 2) present in git log
- [x] Commit `f044f97` (Task 3) present in git log
- [x] 63/63 apps/api tests pass
- [x] 6/6 telemetry-line1 tests pass (Phase 17 line-1 gate preserved)

## Next

- **Plan 18-07** (Wave 3, parallel with 06 — already unblocked pre-this-plan): Release-workflow CI + Phase 18 docs. Ships `.github/workflows/release.yml` for source-map upload on tag push (EXT-01); produces Phase 18 phase-level docs. Independent of 06's wiring edits.
- **Phase 19** (Context, Logging & HTTP/CQRS Tracing): The `wrapCqrsBus` call site locked in this plan is the extension point for ALS-derived tenant/user/request_id enrichment. Same signature, zero rework at the call site — Phase 19 modifies the internals of wrapCqrsBus + adds an Elysia beforeHandle middleware that reads ALS.
- **Phase 20** (BullMQ Trace Propagation): The `worker.on('failed')` capture site locked in this plan is the canonical BullMQ error boundary. Phase 20 adds trace-context extraction adjacent to it — enqueue-side context injection + dequeue-side extraction both wire around the existing createWorker loop without touching this plan's capture wiring.

---

*Phase: 18-error-tracking-adapters*
*Completed: 2026-04-23*
