---
phase: 19-context-logging-http-cqrs-tracing
plan: 07
subsystem: observability / queue / worker-entrypoint
wave: 3
completed: 2026-04-23
tags: [observability, queue, worker, als, wrapEventBus, D-05, D-16]
requires:
  - "@baseworks/observability:obsContext"
  - "@baseworks/observability:wrapEventBus"
  - "@baseworks/observability:getTracer"
  - "@baseworks/i18n:defaultLocale"
  - "apps/api/src/core/registry.ts:getEventBus"
provides:
  - "packages/queue/src/index.ts:wrapProcessorWithAls (internal helper)"
  - "packages/queue/src/index.ts:createWorker wraps every job in obsContext.run frame"
  - "apps/api/src/worker.ts:wrapEventBus wired next to wrapCqrsBus"
affects:
  - "All BullMQ workers constructed via createWorker (currently the example + billing modules)"
  - "Worker-side logger mixin now carries requestId/traceId/spanId during job execution"
  - "Worker-side CQRS dispatches inherit the job ALS frame (via Plan 04 wrapCqrsBus)"
tech-stack:
  added:
    - "@baseworks/i18n as workspace dep of @baseworks/queue"
    - "@baseworks/observability as workspace dep of @baseworks/queue"
  patterns:
    - "Central factory wrap (Pitfall 5) — ALS seed lives once at the createWorker boundary, not at each call site"
    - "Internal-helper extraction for testability (wrapProcessorWithAls) — isolates ALS logic from real Worker + Redis construction"
    - "External wrapper discipline (TRC-02) — wrapEventBus mutates the EventBus from the outside; zero edits to apps/api/src/core/event-bus.ts"
key-files:
  created:
    - "packages/queue/src/__tests__/create-worker-als.test.ts"
  modified:
    - "packages/queue/src/index.ts"
    - "packages/queue/package.json"
    - "apps/api/src/worker.ts"
    - ".planning/phases/19-context-logging-http-cqrs-tracing/deferred-items.md"
decisions:
  - "Chose Path A (test wrapProcessorWithAls directly) over Path B (module-mock bullmq) — cleaner unit test, no Redis dependency, matches Plan 04 recording-mock philosophy"
  - "Exported wrapProcessorWithAls with @internal JSDoc — keeps it available to tests without promising a public API"
  - "Logged packages/queue/tsconfig.json rootDir conflict to deferred-items.md rather than fixing — out-of-scope tooling issue unrelated to Phase 19 deliverables"
metrics:
  duration_minutes: 22
  tasks_completed: 2
  files_touched: 4
  tests_added: 9
  commits:
    - "ed79119 test(19-07): RED — ALS seed tests"
    - "183c642 feat(19-07): GREEN — createWorker ALS wrap + deps"
    - "5cf5a44 feat(19-07): wrapEventBus in worker.ts"
---

# Phase 19 Plan 07: Worker-Side ALS + EventBus Tracing Summary

**One-liner:** `createWorker` now wraps every BullMQ job processor in a seeded `obsContext.run(jobCtx, …)` frame (D-05 central seed), and `apps/api/src/worker.ts` gains a one-line `wrapEventBus(registry.getEventBus(), getTracer())` mirroring Plan 06's HTTP-side wire-up (D-16).

## What Shipped

### 1. `packages/queue/src/index.ts::wrapProcessorWithAls` + `createWorker`

The central worker-side ALS seed point for the entire codebase. `createWorker` now routes every processor through an internal `wrapProcessorWithAls` helper that opens a fresh `ObservabilityContext` frame per job invocation:

```ts
const jobCtx: ObservabilityContext = {
  requestId: (job.data as any)?._requestId ?? crypto.randomUUID(),
  traceId: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
  spanId: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
  locale: defaultLocale,
  tenantId: null,
  userId: null,
};
return obsContext.run(jobCtx, () => processor(job, token));
```

**Public signature UNCHANGED** — `createWorker(name: string, processor: Processor, redisUrl: string, opts?: WorkerConfig): Worker`. Every existing caller (`apps/api/src/worker.ts` line 49 loop) works without edits. The Task 1 diff shows the signature line is byte-equal pre vs post; only the body is different (wraps the processor) + a new sibling helper was added.

### 2. `@baseworks/queue` workspace deps

`package.json` now declares `@baseworks/i18n` + `@baseworks/observability` as workspace deps (it previously had neither — was a bullmq-only package). Required to import `obsContext` + `defaultLocale` + `ObservabilityContext` inside `src/index.ts`.

### 3. `apps/api/src/worker.ts` EventBus tracing wire-up (D-16)

Two-edit surgical change:
- Extended the `@baseworks/observability` barrel import with `getTracer` + `wrapEventBus`.
- Inserted `wrapEventBus(registry.getEventBus(), getTracer())` ONE line below the existing `wrapCqrsBus(registry.getCqrs(), getErrorTracker())` call at line 41 — with a Phase 19 comment explaining the D-16 invariant.

The worker loop at lines 49-68 and the `worker.on("failed", ...)` handler at lines 70-82 are byte-equal pre vs post — Task 1's queue-level wrap means `worker.ts` needs no `obsContext.run(...)` calls of its own.

## Chosen Wrap Path: A (queue-package central wrap)

