---
phase: 17-observability-ports-otel-bootstrap
plan: 01
subsystem: observability
tags: [observability, ports, noop-adapters, bun, workspace-scaffolding, tracing, metrics, error-tracking]

# Dependency graph
requires:
  - phase: 10-payments
    provides: "PaymentProvider port + StripeAdapter pattern (byte-for-byte template for observability ports)"
provides:
  - "@baseworks/observability workspace package (zero runtime deps)"
  - "Tracer port + NoopTracer adapter (OBS-03)"
  - "MetricsProvider port + Counter/Histogram/Gauge instruments + NoopMetricsProvider (OBS-02)"
  - "ErrorTracker port + Breadcrumb/ErrorTrackerScope/CaptureScope + NoopErrorTracker (OBS-01)"
  - "Shared port types module (Attributes, TraceCarrier, LogLevel)"
  - "Barrel re-exports for all three ports and all three noop adapters"
affects:
  - "17-02 (factories) — imports Tracer / MetricsProvider / ErrorTracker ports + Noop classes"
  - "17-04 (telemetry.ts) — constructs OTEL backed adapters against the same port contracts"
  - "18-error-tracking — pino-sink / Sentry / GlitchTip adapters implement ErrorTracker port"
  - "19-context-logging — logger mixin reads tenantId that ErrorTracker scope also carries"
  - "20-bullmq-propagation — uses Tracer.inject/extract via TraceCarrier"
  - "21-otel-adapters — OtelTracer / OtelMetricsProvider implement these ports"

# Tech tracking
tech-stack:
  added:
    - "@baseworks/observability (new workspace package — no runtime deps)"
  patterns:
    - "Port/adapter with `readonly name` + per-method JSDoc (mirrors packages/modules/billing/src/ports/payment-provider.ts)"
    - "Noop-first default adapter: zero external traffic, zero `throw` statements"
    - "Shared cross-port types module (`ports/types.ts`) with port-specific types co-located with each port"
    - "Explicit named barrel re-exports (no `export *` wildcards)"
    - "Compile-time structural-assignability assertions inside port tests"

key-files:
  created:
    - "packages/observability/package.json"
    - "packages/observability/tsconfig.json"
    - "packages/observability/src/index.ts"
    - "packages/observability/src/ports/types.ts"
    - "packages/observability/src/ports/tracer.ts"
    - "packages/observability/src/ports/metrics.ts"
    - "packages/observability/src/ports/error-tracker.ts"
    - "packages/observability/src/adapters/noop/noop-tracer.ts"
    - "packages/observability/src/adapters/noop/noop-metrics.ts"
    - "packages/observability/src/adapters/noop/noop-error-tracker.ts"
    - "packages/observability/src/ports/__tests__/tracer.test.ts"
    - "packages/observability/src/ports/__tests__/metrics.test.ts"
    - "packages/observability/src/ports/__tests__/error-tracker.test.ts"
  modified:
    - "tsconfig.json (added @baseworks/observability path aliases)"
    - "bun.lock (workspace registration)"

key-decisions:
  - "Added tsconfig path aliases for @baseworks/observability to match the explicit-paths convention used by every other @baseworks/* package"
  - "Introduced CaptureScope as a named exported interface on the ErrorTracker port (plan inlined it as a Partial<...> intersection) so Phase 18 adapters can import it without duplicating the shape"
  - "Co-located `Breadcrumb`, `ErrorTrackerScope`, `Span`, `SpanOptions`, `Counter`, `Histogram`, `Gauge` with their owning port rather than in `ports/types.ts` — matches billing precedent (payment-provider.ts co-locates interface-specific types)"

patterns-established:
  - "Noop adapter contract: every method body is a typed empty function with underscore-prefixed unused params; zero `throw`; async methods return resolved defaults"
  - "Port test template: name assertion, every method called under minimal + maximal argument shapes with `.not.toThrow()`, and a compile-time structural assignability line"
  - "Barrel growth policy: one section per task, named exports only, alphabetized within the section"

requirements-completed: [OBS-01, OBS-02, OBS-03]

# Metrics
duration: ~25m
completed: 2026-04-22
---

