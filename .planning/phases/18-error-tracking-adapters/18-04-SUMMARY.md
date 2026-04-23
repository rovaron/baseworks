---
phase: 18-error-tracking-adapters
plan: 04
subsystem: observability
tags: [error-tracking, adapter, pino, fallback, default, tdd]

# Dependency graph
requires:
  - phase: 17-observability-ports-otel-bootstrap
    provides: ErrorTracker port interface (captureException, captureMessage, addBreadcrumb, withScope, flush)
  - phase: 18-error-tracking-adapters
    provides: "Plan 01: ERROR_TRACKER=pino|sentry|glitchtip env + default widened from noop to pino; Plan 02: scrubPii() + DEFAULT_DENY_KEYS + PiiEvent type"
provides:
  - PinoErrorTracker adapter implementing full ErrorTracker port — ERR-03 default when ERROR_TRACKER is unset or =pino
  - scrubPii defense-in-depth applied INSIDE captureException before logger.error (ERR-04 gate inside the pino sink path)
  - Per-instance breadcrumb ring buffer — cap 10, oldest-first eviction, cleared on captureException
  - Barrel export PinoErrorTracker (appended after Plan 03's wrapCqrsBus exports; prior exports preserved)
affects:
  - 18-05-sentry-adapter (conformance test will diff PinoErrorTracker log output against SentryErrorTracker MockTransport output for 13 PII fixtures)
  - 18-06-wiring (apps/api wire-up will construct PinoErrorTracker from the env-selected factory when ERROR_TRACKER=pino or unset)
  - 19-context-logging-tracing (ALS layer will ride on top of this adapter's CaptureScope parameter — no adapter rework needed)

# Tech tracking
tech-stack:
  added:
    - "pino ^10.0.0 as @baseworks/observability dependency (previously reachable only through apps/api transitive workspace resolution; now explicit for direct import)"
  patterns:
    - "Closure-scoped withScope — local object captured by setter arrow functions; NO instance state for scope fields (guards against Pitfall 4 / threat T-18-21 cross-tenant scope leak)"
    - "Per-instance bounded ring buffer via array.push + splice(0, overflow) — keeps newest-N semantics with O(1) amortized push and O(k) eviction on overflow only"
    - "In-memory fake-logger test pattern — pino({ level: 'debug' }, customStream) where customStream.write parses JSON chunks into an array for assertion; no stdout touched during tests"
    - "LogLevel bridge — port's Sentry-native `warning` vocabulary mapped to pino's `warn` method inside the adapter's pinoMethod() switch (prevents leaking adapter-implementation naming into callers)"

key-files:
  created:
    - packages/observability/src/adapters/pino/pino-error-tracker.ts (201 lines — full ErrorTracker impl)
    - packages/observability/src/adapters/pino/__tests__/pino-error-tracker.test.ts (214 lines — 12 test cases, 31 assertions)
  modified:
    - packages/observability/src/index.ts (append PinoErrorTracker export below Plan 03's wrapCqrsBus exports; Plans 01/02/03 exports preserved untouched)
    - packages/observability/package.json (add pino ^10.0.0 dependency)
    - bun.lock (pino + its transitive deps hoisted into the workspace)

key-decisions:
  - "Widened captureMessage level mapping to cover the port's full LogLevel enum (fatal→60, error→50, warning→40, info→30, debug→20, default→info). The plan text colloquially used `\"warn\"` but `ports/types.ts LogLevel` uses `\"warning\"` (Sentry-native). Auto-fixed as Rule-1 bug since the plan's literal would have been a TypeScript error at the port boundary. Comments in pinoMethod() document the plan-vs-authoritative divergence for future readers."
  - "pino added as an EXPLICIT @baseworks/observability dependency even though apps/api already depends on it. Workspace transitive resolution does not make pino importable from packages/observability at Bun's package-resolution layer — the type-only import `import type { Logger } from 'pino'` would compile but the test file's runtime `import { pino } from 'pino'` would fail. Making the dependency explicit keeps the package self-contained and portable."
  - "pinoMethod uses a Logger bound-method factory rather than a string-key index lookup (logger[level]) — avoids TypeScript's Record<string, LogFn> index-signature requirement on Logger<never, boolean> and keeps the adapter strictly-typed end-to-end."

patterns-established:
  - "Adapter-with-ctor-injected-logger — PinoErrorTracker accepts `logger: Logger` in ctor rather than importing apps/api's singleton. Keeps the adapter test-friendly (swap in a fake stream-writing logger per test) and decouples the adapter from apps/api's logger configuration. Plan 18-06 wire-up will pass the apps/api singleton explicitly."
  - "RED→GREEN TDD gates visible in `git log --oneline -- packages/observability/src/adapters/pino`: `9481f61 test(18-04)` → `2e8ccf0 feat(18-04)`. Same pattern as Plan 03."

requirements-completed: [ERR-03, ERR-04]

# Metrics
duration: 5min
completed: 2026-04-23
---

# Phase 18 Plan 04: Pino-Sink ErrorTracker Adapter Summary

**Ships `PinoErrorTracker` — the default error-tracking adapter when `ERROR_TRACKER` is unset (D-06 default-widening), implementing the full `ErrorTracker` port with PII-scrubbing defense-in-depth, per-instance bounded breadcrumb ring buffer, and closure-scoped `withScope` that refuses cross-tenant leakage by construction.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-23T09:17:49Z
- **Completed:** 2026-04-23T09:23:04Z
- **Tasks:** 2 (Task 1 RED, Task 2 GREEN)
- **Files created:** 2
- **Files modified:** 3 (barrel, package.json, lockfile)

## Accomplishments

- Shipped `PinoErrorTracker` (201 lines) at `packages/observability/src/adapters/pino/pino-error-tracker.ts`. Implements every method of the Phase-17 `ErrorTracker` port — `captureException` (scrubs PII, serializes breadcrumbs, clears buffer), `captureMessage` (1:1 LogLevel→pino-method mapping), `addBreadcrumb` (bounded ring buffer, oldest-first eviction at cap 10), `withScope` (closure-scoped — no instance state), `flush` (always true, synchronous contract).
- Wired `scrubPii` (from Plan 02) INSIDE `captureException` BEFORE `logger.error(...)` — the D-12 defense-in-depth layer. Test 3 asserts a `{ password: "hunter2" }` extra never appears anywhere in the serialized log entry; the full 13-fixture conformance suite is Plan 05's gate.
- Locked the Pitfall-4 invariant with a `Promise.all` regression-guard test (Test 8): two concurrent `withScope` callbacks each call `setTenant` and `setTag` with different values, then a third `captureException` with NO scope arg runs AFTER both — its serialized log entry contains NEITHER tenant nor tag value. Instance-state audit grep (`this.(tags|user|tenantId|extra)\s*=`) returns nothing, which acceptance criteria require.
- Breadcrumb ring buffer: Test 6 adds 15 breadcrumbs and asserts exactly 10 remain with bc-0..bc-4 evicted and bc-14 still present. Test 5 asserts the buffer is cleared after each `captureException` so the next capture starts fresh.
- Added `pino ^10.0.0` as an explicit `@baseworks/observability` dependency. apps/api already depended on it at the same version, but workspace transitive resolution did not expose it to `packages/observability`'s module graph — the test file's `import { pino } from "pino"` would have failed without the explicit entry.
- Updated the barrel `packages/observability/src/index.ts` to append `export { PinoErrorTracker }` below Plan 03's `wrapCqrsBus` export. Prior Wave-1 exports (`scrubPii`, `DEFAULT_DENY_KEYS`, `PiiEvent`, `installGlobalErrorHandlers`, `wrapCqrsBus`, `BusLike`) are preserved intact per Wave-2 contract. Plan 18-05 will append its own exports below this one.
- Full `bun test packages/observability` run: **121/121 pass** (up from 109 after Plan 03; +12 new tests, zero regressions). `bunx tsc --noEmit` clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected LogLevel enum mismatch in captureMessage mapping**

- **Found during:** Task 2 (tsc typecheck revealed after GREEN test pass)
- **Issue:** Plan Task 1 Test 7 and plan D-07 both used the literal `"warn"` for the warn log level, but `packages/observability/src/ports/types.ts` defines `LogLevel = "debug" | "info" | "warning" | "error" | "fatal"`. Passing `"warn"` to `captureMessage` would be a TypeScript error at every call site. Plan text was colloquially using pino's method name rather than the port's Sentry-native vocabulary.
- **Fix:** Adapter's `pinoMethod()` switch uses `"warning"` (port vocabulary) and delegates to `logger.warn` (pino method name). Also added `"fatal"` → `logger.fatal` case, since the port's LogLevel includes it and omitting it would silently fall through to the `info` default. Test 7 updated to cover all five port levels (fatal/error/warning/info/debug) + default. Comments in `pinoMethod()` document the plan-vs-authoritative divergence.
- **Files modified:** `packages/observability/src/adapters/pino/pino-error-tracker.ts`, `packages/observability/src/adapters/pino/__tests__/pino-error-tracker.test.ts`
- **Commit:** folded into `2e8ccf0` (GREEN commit) so RED state stays valid against what ultimately shipped

**2. [Rule 3 - Blocking] Added pino as explicit dependency**

- **Found during:** Task 1 (RED state verification — `bun test` failed at module resolution)
- **Issue:** `@baseworks/observability` did not declare `pino` as a dependency. Transitive workspace resolution from `@baseworks/api` did not hoist pino to a path the observability test file could resolve. `import { pino } from "pino"` inside the test file would have failed with "Cannot find package" before the intended "Cannot find module '../pino-error-tracker'" RED signal.
- **Fix:** Added `"pino": "^10.0.0"` to `packages/observability/package.json` dependencies, matching apps/api's version. `bun install` hoisted pino into the workspace. Verified with `bun -e "import('pino')"` from the observability package. Note: the adapter source file uses `import type { Logger } from "pino"` (type-only, compiled away), but the test file needs runtime pino and will inform future plans if they consume pino types outside test context.
- **Files modified:** `packages/observability/package.json`, `bun.lock`
- **Commit:** folded into `9481f61` (RED commit) — the dependency was required to produce the correct RED error

**3. [Rule 1 - Type] Test file generic-parameter mismatch between `pino()` return and PinoErrorTracker ctor param**

- **Found during:** Task 2 (tsc revealed after GREEN test pass)
- **Issue:** `pino({...}, stream)` returns `Logger<never, boolean>` (no custom levels declared); `PinoErrorTracker`'s ctor param `logger: Logger` defaults to `Logger<string, boolean>` per pino's type defaults. tsc rejects the call site even though runtime behavior is correct (both generic instantiations expose identical `error/warn/info/debug/fatal` methods).
- **Fix:** Test file casts the `pino(...)` result to `as unknown as Logger` before passing to the ctor. Comment in the fake-logger factory documents why. The cast is test-only — production callers (apps/api's `logger.ts` singleton) use pino with its default `string` level type and match the ctor's default `Logger` shape exactly.
- **Files modified:** `packages/observability/src/adapters/pino/__tests__/pino-error-tracker.test.ts`
- **Commit:** folded into `2e8ccf0` (GREEN commit)

### Out-of-Scope Items (deferred, not fixed)

**Biome configuration drift (pre-existing, global repo issue)**

- `biome.json` declares `"$schema": "https://biomejs.dev/schemas/2.0.0/schema.json"` but the workspace-installed Biome CLI is `2.4.10`. The config also uses the deprecated `organizeImports` top-level key, which Biome 2.4.10 does not recognize. Running `bunx biome check packages/observability/src/adapters/pino/` exits non-zero BEFORE any of our files are lint-checked — the failure is config deserialization, not code quality.
- **Scope decision:** Not caused by this plan's changes; both Plans 02 and 03 shipped with the same config drift. Fixing it requires a `biome migrate` run across the whole repo and is safer as its own quick task. Per executor scope boundary rules (only auto-fix issues DIRECTLY caused by current task's changes), this is deferred to a future cleanup quick task.
- **Mitigation:** Our files were visually audited for adherence to the existing codebase's Biome-conformant style (import order, formatter output, JSDoc layout, trailing commas). tsc --noEmit is clean, which is the substantive type-safety gate.

## Tests

- **Added:** 12 test cases (`packages/observability/src/adapters/pino/__tests__/pino-error-tracker.test.ts`) — 31 `expect()` assertions across port-method coverage, PII scrubbing, ring-buffer semantics, Pitfall-4 concurrency guard, flush contract, and throwing-transport resilience.
- **Test suite state:**
  - Pino adapter isolated: **12/12 pass**
  - Full observability package: **121/121 pass** (109 inherited from Plan 03 + 12 new; zero regressions)
  - `bunx tsc --noEmit` (observability package): clean

## Threat Model Compliance

| Threat ID | Status | Evidence |
|-----------|--------|----------|
| T-18-20 (PII → logger) | mitigated | `scrubPii(raw)` called inside `captureException` before `logger.error`; Test 3 asserts `"hunter2"` absence. 13-fixture conformance suite at Plan 05 is the comprehensive gate. |
| T-18-21 (cross-tenant scope leak) | mitigated | `withScope` uses closure-local scope object; no instance fields for scope. Test 8 (Promise.all) asserts concurrent callbacks don't leak into each other or into a subsequent `captureException`. Acceptance grep `this.(tags\|user\|tenantId\|extra)\s*=` returns empty. |
| T-18-22 (unbounded buffer) | mitigated | `BREADCRUMB_BUFFER_SIZE = 10` constant; `splice(0, overflow)` on every `addBreadcrumb`. Test 6 adds 15 and asserts 10 remain. |
| T-18-23 (flush blocks exit) | accepted | `flush` resolves `true` synchronously. Test 11 asserts both no-timeout and with-timeout paths. Pino stream backpressure is out of scope — `installGlobalErrorHandlers` (Plan 03) imposes the 2000ms flush cap via its own `Promise.race`. |
| T-18-24 (non-Error throws) | mitigated | Ternary wraps non-Error values as `{ value: String(err) }`. Not directly tested in Plan 04; Plan 05's conformance suite will add a `throw "string"` fixture. |
| T-18-25 (PII in err.message) | mitigated | Whole `raw` object (including `errPayload.message`) passed through `scrubPii`, so regex passes run against the message text. Plan 02's fixture 3 (`email-in-error-message-string`) is the conformance witness; wired end-to-end at Plan 05. |

## Next

- **Plan 18-05** (Wave 2, parallel with this plan): SentryErrorTracker adapter + cross-adapter PII conformance test (the 13-fixture suite from Plan 02 run against BOTH this adapter and the Sentry adapter). That plan will ALSO append to the observability barrel — it must preserve the `PinoErrorTracker` export shipped here.
- **Plan 18-06** (Wave 3, depends on 04 + 05): `apps/api/src/index.ts` + `worker.ts` wire-up. Constructs `PinoErrorTracker(logger)` from the env-selected factory when `ERROR_TRACKER=pino` or unset; calls `installGlobalErrorHandlers(tracker)` + `wrapCqrsBus(bus, tracker)` + `app.onError(...)` + `worker.on('failed', ...)`.

## Commits

- `9481f61` — `test(18-04): add failing tests for PinoErrorTracker adapter` (RED gate + pino dep)
- `2e8ccf0` — `feat(18-04): implement PinoErrorTracker adapter` (GREEN + barrel + LogLevel bridge fix)

## Self-Check: PASSED

Verified:
- FOUND: `packages/observability/src/adapters/pino/pino-error-tracker.ts` (201 lines)
- FOUND: `packages/observability/src/adapters/pino/__tests__/pino-error-tracker.test.ts` (214 lines)
- FOUND: `9481f61` (test commit)
- FOUND: `2e8ccf0` (feat commit)
- FOUND: barrel export `export { PinoErrorTracker } from "./adapters/pino/pino-error-tracker";` in `packages/observability/src/index.ts`
- FOUND: prior Plan 01/02/03 barrel exports preserved (scrubPii, DEFAULT_DENY_KEYS, PiiEvent, installGlobalErrorHandlers, wrapCqrsBus, BusLike — all present above the new line)
- FOUND: 12/12 pino adapter tests pass; 121/121 full observability suite pass
- FOUND: tsc --noEmit clean on observability package
- FOUND: no instance-state for scope fields (grep empty)
