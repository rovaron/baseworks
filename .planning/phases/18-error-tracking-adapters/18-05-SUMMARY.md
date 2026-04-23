---
phase: 18-error-tracking-adapters
plan: 05
subsystem: observability
tags: [observability, adapter, sentry, glitchtip, conformance, factory, tdd]

# Dependency graph
requires:
  - phase: 17-observability-ports-otel-bootstrap
    provides: ErrorTracker port (captureException, captureMessage, addBreadcrumb, withScope, flush), getErrorTracker factory + get/set/reset trio
  - phase: 18-error-tracking-adapters
    provides: "Plan 01: @sentry/bun + @sentry/core installed, ERROR_TRACKER enum widened, SENTRY_DSN/GLITCHTIP_DSN env; Plan 02: scrubPii + 13 PII_FIXTURES; Plan 03: makeTestTransport helper (A2); Plan 04: PinoErrorTracker in barrel"
provides:
  - SentryErrorTracker — single class serving BOTH Sentry and GlitchTip via kind tag (ERR-01, ERR-02 / D-05)
  - buildInitOptions — pure helper applying A1 Option C (defaultIntegrations: false + sendDefaultPii: false + scrubPii hooks + 4 safe integrations)
  - Cross-adapter PII conformance test — 13 fixtures × 3 adapters (pino, sentry, noop) = 39 tests (ERR-04 / D-11 / D-14)
  - Extended getErrorTracker() switch — dispatches pino/sentry/glitchtip, default widened from 'noop' to 'pino' (D-06)
  - Barrel exports SentryErrorTracker + SentryErrorTrackerOptions (appended after Plan 04's PinoErrorTracker)
affects:
  - 18-06 (wiring) — getErrorTracker() now dispatches all four adapters; index.ts/worker.ts can switch on env without adapter construction knowledge
  - 18-07 (docs) — nothing to update in the docs yet; Plan 07 captures the final state

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A1 Option C Sentry init — defaultIntegrations: false + 4 safe integrations (inboundFilters, dedupe, linkedErrors, functionToString). Prevents bunServerIntegration from auto-patching Bun.serve (T-18-26) AND prevents onUncaughtException/onUnhandledRejection from double-registering with installGlobalErrorHandlers (T-18-27)."
    - "Sentry.close(100) in afterEach — MANDATORY for every describe that constructs SentryErrorTracker. The Sentry hub is a process-global side effect; 12+ init calls in the unit test and 13+ in the conformance test would pollute across each other without close() (T-18-32)."
    - "CaptureScope.tenantId → Sentry tag translation — Sentry's CaptureContext has no tenantId field; adapter destructures scope.tenantId and merges into tags map. Mirrors withScope's setTenant → setTag('tenantId', value) mapping."
    - "SENTRY_DSN uses RFC 2606 reserved domain (http://public@example.com/1) in ALL tests — guaranteed non-routable, prevents accidental real-Sentry hits even if transport override is missed (T-18-30)."
    - "Factory ESM-only pino import hoisted to top-of-file — CLAUDE.md requires ESM across the workspace under Bun. Not a bundle-size concern (factory.ts is node-side)."
    - "Dual-error-path on unknown ERROR_TRACKER — error message now lists all 4 supported values (noop/pino/sentry/glitchtip) so operators see the full matrix rather than the Phase 17 noop-only message."

key-files:
  created:
    - packages/observability/src/adapters/sentry/init-options.ts (76 lines — A1 Option C buildInitOptions helper)
    - packages/observability/src/adapters/sentry/sentry-error-tracker.ts (149 lines — adapter serving both kinds)
    - packages/observability/src/adapters/sentry/__tests__/sentry-error-tracker.test.ts (132 lines — 12 tests, 14 expects)
    - packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts (133 lines — 39 tests, 53 expects)
  modified:
    - packages/observability/src/factory.ts (+52 lines — 3 new switch arms, 2 new imports, 1 new pino import; JSDoc refreshed for D-06)
    - packages/observability/src/factory/__tests__/error-tracker-factory.test.ts (+70 lines — 8 new Phase-18 tests, 1 updated default test, 1 updated unknown-value test)
    - packages/observability/src/index.ts (+4 lines — SentryErrorTracker + SentryErrorTrackerOptions exports appended below PinoErrorTracker)

key-decisions:
  - "A1 Option C chosen over Option A (all-defaults-off) — preserves Sentry's dedupe + linked-errors + inbound-filter + function-toString which would be painful to re-implement, while cutting every default that auto-captures request bodies or double-registers global handlers. Matches RESEARCH recommendation verbatim."
  - "CaptureScope.tenantId translated to tag in captureException (Rule 1 bug fix) — surfaced by the tenantId-positive-case conformance fixture. The port contract defines tenantId as a first-class scope field; Sentry has no native equivalent. Without translation, every error captured in production (every error DOES carry a tenantId per ERR-04) would silently drop the most-filtered-on dimension in support workflows. Mirrors withScope's setTenant → setTag('tenantId', ...) mapping for consistency."
  - "Existing factory tests at lines 38 + 66 updated in place rather than appending replacements — the existing tests assert Phase-17 behavior (default=noop, sentry=unknown) that D-06 explicitly reverses. Leaving them would create two contradicting tests. The existing comment on line 38 anticipated this moment ('Phase 18 changes default to pino when the pino-sink adapter lands')."
  - "Transport type imported from @sentry/core, not @sentry/bun — @sentry/bun does not re-export the Transport type (runtime Transport interface comes from @sentry/core per A2). @sentry/core is already an explicit dep since Plan 01, so no new install."
  - "PinoErrorTracker in the pino factory case is constructed with a minimal local pino({level}) logger — factory.ts does NOT import @baseworks/api (cross-package cycle). Callers who want the app's full logger substitute via setErrorTracker(new PinoErrorTracker(customLogger))."

patterns-established:
  - "TDD RED → GREEN visible in `git log --oneline -- packages/observability/src/{adapters/sentry,adapters/__tests__,factory}`: a5f993f test → 2d7e115 feat (Task 1); ef1437d combined test+fix (Task 2 — the adapter fix IS required for the RED conformance test to reach GREEN, both land together); 19a0d90 test → dee7667 feat (Task 3)."
  - "Plan-authoritative port vocabulary vs implementation language divergence — plan text used 'warn' for the warn log level but ports/types.ts LogLevel says 'warning' (Sentry-native). Resolved upstream in Plan 04; inherited cleanly here. Test 5 uses 'warning' directly."

requirements-completed: [ERR-01, ERR-02, ERR-04]

# Metrics
duration: 9min
completed: 2026-04-23
tasks_completed: 3
tests_added: 59
commits: 5
---

# Phase 18 Plan 05: Sentry Adapter + Factory Extension + Cross-Adapter Conformance Summary

Ships SentryErrorTracker (ERR-01, ERR-02) — one class serving both Sentry and GlitchTip via the `kind` tag with A1 Option C hard-coded safe defaults (`defaultIntegrations: false` + `sendDefaultPii: false` + scrubPii hooks + 4-integration curated safe list), the cross-adapter PII conformance test (ERR-04 — 13 fixtures × 3 adapters = 39 tests running against in-memory test transport), and extends the factory `getErrorTracker()` switch with `pino | sentry | glitchtip` cases while widening the default from `noop` to `pino` per D-06. The final plan of Wave 2, unblocking Plan 06 (app wire-up) for Wave 3.

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-23T09:29:57Z
- **Completed:** 2026-04-23T09:39:23Z
- **Tasks:** 3 (all TDD RED→GREEN)
- **Files created:** 4
- **Files modified:** 3
- **Tests added:** 59 (12 unit + 39 conformance + 8 factory)
- **Commits:** 5 (Task 1 RED+GREEN, Task 2 combined, Task 3 RED+GREEN)

## Accomplishments

- **Shipped `SentryErrorTracker`** at `packages/observability/src/adapters/sentry/sentry-error-tracker.ts` — a single 149-line class that serves BOTH Sentry and GlitchTip targets via a `kind: 'sentry' | 'glitchtip'` constructor option. The class is the sole Sentry-SDK-importing module (only this file + init-options.ts import `@sentry/bun`). Port methods delegate thinly: `captureException → Sentry.captureException` (with tenantId-to-tag translation — see Deviations), `captureMessage → Sentry.captureMessage`, `addBreadcrumb → Sentry.addBreadcrumb`, `withScope → Sentry.withScope(bridgeScope)`, `flush → Sentry.flush`. `setTenant` in the bridged scope maps to `setTag('tenantId', value ?? '')`.
- **Shipped `buildInitOptions`** at `packages/observability/src/adapters/sentry/init-options.ts` — a 76-line pure helper that codifies the D-15 / A1 Option C contract: `sendDefaultPii: false` (hard-coded literal, no env path), `defaultIntegrations: false` (A1 resolution — empty `integrations: []` does NOT disable defaults in @sentry/bun 10.49), `beforeSend`/`beforeBreadcrumb` both running `scrubPii` (defense-in-depth per D-12), and a curated 4-integration safe list (`inboundFilters`, `dedupe`, `linkedErrors`, `functionToString`) that cuts every default which would auto-capture request bodies or double-register global handlers.
- **Shipped cross-adapter conformance test** at `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` — 133 lines, 39 tests. The 13 PII_FIXTURES from Plan 02 run through pino, sentry (via makeTestTransport), and noop adapters. Every `shouldNotAppear` substring is asserted absent AND every `shouldSurvive` substring is asserted present in the emitted output per adapter. This is the ERR-04 gate — one red test would indicate PII is leaking from some adapter for some fixture.
- **Extended factory `getErrorTracker()` switch** — three new arms (`case "pino"` with a minimal local pino logger, `case "sentry"` constructing SentryErrorTracker with kind:'sentry' from SENTRY_DSN, `case "glitchtip"` symmetrical with GLITCHTIP_DSN). Default widened from `'noop'` to `'pino'` per D-06. `process.env` invariant preserved (no `@baseworks/config` import). Factory throws with DSN env var name when the selected adapter's DSN is missing (D-09 crash-hard).
- **Extended factory tests** — appended 8 new Phase-18 tests in a separate describe block, updated 2 existing Phase-17 tests that asserted behavior D-06 reverses. Full 26/26 factory test suite passes.
- **Barrel exports** — `SentryErrorTracker` and `SentryErrorTrackerOptions` appended after Plan 04's `PinoErrorTracker` export. All prior Phase 17/18 barrel exports preserved intact (scrubPii, DEFAULT_DENY_KEYS, PiiEvent, installGlobalErrorHandlers, wrapCqrsBus, BusLike, PinoErrorTracker).
- **Full observability test suite: 180/180 pass** (121 from Plan 04 + 59 new: 12 unit + 39 conformance + 8 factory). `bunx tsc --noEmit` clean.

## Task Commits

| Task | Phase | Commit | Description |
| ---- | ----- | ------ | ----------- |
| 1 | RED | `a5f993f` | Failing tests for SentryErrorTracker + buildInitOptions (cannot find module) |
| 1 | GREEN | `2d7e115` | Implement SentryErrorTracker + buildInitOptions (12 tests pass) |
| 2 | GREEN | `ef1437d` | Cross-adapter conformance test (39 tests) + translate CaptureScope.tenantId (Rule 1 adapter fix) |
| 3 | RED | `19a0d90` | Failing factory tests for pino/sentry/glitchtip + updated defaults (8 fail) |
| 3 | GREEN | `dee7667` | Extend getErrorTracker switch (26 tests pass) |

Task 2 is a single combined commit because the conformance test cannot pass without the adapter's tenantId translation fix — both land together. Tasks 1 and 3 follow strict TDD RED→GREEN separation.

## Decisions Made

### A1 Option C Sentry init (not Option A / Option B)

Three configurations were on the table per RESEARCH A1:
- **Option A** (all defaults off): `defaultIntegrations: false, integrations: []` — would cut dedupe + linked-errors + inbound-filter, each of which is non-trivial to reimplement correctly.
- **Option B** (keep Sentry handlers, drop D-02): `integrations: []` with defaults on; rely on `onUncaughtExceptionIntegration` + `onUnhandledRejectionIntegration` — but Sentry's handlers don't guarantee `process.exit(1)` and accept no flush timeout, contradicting D-02's boundedness.
- **Option C** (chosen): `defaultIntegrations: false` + 4 explicit safe integrations. Preserves the noise-reduction + error-chaining value while cutting every default that auto-captures request bodies (T-18-26) or double-registers global handlers (T-18-27).

Matches RESEARCH recommendation verbatim. Test 3 of buildInitOptions asserts `integrations.length === 4` — a structural guard against someone adding `requestDataIntegration` later.

### CaptureScope.tenantId → Sentry tag translation (Rule 1 bug fix)

Surfaced by the `tenantId-positive-case` conformance fixture: `captureException(err, { tenantId: 'tnt-beta' })` was silently dropping the tenantId because Sentry's `CaptureContext` type has no `tenantId` field (it's a port-specific addition to CaptureScope). Without the fix, every production error — every error DOES carry a tenantId per ERR-04 — would lose the most-filtered-on dimension in support workflows.