The plan offered two paths for where to seed worker ALS:
- **Path A (queue package / createWorker)** — `RESEARCH.md` Pitfall 5 recommendation. Structural guarantee: no caller can construct a BullMQ Worker through `createWorker` and forget the seed.
- **Path B (app layer — wrap inside worker.ts's inner processor)** — convention-based, requires remembering the wrap at every callsite.

Took Path A. Rationale: treats the ALS-seed invariant as a type-system/factory-level guarantee rather than a convention. `T-19-ALS-4` (cross-job ALS bleed) becomes structurally impossible rather than "we tested for it once". The `wrapProcessorWithAls` extraction also gives Task 1 a clean unit-testable surface — the 9 tests hit the helper directly without constructing a real BullMQ Worker + Redis connection.

## Fake-Job Test Shape (reusable for Phase 20)

Tests use this shape to drive the wrapper without a real BullMQ job:

```ts
const fakeJob = (data: any = {}) => ({ id: "fake-id", name: "fake-name", data }) as any;
const wrapped = wrapProcessorWithAls(processor);
await wrapped(fakeJob({ _requestId: "from-api-request" }), "fake-token");
```

Phase 20's enqueue propagation tests can reuse this pattern — build a fake job with a `_requestId` field and pass it straight to `wrapProcessorWithAls(processor)` to assert end-to-end request-id propagation from enqueue-side to worker-side without touching Redis.

## W1 Behavioral Regression Guard

Task 2's verify step re-runs the Plan 04 wrap-event-bus suite (`packages/observability/src/wrappers/__tests__/wrap-event-bus.test.ts`). Confirms:
- `registry.getEventBus()` returns an instance with the expected EventBus-like shape.
- `wrapEventBus` signature hasn't drifted since Plan 04.
- `emit`/`on` pass-through + span emission semantics are intact.

Outcome: **9/9 passing** at Task 2 verify time. Registry singleton identity is stable — the same EventBus instance is wired on both the API side (Plan 06, wave 3 sibling) and the worker side (Plan 07, this plan).

## Verification Evidence

| Check | Command | Result |
|-------|---------|--------|
| D-05 key-link | `grep -c "obsContext.run" packages/queue/src/index.ts` | 1 |
| D-16 key-link | `grep -c "wrapEventBus" apps/api/src/worker.ts` | 2 (import + call) |
| Workspace deps | `grep -c "@baseworks/\(observability\|i18n\)" packages/queue/package.json` | 2 |
| ALS seed tests | `bun test packages/queue/src/__tests__/create-worker-als.test.ts` | 9/9 pass |
| Full queue suite | `bun test packages/queue/` | 23/23 pass (14 existing + 9 new) |
| W1 regression guard | `bun test packages/observability/src/wrappers/__tests__/wrap-event-bus.test.ts` | 9/9 pass |
| Wrapper suites | `bun test packages/observability/src/wrappers/__tests__/` | 24/24 pass |

## Deviations from Plan

None — plan executed exactly as written. Path A was the plan-recommended choice; the `wrapProcessorWithAls` extraction shape matches the plan's `<action>` block for Task 1 Step 3. Task 2's two surgical edits match the plan byte-for-byte.

One out-of-scope tooling observation was logged to `deferred-items.md` (not a deviation — a pre-existing issue):
- `packages/queue/tsconfig.json` has `rootDir: "./src"` which conflicts with cross-package source imports when running `tsc -p packages/queue/tsconfig.json` directly. Root `tsc --noEmit` works fine. Out-of-scope for Phase 19; deferred to a future tooling cleanup.

## Known Stubs

None. `tenantId` + `userId` are intentionally null at job-seed time — job handlers that want tenant-scoped behavior should look up tenant from `job.data` and call `setTenantContext(...)` inside the handler (same pattern as the HTTP-side `tenantMiddleware` from Plan 06). This is documented in the `wrapProcessorWithAls` JSDoc.

## Threat Flags

None. The Phase 19 threat register (T-19-ALS-4, T-19-ALS-5, T-19-TRC-6, T-19-TRC-7) is the complete surface for this plan — no new trust boundaries introduced.

## Handoff Notes for Phase 20

- Phase 20 enqueue-side work needs to inject `_requestId` into `job.data` when enqueuing from inside an active HTTP request frame (read `getObsContext()?.requestId` and attach). Task 1's `wrapProcessorWithAls` will forward it automatically.
- Phase 20 can also consider widening the seed to include `inboundCarrier` (W3C traceparent) for end-to-end trace propagation API → queue → worker. The current seed is propagation-ready — just add a `traceparent` field to job.data on enqueue and the worker wrap can extract it.
- The `fakeJob` test shape above is ready to be promoted to a shared test helper if Phase 20 ends up asserting end-to-end propagation.

## Self-Check: PASSED

Verified:
- `packages/queue/src/__tests__/create-worker-als.test.ts` — FOUND
- `packages/queue/src/index.ts` — FOUND (contains `wrapProcessorWithAls` + `obsContext.run`)
- `packages/queue/package.json` — FOUND (contains `@baseworks/observability` + `@baseworks/i18n`)
- `apps/api/src/worker.ts` — FOUND (contains `wrapEventBus(registry.getEventBus(), getTracer())`)
- Commit `ed79119` (RED) — FOUND in git log
- Commit `183c642` (GREEN + deps) — FOUND in git log
- Commit `5cf5a44` (wrapEventBus in worker.ts) — FOUND in git log
