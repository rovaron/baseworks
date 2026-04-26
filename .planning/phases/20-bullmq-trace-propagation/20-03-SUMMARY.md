---
phase: 20-bullmq-trace-propagation
plan: 03
subsystem: observability
tags: [bullmq, otel, propagation, e2e, single-trace, queue, observability, http, green]

# Dependency graph
requires:
  - phase: 20-bullmq-trace-propagation
    plan: 02
    provides: wrapQueue producer wrapper, extended wrapProcessorWithAls (carrier extract), createQueue auto-wrap, BasicTracerProvider+AsyncLocalStorageContextManager test setup pattern
provides:
  - "D-08 in-process E2E single-trace gate at apps/api/__tests__/observability-bullmq-trace.test.ts (CTX-04 SC#2 trace-data level)"
  - "context.with(otelCtxWithReqSpan, () => obsContext.run(seed, ...)) test pattern that mirrors production HTTP middleware seeding both ALS and OTEL active context"
affects: []

# Tech tracking
tech-stack:
  added:
    - "@opentelemetry/core ^2.7.0 — direct dep on apps/api (W3CTraceContextPropagator for test setup)"
    - "@opentelemetry/sdk-trace-base ^2.7.0 — direct dep on apps/api (BasicTracerProvider for valid-context spans in tests)"
    - "@opentelemetry/context-async-hooks ^2.7.0 — direct dep on apps/api (AsyncLocalStorageContextManager so context.with activates parents)"
  patterns:
    - "Three-OTEL-globals test setup (propagator + tracer provider + context manager) — same pattern as packages/queue tests in Plan 20-02. Mandatory in apps/api too because it also doesn't import telemetry.ts in the test file."
    - "context.with(reqSpanCtx, () => obsContext.run(seed, ...)) — seeds BOTH the OTEL active span AND the ALS frame so the producer wrapper's publish span inherits the synthetic request span's traceId. Without the OTEL-side seed, publish opens a fresh trace and the SC#2 single-trace assertion fails."

key-files:
  created:
    - apps/api/__tests__/observability-bullmq-trace.test.ts
    - .planning/phases/20-bullmq-trace-propagation/20-03-SUMMARY.md
  modified:
    - apps/api/package.json
    - bun.lock

key-decisions:
  - "Add @opentelemetry/core + @opentelemetry/sdk-trace-base + @opentelemetry/context-async-hooks as direct deps of apps/api. Same Bun-workspace-isolated-install issue Plan 20-02 hit on packages/queue: transitive otel deps from @baseworks/observability are not symlinked into apps/api/node_modules. Without these direct deps, the test file fails to load."
  - "Wrap the request handler in BOTH context.with(otelCtxWithReqSpan) AND obsContext.run(seed) so the seeded traceId appears on both the OTEL active span context (for publish span inheritance) and the ALS frame (for the producer-side log mixin). This precisely models what the production HTTP middleware (Phase 19 D-13) does — Bun.serve.fetch wraps its handler in a request span via the OTEL HTTP instrumentation AND seeds ALS via observabilityMiddleware. The test had to reproduce both halves."

patterns-established:
  - "Production-mirror seeding for in-process E2E tests: when a test needs to verify trace continuity from an HTTP-equivalent producer through to a worker-equivalent consumer, the test must seed both the OTEL active context AND the ALS frame with the same synthetic traceId. ALS-only seeding (Phase 19's pattern for tenant/request bleed tests) is sufficient when the assertion only touches ALS-derived fields, but breaks when the assertion crosses the carrier injection path (which reads trace context from OTEL active context, not ALS)."

requirements-completed: [CTX-04, TRC-03]

# Metrics
duration: ~25min
completed: 2026-04-26
---

# Phase 20 Plan 03: BullMQ Trace Propagation E2E Summary

**D-08 in-process API → worker single-trace assertion: an Elysia probe handler emits a producer-side log inside obsContext.run + context.with(reqSpanCtx); the captured Queue.add carrier replays through wrapProcessorWithAls; producer-log and consumer-log carry the same traceId, requestId, tenantId, and userId — closing CTX-04 SC#2 at the trace-data level (Tempo visual verification deferred to Phase 21).**

## Performance