Fix: destructure `tenantId` from CaptureScope, merge into the tags map (`tags.tenantId = String(tenantId)`), pass everything else through unchanged. Mirrors the `withScope` bridge's `setTenant → setTag('tenantId', value ?? '')` mapping, so the two entry points behave identically.

### Two existing factory tests updated in place

The existing test at line 38 asserted `default === noop`; the existing test at line 66 asserted `ERROR_TRACKER=sentry` is an unknown value. Both contradict D-06 (default=pino) and D-05 (sentry is a valid adapter). The plan Action says "APPEND ... DO NOT TOUCH existing tests" but also requires Test 1 to assert default=pino — the two are structurally incompatible. The file's own comment on line 38 anticipates exactly this moment: "Phase 17 default — Phase 18 changes default to 'pino'". Updating in place was the only path to a consistent test suite.

### Transport type from @sentry/core, not @sentry/bun

`@sentry/bun` does not re-export the `Transport` TypeScript type (verified via `tsc` during Task 1 — `Namespace '@sentry/bun' has no exported member 'Transport'`). `@sentry/core` has been an explicit observability dependency since Plan 01 (for `createTransport`), so importing the type from there adds zero new dependency surface.

### PinoErrorTracker in the factory uses a minimal local pino logger

Factory would cycle if it imported `@baseworks/api`'s logger singleton. Instead, `case "pino"` constructs `pino({ level: process.env.LOG_LEVEL ?? "info" })` locally. Callers who want app-wide bindings substitute via `setErrorTracker(new PinoErrorTracker(customLogger))` at entrypoint time — Plan 06's job.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CaptureScope.tenantId silently dropped in SentryErrorTracker.captureException**

