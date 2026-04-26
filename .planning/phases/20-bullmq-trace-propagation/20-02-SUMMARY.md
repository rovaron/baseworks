---
phase: 20-bullmq-trace-propagation
plan: 02
subsystem: observability
tags: [bullmq, otel, propagation, tracing, w3c, queue, observability, wrapper, green]

# Dependency graph
requires:
  - phase: 20-bullmq-trace-propagation
    plan: 01
    provides: carrier-roundtrip RED tests + create-worker-als Tests 10/11 RED + buildStubQueue helper + W3CTraceContextPropagator setup pattern + @opentelemetry/api+core direct deps on packages/queue
provides:
  - "wrapQueue<Q extends Queue>(queue: Q): Q producer wrapper at packages/observability/src/wrappers/wrap-queue.ts"
  - "extended wrapProcessorWithAls with carrier-extract via propagation.extract + context.with(parentCtx)"
  - "createQueue → wrapQueue wired transparently — zero edits to the four queue.add call sites"
  - "BasicTracerProvider + AsyncLocalStorageContextManager test-setup pattern reusable by Plan 20-03"
affects: [20-03]

# Tech tracking
tech-stack:
  added:
    - "@opentelemetry/semantic-conventions ^1.40.0 — direct dep on packages/queue (consumer-side imports ATTR_MESSAGING_*)"
    - "@opentelemetry/sdk-trace-base ^2.7.0 — direct dep on packages/queue (test-only: BasicTracerProvider for valid-context spans)"
    - "@opentelemetry/context-async-hooks ^2.7.0 — direct dep on packages/queue (test-only: AsyncLocalStorageContextManager for context.with activation)"
    - "bullmq ^5.0.0 — direct dep on packages/observability (so wrap-queue.ts type-only import resolves under Bun isolated installs)"
  patterns:
    - "Producer wrapper opens span via @opentelemetry/api directly (NOT the Tracer port — RESEARCH §382: NoopSpan has no SpanContext, propagation.inject would emit an empty traceparent). Documented inline in wrap-queue.ts header."
    - "Consumer wrapper context order: OUTER context.with(parentCtx, fn) → tracer.startSpan inherits parent traceId → INNER context.with(trace.setSpan(parentCtx, span), () => obsContext.run(jobCtx, ...)). RESEARCH anti-pattern §385: OTEL active context FIRST, ALS INSIDE."
    - "D-09 short-circuit: if (!obsContext.getStore()) return origAdd(...) unwrapped. Repeatable jobs / startup scripts / error-capture enqueues skip carrier injection cleanly."
    - "Per-attempt fresh consumer span via tracer.startSpan inside context.with(parentCtx, ...) — D-10 retries produce sibling consumer spans under the producer publish parent."
    - "Test-setup pattern: BasicTracerProvider + AsyncLocalStorageContextManager + W3CTraceContextPropagator ALL THREE registered in beforeAll. Without context manager, context.with is a no-op; without tracer provider, spans are NoopSpans. This gap was invisible in Plan 20-01 RED because tests crashed at module load."

key-files:
  created:
    - packages/observability/src/wrappers/wrap-queue.ts
    - .planning/phases/20-bullmq-trace-propagation/20-02-SUMMARY.md
  modified:
    - packages/observability/src/index.ts
    - packages/observability/package.json
    - packages/queue/src/index.ts
    - packages/queue/package.json
    - packages/queue/src/__tests__/carrier-roundtrip.test.ts
    - packages/queue/src/__tests__/create-worker-als.test.ts
    - packages/queue/src/__tests__/queue.test.ts
    - apps/api/__tests__/logger-callsite-invariance.test.ts
    - bun.lock

