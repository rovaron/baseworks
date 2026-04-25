# Phase 20: BullMQ Trace Propagation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `20-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-25
**Phase:** 20-bullmq-trace-propagation
**Areas discussed:** Instrumentation strategy, Producer-side injection mechanism, Carrier shape + worker parent semantics, Smoke test + merge gate shape, No-ALS-frame enqueue behavior, Retry attempt span semantics, OTEL messaging semantic conventions

---

## Initial Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Instrumentation strategy | @appsignal/opentelemetry-instrumentation-bullmq vs hand-rolled W3C propagator vs hybrid | ✓ |
| Producer-side injection mechanism | Wrap Queue in createQueue vs enqueue() helper vs edit each call site | ✓ |
| Carrier shape + worker parent semantics | _otel envelope vs unified vs flat; child-of-producer vs link-only | ✓ |
| Smoke test + merge gate shape | In-process fake-job vs real Redis vs hybrid | ✓ |

---

## Instrumentation strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-rolled W3C propagator (Recommended) | Use @opentelemetry/api propagation.inject/extract directly. ~30 lines, Bun-safe, deterministic, no module patching. Aligns with Phase 17 D-12 and ARCHITECTURE.md §874. | ✓ |
| @appsignal/opentelemetry-instrumentation-bullmq only | Install lib, register alongside auto-instrumentations. Highest bug-surface on Bun (prototype patching). | |
| Hybrid: lib if it works, hand-rolled fallback | Install both, prefer lib at runtime, fall back to hand-rolled if smoke test fails. Doubles maintenance. | |
| Hand-rolled now, lib in Phase 21 | Ship hand-rolled now, re-evaluate in Phase 21 with real OTEL exporter. Wrapper interface stable. | |

**User's choice:** Hand-rolled W3C propagator
**Notes:** Selected the recommended option. Aligns with the Phase 17/18/19 stance that explicit hand-rolled wrappers beat instrumentation-package patching on Bun.

---

## Producer-side injection mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Wrap Queue inside createQueue (Recommended) | createQueue() returns a wrapped Queue whose add()/addBulk() auto-inject carrier. Mirrors wrapProcessorWithAls. Zero call-site edits. | ✓ |
| Mandatory enqueue() helper in packages/queue | enqueue(queue, name, data, opts) helper; direct queue.add becomes a lint violation. Matches PITFALLS guidance literally. | |
| Edit each call site to merge _otel | Touch auth/billing/example/observability call sites. Most explicit, but breaks zero-handler-edits discipline. | |
| Wrap Queue + provide enqueue() helper | Wrapper handles default; helper for advanced cases (custom carrier override, fan-out). | |

**User's choice:** Wrap Queue inside createQueue
**Notes:** Recommended option. Symmetric with Phase 19's consumer-side wrapper. Zero call-site edits. Repeatable/delayed jobs auto-covered.

---

## Carrier shape + worker parent semantics

### Carrier shape

| Option | Description | Selected |
|--------|-------------|----------|
| _otel as W3C carrier + keep _requestId top-level (Recommended) | _otel = { traceparent, tracestate? } pure W3C carrier. _requestId/_tenantId/_userId stay flat top-level. Phase 19's _requestId fallback unchanged. | ✓ |
| Unified _otel envelope | _otel = { traceparent, requestId, tenantId, userId? }. Cleanest grep target. Migrates Phase 19's _requestId read path. | |
| Flat top-level fields | _traceparent + _requestId + _tenantId at top level. propagation API expects flat carrier object — needs shim. | |

**User's choice:** _otel as W3C carrier + keep _requestId top-level
**Notes:** Avoids breaking Phase 19's wrapProcessorWithAls fallback path. Pure W3C carrier shape consumed by propagation.inject/extract directly.

### Carrier extras (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Include userId | Carrier carries userId alongside tenantId. Worker logs immediately know which user enqueued. | ✓ |
| Forward inbound tracestate (vendor headers) | Propagate tracestate when present. Diverges from Phase 19's minimal-carrier deferral. | ✓ |

**User's choice:** Both
**Notes:** Explicit divergence from Phase 19's tracestate deferral — captured as D-04. UserId inclusion adds operator value at negligible cost.

### Worker parent semantics + tenantId inclusion

These were communicated as **already locked by SC#2 and SC#4**:
- SC#2 → worker process span is a **child** of producer enqueue span (parent-child via `context.with(parentCtx, ...)`), not link-only.
- SC#4 → carrier must include `tenantId`.

User accepted these as locked; no separate question asked.

---

## Smoke test + merge gate

### SC#3 merge-gate smoke test

| Option | Description | Selected |
|--------|-------------|----------|
| In-process fake-job round-trip (Recommended) | Reuses Phase 19 fakeJob shape. Asserts carrier round-trip via stubbed Queue.add + wrapProcessorWithAls. No Redis. | ✓ |
| Real BullMQ + Redis integration | Spin up real Queue + Worker against ioredis. Highest fidelity, requires Redis at test time. | |
| In-process round-trip + opt-in real-Redis variant | Default in-process test gates merges; optional @integration test exercises real path. | |

**User's choice:** In-process fake-job round-trip
**Notes:** Fast, deterministic, runs on every bun test. Reuses Phase 19's reusable fakeJob shape per 19-07-SUMMARY.md handoff.

### SC#2 end-to-end (API→worker single-trace) assertion