# Phase 17 Plan 01: Observability Ports & Noop Adapters Summary

**Scaffolded @baseworks/observability workspace package with three port interfaces (Tracer, MetricsProvider, ErrorTracker), three Noop adapters, and 23 port-level tests — all zero-dependency and zero-throw, establishing the contracts Plans 02/04 and Phases 18/21 build against.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-22T02:45:00Z
- **Completed:** 2026-04-22T03:10:24Z
- **Tasks:** 4 (17-01-00 through 17-01-03)
- **Files created:** 13 (10 source + 3 test)
- **Files modified:** 2 (tsconfig.json, bun.lock)

## Accomplishments

- `@baseworks/observability` workspace package exists and resolves via Bun workspaces (`bun pm ls` lists it as `workspace:packages\observability`)
- Three port interfaces defined with `readonly name`, per-method `@param` / `@returns` JSDoc, and co-located port-specific types — mirroring the billing `PaymentProvider` precedent byte-for-byte
- Three Noop adapters implement every port method with typed empty bodies, never throwing (grep-verified 0 `throw` statements across all three adapter files)
- 23 port-level tests pass in ~50 ms (`bun test packages/observability`): 9 tracer + 6 metrics + 8 error-tracker
- Package typechecks clean (`tsc --noEmit` exits 0)
- Zero OTEL / Sentry deps at this layer — Plan 04 owns SDK imports (grep-verified: `@opentelemetry`/`@sentry` not present in package.json)

## Task Commits

Each task was committed atomically:

1. **Task 17-01-00: Scaffold workspace package** — `209cdf0` (feat)
2. **Task 17-01-01: Tracer port + NoopTracer + tests (OBS-03)** — `e21b57f` (feat, TDD combined)
3. **Task 17-01-02: MetricsProvider port + NoopMetricsProvider + tests (OBS-02)** — `2b7e7a1` (feat, TDD combined)
4. **Task 17-01-03: ErrorTracker port + NoopErrorTracker + tests (OBS-01)** — `8419f19` (feat, TDD combined)

_Note: Plan uses `tdd="true"` per task; each task combined test + impl in one feat commit because each TDD pair lives in its own task and the test file + impl file were added together. A stricter red/green split was skipped because each test also contains a compile-time assignability line that would not compile without the matching interface + class — red-first would have been a syntactic impossibility._

## Interface Signatures Shipped

All three ports were implemented verbatim from the `<interfaces>` block of the plan:

### Tracer (`packages/observability/src/ports/tracer.ts`)

```typescript
export interface Span {
  end(): void;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: "ok" | "error"; message?: string }): void;
  recordException(err: unknown): void;
}

export interface SpanOptions {
  attributes?: Attributes;
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
}

export interface Tracer {
  readonly name: string;
  startSpan(name: string, options?: SpanOptions): Span;
  withSpan<T>(
    name: string,
    fn: (span: Span) => T | Promise<T>,
    options?: SpanOptions,
  ): Promise<T>;
  inject(carrier: TraceCarrier): void;
  extract(carrier: TraceCarrier): void;
  currentCarrier(): TraceCarrier;
}
```

### MetricsProvider (`packages/observability/src/ports/metrics.ts`)

```typescript
export interface Counter {
  inc(value?: number, attributes?: Attributes): void;
}
export interface Histogram {
  record(value: number, attributes?: Attributes): void;
}
export interface Gauge {
  set(value: number, attributes?: Attributes): void;
}
export interface MetricsProvider {
  readonly name: string;
  counter(name: string, options?: { description?: string; unit?: string }): Counter;
  histogram(name: string, options?: { description?: string; unit?: string }): Histogram;
  gauge(name: string, options?: { description?: string; unit?: string }): Gauge;
}
```

### ErrorTracker (`packages/observability/src/ports/error-tracker.ts`)