- **Found during:** Task 2 conformance test (`tenantId-positive-case` and `plain-password-in-scope-extra` fixtures both failed with "Expected to contain 'tnt-alpha'/'tnt-beta'")
- **Issue:** `Sentry.captureException(err, scope as CaptureContext)` was the plan's literal — but Sentry's CaptureContext type has no `tenantId` field, so the value never reached the emitted event. Every production error with a tenantId would silently lose that dimension.
- **Fix:** Destructure `tenantId` from CaptureScope, merge into tags map, pass the rest through unchanged. Mirrors the `withScope` bridge's tenantId handling.
- **Files modified:** `packages/observability/src/adapters/sentry/sentry-error-tracker.ts`
- **Commit:** folded into `ef1437d` (Task 2 combined commit — the fix is REQUIRED for the conformance test RED → GREEN transition)

**2. [Rule 1 - Type] LogLevel vocabulary mismatch in plan Test 5 (`"warn"` vs `"warning"`)**

- **Found during:** Task 1 test authoring (would have been a tsc error)
- **Issue:** Plan action block's Test 5 called `tracker.captureMessage("warn-msg", "warn")`, but `ports/types.ts` defines `LogLevel = "debug" | "info" | "warning" | "error" | "fatal"`. Passing `"warn"` would be a TypeScript error. Plan 18-04 hit and documented the same divergence; inherited cleanly here.
- **Fix:** Test 5 uses `"warning"` directly (authoritative port vocabulary).
- **Files modified:** `packages/observability/src/adapters/sentry/__tests__/sentry-error-tracker.test.ts` (shipped correct at authoring)
- **Commit:** `a5f993f` (Task 1 RED — correct from the start)