key-decisions:
  - "Test setup needs both BasicTracerProvider AND AsyncLocalStorageContextManager. RESEARCH §382 flagged the tracer-provider need. The context-manager need was a Plan 20-01 gap — without it, context.with(parentCtx, fn) is a no-op and consumer spans never inherit producer traceIds. Decision: add both via @opentelemetry/{sdk-trace-base,context-async-hooks} direct deps on packages/queue, register inside the existing beforeAll blocks."
  - "Added bullmq as direct dep of packages/observability. Plan PATTERNS.md line 236 named this acceptable; here promoted from peer-dep to direct dep so the type-only `import type { Queue, JobsOptions } from 'bullmq'` in wrap-queue.ts resolves under Bun's workspace isolated installs (transitive types from packages/queue → packages/observability are not exposed)."
  - "MockQueue in queue.test.ts needed add+addBulk stubs. Phase 20 wraps via wrapQueue which calls `.bind(queue.add)` and `.bind(queue.addBulk)`; the Phase 19 mock declared neither. Added inert async stubs that satisfy the bind without changing test semantics — the 5 createQueue config tests still verify queue.opts only."
  - "Added wrap-queue.ts to ALLOWED list in logger-callsite-invariance.test.ts. The wrapper legitimately reads obsContext per D-02, mirroring the already-allowlisted wrap-cqrs-bus.ts (D-17) and wrap-event-bus.ts (D-15/D-16)."

requirements-completed: []  # CTX-04 + TRC-03 close on Plan 20-03 (in-process E2E test); Plan 20-02 ships only the wrapper code.

# Metrics
duration: ~50min
completed: 2026-04-26
---

# Phase 20 Plan 02: BullMQ Producer + Consumer Wrapper Summary

**JWT-style W3C trace propagation across BullMQ enqueue boundaries: wrapQueue producer + extended wrapProcessorWithAls consumer, wired via createQueue with zero edits to the four existing queue.add call sites.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-04-26T (Wave 2 spawn)
- **Tasks:** 2 (both committed atomically)
- **Files created:** 1 (wrap-queue.ts)
- **Files modified:** 8 + bun.lock
- **Commits:** 2 (Task 1: `72e2b57`, Task 2: `f6b066c`)

## Accomplishments

- Shipped `wrapQueue<Q extends Queue>(queue: Q): Q` at `packages/observability/src/wrappers/wrap-queue.ts` (153 lines) — the producer-side W3C carrier injector. Mirrors wrap-cqrs-bus.ts / wrap-event-bus.ts location and JSDoc style; uses `@opentelemetry/api` directly instead of the Tracer port (RESEARCH §382 — NoopSpan has no SpanContext under the port).
- Extended `wrapProcessorWithAls` in `packages/queue/src/index.ts` (now 163 lines) with the consumer-side extract path: `propagation.extract(ROOT_CONTEXT, job.data._otel ?? {})` → `context.with(parentCtx, () => tracer.startSpan(...))` so the consumer span inherits the producer's traceId; ALS seeded with carrier-derived `_tenantId`/`_userId`/`_requestId`.
- Wired `createQueue` to call `wrapQueue(q)` inside the factory body — the four existing `queue.add` call sites in auth/billing/example/observability inherit instrumentation transparently. **Zero edits** to those files (verified via `git diff HEAD~2 --` returning empty).
- Phase 19 fresh-fallback path preserved structurally: when `job.data._otel` is absent, `propagation.extract` returns `ROOT_CONTEXT` unchanged → consumer span opens with no parent → fresh `traceId`/`spanId` per RESEARCH §561-624 contract.

## Task Commits

| Task | Description | Hash | Files (key) |
|------|-------------|------|-------------|
| 1 | wrapQueue producer wrapper + observability barrel + queue deps | `72e2b57` | `packages/observability/src/wrappers/wrap-queue.ts` (NEW), `packages/observability/src/index.ts`, `packages/queue/package.json`, `packages/observability/package.json` |
| 2 | extend wrapProcessorWithAls + wire wrapQueue into createQueue | `f6b066c` | `packages/queue/src/index.ts` (MODIFIED), test files + ALLOWED-list update |

## RED→GREEN Transitions (7 tests, all GREEN)

| File | Test | Plan 20-01 state | Plan 20-02 state |
|------|------|------------------|------------------|
| `carrier-roundtrip.test.ts` | Test 1 — producer injects valid traceparent + flat ALS fields | RED (Export not found: wrapQueue) | **GREEN** |
| `carrier-roundtrip.test.ts` | Test 2 — worker reconstitutes producer traceId | RED (same) | **GREEN** |
| `carrier-roundtrip.test.ts` | Test 3 — D-09 no-ALS short-circuit | RED (same) | **GREEN** |
| `carrier-roundtrip.test.ts` | Test 4 — D-04 tracestate forwarding | RED (same) | **GREEN** |
| `carrier-roundtrip.test.ts` | Test 5 — D-10 per-attempt sibling spans | RED (same) | **GREEN** |
| `create-worker-als.test.ts` | Test 10 — _otel seeds inner ALS traceId | RED (extract not implemented) | **GREEN** |
| `create-worker-als.test.ts` | Test 11 — _tenantId/_userId from job.data | RED (same) | **GREEN** |

