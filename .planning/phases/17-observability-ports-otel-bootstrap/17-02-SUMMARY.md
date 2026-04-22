---
phase: 17-observability-ports-otel-bootstrap
plan: 02
subsystem: observability
tags: [observability, factory, lazy-singleton, env-selected, tracer, metrics, error-tracker]

# Dependency graph
requires:
  - phase: 17-01-observability-ports-noop-adapters
    provides: "Tracer / MetricsProvider / ErrorTracker port interfaces + Noop* adapter classes (imported by factory.ts)"
  - phase: 10-payments
    provides: "provider-factory.ts shape (byte-for-byte template per D-01/D-02)"
provides:
  - "getTracer / setTracer / resetTracer singleton trio (OBS-03)"
  - "getMetrics / setMetrics / resetMetrics singleton trio (OBS-02)"
  - "getErrorTracker / setErrorTracker / resetErrorTracker singleton trio (OBS-01)"
  - "Env-selected lazy instantiation: TRACER / METRICS_PROVIDER / ERROR_TRACKER (default 'noop')"
  - "Canonical unknown-adapter error string: \"Phase 17 supports only 'noop'.\" (referenced by Plan 03 schema and Plan 04 boot test)"
  - "Barrel re-exports of all 9 factory functions from @baseworks/observability"
affects:
  - "17-04 (telemetry.ts) — calls getTracer/getMetrics/getErrorTracker after sdk.start() + validateObservabilityEnv()"
  - "18-error-tracking — extends ERROR_TRACKER switch to pino/sentry/glitchtip"
  - "21-otel-exporters — extends TRACER and METRICS_PROVIDER switches to 'otel'"
  - "19-context-logging, 20-bullmq-propagation, 22-admin-panels — consume getTracer/getMetrics/getErrorTracker at runtime"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy-singleton factory mirroring provider-factory.ts byte-for-byte (D-01/D-02): module-level `let *Instance: T | null = null;` + switch-based getter + set/reset trio"
    - "Direct process.env read (no @baseworks/config import) so factory.ts is safely loadable by telemetry.ts before sdk.start() per D-06"
    - "Canonical unknown-adapter error format: \"Unknown <VAR>: <value>. Phase 17 supports only 'noop'.\" — grep-checked 3 occurrences (one per port)"
    - "Test seam discipline: env-var tests save/restore process.env in afterEach; singleton is cleared in both beforeEach and afterEach to prevent state bleed"

key-files:
  created:
    - "packages/observability/src/factory.ts"
    - "packages/observability/src/factory/__tests__/tracer-factory.test.ts"
    - "packages/observability/src/factory/__tests__/metrics-factory.test.ts"
    - "packages/observability/src/factory/__tests__/error-tracker-factory.test.ts"
  modified:
    - "packages/observability/src/index.ts (appended factory barrel exports)"

key-decisions:
  - "Followed plan's two-task TDD ordering verbatim: Task 17-02-01 implements factory.ts (verified by tsc --noEmit), Task 17-02-02 writes the 3 test files (verified by bun test). Separate feat() and test() commits, not combined — unlike Plan 17-01 which combined them because port tests had compile-time assignability lines that made a pure RED impossible. The factory tests have no such constraint; they compile against imports that already exist from Task 1."
  - "Kept the acceptance-criterion error string verbatim: Unknown <VAR>: <value>. Phase 17 supports only 'noop'. Plan 03 (env validator Zod enum) and Plan 04 (telemetry boot smoke test) both reference this exact phrase, so any deviation would force downstream plan rewrites."
  - "Error-tracker test 1 carries an inline note about Phase 18 default shift to 'pino' so the maintainer who updates the default does not miss updating this assertion."
  - "Did NOT add a default-arm 'noop' assignment in the switch — each case is explicit. Mirrors provider-factory.ts which trusts Zod for enum-narrowing and uses an explicit default: throw."