**3. [Rule 1 - Type] `Transport` not re-exported from @sentry/bun**

- **Found during:** Task 1 tsc verification after GREEN
- **Issue:** `transport?: (options: any) => Sentry.Transport` produced `Namespace '@sentry/bun' has no exported member 'Transport'`.
- **Fix:** Import `Transport` from `@sentry/core` (already a Plan-01 explicit dep for `createTransport`). Use `Transport` as a named type-only import across both init-options.ts and sentry-error-tracker.ts.
- **Files modified:** `packages/observability/src/adapters/sentry/init-options.ts`, `packages/observability/src/adapters/sentry/sentry-error-tracker.ts`
- **Commit:** folded into `2d7e115` (Task 1 GREEN)

**4. [Rule 1 - Type] `PiiEvent` conversion from Sentry's `ErrorEvent`**

- **Found during:** Task 1 tsc verification after GREEN
- **Issue:** `scrubPii(event as PiiEvent)` produced `Conversion of type 'ErrorEvent' to type 'PiiEvent' may be a mistake ... Index signature for type 'string' is missing in type 'ErrorEvent'`. Sentry's ErrorEvent has typed known fields; PiiEvent is `Record<string, unknown>` (index signature).
- **Fix:** Bridge cast via `as unknown as PiiEvent` — the adapter boundary is exactly where this kind of structural-to-indexed conversion belongs.
- **Files modified:** `packages/observability/src/adapters/sentry/init-options.ts`
- **Commit:** folded into `2d7e115` (Task 1 GREEN)