- **Duration:** ~25 min
- **Tasks:** 1 (committed atomically)
- **Files created:** 2 (test + summary)
- **Files modified:** 2 (package.json + bun.lock)
- **Commits:** 1 (Task 1: `01742c7`)

## Accomplishments

- Authored `apps/api/__tests__/observability-bullmq-trace.test.ts` (211 lines, 1 test, 17 expect() calls) covering the full producer→carrier→consumer trace continuity path entirely in-process: stubbed Queue.add captures the carrier, Elysia probe app handles a `/probe` request inside `obsContext.run + context.with(reqSpanCtx)`, recorded payload replays through `wrapProcessorWithAls`, and producer + consumer log lines are asserted to share `traceId / requestId / tenantId / userId`.
- Mirrored the Plan 20-02 test-setup pattern: `beforeAll` registers `W3CTraceContextPropagator + BasicTracerProvider + AsyncLocalStorageContextManager`. Without all three, the assertion would silently pass on broken behavior.
- Added the production-mirror double-seed pattern (`context.with(otelCtxWithReqSpan, () => obsContext.run(seed, ...))`) and documented inline why both halves are required — the OTEL side feeds the publish span's parent traceId; the ALS side feeds the pino mixin's producer-log traceId. They must agree to satisfy SC#2.
- Added `@opentelemetry/core + @opentelemetry/sdk-trace-base + @opentelemetry/context-async-hooks` as direct deps of `apps/api` (same Rule 3 Bun-workspace-isolated-install fix Plan 20-02 made on `packages/queue`).

## Task Commits

| Task | Description | Hash | Files |
|------|-------------|------|-------|
| 1 | D-08 in-process E2E test + apps/api otel direct deps | `01742c7` | `apps/api/__tests__/observability-bullmq-trace.test.ts` (NEW), `apps/api/package.json` (MOD), `bun.lock` (MOD) |

## Phase 20 GREEN Matrix (all three plans combined)

| Test file | Plan | Tests | Status |
|-----------|------|-------|--------|
| `packages/queue/src/__tests__/carrier-roundtrip.test.ts` | 20-01 (RED) → 20-02 (GREEN) | 5 | 5/5 GREEN |
| `packages/queue/src/__tests__/create-worker-als.test.ts` | 20-01 (Tests 10/11 RED, Test 12 GREEN) → 20-02 (10/11 GREEN) | 12 (3 new + 9 Phase 19) | 12/12 GREEN |
| `apps/api/__tests__/observability-bullmq-trace.test.ts` | 20-03 NEW | 1 | 1/1 GREEN |
| **Phase 20 totals** |  | **18 Phase-20-relevant tests** | **18/18 GREEN** |

Phase 19 invariants preserved byte-for-byte: 9 of the 12 create-worker-als tests are the original Phase 19 ALS tests (fresh-fallback path on absent `_otel` carrier).

## RED→GREEN Transitions Plan 20-02 Unlocked + 1 NEW GREEN This Plan Adds

| Where | Test | Before 20-02 | After 20-02 | After 20-03 |
|-------|------|--------------|-------------|-------------|
| carrier-roundtrip | Test 1 — producer injects valid traceparent + flat ALS fields | RED | **GREEN** | unchanged |
| carrier-roundtrip | Test 2 — worker reconstitutes producer traceId | RED | **GREEN** | unchanged |
| carrier-roundtrip | Test 3 — D-09 no-ALS short-circuit | RED | **GREEN** | unchanged |
| carrier-roundtrip | Test 4 — D-04 tracestate forwarding | RED | **GREEN** | unchanged |
| carrier-roundtrip | Test 5 — D-10 per-attempt sibling spans | RED | **GREEN** | unchanged |
| create-worker-als | Test 10 — _otel seeds inner ALS traceId | RED | **GREEN** | unchanged |
| create-worker-als | Test 11 — _tenantId/_userId from job.data | RED | **GREEN** | unchanged |
| observability-bullmq-trace (NEW in 20-03) | producer log + consumer log share traceId | n/a (file did not exist) | n/a | **GREEN** |

Total: 7 RED→GREEN transitions in Plan 20-02 + 1 NEW GREEN test added in Plan 20-03.

## Test Suite State at Plan Close