patterns-established:
  - "Observability factory structure template: every downstream port adapter (Phase 18 Sentry, Phase 21 OTEL) extends the existing switch with a new `case` arm; no new factory function is ever added to factory.ts — always grow the switch"
  - "Six-test canonical set for every observability factory file: unset-default / singleton-identity / reset-forces-new / set-injects-mock / unknown-throws / explicit-noop-parity. Phase 18 and Phase 21 test files copy this shape and add adapter-specific cases"

requirements-completed: [OBS-01, OBS-02, OBS-03]

# Metrics
duration: ~22m
completed: 2026-04-22
---

# Phase 17 Plan 02: Observability Factories Summary

**Shipped nine env-selected lazy-singleton factory functions (three trios for Tracer / MetricsProvider / ErrorTracker) with `Phase 17 supports only 'noop'.` crash-on-unknown discipline, 18 unit tests (6 per port), and zero dependency on `@baseworks/config` so downstream telemetry.ts can import before sdk.start().**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-04-22 (Wave 2 executor spawn)
- **Completed:** 2026-04-22
- **Tasks:** 2 (17-02-01 factory impl, 17-02-02 factory tests)
- **Files created:** 4 (factory.ts + 3 test files)
- **Files modified:** 1 (index.ts barrel)

## Accomplishments

- All nine factory functions exported from `packages/observability/src/factory.ts` and re-exported from the package barrel
- Each factory defaults to its `Noop*` adapter when the env var is unset (D-03 honored)
- Each factory throws a canonical error string when the env var holds an unsupported value (D-09 honored, grep-verified 3 occurrences of `Phase 17 supports only 'noop'.`)
- `factory.ts` imports ONLY from `./ports/*` and `./adapters/noop/*` — zero `@baseworks/config` dependency (grep-verified: 0 matches for `from "@baseworks/config"`), preserving the D-06 import-ordering guarantee for Plan 04's `telemetry.ts`
- 18 new factory unit tests (`bun test packages/observability/src/factory/__tests__/` → 18 pass, 0 fail)
- Full package suite: `bun test packages/observability` → 41 pass, 0 fail, 81 expect() calls
- Package typechecks clean: `bunx tsc --noEmit -p packages/observability/tsconfig.json` → exit 0

## Task Commits

1. **Task 17-02-01 (feat):** Implement factory.ts with three lazy-singleton trios — `fad6338`
2. **Task 17-02-02 (test):** Write factory unit tests (tracer/metrics/error-tracker) — `5385141`

Two-commit ordering — `feat` first (verified by tsc), `test` second (verified by `bun test`) — matches the plan's per-task `tdd="true"` flag without the combined-commit compromise Plan 17-01 used for port tests. Factory tests have no compile-time assignability line and compile cleanly against the impl from Task 1.

## Factory Function Signatures Shipped

All nine functions were implemented verbatim from the plan's `<interfaces>` block:

```typescript
// packages/observability/src/factory.ts

export function getTracer(): Tracer;
export function setTracer(tracer: Tracer): void;
export function resetTracer(): void;

export function getMetrics(): MetricsProvider;
export function setMetrics(metrics: MetricsProvider): void;
export function resetMetrics(): void;

export function getErrorTracker(): ErrorTracker;
export function setErrorTracker(tracker: ErrorTracker): void;
export function resetErrorTracker(): void;
```

## Canonical Unknown-Adapter Error Message

Every factory's `default:` switch arm throws:

```
Unknown <VAR>: <value>. Phase 17 supports only 'noop'.
```

Three concrete strings appear in `factory.ts`:

```
`Unknown TRACER: ${name}. Phase 17 supports only 'noop'.`
`Unknown METRICS_PROVIDER: ${name}. Phase 17 supports only 'noop'.`
`Unknown ERROR_TRACKER: ${name}. Phase 17 supports only 'noop'.`
```