**5. [Rule 1 - Type] `buildInitOptions()` return type is `Parameters<typeof Sentry.init>[0]` which includes `undefined`**

- **Found during:** Task 1 tsc verification after GREEN
- **Issue:** `Sentry.init` accepts `init(options?: Options): Client | undefined`, so `Parameters<typeof Sentry.init>[0]` is `Options | undefined`, causing `'opts' is possibly 'undefined'` at every test access point.
- **Fix:** Tests use non-null assertion `const opts = buildInitOptions({...})!;` — `buildInitOptions` always returns a populated object by construction.
- **Files modified:** `packages/observability/src/adapters/sentry/__tests__/sentry-error-tracker.test.ts`
- **Commit:** folded into `2d7e115` (Task 1 GREEN)

### Out-of-scope observations (not fixed)

**`@sentry/profiling-node` strings in transitive node_modules docstrings**

An acceptance-grep turned up `grep -R "@sentry/profiling-node" packages/` matches inside `packages/api-client/node_modules/.../.{cjs,esm,map}` files (compiled/minified Sentry SDK contents). These are internal Sentry SDK references to `@sentry/profiling-node` as an optional integration (Sentry docs the integration in its own source for operator reference). **Not** a direct Baseworks dependency — Plan 01 verified the dependency-level grep (`grep -R '"@sentry/profiling-node"' package.json packages/*/package.json`) returns nothing, which is the authoritative check per CLAUDE.md Bun-only constraint. The docstring matches are out-of-scope for this plan; they were introduced by `bun install` resolving the full Sentry transitive graph and cannot be removed without vendoring.

**`biome check` config drift**

Biome 2.4.10 installed vs `biome.json` $schema version 2.0.0 — pre-existing across Plans 01-04, not introduced here. Cannot be fixed without a repo-wide `biome migrate` run that affects non-Phase-18 files. Deferred.

## Verification

All plan-level verification checks pass:

- [x] `bun test packages/observability/src/adapters/sentry` exits 0 (12/12 tests pass)
- [x] `bun test packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` exits 0 (39/39 tests pass — 13 fixtures × 3 adapters)
- [x] `bun test packages/observability/src/factory` exits 0 (26/26 tests pass)
- [x] `bun test packages/observability` exits 0 (180/180 tests across 12 files, 303 expect() calls)
- [x] `grep -R "MockTransport" packages/observability/` returns nothing (A2 compliance)
- [x] `grep "sendDefaultPii: false" packages/observability/src/adapters/sentry/init-options.ts` matches (literal code line — 1 of 3 matches; other 2 are doc comments explaining the invariant)
- [x] `grep "defaultIntegrations: false" packages/observability/src/adapters/sentry/init-options.ts` matches
- [x] `grep "@baseworks/config" packages/observability/src/factory.ts` returns ZERO non-comment matches (invariant preserved)
- [x] `grep -c "Integration(" packages/observability/src/adapters/sentry/init-options.ts` returns 4 (Option C safe list)
- [x] `grep -R "@sentry/node" packages/observability/src/adapters/sentry/` returns nothing (Bun-only compliance)
- [x] `grep "case \"pino\":" / "case \"sentry\":" / "case \"glitchtip\":" packages/observability/src/factory.ts` — all 3 match
- [x] `grep "process.env.ERROR_TRACKER ?? \"pino\"" packages/observability/src/factory.ts` matches (D-06 widening)
- [x] `grep -c "new SentryErrorTracker" packages/observability/src/factory.ts` returns 2 (one per kind)
- [x] `grep -R "Sentry.close" packages/observability/src/adapters/sentry/__tests__/` matches (afterEach teardown per T-18-32)
- [x] `grep "Sentry.close" packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` matches (REQUIRED afterEach in sentry describe)
- [x] `bunx tsc --noEmit` on `packages/observability` exits 0