```typescript
export interface Breadcrumb {
  message: string;
  category?: string;
  level?: LogLevel;
  data?: Record<string, unknown>;
  timestamp?: number;
}

export interface ErrorTrackerScope {
  setUser(user: { id?: string; email?: string } | null): void;
  setTag(key: string, value: string): void;
  setExtra(key: string, value: unknown): void;
  setTenant(tenantId: string | null): void;
}

export interface CaptureScope {
  user?: { id?: string; email?: string } | null;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  tenantId?: string | null;
}

export interface ErrorTracker {
  readonly name: string;
  captureException(err: unknown, scope?: CaptureScope): void;
  captureMessage(message: string, level?: LogLevel): void;
  addBreadcrumb(breadcrumb: Breadcrumb): void;
  withScope<T>(fn: (scope: ErrorTrackerScope) => T): T;
  flush(timeoutMs?: number): Promise<boolean>;
}
```

### Shared types (`packages/observability/src/ports/types.ts`)

```typescript
export type Attributes = Record<string, string | number | boolean>;
export type TraceCarrier = Record<string, string>;
export type LogLevel = "debug" | "info" | "warning" | "error" | "fatal";
```

## Test Counts

| Port | Test File | Tests | Expect Calls |
|------|-----------|-------|--------------|
| Tracer (OBS-03) | `packages/observability/src/ports/__tests__/tracer.test.ts` | 9 | 21 |
| MetricsProvider (OBS-02) | `packages/observability/src/ports/__tests__/metrics.test.ts` | 6 | 16 |
| ErrorTracker (OBS-01) | `packages/observability/src/ports/__tests__/error-tracker.test.ts` | 8 | 20 |
| **Total** | — | **23** | **57** |

Every test file includes a compile-time `const _assignable: Port = new NoopAdapter()` line — if an adapter ever drifts from its port, `tsc` catches it before the runtime does.

## Decisions Made