The trailing literal `Phase 17 supports only 'noop'.` phrase is referenced by Plan 03's Zod enum rejection error path and Plan 04's planned boot-level smoke test (17-VALIDATION row 17-04-05, threat T-17-01).

## Test Counts

| Port | Test File | Tests | Expect Calls |
|------|-----------|-------|--------------|
| Tracer (OBS-03) | `packages/observability/src/factory/__tests__/tracer-factory.test.ts` | 6 | 8 |
| MetricsProvider (OBS-02) | `packages/observability/src/factory/__tests__/metrics-factory.test.ts` | 6 | 8 |
| ErrorTracker (OBS-01) | `packages/observability/src/factory/__tests__/error-tracker-factory.test.ts` | 6 | 8 |
| **Factory subtotal** | — | **18** | **24** |
| Ports (carried from Plan 17-01) | `packages/observability/src/ports/__tests__/*.test.ts` | 23 | 57 |
| **Package total** | — | **41** | **81** |

Each factory test file covers the canonical six behaviors:

1. Default to `Noop*` when the env var is unset
2. Singleton identity (two gets return the same reference)
3. `reset*()` forces a fresh instance on next get
4. `set*(mock)` makes `get*()` return the injected mock
5. Unknown env value throws with the canonical `Phase 17 supports only 'noop'` phrase AND the offending value
6. Explicit `=noop` matches the default behavior

## Barrel Growth

`packages/observability/src/index.ts` gained a final section after the three port+adapter sections:

```typescript
// Env-selected singleton factories (Plan 17-02).
export {
  getTracer,
  setTracer,
  resetTracer,
  getMetrics,
  setMetrics,
  resetMetrics,
  getErrorTracker,
  setErrorTracker,
  resetErrorTracker,
} from "./factory";
```

Downstream consumers (`apps/api/src/telemetry.ts` in Plan 04, worker module in Plan 20) can now:

```typescript
import {
  getTracer,
  getMetrics,
  getErrorTracker,
} from "@baseworks/observability";
```

## D-06 Constraint Verification

**Constraint:** `factory.ts` MUST NOT import `@baseworks/config` — Plan 04's `telemetry.ts` imports from this file *before* `sdk.start()`, and `@baseworks/config` eagerly loads env validation on import. If `factory.ts` transitively imported `@baseworks/config`, telemetry.ts would trigger env validation before OTEL has registered its global propagators, breaking the bootstrap order.

**Verification:**

```bash
$ grep -c 'from "@baseworks/config"' packages/observability/src/factory.ts
0
```

The factory reads `process.env.TRACER` / `process.env.METRICS_PROVIDER` / `process.env.ERROR_TRACKER` directly. Two mentions of `@baseworks/config` appear in the file's doc-block comment explicitly documenting why the import is absent.

## Decisions Made

- **Separate `feat` + `test` commits (not combined)** — Plan 17-01 combined them because port tests carried compile-time `const _assignable: Port = new NoopAdapter()` lines that required the impl to exist to compile. Plan 17-02 factory tests have no such constraint; they import already-existing symbols from factory.ts. A conventional feat-then-test ordering is both more legible in git log and is what `tdd="true"` on a per-task basis naturally suggests.
- **Explicit `case "noop":` + `default:` (no fallback in default)** — mirrors provider-factory.ts exactly. The Zod enum in `env.ts` (Plan 17-03) narrows these env vars to `"noop"` at module-import time, so the `default:` arm is a defense-in-depth against anyone circumventing the Zod layer (e.g., `process.env.TRACER = "otel"` set by a test after createEnv has evaluated). The explicit throw there is the seam T-17-01 mitigates.
- **Shared test structure, not a helper** — each test file is ~75 lines and extremely regular. Extracting a `makeFactoryTestSuite<T>(opts)` helper would save lines but obscure the per-port detail (env var names, class names) that matters when debugging. Explicit duplication is the simpler pattern here; the six-test canonical set is established in this summary so Phase 18/21 authors know the shape to copy.
- **Committed `const origTracer = process.env.TRACER` save-and-restore pattern** — prevents test-order-dependence across suites (e.g., if Plan 17-03 runs before Plan 17-02 and leaves `TRACER` set by an env file).

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met, all verification commands pass.