## Success Criteria

- [x] `SentryErrorTracker` serves BOTH Sentry and GlitchTip (ERR-01, ERR-02) via single class + `kind` tag
- [x] `buildInitOptions` applies A1 Option C + scrubPii hooks + `sendDefaultPii: false` hard-coded + 4 safe integrations
- [x] Cross-adapter conformance test feeds 13 fixtures through pino + sentry + noop (ERR-04) — 39 tests green
- [x] `getErrorTracker()` switch dispatches all 4 adapters with crash-hard on missing DSN
- [x] Default `ERROR_TRACKER` widened from `'noop'` to `'pino'` (D-06)
- [x] No edits to `@baseworks/config` import invariant in factory.ts (grep-verified)
- [x] Barrel preserves prior PinoErrorTracker + Plan 01/02/03 exports; appends SentryErrorTracker + SentryErrorTrackerOptions

## Must-haves Delivered

- [x] Operator setting `ERROR_TRACKER=sentry` + `SENTRY_DSN` sees `@sentry/bun` initialize with `defaultIntegrations: false` + `sendDefaultPii: false` + scrubPii hooks + the 4-integration safe list (A1 Option C).
- [x] Operator setting `ERROR_TRACKER=glitchtip` + `GLITCHTIP_DSN` sees the SAME SentryErrorTracker class instantiated with `kind: 'glitchtip'` (ERR-02 parity — identical code path).
- [x] Operator sees `captureException`/`captureMessage`/`addBreadcrumb`/`withScope`/`flush` all delegate to `@sentry/bun` top-level functions.
- [x] Operator running the conformance test sees all 13 PII fixtures redacted across BOTH pino and sentry adapters (ERR-04).
- [x] Operator with `ERROR_TRACKER` unset sees the factory default to `'pino'` (D-06 — widened).

## Tests Added

**59 new tests total** across 3 files:

- **12 unit tests** in `packages/observability/src/adapters/sentry/__tests__/sentry-error-tracker.test.ts` (14 expects):
  - 7 SentryErrorTracker tests: name="sentry"/"glitchtip", captureException envelope, beforeSend PII scrub, captureMessage level, withScope return, flush boolean
  - 5 buildInitOptions tests: sendDefaultPii false, defaultIntegrations false, 4 safe integrations, beforeSend scrub, transport passthrough

- **39 conformance tests** in `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` (53 expects):
  - 13 pino adapter tests (one per PII fixture)
  - 13 sentry adapter tests (one per PII fixture, against makeTestTransport)
  - 13 noop adapter smoke tests (no-throw assertions)

- **8 new factory tests** in `packages/observability/src/factory/__tests__/error-tracker-factory.test.ts`:
  - Default=pino (D-06), ERROR_TRACKER=noop/pino/sentry/glitchtip each returns right adapter.name, missing SENTRY_DSN throws, missing GLITCHTIP_DSN throws, unknown value throws with supported-list

Plus **2 existing factory tests updated** to match D-06 (default=pino) and D-05 (sentry is a valid adapter, not unknown).

## Threat Model Compliance

| Threat ID | Status | Evidence |
|-----------|--------|----------|
| T-18-26 (requestDataIntegration auto-captures webhook bodies) | mitigated | `defaultIntegrations: false` disables it; buildInitOptions test 3 asserts `integrations.length === 4` (explicit safe list); scrubPii's webhook-route rule (Plan 02) as second layer. |
| T-18-27 (onUncaughtException double-registration with D-02 handlers) | mitigated | `defaultIntegrations: false` removes Sentry's global handlers; installGlobalErrorHandlers (Plan 03) is the sole source. buildInitOptions test 2 asserts `defaultIntegrations === false`. |
| T-18-28 (malicious DSN pointing at attacker infra) | accepted | DSN is operator-controlled env; Plan 01 Zod `z.string().url()` provides shape validation; explicit selection (D-06 — no auto-detect) prevents accidental opt-in. |
| T-18-29 (sendDefaultPii env override sneaking in via refactor) | mitigated | Hard-coded literal in init-options.ts; acceptance grep finds ONE literal `false` match + 2 doc-comment matches; no env path. |
| T-18-30 (test hits real Sentry) | mitigated | Conformance + unit tests both use makeTestTransport (in-memory); DSN is RFC 2606 reserved `http://public@example.com/1`; grep for `sentry.io`/`glitchtip.io` in `__tests__/` returns nothing. |
| T-18-31 (ERROR_TRACKER=sentry with missing DSN silently falls back to pino) | mitigated | factory `case "sentry"` throws if SENTRY_DSN absent; factory test 6 asserts. Same for glitchtip. |
| T-18-32 (Sentry.init process-global pollution across tests) | mitigated | Every describe constructing SentryErrorTracker has `afterEach(async () => { await Sentry.close(100); })`. 12 tests + 13 conformance fixtures all pass; none leak into later tests. |
| T-18-33 (GlitchTip wire protocol diverges from Sentry silently) | accepted | Same class serves both; protocol parity is RESEARCH-confirmed (STACK.md + GlitchTip 6 release notes); structural parity (identical code path) is the ERR-02 gate. |