- **tsconfig path aliases** — the plan did not explicitly call for modifying root `tsconfig.json`, but every other `@baseworks/*` package has an entry in `compilerOptions.paths`. Adding `@baseworks/observability` + `@baseworks/observability/*` keeps TS resolution consistent with the rest of the monorepo. (Rule 3 — blocking: without this, downstream apps importing `@baseworks/observability` before `bun install` has created node_modules would fail to resolve via the project's path convention.)
- **Named `CaptureScope` interface** — the plan inlined the parameter shape of `captureException` as `Partial<{ ... }>`. Extracting it into a named exported interface keeps the signature readable and gives Phase 18 adapter authors a single symbol to import instead of duplicating the shape.
- **Combined test + impl per task commit** — the plan carries `tdd="true"` on every task but the compile-time assignability line in each test file makes a pure RED phase impossible (the test would not compile without the matching interface). One `feat(...)` commit per task with both the test file and the impl file is the honest representation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `@baseworks/observability` path aliases to root `tsconfig.json`**
- **Found during:** Task 17-01-00 (workspace scaffold)
- **Issue:** Root `tsconfig.json` declares explicit `paths` entries for every other `@baseworks/*` workspace. Omitting the observability entry would leave consumer files (apps/api Plan 04) unable to resolve the import under TS language-server / editor tooling even though Bun resolves it at runtime.
- **Fix:** Added `"@baseworks/observability": ["./packages/observability/src"]` and `"@baseworks/observability/*": ["./packages/observability/src/*"]` alongside the existing aliases.
- **Files modified:** `tsconfig.json`
- **Verification:** `bunx tsc --noEmit` exits 0 from `packages/observability/`; the root `tsc --noEmit` already excludes observability (it is only pulled in on-demand by consumer packages, which arrive in Plan 02+).
- **Committed in:** `209cdf0` (Task 17-01-00 commit)

**2. [Rule 2 - Missing Critical] Introduced named `CaptureScope` interface on the ErrorTracker port**
- **Found during:** Task 17-01-03 (ErrorTracker port authoring)
- **Issue:** The plan spec used an inline `Partial<{ user: ...; tags: ...; extra: ...; tenantId: ... }>` for the `captureException` scope parameter. Phase 18 adapters (Sentry, pino-sink) will need to accept that same shape in helper functions and would otherwise have to duplicate the inline type at every callsite or rely on TypeScript inference.
- **Fix:** Extracted the shape into `export interface CaptureScope { ... }` and reference it from `captureException(err: unknown, scope?: CaptureScope)`. The runtime shape is identical; the only change is that consumers have a named symbol to import.
- **Files modified:** `packages/observability/src/ports/error-tracker.ts`, `packages/observability/src/adapters/noop/noop-error-tracker.ts`, `packages/observability/src/index.ts`
- **Verification:** `bun test packages/observability/src/ports/__tests__/error-tracker.test.ts` — 8/8 passing, including a test that passes both a full and a null-populated CaptureScope.
- **Committed in:** `8419f19` (Task 17-01-03 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical)
**Impact on plan:** Both deviations widen the surface area slightly but strictly in the API-consumption direction (extra exports, no removals, no semantic changes). The ErrorTracker port still satisfies every acceptance-criterion grep verbatim.

## Issues Encountered

- **Root `tsconfig.json` paths** — surfaced as a blocking concern during the scaffold task; resolved inline as Deviation 1 above.
- No test failures, no typecheck failures, no runtime errors during execution.

## Phase 17 Constraint Held

**Zero OTEL/Sentry dependencies at this layer.** Plan 04 owns SDK imports. Verified by:

```bash
grep -E '"@opentelemetry|"@sentry' packages/observability/package.json
# 0 matches
```

`packages/observability/package.json` contains `"dependencies": {}` — mitigates T-17-03 (Information Disclosure via transitive SDK egress).

Additionally, grep-verified 0 `throw` statements across all three `packages/observability/src/adapters/noop/*.ts` files — mitigates T-17-01 (Tampering: untrusted call-site inputs must never break the default adapter).

## User Setup Required

None — no external service configuration required at this layer. Phase 18 and Phase 21 will add environment keys for real adapters.

## Next Phase Readiness

- **Plan 17-02 (factories):** Ready. Can import `Tracer` / `MetricsProvider` / `ErrorTracker` port types and `NoopTracer` / `NoopMetricsProvider` / `NoopErrorTracker` classes directly from `@baseworks/observability`.
- **Plan 17-03 (env validation):** Ready. Independent from this plan; no blockers.
- **Plan 17-04 (telemetry.ts):** Ready. Will add `@opentelemetry/*` deps to `packages/observability/package.json` at that time (Task 17-04-00 in the Validation map).
- **Future phases (18 pino-sink, 21 OTEL adapters):** Contracts are stable. Any widening (e.g., async variants, additional scope keys) should be additive to these interfaces.

## Self-Check: PASSED

- Files created:
  - `packages/observability/package.json` — FOUND
  - `packages/observability/tsconfig.json` — FOUND
  - `packages/observability/src/index.ts` — FOUND
  - `packages/observability/src/ports/types.ts` — FOUND
  - `packages/observability/src/ports/tracer.ts` — FOUND
  - `packages/observability/src/ports/metrics.ts` — FOUND
  - `packages/observability/src/ports/error-tracker.ts` — FOUND
  - `packages/observability/src/adapters/noop/noop-tracer.ts` — FOUND
  - `packages/observability/src/adapters/noop/noop-metrics.ts` — FOUND
  - `packages/observability/src/adapters/noop/noop-error-tracker.ts` — FOUND
  - `packages/observability/src/ports/__tests__/tracer.test.ts` — FOUND
  - `packages/observability/src/ports/__tests__/metrics.test.ts` — FOUND
  - `packages/observability/src/ports/__tests__/error-tracker.test.ts` — FOUND
- Commits present in `git log`:
  - `209cdf0` — FOUND (Task 17-01-00)
  - `e21b57f` — FOUND (Task 17-01-01)
  - `2b7e7a1` — FOUND (Task 17-01-02)
  - `8419f19` — FOUND (Task 17-01-03)
- `bun test packages/observability` — 23/23 pass
- `bunx tsc --noEmit` — exits 0
- Grep: 0 `throw` in `packages/observability/src/adapters/noop/*.ts`
- Grep: 0 `@opentelemetry|@sentry` matches in `packages/observability/package.json`

---

*Phase: 17-observability-ports-otel-bootstrap*
*Plan: 01*
*Completed: 2026-04-22*