| Option | Description | Selected |
|--------|-------------|----------|
| In-process: app.handle + wrapped queue + fake worker (Recommended) | Mount Elysia app, capture carrier from stubbed Queue.add, invoke wrapProcessorWithAls(processor)(jobFromCarrier). Assert traceId equality via pino capture. | ✓ |
| Real Redis + BullMQ Worker spin-up | Full integration. Closest to production; flakier under CI without sidecar. | |
| Defer to Phase 21 (real OTEL exporter present) | Phase 20 only ships SC#3 smoke test; Tempo verification is Phase 21. Still asserts traceId equality in-process. | |

**User's choice:** In-process: app.handle + wrapped queue + fake worker
**Notes:** Tempo verification (literal "in Tempo" wording of SC#2) is captured in CONTEXT.md as deferred to Phase 21.

---

## Additional Areas (round 2)

User chose to explore three more areas:

| Option | Description | Selected |
|--------|-------------|----------|
| Enqueue without ALS frame | What happens when wrappedQueue.add called outside obsContext.run? | ✓ |
| Retry attempt span semantics | Each attempt fresh consumer span vs shared span vs separate trace | ✓ |
| OTEL messaging semantic conventions | Span names + attributes for messaging.system=bullmq | ✓ |
| Disable / opt-out switch | OBS_BULLMQ_PROPAGATION env flag | |

---

## No-ALS-frame enqueue

| Option | Description | Selected |
|--------|-------------|----------|
| Inject empty/no carrier (Recommended) | If obsContext.getStore() undefined: skip injection. Worker fresh-trace fallback (Phase 19) unchanged. | ✓ |
| Generate fresh traceparent at enqueue | Producer wrapper opens one-shot span; always one trace per job. Adds noise for repeatable jobs. | |
| Crash hard (assert ALS frame) | Throw if no ALS frame. Most aggressive; breaks current error-handler + repeatable enqueue. | |

**User's choice:** Inject empty/no carrier
**Notes:** Affected paths: error-handler enqueue, BullMQ scheduler-driven repeatables (sync-usage), startup tasks. Worker still emits valid trace, just orphan from producer.

---

## Retry attempt span semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Each attempt = fresh consumer span, all child of producer (Recommended) | wrapProcessorWithAls extracts on every invocation. Attempts 1, 2, 3 are siblings. Tempo shows per-attempt timing. | ✓ |
| Attempts share one consumer span | Single 'process' row regardless of retries. Loses per-attempt detail; doesn't match BullMQ event model. | |
| Attempt 1 child of producer; retries new trace | Retries get fresh traceparent (orphaned). Loses retry visibility. | |

**User's choice:** Each attempt = fresh consumer span, all child of producer
**Notes:** Aligns with OTEL messaging retry guidance. Final-failure error attribution stays on last attempt's span (Phase 18 worker.on('failed') wiring unchanged).

---

## OTEL messaging semantic conventions

| Option | Description | Selected |
|--------|-------------|----------|
| Full OTEL messaging conventions (Recommended) | Producer: '{queue.name} publish' + messaging.system=bullmq + destination.name + operation + message.id. Consumer: '{queue.name} process'. Full attribute set. | ✓ |
| Minimal: span name + jobId only | 'enqueue {queue.name}' + 'process {queue.name}' + job.id. No messaging.* namespace. | |
| Mirror Phase 19 CQRS naming style | 'queue.publish'/'queue.process' fixed names + queue.name attribute. Diverges from OTEL standard. | |

**User's choice:** Full OTEL messaging conventions
**Notes:** Bounded cardinality (queue names + jobIds). Phase 21 RED-metrics OTEL Views will drop messaging.message.id from metric labels (cardinality guard per PITFALLS Pitfall 4).

---

## Final Confirmation

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context | Write CONTEXT.md + DISCUSSION-LOG.md now and commit. | ✓ |
| Explore one more area | Surface remaining minor areas (env opt-out flag, FlowProducer, payload-size budget). | |

**User's choice:** I'm ready for context
**Notes:** 11 decisions captured (D-01..D-11).

---

## Claude's Discretion

The following decisions were left as Claude's discretion in CONTEXT.md, to be resolved by the planner:
- Wrapper mechanism for Queue (Proxy vs subclass vs Object.assign).
- Where the propagator/extractor helper lives (inline in packages/queue vs extracted to packages/observability/src/wrappers/wrap-queue.ts).
- Whether `_otel` is removed from `job.data` before passing to user processors.
- Exact OTEL attribute key for retry attempt number (`messaging.bullmq.attempt` vs `messaging.system_specific.attempt`).
- Producer span sync vs fire-and-forget around `Queue.add`.
- Concrete propagation API carrier setter/getter shape.
- Whether to forward `locale` from ALS into the carrier (NOT required by SC).

## Deferred Ideas

The following were noted for future phases (full list in CONTEXT.md `<deferred>`):
- `@appsignal/opentelemetry-instrumentation-bullmq` install — Phase 21 revisit.
- Tempo dashboard verification — Phase 21.
- OTEL View cardinality cap on `messaging.message.id` — Phase 21.
- Sampling strategy — Phase 21.
- Frontend trace propagation — future phase.
- BullMQ FlowProducer support — out of scope, not in current codebase.
- Opt-out env flag (`OBS_BULLMQ_PROPAGATION=false`) — not added; Noop tracer is the existing escape hatch.
- `locale` in carrier — trivial future enhancement.
- W3C `baggage` header propagation — deferred (Phase 19 also deferred).
- Retry counter metrics — Phase 21 metrics territory.