## Known Stubs

None. All 4 factory-dispatched adapters are complete; conformance test exercises every one end-to-end; all imports are real.

## Threat Flags

None new. This plan IS the mitigation layer for T-18-26 through T-18-32 (the Sentry-init discipline, the test-transport discipline, and the DSN-required crash-hard). No new threat surface introduced — the SentryErrorTracker is a thin boundary between the locked ErrorTracker port and an existing SDK (`@sentry/bun`), scoped exclusively inside `packages/observability`.

## TDD Gate Compliance

Plan type: `execute` with three `tdd="true"` tasks. All three tasks enforced strict RED → GREEN gates visible in `git log`:

- **Task 1:** `a5f993f` (test/RED — Cannot find module) → `2d7e115` (feat/GREEN — 12 tests pass)
- **Task 2:** `ef1437d` (combined — test file creation REQUIRED the adapter fix to reach GREEN; both ship in a single commit). This is a deliberate compression: the cross-adapter conformance test cannot be authored to RED + GREEN separately when the GREEN state requires a PARALLEL adapter-code change that wasn't in Plan 01-04's scope. A split commit would show a passing test against broken code (Task 2a) that immediately breaks (Task 2b) — misleading git history. Combined commit message explicitly documents both the conformance test authoring AND the tenantId adapter fix, so the Rule 1 bug provenance is preserved.
- **Task 3:** `19a0d90` (test/RED — 8 failures) → `dee7667` (feat/GREEN — 26/26 factory tests pass)

No REFACTOR gate needed — all implementation was minimal-correct at GREEN.

## Self-Check: PASSED

- [x] `packages/observability/src/adapters/sentry/init-options.ts` — FOUND
- [x] `packages/observability/src/adapters/sentry/sentry-error-tracker.ts` — FOUND
- [x] `packages/observability/src/adapters/sentry/__tests__/sentry-error-tracker.test.ts` — FOUND
- [x] `packages/observability/src/adapters/__tests__/error-tracker-conformance.test.ts` — FOUND
- [x] `packages/observability/src/factory.ts` — modified (3 new switch cases)
- [x] `packages/observability/src/factory/__tests__/error-tracker-factory.test.ts` — modified (+8 tests, 2 updated)
- [x] `packages/observability/src/index.ts` — modified (SentryErrorTracker barrel export)
- [x] Commits `a5f993f`, `2d7e115`, `ef1437d`, `19a0d90`, `dee7667` — all present in `git log`
- [x] 180/180 full observability test suite pass (303 expect() calls)
- [x] tsc --noEmit clean on observability package
- [x] Barrel preserves ALL Plan 01/02/03/04 exports unchanged

## Next

- **Plan 18-06** (Wave 3, depends on 04 + 05): Entrypoint wire-up in `apps/api/src/index.ts` + `worker.ts`. Constructs the env-selected ErrorTracker via `getErrorTracker()` (now dispatching all 4 adapters), calls `installGlobalErrorHandlers(tracker)`, applies `wrapCqrsBus(bus, tracker)` after `registry.loadAll()`, extends `worker.on('failed')` with `tracker.captureException(err, ...)`, extends `errorMiddleware.onError` with capture call. No `validateObservabilityEnv()` concerns — Plan 01 already filled those arms.
- **Plan 18-07** (Wave 3, parallel with 06): Release-workflow CI + docs. Ships `.github/workflows/release.yml` for source-map upload; produces Phase 18 docs.

---

*Phase: 18-error-tracking-adapters*
*Completed: 2026-04-23*
