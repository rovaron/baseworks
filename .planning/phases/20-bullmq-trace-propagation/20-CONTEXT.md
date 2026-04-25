# Phase 20: BullMQ Trace Propagation - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Inject W3C `traceparent` (and optional `tracestate`) into every BullMQ enqueue, plus `requestId`, `tenantId`, and `userId` from the producer's ALS frame, so that workers reconstitute the producer's trace context on job pickup and emit a consumer span as a child of the producer's enqueue span. Producer-side injection lands as an internal upgrade of `createQueue` in `packages/queue` (zero edits to the four current `queue.add(...)` call sites in auth / billing / example / observability). Worker-side extraction extends the existing `wrapProcessorWithAls` (Phase 19 D-05) to seed the ALS frame from the carrier when present; the fresh-fallback path stays unchanged. Delivers CTX-04, TRC-03. Acceptance: a `bun test` smoke test gates the carrier round-trip on every PR (SC#3); an in-process API→worker test asserts producer-log `traceId` equals worker-log `traceId` (SC#2 sans Tempo verification, deferred to Phase 21).

The real OTEL exporter, Grafana stack, and Tempo verification ship in Phase 21. Drizzle/postgres.js DB-level spans remain deferred (TRC-future-01). The `@appsignal/opentelemetry-instrumentation-bullmq` package is **not** installed — see D-01.

</domain>

<decisions>
## Implementation Decisions

### Instrumentation strategy

- **D-01:** **Hand-rolled W3C propagator.** Use `@opentelemetry/api` `propagation.inject(context.active(), carrier)` and `propagation.extract(context.active(), carrier)` directly inside the queue wrapper. Do NOT install `@appsignal/opentelemetry-instrumentation-bullmq` in Phase 20. Rationale: deterministic, ~30 lines of code, Bun-safe (no prototype patching), aligns with Phase 17 D-12 (instrumentation list deliberately excludes `bullmq`) and ARCHITECTURE.md §874 ("explicit hand-rolled wrappers for Elysia, Drizzle, BullMQ"). Phase 21 may revisit the AppSignal instrumentation when a real OTEL exporter exists and span output can be inspected — Phase 20 must not couple correctness to a 3rd-party patch's Bun compatibility.

### Producer-side injection mechanism

- **D-02:** **Wrap the `Queue` instance inside `createQueue()`.** `createQueue(name, redisUrl)` returns an object whose `.add(...)` and `.addBulk(...)` methods auto-inject the carrier from the current ALS frame. Mirrors the Phase 19 D-05 pattern (`wrapProcessorWithAls`) on the symmetric producer side. **Zero call-site edits** across the four current enqueue sites:
  - `packages/modules/auth/src/auth.ts` (password-reset / team-invite / magic-link)
  - `packages/modules/billing/src/routes.ts` (webhook normalized event)
  - `packages/modules/example/src/hooks/on-example-created.ts` (example-process-followup)
  - `packages/observability/src/lib/install-global-error-handlers.ts` (top-level error capture enqueue)
  Repeatable jobs (e.g., billing `sync-usage`) and delayed jobs are covered automatically because `Queue.add` is the only enqueue surface. The wrapped object preserves the BullMQ Queue surface (TypeScript type, methods, internals) — planner picks between Proxy, subclass, or hand-written wrapper class based on TS-inference cleanliness. No `enqueue()` helper is introduced; `queue.add` stays the call-site pattern.

### Carrier shape

- **D-03:** **Mixed shape — `_otel` envelope for W3C propagation carrier + flat top-level fields for ALS-derived context.** On `job.data`:
  ```ts
  {
    ...userPayload,
    _otel: { traceparent: "00-...", tracestate?: "..." }, // pure W3C carrier consumed by propagation.inject/extract
    _requestId: "...",   // top-level, back-compat with Phase 19 wrapProcessorWithAls fallback path
    _tenantId: "..." | null,
    _userId: "..." | null,
  }
  ```
  Worker reads each field independently — no nested-shape coupling. Phase 19's `wrapProcessorWithAls` reads `job.data._requestId` today and **does not change** (Phase 20 only adds reads for `_otel`, `_tenantId`, `_userId`). The `_otel` envelope keeps `propagation.inject(context.active(), envelope)` working without an adapter. Reserved for future propagation extras (baggage, etc.); `tracestate` lands in Phase 20 (D-04) but stays under `_otel` so the OTEL API drives the shape, not us.