## Issues Encountered

- **Missing `node_modules` in fresh worktree** — same pattern as Plan 17-03 summary documented. Resolved with `bun install` at worktree root (1050 packages installed in 10.4s). No lockfile drift observed; `git status` clean after install.

## User Setup Required

None — zero new env vars required at this layer. Operators who do nothing see all three adapters default to `"noop"` (no network traffic, no external service calls). Phases 18 and 21 introduce operator-facing env keys (SENTRY_DSN, OTEL_EXPORTER_OTLP_ENDPOINT, etc.) that opt into real adapters.

## Threat Mitigations

Per the plan's `<threat_model>`:

- **T-17-01 (config-tamper):** `factory.ts` `default:` switch arms throw `Unknown <VAR>: ${name}. Phase 17 supports only 'noop'.` on unrecognized env values. Three grep-verified occurrences of the literal `Phase 17 supports only 'noop'.` phrase. Test 5 in each factory test file calls `get*()` with an unsupported value (`TRACER=otel`, `METRICS_PROVIDER=otel`, `ERROR_TRACKER=sentry`) and asserts the thrown error matches `/Phase 17 supports only 'noop'/` AND contains the offending value. Bidirectional positive/negative coverage satisfied.

(T-17-02..05 are out of scope for this plan.)

## Next Plan Readiness

- **Plan 17-04 (telemetry.ts):** Ready — can `import { getTracer, getMetrics, getErrorTracker } from "@baseworks/observability"` after `sdk.start()` + `validateObservabilityEnv()` per D-06. The factory contracts won't change when Plan 21 adds the `"otel"` case arms — only the switch interior grows.
- **Phase 18 (error-tracking):** Ready — will extend `getErrorTracker`'s switch with `case "pino":`, `case "sentry":`, `case "glitchtip":` arms that read their own required env keys (and throw on missing ones, mirroring provider-factory.ts's STRIPE_SECRET_KEY pattern).
- **Phase 21 (otel-exporters):** Ready — will extend `getTracer` and `getMetrics` switches with `case "otel":` arms that wire `OtelTracer` / `OtelMetricsProvider` against OTEL_EXPORTER_OTLP_ENDPOINT.

## Self-Check

Verifying claims before completion:

- `packages/observability/src/factory.ts` — FOUND
- `packages/observability/src/factory/__tests__/tracer-factory.test.ts` — FOUND
- `packages/observability/src/factory/__tests__/metrics-factory.test.ts` — FOUND
- `packages/observability/src/factory/__tests__/error-tracker-factory.test.ts` — FOUND
- `packages/observability/src/index.ts` — MODIFIED (contains factory barrel block)
- `grep -c "Phase 17 supports only 'noop'." packages/observability/src/factory.ts` → 3 ✓
- `grep -c 'from "@baseworks/config"' packages/observability/src/factory.ts` → 0 ✓
- `bun test packages/observability` → 41 pass, 0 fail, 81 expect() calls ✓
- `bun test packages/observability/src/factory/__tests__/tracer-factory.test.ts` → 6/6 pass ✓
- `bun test packages/observability/src/factory/__tests__/metrics-factory.test.ts` → 6/6 pass ✓
- `bun test packages/observability/src/factory/__tests__/error-tracker-factory.test.ts` → 6/6 pass ✓
- `bunx tsc --noEmit -p packages/observability/tsconfig.json` → exit 0 ✓
- Commit `fad6338` (feat, Task 17-02-01) — FOUND in git log
- Commit `5385141` (test, Task 17-02-02) — FOUND in git log

## Self-Check: PASSED

---

*Phase: 17-observability-ports-otel-bootstrap*
*Plan: 02*
*Completed: 2026-04-22*