Phase 19 Tests 1-9 + Test 12 (fresh-fallback regression guard) — all stayed GREEN byte-for-byte.

## Test Suite State at Plan Close

| Suite | Pass | Fail | Notes |
|-------|------|------|-------|
| `packages/queue/` | 31/31 | 0 | 12 create-worker-als + 5 carrier-roundtrip + 14 queue.test.ts |
| `packages/observability/` | 205/205 | 0 | No regressions in Phase 17/18/19 wrappers |
| `apps/api/` (related) | logger-callsite-invariance 3/3 | 0 | wrap-queue.ts added to ALLOWED list |

`apps/api/src/__tests__/entrypoints.test.ts:Worker entrypoint` is pre-existing-flaky (Bun-spawned worker subprocess depends on real Redis/Postgres in env; verified failing before any Plan 20-02 changes via `git stash` — out of scope per scope-boundary rules).

## wrapProcessorWithAls Extension — Diff Summary

**Lines preserved from Phase 19 (semantic):**
- Public signature: `(processor: Processor): Processor` UNCHANGED.
- Seed composition for `requestId`: prefers `data._requestId ?? crypto.randomUUID()` (Phase 19 D-05).
- `obsContext.run(jobCtx, () => processor(job, token))` is still the single ALS frame opening (Phase 19 invariant).
- Fresh-fallback observable behavior on absent carrier (Phase 19 Tests 4 + 12 guard).

**Lines added by Phase 20:**
- `propagation.extract(ROOT_CONTEXT, data._otel ?? {})` carrier extract.
- Outer `context.with(parentCtx, fn)` activates parent OTEL context for child span inheritance.
- `tracer.startSpan(`{queueName} process`, { kind: SpanKind.CONSUMER, attributes: {...} })` opens fresh consumer span per attempt (D-10).
- `messaging.bullmq.attempt = (job.attemptsMade ?? 0) + 1` consumer-only attribute.
- ALS `traceId`/`spanId` now sourced from `span.spanContext()` (carrier-inherited when present, fresh when not — same outcome shape).
- ALS `tenantId` / `userId` now seeded from `data._tenantId ?? null` / `data._userId ?? null` (was hard-null in Phase 19).
- Inner `context.with(trace.setSpan(parentCtx, span), () => obsContext.run(jobCtx, ...))` — RESEARCH anti-pattern §385: OTEL active context FIRST, ALS INSIDE.
- Span error path: `recordException + setStatus(ERROR) + throw` then `span.end()` in finally.

Net: ~30 lines added, 0 lines removed, signature preserved.

## Zero-Edit Invariant Evidence

```
$ git diff HEAD~2 -- \
    packages/modules/auth/src/auth.ts \
    packages/modules/billing/src/routes.ts \
    packages/modules/example/src/hooks/on-example-created.ts \
    packages/observability/src/lib/install-global-error-handlers.ts
(empty output)

$ grep -c "queue.add(" packages/modules/auth/src/auth.ts                                # 3 (password-reset, team-invite, magic-link)
$ grep -c "queue.add(" packages/modules/billing/src/routes.ts                           # 1 (process-webhook)
$ grep -c "queue.add(" packages/modules/example/src/hooks/on-example-created.ts         # 1 (example-process-followup)
```

All five enqueue call sites byte-for-byte unchanged. The wrap is fully transparent at the call boundary.

## Decisions Made