- **D-04:** **Forward `tracestate` when present in active context.** `propagation.inject` writes `tracestate` into the carrier whenever the active context carries vendor-specific trace state. **Explicit divergence from Phase 19's minimal-carrier deferral** (Phase 19 §"Deferred Ideas" → tracestate). Rationale: cross-process boundary preserves vendor context for any operator running with a vendor-aware exporter (Datadog, Honeycomb, etc. via Phase 21 OTEL collector). Cost is negligible — one optional string field, only set when present upstream. Phase 19 docs to update during Phase 20 planning: roadmap deferral note can be marked "shipped in Phase 20."

### Worker-side parent semantics + ALS reconstitution

- **D-05:** **Worker process span is a child of the producer enqueue span via `context.with(parentCtx, ...)`.** The upgraded `wrapProcessorWithAls` (extension of Phase 19 D-05) now:
  1. Extracts `parentCtx = propagation.extract(ROOT_CONTEXT, job.data._otel ?? {})`.
  2. If extraction yields a valid `SpanContext`: opens the consumer span inside `context.with(parentCtx, () => tracer.startSpan('{queue.name} process', { kind: SpanKind.CONSUMER, ...attrs }))`. The new span inherits the producer's `traceId`; its `spanId` is fresh; its `parentSpanId` references the producer enqueue span.
  3. If extraction yields no valid context (carrier absent — the no-ALS-frame producer path, D-09): falls back to Phase 19 behavior — fresh `traceId`/`spanId` generated locally; consumer span opens with no parent (orphan trace).
  4. Seeds the ALS frame with `requestId` (from `job.data._requestId`, falling back to fresh — Phase 19 path), `tenantId` (from `job.data._tenantId ?? null`), `userId` (from `job.data._userId ?? null`), `traceId`/`spanId` from the consumer span just opened.
  5. Runs `obsContext.run(jobCtx, () => processor(job, token))`.
  Worker-side fresh-fallback path (Phase 19 D-05) is preserved byte-for-byte — Phase 20 only **adds** the carrier-extract branch; existing behavior on Phase 19's tests stays green.

- **D-06:** **Producer enqueue span is opened inside `wrappedQueue.add()`.** The wrapper:
  1. Reads `obsContext.getStore()`. If undefined → D-09 path (no injection).
  2. Else: opens a producer span via `tracer.startSpan('{queue.name} publish', { kind: SpanKind.PRODUCER, ...attrs })`.
  3. Injects via `propagation.inject(trace.setSpan(context.active(), producerSpan), carrier)` so the `traceparent` written into `_otel` references the producer span (not the request span — the worker becomes a child of `publish`, not of the HTTP request directly; the HTTP request remains the grandparent in the trace tree).
  4. Copies `requestId`, `tenantId`, `userId` from the ALS frame into top-level `job.data._requestId/_tenantId/_userId`.
  5. Calls the underlying `Queue.add(name, dataWithCarrier, opts)`.
  6. Awaits the result, then `producerSpan.end()`. On rejection: `recordException` + `setStatus({ code: 'error' })` then rethrow.

### Span naming + attributes (OTEL messaging semantic conventions)

- **D-07:** **Full OTEL messaging semantic conventions:**
  - Producer span name: `{queue.name} publish`, `kind=PRODUCER`
  - Consumer span name: `{queue.name} process`, `kind=CONSUMER`
  - Common attributes (both):
    - `messaging.system = "bullmq"`
    - `messaging.destination.name = <queueName>`
    - `messaging.operation = "publish"` (producer) / `"process"` (consumer)
    - `messaging.message.id = <jobId>`
  - Consumer-only attributes (set at processor invocation):
    - `messaging.bullmq.attempt = job.attemptsMade + 1` (1-indexed for human readability)
    - `tenant.id`, `user.id`, `request.id` from ALS at span-end (parallel to Phase 19 D-13 HTTP attribute set)
  - Phase 21 RED metrics will use OTEL `View` to drop `messaging.message.id` from metric labels (cardinality guard, Pitfall 4). Phase 20 emits the attribute on spans but does not implement the View — Phase 21 territory.

### No-ALS-frame enqueue behavior