| Suite | Pass | Fail | Notes |
|-------|------|------|-------|
| `apps/api/__tests__/` | 42/42 | 0 | Includes the new D-08 test; Phase 17/18/19 tests all GREEN. |
| `packages/queue/` | 31/31 | 0 | Plan 20-01 + 20-02 contracts preserved. |
| `packages/observability/` | 205/205 | 0 | No regressions in Phase 17/18/19 wrappers. |

## Key Implementation Notes

### The double-seed pattern

Production HTTP requests in apps/api:

1. Bun.serve.fetch wraps each request in an OTEL HTTP server span (Phase 17 instrumentation), so `context.active()` carries the request span's SpanContext throughout the handler.
2. `observabilityMiddleware` (Phase 19 D-13) seeds the ALS frame with the same traceId pulled from that active span.

The two halves must agree because:

- The pino mixin reads from ALS — producer-side log emits the ALS traceId.
- `wrapQueue` opens a publish span as a child of `context.active()` — the new span inherits the OTEL-active traceId.
- `propagation.inject(trace.setSpan(active, span), carrier)` writes the publish span's traceId into `_otel.traceparent` — which has the same trace-tree root as the ALS-stored traceId.
- Consumer extracts the carrier and `wrapProcessorWithAls` opens a consumer span as a child of the extracted parent context, then seeds a fresh ALS frame from `span.spanContext()` — so the consumer's pino mixin emits the same traceId.

This test reproduces both halves of the seed via:

```typescript
const otelCtxWithReqSpan = trace.setSpanContext(ROOT_CONTEXT, reqSpanCtx);
const res = await context.with(otelCtxWithReqSpan, () =>
  obsContext.run(seed, () => probeApp.handle(req)),
);
```

The first iteration of the test only seeded ALS — the assertion failed because the publish span got a fresh traceId (no OTEL-side parent). Adding the `context.with` outer wrap fixed it. This matches the Plan 20-02 carrier-roundtrip Test 4 pattern (which uses `context.with(ctxWithState, ...)` to inject tracestate).

### Why apps/api needs the same otel direct deps as packages/queue

Bun's workspace isolated installs do NOT symlink transitive deps from a workspace dependency into the consuming package. `@baseworks/observability` lists `@opentelemetry/core`, `@opentelemetry/sdk-trace-base`, and `@opentelemetry/context-async-hooks` (the latter two via @baseworks/queue's deps), but those are not visible from `apps/api`. The test file imports them directly, so they must be direct deps. Plan 20-02 hit the same fix on `packages/queue`; Plan 20-03 mirrors it on `apps/api`.

## Decisions Made

- **Production-mirror double-seed (context.with + obsContext.run)** — see "Key Implementation Notes" above. Without it the test would have asserted on a broken end-to-end path silently.
- **Add otel direct deps on apps/api** — matches Plan 20-02 Rule 3 deviation pattern. Bun workspace isolated installs require it.
- **Single test file with one test** — the plan specified one happy-path single-trace assertion. Per Plan 20-03 `<acceptance_criteria>`, the test contains all 8 mandatory assertions (typeof + equality on traceId, requestId, tenantId, userId for both producer and consumer log sides). Splitting into multiple tests would only add boilerplate; the carrier-roundtrip suite at packages/queue already covers D-09 (no-ALS skip), D-04 (tracestate), and D-10 (per-attempt) in isolation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] @opentelemetry/{core,sdk-trace-base,context-async-hooks} not resolvable from apps/api**