- **Use `@opentelemetry/api` directly in wrap-queue.ts, not the Tracer port.** RESEARCH §382 documented; inline JSDoc in wrap-queue.ts header explains the divergence from wrap-cqrs-bus.ts / wrap-event-bus.ts. The port returns a NoopTracer whose spans have INVALID_SPAN_CONTEXT (all zeros), and W3CTraceContextPropagator silently skips invalid contexts during inject — making the carrier empty.
- **Test setup must register THREE OTEL globals: propagator + tracer provider + context manager.** Plan 20-01 registered only the propagator. Without TracerProvider, `tracer.startSpan` returns NoopSpans (zero context). Without ContextManager, `context.with(parentCtx, fn)` is a no-op (consumer spans don't inherit). Documented inline in both test files via the `Plan 20-02 Rule 3 deviation:` comment block.
- **Add bullmq as direct dep of packages/observability.** PATTERNS.md line 236 framed this as "acceptable peer-dep"; here promoted to direct dep because Bun's workspace isolated installs don't expose transitive types from `@baseworks/queue` → `@baseworks/observability`. The runtime import is type-only, so this is a typing/devx fix not a behavioral change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Test infrastructure missing TracerProvider + ContextManager registration**

- **Found during:** Task 2 verification (running `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` after wrapper code was in place).
- **Issue:** Plan 20-01's RED tests registered `propagation.setGlobalPropagator(new W3CTraceContextPropagator())` in beforeAll but NOT a TracerProvider or ContextManager. With the implementation in place, `propagation.inject(trace.setSpan(active, span), carrier)` produced empty `_otel` carriers because `trace.getTracer().startSpan()` returned NoopSpans (INVALID_SPAN_CONTEXT). Additionally, `context.with(parentCtx, fn)` was a no-op without a registered ContextManager — consumer spans inside it didn't inherit the producer traceId.
- **Fix:** Added `@opentelemetry/sdk-trace-base ^2.7.0` and `@opentelemetry/context-async-hooks ^2.7.0` as direct deps of `packages/queue`. Modified the existing beforeAll blocks in both test files to register `BasicTracerProvider` + `AsyncLocalStorageContextManager`. Documented inline with the Plan 20-02 Rule 3 deviation comment block. Test contracts (assertions) untouched per Plan 20-01 hand-off rules.
- **Files modified:** `packages/queue/package.json`, `packages/queue/src/__tests__/carrier-roundtrip.test.ts`, `packages/queue/src/__tests__/create-worker-als.test.ts`, `bun.lock`.
- **Verification:** All 5 carrier-roundtrip tests + Tests 10/11 of create-worker-als pass after the fix; Phase 19 Tests 1-9 + Test 12 (fresh-fallback regression) also pass.
- **Committed in:** `f6b066c` (Task 2)

**2. [Rule 3 — Blocking] bullmq types not reachable from packages/observability**

- **Found during:** Task 1 verification (`bunx tsc --noEmit` flagged `Cannot find module 'bullmq' or its corresponding type declarations` in wrap-queue.ts).
- **Issue:** `wrap-queue.ts` does `import type { JobsOptions, Queue } from "bullmq"`, but bullmq was only a dep of `@baseworks/queue`, not `@baseworks/observability`. Bun's workspace isolated installs don't symlink transitive deps from a downstream package back into an upstream one.
- **Fix:** Added `bullmq ^5.0.0` to `packages/observability/package.json`. PATTERNS.md line 236 explicitly framed this as acceptable.
- **Files modified:** `packages/observability/package.json`, `bun.lock`.
- **Verification:** `bunx tsc --noEmit` no longer flags wrap-queue.ts.
- **Committed in:** `72e2b57` (Task 1)

**3. [Rule 1 — Bug] MockQueue in queue.test.ts lacked add/addBulk methods**

- **Found during:** Task 2 verification (running `bun test packages/queue/`).
- **Issue:** `createQueue` now wraps the constructed Queue via `wrapQueue(q)`, which calls `q.add.bind(q)` and `q.addBulk.bind(q)`. The Phase 19-era MockQueue declared neither method, so wrapping crashed with `TypeError: undefined is not an object (evaluating 'queue.add.bind')` — breaking 5 pre-existing tests in `queue.test.ts` that exercised createQueue config (name + opts assertions).
- **Fix:** Added inert async stubs `add(name, data, opts) → { id, name, data }` and `addBulk(jobs) → jobs.map(...)`  to MockQueue. Tests assert only on `queue.name` and `queue.opts.defaultJobOptions`, so the stubs are semantically transparent.
- **Files modified:** `packages/queue/src/__tests__/queue.test.ts`.
- **Verification:** All 14 queue.test.ts tests pass.
- **Committed in:** `f6b066c` (Task 2)

**4. [Rule 2 — Auto-add] wrap-queue.ts missing from logger-callsite-invariance ALLOWED list**

- **Found during:** Task 2 verification (running `bun test apps/api/`).
- **Issue:** `apps/api/__tests__/logger-callsite-invariance.test.ts` enforces a whitelist of files allowed to read `obsContext.getStore()` directly (CTX-03 invariant from Phase 19). The new `wrap-queue.ts` legitimately reads `obsContext.getStore()` at the producer-side wrap to read `requestId`/`tenantId`/`userId` from the active ALS frame (D-02), but wasn't in the whitelist.
- **Fix:** Added `"packages/observability/src/wrappers/wrap-queue.ts"` to the ALLOWED set with comment `// Phase 20 D-02 — producer carrier inject from ALS`. Mirrors the precedent of wrap-cqrs-bus.ts (D-17) and wrap-event-bus.ts (D-15/D-16) which were already allowlisted.
- **Files modified:** `apps/api/__tests__/logger-callsite-invariance.test.ts`.
- **Verification:** All 3 logger-callsite-invariance tests pass.
- **Committed in:** `f6b066c` (Task 2)

---

**Total deviations:** 4 (1 Rule 1 bug fix, 2 Rule 3 blockers, 1 Rule 2 auto-add) — all required to make Plan 20-01's tests achievable.

## Issues Encountered

- The `_otel`-carrier-empty failure mode initially looked like a wrap-queue.ts bug — the actual cause was the missing TracerProvider in tests (NoopTracer's `INVALID_SPAN_CONTEXT` is silently filtered by W3CTraceContextPropagator on inject). Confirmed via 3-line standalone Bun script before patching.
- The `Test 5 D-10` failure (consumer trace IDs not matching across attempts) had a different root cause — even with TracerProvider registered, `context.with(parentCtx, fn)` was a no-op without an explicit ContextManager. The OTEL JS API requires both for parent inheritance through `context.with`. Verified via second standalone Bun script before patching.

## Hand-off to Plan 20-03

Plan 20-03 will ship the in-process API→worker E2E test (`apps/api/__tests__/observability-bullmq-trace.test.ts`, D-08) that asserts producer-log `traceId === worker-log traceId`.

**Reusable from this plan for Plan 20-03:**

| Reusable artifact | Source | Why useful for 20-03 |
|---|---|---|
| `BasicTracerProvider + AsyncLocalStorageContextManager + W3CTraceContextPropagator` beforeAll setup | `packages/queue/src/__tests__/carrier-roundtrip.test.ts` lines 39-58 | Plan 20-03's E2E test needs the same OTEL global setup so producer + consumer span contexts are real and inheritance through `context.with` works. Copy the block verbatim. |
| `buildStubQueue(name) → { queue, calls }` | Plan 20-01 carrier-roundtrip.test.ts | The E2E test mounts an Elysia route that calls `wrappedQueue.add(...)` — use buildStubQueue (or a slim variant) to capture the recorded carrier without booting Redis. |
| `fakeJob(data, attemptsMade?)` | Plan 20-01 (used by both Phase-20 test files) | Replay the captured producer carrier through wrapProcessorWithAls(processor)(fakeJob(recordedData), token) so the inner ALS observed by the worker processor can be inspected. |
| Pino mixin + test-stream pattern | `apps/api/__tests__/observability-context-bleed.test.ts` (Phase 19) | The single-trace assertion needs producer-log `traceId` and worker-log `traceId` from the same captured stream. Phase 19's pino-stream pattern is the canonical shape; reuse it directly. |
| Direct otel deps on packages/queue | `packages/queue/package.json` | apps/api will need similar setup (api/core already direct deps; sdk-trace-base + context-async-hooks may be needed if the test setup mirrors carrier-roundtrip's). |

**Plan 20-03 should NOT need to modify wrap-queue.ts or wrapProcessorWithAls** — the contracts they implement satisfy D-02, D-04, D-05, D-06, D-07, D-09, D-10. If 20-03 finds a behavioral gap, it's a 20-CONTEXT.md re-discussion item, not a wrapper edit.

## Self-Check: PASSED

**Created files exist:**
- FOUND: `packages/observability/src/wrappers/wrap-queue.ts` (153 lines)
- FOUND: `.planning/phases/20-bullmq-trace-propagation/20-02-SUMMARY.md` (this file)

**Modified files exist with expected content:**
- FOUND: `packages/observability/src/index.ts` — `export { wrapQueue }` line present
- FOUND: `packages/queue/src/index.ts` — `wrapQueue(q)` + `propagation.extract(ROOT_CONTEXT, carrierIn)` + `context.with(parentCtx` lines all present
- FOUND: `packages/queue/package.json` — @opentelemetry/{api,core,semantic-conventions,sdk-trace-base,context-async-hooks} deps all present
- FOUND: `packages/observability/package.json` — bullmq dep present
- FOUND: `apps/api/__tests__/logger-callsite-invariance.test.ts` — `packages/observability/src/wrappers/wrap-queue.ts` in ALLOWED set

**Commits exist:**
- FOUND: `72e2b57` (Task 1 — feat(20-02): wrapQueue producer wrapper + observability barrel + queue deps)
- FOUND: `f6b066c` (Task 2 — feat(20-02): extend wrapProcessorWithAls + wire wrapQueue into createQueue)

**Acceptance criteria spot-checks (Task 1):**
- `grep -c "export function wrapQueue" packages/observability/src/wrappers/wrap-queue.ts` = 1 ✓
- `grep -c "propagation.inject(trace.setSpan(context.active(), span), carrier)" packages/observability/src/wrappers/wrap-queue.ts` = 2 (one in .add, one in addBulk per-item map) ✓
- `grep -c "if (!store)" packages/observability/src/wrappers/wrap-queue.ts` = 2 ✓
- `grep -c "kind: SpanKind.PRODUCER" packages/observability/src/wrappers/wrap-queue.ts` = 2 ✓
- `grep -c "messaging.batch.message_count" packages/observability/src/wrappers/wrap-queue.ts` = 1 ✓
- `grep -c "messaging.bullmq.attempt" packages/observability/src/wrappers/wrap-queue.ts` = 0 ✓ (consumer-only)
- `grep -c "span.recordException" packages/observability/src/wrappers/wrap-queue.ts` = 2 ✓
- `grep -c "span.end()" packages/observability/src/wrappers/wrap-queue.ts` = 2 ✓
- `grep -c 'getTracer.*from "../factory"' packages/observability/src/wrappers/wrap-queue.ts` = 0 ✓ (CRITICAL — uses @opentelemetry/api directly)
- `grep -c "export { wrapQueue }" packages/observability/src/index.ts` = 1 ✓

**Acceptance criteria spot-checks (Task 2):**
- `grep -c "wrapQueue," packages/queue/src/index.ts` = 1 ✓
- `grep -c "wrapQueue(q)" packages/queue/src/index.ts` = 1 ✓
- `grep -c "propagation.extract(ROOT_CONTEXT, carrierIn)" packages/queue/src/index.ts` = 1 ✓
- `grep -c "context.with(parentCtx" packages/queue/src/index.ts` = 1 ✓
- `grep -c "context.with(trace.setSpan(parentCtx, span)" packages/queue/src/index.ts` = 1 ✓
- `grep -c "obsContext.run(jobCtx" packages/queue/src/index.ts` = 1 ✓ (single ALS opening — Phase 19 invariant)
- `grep -c "kind: SpanKind.CONSUMER" packages/queue/src/index.ts` = 1 ✓
- `grep -c "(job.attemptsMade ?? 0) + 1" packages/queue/src/index.ts` = 1 ✓
- `grep -c "trace.getTracer(CONSUMER_TRACER_NAME)" packages/queue/src/index.ts` = 1 ✓

**Test results:**
- `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` → 5/5 pass ✓
- `bun test packages/queue/src/__tests__/create-worker-als.test.ts` → 12/12 pass ✓
- `bun test packages/queue/` → 31/31 pass ✓
- `bun test packages/observability/` → 205/205 pass ✓
- Zero-edit invariant: `git diff HEAD~2 -- {auth,billing,example,observability lib}` → empty ✓

---

*Phase: 20-bullmq-trace-propagation*
*Plan: 02*
*Completed: 2026-04-26*