- **D-09:** **Skip carrier injection when `obsContext.getStore()` is undefined.** No `_otel`, `_requestId`, `_tenantId`, or `_userId` written. Worker-side `wrapProcessorWithAls` falls through to Phase 19's fresh-trace path — orphan from any producer, but a valid trace inside the worker. Affected today:
  - `packages/observability/src/lib/install-global-error-handlers.ts` — global error capture may enqueue from a context outside any request frame (e.g., during `process.on('uncaughtException')`).
  - BullMQ scheduler-driven repeatable jobs (e.g., `billing/sync-usage`) — re-enqueue happens inside BullMQ internals, not inside `obsContext.run`.
  - Startup tasks / migrations — same.
  Worker logs for these jobs still emit `traceId`/`spanId` (worker-side fresh) and `requestId` (worker-side fresh) — the trace just doesn't link back to a producer. Acceptable for v1.3.

### Retry attempt span semantics

- **D-10:** **Each retry attempt opens a fresh consumer span; all attempts share the producer enqueue span as parent.** BullMQ invokes the processor function once per attempt; `wrapProcessorWithAls` runs each invocation through D-05's extract-then-open path. Result in Tempo: producer `publish` span has N child `process` spans (siblings, one per attempt), each with its own timing and `messaging.bullmq.attempt` attribute. Final attempt that fails terminally surfaces `span.setStatus({ code: 'error' })` + `recordException` (already emitted today by Phase 18 `worker.on('failed')`; Phase 20 adds the per-attempt span layer above it).

### Smoke test + merge gate (SC#3)

- **D-07b:** **In-process fake-job round-trip smoke test.** New file `packages/queue/src/__tests__/carrier-roundtrip.test.ts`:
  - Test 1: `obsContext.run({ traceId: KNOWN_TRACE_ID, ... }, async () => wrappedQueue.add('test-job', { foo: 1 }))` — capture the recorded payload via a stubbed `Queue.add`. Assert `recorded.data._otel.traceparent` exists; parse the W3C format; assert traceId matches `KNOWN_TRACE_ID`. Assert `_requestId`, `_tenantId`, `_userId` set per ALS.
  - Test 2: take that recorded payload, build a fakeJob (Phase 19 helper shape), invoke `wrapProcessorWithAls(processor)(fakeJob)`. Capture inner ALS via `getObsContext()`. Assert `inner.traceId === KNOWN_TRACE_ID` and `inner.requestId === ALS.requestId` and `inner.tenantId === ALS.tenantId`.
  - Test 3: no-ALS path — call `wrappedQueue.add` outside `obsContext.run`; assert recorded payload has no `_otel`, no `_requestId`/`_tenantId`/`_userId`. Assert worker-side `wrapProcessorWithAls(processor)(fakeJob)` falls through to Phase 19 fresh-trace path (different traceId, fresh requestId).
  - Test 4: tracestate forwarding — when injected context carries `tracestate`, assert `recorded.data._otel.tracestate` is set.
  - Test 5: retry attempt — invoke `wrapProcessorWithAls` twice with the same fakeJob (mutate `attemptsMade`). Assert two distinct `spanId` values; the consumer-span recorder confirms parent_spanId equals the producer span across both invocations.
  No Redis. No real Worker. Runs on every `bun test`. Gates the carrier shape and the parent-child relationship as merge prerequisites.