- **Found during:** Task 1 verification (initial test file authoring; the test file's beforeAll requires all three).
- **Issue:** Plan 20-03 `<read_first>` listed `apps/api/package.json (confirm pino + elysia available; @baseworks/queue reachable)` — but did not anticipate the otel deps would be missing. The plan's example imports `W3CTraceContextPropagator` from `@opentelemetry/core`, but apps/api only had `@opentelemetry/api`, `@opentelemetry/sdk-node`, and `@opentelemetry/auto-instrumentations-node` as direct deps; under Bun's workspace isolated install model the missing three are not exposed by transitive resolution. Same root cause as Plan 20-02 deviation #2 on packages/queue.
- **Fix:** Added `@opentelemetry/core ^2.7.0`, `@opentelemetry/sdk-trace-base ^2.7.0`, `@opentelemetry/context-async-hooks ^2.7.0` to `apps/api/package.json` dependencies.
- **Files modified:** `apps/api/package.json`, `bun.lock`.
- **Verification:** `ls apps/api/node_modules/@opentelemetry/` returns `api, auto-instrumentations-node, context-async-hooks, core, resources, sdk-node, sdk-trace-base, semantic-conventions`. Test file loads.
- **Committed in:** `01742c7` (folded into the Task 1 commit because it's a load-prerequisite for the new test).

**2. [Rule 1 — Bug] Initial test seeded only ALS, not OTEL active context**

- **Found during:** Task 1 verification (first run after the test was written from the plan's example verbatim).
- **Issue:** The plan's `<action>` example seeded only `obsContext.run(seed, () => probeApp.handle(req))`. With this seed, the producer-side pino log line carried the ALS-seed traceId (`f`*32) but the publish span inside `wrapQueue` opened with no OTEL parent, so it minted a fresh traceId — and that fresh traceId is what flowed through the carrier into the consumer. Result: producer log traceId and consumer log traceId disagreed. Test failed with `Expected: "a13f1717..." Received: "ffffff..."`.
- **Fix:** Wrapped the handler invocation in `context.with(otelCtxWithReqSpan, () => obsContext.run(seed, ...))` and changed the seed to use the same synthetic `T_PRODUCER` traceId for both the OTEL span context and the ALS traceId. This mirrors what the production HTTP middleware does (Bun.serve seeds OTEL via the HTTP instrumentation; observabilityMiddleware seeds ALS).
- **Files modified:** `apps/api/__tests__/observability-bullmq-trace.test.ts`.
- **Verification:** Test now passes — producer log traceId, consumer log traceId, and the carrier-injected traceId all equal `T_PRODUCER`.
- **Committed in:** `01742c7` (the test never landed in a broken state — the fix was applied during initial authoring before the first commit).

**3. [Environmental — not a code deviation] .env file copied from parent repo into worktree**

- **Found during:** Initial worktree setup.
- **Issue:** Worktrees in the GSD parallel-execution model don't inherit `.env` from the parent repo. `@baseworks/observability` transitively imports `@baseworks/config` which validates DATABASE_URL/BETTER_AUTH_SECRET at module load time and crashes on missing env. Same issue Plan 20-01 documented.
- **Fix:** Copied `.env` from `C:\Projetos\baseworks\.env`. `.env` is gitignored so this is not committed.
- **Committed in:** N/A (gitignored)

---

**Total deviations:** 1 Rule 3 blocker (otel deps), 1 Rule 1 fix during authoring (double-seed for trace continuity), plus 1 environmental setup. Both code-level deviations were necessary for the plan's documented end state to be achievable.

## Issues Encountered

- The single-trace assertion failed on the first run with a producer/consumer traceId mismatch. Initial reaction was "wrap-queue.ts bug" — but reading the failure carefully showed both traceIds were valid 32-hex strings, just different. The producer side carried the ALS seed; the consumer side carried the publish-span-derived traceId. Root cause: the seed was only in ALS, not in OTEL active context. Fixed by adding `context.with(otelCtxWithReqSpan, ...)` outer wrap. This is the production-mirror double-seed pattern documented under "Key Implementation Notes."
- The plan's example `<action>` block did not account for the OTEL-active-context seeding requirement — it relied on `obsContext.run(seed, ...)` alone. This is a plan-level omission rather than a wrapper-level bug; documented as Rule 1 deviation above so future readers understand why the production-mirror pattern is mandatory for any in-process E2E test that crosses the carrier boundary.

## Hand-off Notes for Phase 21

| Item | Status entering Phase 21 |
|------|--------------------------|
| **Tempo visual verification (SC#2 literal "in Tempo" wording)** | **Pending** — requires real OTEL exporter + Grafana stack. Phase 20 SC#2 satisfied at trace-data level only via D-08 in-process test. |
| **OTEL `View` cardinality cap on `messaging.message.id` (MET-02)** | **Pending** — Phase 20 emits the attribute on spans without a cap; Phase 21 metrics territory. |
| **Sampling strategy (parent-based 10% etc.)** | **Pending** — needs real exporter to make sampling decisions visible. |
| **Phase 20 wrappers swap-in transparency** | **Confirmed transparent** — `wrapQueue` and `wrapProcessorWithAls` both use `@opentelemetry/api` directly (not the Tracer port — Plan 20-02 RESEARCH §382 deviation). Real OTEL exporter swap is `NodeSDK` registration only; no call-site changes required in `wrap-queue.ts` or `wrapProcessorWithAls`. |

## Zero-Edit Invariant — End-of-Phase Confirmation

```
$ git diff <phase-20-base> -- \
    packages/modules/auth/src/auth.ts \
    packages/modules/billing/src/routes.ts \
    packages/modules/example/src/hooks/on-example-created.ts \
    packages/observability/src/lib/install-global-error-handlers.ts
(empty)
```

The four `queue.add` call sites in auth/billing/example/observability are byte-for-byte identical to their pre-Phase-20 state. The producer-side wrap is fully transparent at the call boundary (D-02 / Plan 20-02 confirmation; Plan 20-03 does not touch any production source file).

## User Setup Required

None. Phase 20 ships pure test + wrapper code — no env vars, no external services, no DB migrations.

## Next Phase Readiness

- **Phase 21 (real OTEL exporter swap-in):** Phase 20 contracts are complete. The wrappers consume `@opentelemetry/api` globals (propagator + tracer provider + context manager) — Phase 21 just needs to register a real `BatchSpanProcessor + OTLPTraceExporter` via `NodeSDK` to flip from Noop to real exporting. No call-site or wrapper edits required.
- **Phase 21 will need to verify SC#2 literal "in Tempo":** The same 1-test scenario in `observability-bullmq-trace.test.ts` should be runnable end-to-end against a real Tempo backend by switching the test's BasicTracerProvider for a NodeSDK-driven provider with an OTLP exporter pointed at the local Tempo. The test's assertion is exporter-agnostic — once spans land in Tempo, manual eyeballing of the trace tree (request → publish → process) confirms the visual single-trace view.

## Self-Check: PASSED

**Created files exist:**
- FOUND: `apps/api/__tests__/observability-bullmq-trace.test.ts` (211 lines)
- FOUND: `.planning/phases/20-bullmq-trace-propagation/20-03-SUMMARY.md` (this file)

**Modified files exist with expected content:**
- FOUND: `apps/api/package.json` — `@opentelemetry/core`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/context-async-hooks` direct deps present
- FOUND: `bun.lock` — reflects the new direct deps

**Commits exist:**
- FOUND: `01742c7` — test(20-03): add observability-bullmq-trace E2E (D-08 / CTX-04 SC#2)

**Acceptance criteria spot-checks:**
- File exists with at least 100 lines: 211 lines ✓
- `grep -c "propagation.setGlobalPropagator(new W3CTraceContextPropagator())" ...` = 1 ✓
- `grep -c "propagation.disable()" ...` = 1 ✓
- `grep -c 'wrapQueue' ...` = 4 (>= 2: import + use) ✓
- `grep -c "wrapProcessorWithAls" ...` = 4 (>= 2: import + use) ✓
- `grep -c '"producer-side"' ...` = 2 (>= 2: emit + assertion lookup) ✓
- `grep -c '"consumer-side"' ...` = 2 (>= 2: emit + assertion lookup) ✓
- `grep -c "expect(producerLog?.traceId).toBe(consumerLog?.traceId)" ...` = 1 ✓
- `grep -c "_otel?.traceparent" ...` = 1 (>= 1: W3C format check) ✓
- `grep -c "obsContext.run(seed" ...` = 1 ✓
- `grep -c "Elysia" ...` = 3 (>= 2: import + new instance) ✓
- `grep -c "queueName: \"test-queue\"" ...` = 1 (>= 1: fakeJob shape) ✓
- `bun test apps/api/__tests__/observability-bullmq-trace.test.ts` exits 0 with 1 test passing ✓
- `bun test apps/api/__tests__/` exits 0 (42/42 pass — Phase 17/18/19 + new D-08) ✓
- `bun test packages/queue/` exits 0 (31/31 pass) ✓
- `bun test packages/observability/` exits 0 (205/205 pass) ✓
- `git log --oneline -1 -- apps/api/__tests__/observability-bullmq-trace.test.ts` shows commit prefix `test(20-03)` ✓

---
*Phase: 20-bullmq-trace-propagation*
*Plan: 03*
*Completed: 2026-04-26*