- **D-08:** **In-process API→worker E2E single-trace assertion (SC#2).** New file `apps/api/__tests__/observability-bullmq-trace.test.ts`:
  - Mount a slim Elysia app (or full app) with a route that calls `wrappedQueue.add(...)` (e.g., trigger `auth/forgot-password` to enqueue `password-reset`).
  - Stub the underlying `Queue.add` to capture the recorded carrier (no Redis).
  - Assert producer-side log line (captured via pino test transport, like Phase 19 bleed test) carries `traceId === T_PRODUCER`.
  - Take the captured carrier, build a fakeJob, invoke `wrapProcessorWithAls(processor)(fakeJob)` where `processor` does `logger.info('worker side')`.
  - Assert worker-side log line carries `traceId === T_PRODUCER` and `requestId === R_PRODUCER` and `tenantId === ALS.tenantId`.
  Tempo verification (the literal "in Tempo" wording of SC#2) is **deferred to Phase 21** acceptance, when the real OTEL exporter exists and a Tempo backend can be inspected. Phase 20 SC#2 is satisfied at the trace-data level by this in-process test.

### Claude's Discretion

- Exact wrapper mechanism for `Queue` (Proxy vs subclass vs `Object.assign(new Queue(...), { add: wrappedAdd })`) — planner picks based on TypeScript inference cleanliness for `Queue.add` overloads (`add(name, data)` and `add(name, data, opts)` and `addBulk([...])`).
- Where the propagator/extractor helper lives: inline in `packages/queue/src/index.ts` vs extracted to `packages/observability/src/wrappers/wrap-queue.ts` (mirrors `wrap-cqrs-bus.ts`/`wrap-event-bus.ts`). The latter keeps `packages/queue` thin and consolidates "wrapper" code in one package; the former minimizes cross-package wiring.
- Whether `_otel` is removed from `job.data` before passing the (`data`) to user processors — defensive, prevents downstream code from reading internal fields. Or kept alongside payload (simpler, current `_requestId` already lives at top level).
- Exact attribute key for `messaging.bullmq.attempt` — OTEL conventions don't standardize a BullMQ-specific key; planner verifies whether `messaging.system_specific.attempt` or `messaging.bullmq.attempt` is the conventional shape.
- Whether the producer span is opened/closed synchronously around `Queue.add(...)` (await + end) or fire-and-forget. Synchronous is recommended for accurate enqueue-latency measurement; planner confirms.
- Concrete propagation API: `propagation.inject(ctx, carrier)` mutates `carrier` in place (it's the OTEL standard). Planner confirms the carrier shape passed in is a plain `Record<string, string>` and that the resulting `_otel` field is exactly that record. Alternative: dedicated `setter`/`getter` shapes (rarely needed for object carriers).
- Whether to also forward `locale` from the ALS frame onto the carrier (Phase 19 D-12 unified `locale` into `obsContext`; jobs currently use `defaultLocale` at seed). Out-of-scope clarification: NOT required by SC; can be added trivially later without breaking API.

### Folded Todos

None — `gsd-tools list-todos` returned 0 matches at discussion time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone & requirements
- `.planning/milestones/v1.3-ROADMAP.md` §"Phase 20: BullMQ Trace Propagation" — Goal, Depends on (Phase 19), requirements (CTX-04, TRC-03), 4 Success Criteria. Every Phase 20 plan must trace back to those.
- `.planning/REQUIREMENTS.md` §CTX-04 (BullMQ enqueue wrap inject + worker reconstitute via `obsContext.run`) and §TRC-03 (BullMQ enqueue + process instrumented with W3C context propagation; smoke test as merge gate).
- `.planning/PROJECT.md` — Vision and hard constraints (Bun-only; Elysia + Eden Treaty; modular backend pattern; BullMQ + Redis as the only queue system).

### Research & pitfalls (Phase 20 specific)
- `.planning/research/PITFALLS.md` §"Pitfall 2: BullMQ trace context not injected" (lines ~38–73) — the exact playbook this phase implements: prefer `@appsignal/opentelemetry-instrumentation-bullmq` if it works under Bun, else hand-roll via `propagation.inject`/`extract` with `_otel` carrier; bake into a single helper; literal test that producer traceId equals worker traceId. Phase 20 D-01 explicitly chooses hand-rolled.
- `.planning/research/PITFALLS.md` §"Pitfall 3: AsyncLocalStorage leaking" — drives the pattern of "wrap every BullMQ processor with `withJobContext(job, fn)`" — Phase 19 already realized this as `wrapProcessorWithAls`; Phase 20 extends the same wrapper with carrier extraction.
- `.planning/research/PITFALLS.md` §"Pitfall 4: High-cardinality metric labels" — drives the Phase 21 deferral of OTEL `View` cardinality caps. Phase 20 emits `messaging.message.id` (jobId) on spans but flags Phase 21 must drop it from metrics.
- `.planning/research/STACK.md` §"BullMQ instrumentation" (rows for `@appsignal/opentelemetry-instrumentation-bullmq`) — STACK.md row 19 + 49 + 100 + 123 + 176 + 230 + 247 + 272. MEDIUM Bun-compat risk flagged. Phase 20 D-01 elects hand-rolled; library may revisit in Phase 21.
- `.planning/research/ARCHITECTURE.md` §874 — "explicit hand-rolled wrappers for Elysia, Drizzle, BullMQ" architectural stance.
- `.planning/research/SUMMARY.md` lines 38, 154, 171, 218, 260 — confirms BullMQ propagation as a Phase 20 deliverable; flags the Bun smoke-test requirement.

### Phase 19 handoff (parent phase — locked precedents)
- `.planning/phases/19-context-logging-http-cqrs-tracing/19-CONTEXT.md` — full context. Phase 20 builds directly on:
  - **D-05** (worker-side ALS scaffolding in `wrapProcessorWithAls` — Phase 20 extends this function in place; signature unchanged).
  - **D-01..D-03** (single `obsContext` ALS, `setTenantContext`/`setSpan`/`setLocale` mutators, `getObsContext()` reader).
  - **D-19** (pino mixin) — worker logs auto-pick up `traceId`/`spanId`/`requestId`/`tenantId`/`userId` from ALS without per-call edits.
  - Deferred: **§"BullMQ traceparent injection + extraction" → Phase 20** (this phase).
  - Deferred: **§"Tracestate header forwarding" → was deferred** — Phase 20 D-04 explicitly **un-defers** tracestate forwarding on outbound enqueue carrier.
- `.planning/phases/19-context-logging-http-cqrs-tracing/19-07-PLAN.md` — central wrap path A (`wrapProcessorWithAls` lives in `packages/queue`). Phase 20 extends THIS file's wrapper.
- `.planning/phases/19-context-logging-http-cqrs-tracing/19-07-SUMMARY.md` §"Fake-Job Test Shape (reusable for Phase 20)" (line 97+) — explicit handoff: the fakeJob test shape is reusable for Phase 20's smoke test (D-07b).
- `packages/observability/src/context.ts` — the `obsContext` instance + `ObservabilityContext` type Phase 20 reads/writes via the producer wrapper.
- `packages/queue/src/index.ts` — current `wrapProcessorWithAls` + `createWorker` + `createQueue`. Phase 20 modifies `createQueue` (D-02) and extends `wrapProcessorWithAls` (D-05).

### Phase 18 handoff
- `.planning/phases/18-error-tracking-adapters/18-06-SUMMARY.md` — `worker.on('failed')` is the canonical BullMQ error boundary; Phase 20 adds trace-context extraction adjacent to it without touching that capture wiring.
- `.planning/phases/18-error-tracking-adapters/18-CONTEXT.md` line 141 — `@appsignal/opentelemetry-instrumentation-bullmq` not used; carried forward to Phase 20. **Phase 20 confirms: still not installed.**
- `packages/observability/src/wrappers/wrap-cqrs-bus.ts` and `wrap-event-bus.ts` — Phase 19 wrapper patterns Phase 20 mirrors for the queue (decision still TBD whether the queue wrapper lives in `packages/queue` or `packages/observability/src/wrappers/wrap-queue.ts` — see Claude's Discretion).

### Phase 17 handoff
- `.planning/phases/17-observability-ports-otel-bootstrap/17-CONTEXT.md` line 36, 107, 117 — **D-12** explicitly defers `@appsignal/opentelemetry-instrumentation-bullmq` install to Phase 20. **Phase 20 honors the spirit of D-12** (Bun-safe, deterministic) but goes further: D-01 chooses hand-rolled over the AppSignal instrumentation entirely. Phase 17's instrumentation list (HTTP, pino, ioredis only) remains unchanged.
- `.planning/phases/17-observability-ports-otel-bootstrap/17-04-PLAN.md` lines 145, 207 — DO NOT install `@appsignal/opentelemetry-instrumentation-bullmq`. Phase 20 confirms.
- `packages/observability/src/ports/tracer.ts` — `Tracer` port + `Span` interface Phase 20 consumes for producer + consumer spans. `startSpan(name, opts)` + `setAttribute` + `setStatus` + `recordException` + `end` cover everything Phase 20 needs.
- `packages/observability/src/ports/types.ts` — `TraceCarrier` type for the `_otel` carrier.
- `packages/observability/src/factory.ts` — `getTracer()` lazy singleton (Noop default). Phase 20 wrappers consume via the factory; no adapter wiring.

### Existing code Phase 20 modifies (required reading)
- `packages/queue/src/index.ts` — **MODIFIED**:
  - `createQueue(name, redisUrl)` returns a wrapped Queue (D-02). Wrapper opens producer span, injects carrier, writes `_otel` + `_requestId`/`_tenantId`/`_userId`, calls underlying `Queue.add`/`addBulk`.
  - `wrapProcessorWithAls(processor)` extended (D-05): extract carrier, open consumer span inside `context.with(parentCtx, ...)` when present, otherwise fresh-fallback (Phase 19 path); seed ALS with extracted/fresh values + tenant/user from carrier.
  - `createWorker(...)` body unchanged — still calls `wrapProcessorWithAls(processor)` internally; the extension is internal.
- `packages/queue/src/__tests__/carrier-roundtrip.test.ts` — **NEW** (D-07b): 5 tests covering carrier inject/extract round-trip, no-ALS-frame skip, tracestate forwarding, retry-attempt parent inheritance.
- `packages/queue/src/__tests__/create-worker-als.test.ts` — **EXTEND** with carrier-extract assertions (Test 7+: when `job.data._otel` present, ALS frame inherits producer traceId; existing Phase 19 fresh-fallback tests stay green).
- `apps/api/__tests__/observability-bullmq-trace.test.ts` — **NEW** (D-08): in-process API→worker single-trace assertion. Mounts Elysia app, fires request, captures carrier, invokes `wrapProcessorWithAls`, asserts traceId equality across producer + consumer log lines.
- `packages/queue/package.json` — **NO NEW DEPS**. `@opentelemetry/api` already a transitive dep via `@baseworks/observability`. Confirm at planning time; if not, add as direct dep (it's <10kB, header-only API).
- `packages/observability/src/wrappers/wrap-queue.ts` — **NEW (optional, Claude's Discretion)** — extract the producer wrapper here if planner judges it cleaner than inlining in `packages/queue`. Mirrors `wrap-cqrs-bus.ts` location.

### Existing code Phase 20 does NOT modify (zero-edit invariants)
- `packages/modules/auth/src/auth.ts` — three `queue.add` call sites (password-reset, team-invite, magic-link) stay byte-for-byte identical.
- `packages/modules/billing/src/routes.ts` — webhook `queue.add` call site identical.
- `packages/modules/billing/src/jobs/sync-usage.ts` — repeatable job enqueue identical (hits D-09 no-ALS-frame path on scheduler ticks).
- `packages/modules/example/src/hooks/on-example-created.ts` — `example-process-followup` enqueue identical.
- `packages/observability/src/lib/install-global-error-handlers.ts` — top-level error-capture enqueue identical (hits D-09 path).
- `apps/api/src/index.ts` and `apps/api/src/worker.ts` — entrypoints unchanged. The `createQueue` factory upgrade is transparent to call sites.
- `apps/api/src/core/cqrs.ts`, `apps/api/src/core/event-bus.ts` — Phase 17/18/19 invariants extended to Phase 20 (no edits).
- Phase 19's `apps/api/__tests__/observability-context-bleed.test.ts` — runs unchanged.

### External docs
- W3C Trace Context spec — `traceparent` format `00-<32-hex-traceid>-<16-hex-spanid>-<2-hex-flags>`; `tracestate` opaque key=value vendor list. Drives D-03, D-04.
- OTEL messaging semantic conventions — `messaging.system`, `messaging.destination.name`, `messaging.operation` (`publish`/`process`), `messaging.message.id`, `SpanKind.PRODUCER`/`CONSUMER`. Drives D-07.
- `@opentelemetry/api` `propagation.inject(context, carrier)` and `propagation.extract(context, carrier)` — the W3C propagation API Phase 20 uses directly. https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_api.html (propagation namespace).
- BullMQ `Queue.add(name, data, opts)` and `Queue.addBulk` — the producer surface Phase 20 wraps. https://docs.bullmq.io
- `@appsignal/opentelemetry-instrumentation-bullmq` — explicitly NOT installed in Phase 20 (D-01); referenced only as the alternative the codebase rejected.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/queue/src/index.ts:wrapProcessorWithAls` — Phase 19 D-05 wrapper. Phase 20 extends in place (no signature change). Already exposes a clean test shape (`fakeJob` helper in `create-worker-als.test.ts`).
- `packages/queue/src/index.ts:createQueue` — current factory. Phase 20 wraps the returned Queue at this single point.
- `packages/observability/src/context.ts:obsContext` + `getObsContext()` + setters — ALS surface Phase 20 reads at producer side and writes at consumer side.
- `packages/observability/src/factory.ts:getTracer()` — lazy Noop tracer; Phase 20 producer + consumer spans go through this.
- `packages/observability/src/ports/tracer.ts` — Span interface (`end`, `setAttribute`, `setStatus`, `recordException`) covers everything Phase 20 needs.
- `packages/queue/src/__tests__/create-worker-als.test.ts` — fake-job pattern (`fakeJob = (data) => ({ id, name, data }) as any`) is the test shape Phase 20 reuses for D-07b carrier round-trip suite.
- `apps/api/__tests__/observability-context-bleed.test.ts` (Phase 19) — pattern for capturing pino log lines via test transport + asserting log fields. Phase 20's E2E test (D-08) reuses this pino-capture shape.
- Phase 18 `worker.on('failed')` capture wiring at `apps/api/src/worker.ts` — already inside the `obsContext.run` frame Phase 19 installs; Phase 20 spans propagate naturally to the captured Sentry events without code changes.

### Established Patterns
- **External wrappers over core edits.** Phase 17 (factory ports), Phase 18 (`wrapCqrsBus`, `wrapEventBus`), Phase 19 (pino mixin, `observabilityMiddleware`, `wrapProcessorWithAls`) — Phase 20 mirrors exactly: wrap `createQueue`, extend `wrapProcessorWithAls`, zero handler edits.
- **Noop-first with factory selection.** `getTracer()` returns Noop by default; producer + consumer spans are no-ops in Noop mode but the carrier is still injected (so log correlation works without an exporter). Real OTEL exporter swaps in at Phase 21 with no Phase 20 call-site changes.
- **Single source of truth for context.** ALS is the source at producer side (carrier seeded from `obsContext.getStore()`); ALS is the destination at consumer side (`obsContext.run(jobCtx, ...)`). Phase 20 maintains the invariant.
- **Test-time enforcement precedes CI-time.** D-07b smoke test runs in `bun test` today; future `ci.yml` (deferred since Phase 18) will pick it up automatically.
- **Crash-hard env validation.** Phase 17 `validateObservabilityEnv()` pattern continues — Phase 20 introduces no new env vars (D-01 hand-rolled = no install, no env). If a future opt-out flag is added (Claude's Discretion / future phase), it goes through the same validator.

### Integration Points
- `packages/queue/src/index.ts:createQueue` → wrapped Queue returned (D-02). All four call sites (`auth`, `billing`, `example`, `observability/install-global-error-handlers`) pick up the new behavior transparently.
- `packages/queue/src/index.ts:wrapProcessorWithAls` → extended for carrier extraction (D-05). `createWorker` consumes the extended wrapper internally.
- `packages/queue/src/index.ts` ↔ `packages/observability/src/context.ts` — already imported (Phase 19 D-05). Phase 20 adds imports for `getTracer()` from `@baseworks/observability` and `propagation`/`context`/`trace` from `@opentelemetry/api`.
- `packages/queue/package.json` ↔ `@opentelemetry/api` — confirm at planning time whether direct dep is needed (likely already transitive via `@baseworks/observability`).
- `packages/queue/src/__tests__/carrier-roundtrip.test.ts` (NEW) — gates D-02, D-04, D-05, D-09, D-10 on every `bun test` run.
- `apps/api/__tests__/observability-bullmq-trace.test.ts` (NEW) — gates SC#2 single-trace at the trace-data level (Tempo verification deferred to Phase 21).

</code_context>

<specifics>
## Specific Ideas

- **`wrapProcessorWithAls` is the load-bearing function.** Phase 19 designed it specifically so Phase 20 only adds the carrier-extract branch. The Phase 19 fresh-fallback path (Test 3 of `create-worker-als.test.ts`) must stay green byte-for-byte — that test is the regression boundary for Phase 20.
- **The producer wrapper is the symmetric mirror.** Phase 19 wrapped the consumer side at the queue-package boundary; Phase 20 wraps the producer side at the same boundary. Both wrappers are internal to `packages/queue` (or `packages/observability/src/wrappers/` per Claude's Discretion). Modules never see them.
- **Hand-rolled, not AppSignal lib.** Phase 17 D-12 deferred install; Phase 20 D-01 elects to skip it entirely. Rationale: deterministic, Bun-safe, no patching surprises. Phase 21 may revisit when real exporters land and span output can be inspected.
- **Three flat fields + one envelope.** `_otel` for the W3C propagation carrier (`propagation.inject` writes there directly); `_requestId`/`_tenantId`/`_userId` flat top-level (back-compat with Phase 19; simple grep target for log analysis). No nested-shape coupling for the ALS-derived fields.
- **Tracestate is forwarded.** Explicit divergence from Phase 19's deferral. Operators with vendor-aware exporters (Datadog, Honeycomb, Lightstep) get vendor context across the producer→consumer hop. One optional string; cost negligible.
- **No-ALS-frame is acceptable orphan.** Repeatable jobs (sync-usage), error-capture enqueues, and startup tasks all hit D-09 — no carrier injected, worker generates fresh trace. Tempo will show these as orphan-from-producer; that's the explicit tradeoff for not requiring every BullMQ scheduler-driven enqueue to be wrapped in `obsContext.run`.
- **Each retry attempt = its own consumer span.** Tempo shows N child `process` spans (siblings of one another, all children of the producer `publish` span) for a job that retried N times. Per-attempt timing visible. Final-failure error attribution stays on the last attempt's span (Phase 18 capture wiring already covers `worker.on('failed')`).
- **Tempo verification is Phase 21.** Phase 20 SC#2 ("single trace in Tempo") is satisfied at the trace-data level (D-08 in-process test) but not the visual Tempo level — that's a Phase 21 acceptance task once the OTEL exporter pipes spans to a real Tempo instance.
- **Smoke test is the merge gate.** SC#3 demands a Bun smoke test as merge requirement. D-07b's `carrier-roundtrip.test.ts` is that gate; runs on every `bun test` in `packages/queue`. Future `ci.yml` will pick it up automatically.

</specifics>

<deferred>
## Deferred Ideas

- **`@appsignal/opentelemetry-instrumentation-bullmq` install** — D-01 elects hand-rolled. Phase 21 may revisit when real OTEL exporter lands and we can compare span output against the AppSignal lib's output. If we adopt later, the wrapper interface (D-02, D-05) stays stable — internal swap.
- **Tempo dashboard verification** (SC#2 literal "in Tempo") — Phase 21 (real OTEL exporter + Grafana stack). Phase 20 satisfies SC#2 at the trace-data level only.
- **OTEL `View` cardinality cap on `messaging.message.id`** — Phase 21 (MET-02). Phase 20 emits the attribute on spans without a cap; relevant only when metrics start being exported.
- **Sampling strategy** (parent-based 10% etc.) — Phase 21 (real exporter required to make sampling decisions visible).
- **Frontend → API → worker browser-side trace propagation** — out of scope for Phase 20. Phase 19's deferred `apps/admin`/`apps/web` traceparent injection still deferred; Phase 20 only covers the API → worker hop.
- **BullMQ `FlowProducer` parent-job/child-job traceparent handling** — not in current codebase use; Phase 20 ignores. If introduced later, `FlowProducer.add(...)` needs the same wrap as `Queue.add`.
- **Opt-out env flag (`OBS_BULLMQ_PROPAGATION=false`)** — not added in Phase 20. Carrier injection cost is negligible (4 small string fields per enqueue); operators who don't want propagation can run Noop tracer (Phase 17 default). If a real opt-out is needed, add via the existing Phase 17 `validateObservabilityEnv()` pattern.
- **`locale` in carrier** — jobs use `defaultLocale` at seed (Phase 19 D-05). Adding `_locale` to the carrier so workers inherit the producer's user-locale is trivial but not required by SC; future enhancement.
- **`baggage` header propagation** — separate W3C spec; deferred (Phase 19 also deferred). If multi-service deployment lands, baggage may carry tenantId across services without re-encoding in spans.
- **Retry telemetry beyond span-per-attempt** — e.g., emit a counter `bullmq.retries.total{queue.name, job.name}`. Phase 21 metrics territory.

### Reviewed Todos (not folded)
None — `gsd-tools list-todos` returned 0 matches at discussion time.

</deferred>

---

*Phase: 20-bullmq-trace-propagation*
*Context gathered: 2026-04-25*
