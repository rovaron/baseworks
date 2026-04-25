# Phase 20: BullMQ Trace Propagation — Research

**Researched:** 2026-04-25
**Domain:** Distributed-tracing carrier injection across a BullMQ producer/consumer hop on Bun
**Confidence:** HIGH (every load-bearing API surface verified against installed `node_modules` source; OTEL semantic-conventions verified against `@opentelemetry/semantic-conventions@1.40.0`; Phase 19 wrapper patterns verified against existing repo files)

## Summary

Phase 20 is a pure wrapper extension. The producer wraps the underlying `Queue` returned from `createQueue()` so `Queue.add` and `Queue.addBulk` open an OTEL producer span, inject a W3C `traceparent` (+ optional `tracestate`) into a `_otel: {}` envelope on `job.data`, copy `requestId`/`tenantId`/`userId` from the `obsContext` ALS frame onto top-level `_requestId`/`_tenantId`/`_userId` fields, and call the underlying method. The consumer side is a strict in-place extension of Phase 19's `wrapProcessorWithAls`: extract the parent context from `job.data._otel`, open a consumer span as a child of the producer span via `context.with(parentCtx, …)`, seed the ALS frame with the extracted traceId/spanId/requestId/tenantId/userId, and run the original processor.

Three findings shape the plan:

1. **`@opentelemetry/api`'s `propagation.inject(ctx, carrier)` is a no-op when no global propagator is registered.** [VERIFIED: `node_modules/.bun/@opentelemetry+api@1.9.1/.../api/propagation.js:73`] The good news: `NodeSDK.start()` (Phase 17's `apps/api/src/telemetry.ts`) registers `W3CTraceContextPropagator` as the global default. Phase 20 inherits this — no extra setup needed in API or worker entrypoints, but a unit test that runs *without* importing `apps/api/src/telemetry.ts` will hit the noop propagator and produce empty carriers unless it explicitly registers one (`propagation.setGlobalPropagator(new W3CTraceContextPropagator())`). The smoke test (D-07b) must register the propagator at the top of the file.

2. **The Phase 17 port `getTracer()` returns a NoopTracer whose `Span` has no real OTEL SpanContext.** [VERIFIED: `packages/observability/src/adapters/noop/noop-tracer.ts:18-23`] D-06's instruction "`propagation.inject(trace.setSpan(context.active(), producerSpan), carrier)`" only works if `producerSpan` is a real `@opentelemetry/api` `Span` with a valid `SpanContext`. The port-level NoopSpan is not interchangeable. The producer wrapper must therefore use **`trace.getTracer('baseworks.queue').startSpan(...)` from `@opentelemetry/api` directly**, not `getTracer()` from `@baseworks/observability`. Same pattern Phase 17 already established at `apps/api/src/telemetry.ts:34,76` (`trace.getTracer('baseworks.boot').startSpan('otel-selftest', …)`).

3. **W3CTraceContextPropagator forwards `tracestate` automatically.** [VERIFIED: `node_modules/.bun/@opentelemetry+core@2.6.1+.../W3CTraceContextPropagator.js:55-57`] When `spanContext.traceState` is present it is serialized via `setter.set(carrier, 'tracestate', ...)` alongside `traceparent`. D-04's "forward tracestate when present" is satisfied by the standard `propagation.inject` call — no extra code, no propagator config. Empty `tracestate` is simply not written.

**Primary recommendation:** Build the producer wrapper at `packages/observability/src/wrappers/wrap-queue.ts` (mirroring `wrap-cqrs-bus.ts` and `wrap-event-bus.ts`), wire it into `createQueue()` in `packages/queue/src/index.ts`, use `trace.getTracer('baseworks.queue')` from `@opentelemetry/api` for spans, and use the `propagation.inject(trace.setSpan(context.active(), producerSpan), carrier)` idiom verbatim. Extend `wrapProcessorWithAls` in place with a `propagation.extract(ROOT_CONTEXT, job.data._otel ?? {})` call followed by `context.with(parentCtx, () => trace.getTracer('baseworks.queue').startSpan(`${queueName} process`, { kind: SpanKind.CONSUMER, … }))`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01** — Hand-rolled W3C propagator via `@opentelemetry/api`. No `@appsignal/opentelemetry-instrumentation-bullmq`.
- **D-02** — Wrap the `Queue` instance inside `createQueue()`. Returned object's `.add(...)` and `.addBulk(...)` auto-inject the carrier. **Zero call-site edits** across the four `queue.add` sites:
  - `packages/modules/auth/src/auth.ts:73` (password-reset)
  - `packages/modules/auth/src/auth.ts:107` (team-invite)
  - `packages/modules/auth/src/auth.ts:130` (magic-link)
  - `packages/modules/billing/src/routes.ts:104` (process-webhook)
  - `packages/modules/example/src/hooks/on-example-created.ts:66` (example-process-followup)
- **D-03** — Mixed carrier shape on `job.data`: `_otel: { traceparent, tracestate? }` envelope **+** flat top-level `_requestId`, `_tenantId`, `_userId`.
- **D-04** — Forward `tracestate` when present (un-defers Phase 19's tracestate deferral).
- **D-05** — Worker process span is a child of producer enqueue span via `context.with(parentCtx, …)`. Extends `wrapProcessorWithAls` in place; signature unchanged.
- **D-06** — Producer enqueue span opened inside `wrappedQueue.add()`; `propagation.inject(trace.setSpan(context.active(), producerSpan), carrier)`. Worker becomes child of `publish`, not the HTTP request directly.
- **D-07** — Full OTEL messaging semantic conventions (`messaging.system`, `messaging.destination.name`, `messaging.operation`, `messaging.message.id`, `SpanKind.PRODUCER`/`CONSUMER`, plus `messaging.bullmq.attempt` for consumer).
- **D-09** — Skip injection when `obsContext.getStore()` is undefined (orphan-from-producer fallback).
- **D-10** — Per-attempt fresh consumer span; all attempts share the producer span as parent.
- **D-07b/D-08** — Two new test files gate the merge.

### Claude's Discretion
- Wrapper mechanism for `Queue` (Proxy vs subclass vs `Object.assign(new Queue(...), { add: wrappedAdd })`).
- Wrapper location (`packages/queue/src/index.ts` inline vs `packages/observability/src/wrappers/wrap-queue.ts`).
- Whether `_otel` is removed from `job.data` before passing to user processors.
- Exact attribute key for `messaging.bullmq.attempt` (verified below; confirm via planner).
- Producer span open/close timing (synchronous around `Queue.add` recommended).
- Forwarding `locale` from ALS (out of scope; trivial later).

### Deferred Ideas (OUT OF SCOPE)
- `@appsignal/opentelemetry-instrumentation-bullmq` install — Phase 21 may revisit.
- Tempo dashboard verification (SC#2 literal "in Tempo") — Phase 21.
- OTEL `View` cardinality cap on `messaging.message.id` — Phase 21 / MET-02.
- Sampling strategy — Phase 21.
- Frontend → API browser-side trace propagation — out of scope.
- BullMQ `FlowProducer` parent-job/child-job traceparent handling — not in current code.
- Opt-out env flag `OBS_BULLMQ_PROPAGATION=false` — not added.
- `_locale` in carrier — future enhancement, not required by SC.
- `baggage` header propagation — Phase 19 also deferred.
- Retry telemetry beyond span-per-attempt (counter `bullmq.retries.total`) — Phase 21.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **CTX-04** | Operator sees BullMQ enqueue wrap inject W3C `traceparent` + `requestId` into job data, and workers reconstitute ALS context via `obsContext.run(...)` on job pickup — verified by an end-to-end test that asserts a single trace spans API request → enqueued job → worker processing | Producer wrapper at `createQueue` (D-02) writes `_otel.traceparent` + `_requestId`/`_tenantId`/`_userId`; consumer extension to `wrapProcessorWithAls` (D-05) extracts and seeds ALS via `obsContext.run`; D-08 in-process test asserts traceId equality across producer + consumer log lines. |
| **TRC-03** | Operator sees BullMQ enqueue + process instrumented with W3C context propagation (via `@appsignal/opentelemetry-instrumentation-bullmq` or hand-rolled equivalent), with a Bun smoke test as merge gate; enqueue spans linked to process spans in Tempo | Hand-rolled per D-01 using `@opentelemetry/api` `propagation.inject`/`extract` + W3CTraceContextPropagator (auto-registered by NodeSDK); D-07b carrier-roundtrip smoke test runs on every `bun test`; in-process parent-child relationship asserted via D-07b Test 5 (retry parent inheritance). Tempo visual verification deferred to Phase 21. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Producer span open + carrier inject | `packages/observability` (wrap-queue) | `packages/queue` (calls wrapper) | Mirrors `wrap-cqrs-bus`/`wrap-event-bus` location; centralizes OTEL primitives in one package |
| Consumer ALS seed + parent context restore | `packages/queue` (extends `wrapProcessorWithAls`) | `packages/observability` (consumes `obsContext`, `getTracer`) | Phase 19 already lives here; Phase 20 strict in-place extension |
| W3C carrier shape (`_otel`) | OTEL global propagator (W3CTraceContextPropagator) | — | NodeSDK registers it; Phase 20 just calls `propagation.inject`/`extract` |
| ALS frame seeding (producer side) | `packages/observability` (reads `obsContext.getStore()`) | — | Single source of truth for `requestId`/`tenantId`/`userId` |
| ALS frame seeding (consumer side) | `packages/queue` (`obsContext.run(jobCtx, …)`) | — | Phase 19 invariant — `createWorker` is the only frame-opening site for jobs |
| Worker process span (child of producer) | `@opentelemetry/api` `context.with` + `trace.getTracer` | `packages/queue` invokes | Real OTEL context propagation, not port-level Noop |

**Why direct `@opentelemetry/api` vs port `getTracer()`:** the port's NoopTracer has its own NoopSpan with no `SpanContext`, so `trace.setSpan(context.active(), portSpan)` would not yield a span context for `propagation.inject` to encode. The `@opentelemetry/api` global tracer (registered by NodeSDK during Phase 17 boot) returns spans with valid SpanContexts under both noop and real-exporter modes. [VERIFIED: `packages/observability/src/adapters/noop/noop-tracer.ts:18-23`; `apps/api/src/telemetry.ts:34,76` already uses this pattern]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@opentelemetry/api` | `^1.9.1` | Tracer + propagation API | Already a transitive dep of `@baseworks/observability`. Header-only, zero runtime overhead, Bun-safe. Provides `trace`, `context`, `propagation`, `SpanKind`, `ROOT_CONTEXT`. [VERIFIED: `packages/observability/package.json:11`] |
| `bullmq` | `^5.73.0` | Queue/Worker primitives | Already wired in `packages/queue`. Phase 20 wraps `Queue.add`/`addBulk`; no API change. [VERIFIED: `packages/queue/package.json:9`, installed `bullmq@5.73.0`] |
| `@opentelemetry/semantic-conventions` | `^1.40.0` | Stable+experimental attribute constants | Already a dep of `@baseworks/observability`. Phase 20 imports `ATTR_MESSAGING_SYSTEM`, `ATTR_MESSAGING_DESTINATION_NAME`, `ATTR_MESSAGING_OPERATION`, `ATTR_MESSAGING_MESSAGE_ID` from the experimental_attributes module. [VERIFIED: `node_modules/.bun/@opentelemetry+semantic-conventions@1.40.0/.../experimental_attributes.d.ts`] |
| `@opentelemetry/core` | `^2.6.1` (transitive) | `W3CTraceContextPropagator` | Auto-registered by `NodeSDK.start()` (Phase 17 telemetry.ts) as the global propagator. Phase 20 does not import directly except in the smoke test (which runs without telemetry.ts and must register a propagator manually). [VERIFIED: `node_modules/.bun/@opentelemetry+core@2.6.1+.../trace/W3CTraceContextPropagator.js`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@baseworks/observability` (workspace) | `0.0.1` | `obsContext`, `ObservabilityContext`, `getTracer`, `wrap-queue.ts` (new) | All wrapper code; ALS read at producer; tracer factory for non-noop branches in Phase 21. |
| `@baseworks/i18n` (workspace) | — | `defaultLocale` | Phase 19 already imports for the consumer fallback path; Phase 20 keeps as-is. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled propagator (D-01) | `@appsignal/opentelemetry-instrumentation-bullmq` | Library patches BullMQ prototype at import time — Bun compatibility unverified, less control over carrier shape. **Rejected per D-01.** Phase 21 may revisit. |
| Port-level `getTracer()` | Direct `trace.getTracer('baseworks.queue')` | Port returns NoopSpan with no SpanContext → `propagation.inject` produces empty carrier even when called. **Use `@opentelemetry/api` direct.** Established pattern: `apps/api/src/telemetry.ts:76`. |
| Proxy-based wrapper | Subclass `Queue` / `Object.assign(new Queue, { add: ... })` | Proxy preserves all methods + future-proof against new BullMQ surface. Subclass requires re-declaring overloaded `add(name, data, opts?)` signature. **Recommend: minimal `Object.assign` wrapper that overrides only `.add` and `.addBulk`.** Most readable, preserves type inference, no Proxy traps to debug. |
| `propagation.inject` with custom setter | Default object setter | Default works for plain `Record<string, string>` — no setter needed. [VERIFIED: `propagation.js:53` falls back to `defaultTextMapSetter`] Custom setter only needed for non-standard carriers (e.g., headers Map). **Use default.** |

**Installation:** No new deps. `packages/queue` already imports `@baseworks/observability`; verify `@opentelemetry/api` is reachable at compile time. If TypeScript complains about missing types, add it as an explicit dep in `packages/queue/package.json`:

```bash
# Only if needed at planning time
bun add @opentelemetry/api@^1.9.1 --filter @baseworks/queue
```

**Version verification:**
- `@opentelemetry/api@1.9.1` — installed (`.bun/@opentelemetry+api@1.9.1`); declared in `packages/observability/package.json:11` as `^1.9.1`. Stable since 2024-04. [VERIFIED]
- `bullmq@5.73.0` — installed (`.bun/bullmq@5.73.0`); declared as `^5.0.0`. Queue.add signature `add(name: NameType, data: DataType, opts?: JobsOptions): Promise<Job<...>>` confirmed at `node_modules/.bun/bullmq@5.73.0/.../classes/queue.d.ts:155`. [VERIFIED]
- `@opentelemetry/semantic-conventions@1.40.0` — installed; messaging attributes confirmed. [VERIFIED]

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  HTTP Request enters apps/api → Bun.serve fetch wrapper opens ALS frame │
│  obsContext.run({ requestId, traceId, spanId, tenantId, userId, ... })  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
       ┌─────────────────────────────────────────────────┐
       │ Module handler (auth/billing/example) calls     │
       │   queue.add('job-name', payload)                │
       │   ↑ this `queue` is the wrappedQueue from D-02  │
       └────────────────────────┬────────────────────────┘
                                │
                                ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ wrappedQueue.add(name, data, opts):                             │
   │  1. const store = obsContext.getStore()                         │
   │  2. if (!store) → call underlying .add(name, data, opts) (D-09) │
   │  3. else open producer span:                                    │
   │       const tracer = trace.getTracer('baseworks.queue')         │
   │       const span = tracer.startSpan(`${queueName} publish`,     │
   │           { kind: SpanKind.PRODUCER, attributes: {...} })       │
   │  4. const carrier: Record<string,string> = {}                   │
   │     propagation.inject(trace.setSpan(context.active(), span),   │
   │                        carrier)                                 │
   │     // carrier now has 'traceparent' (+ 'tracestate' if present)│
   │  5. const dataWithCarrier = {                                   │
   │       ...data,                                                  │
   │       _otel: carrier,                                           │
   │       _requestId: store.requestId,                              │
   │       _tenantId: store.tenantId,                                │
   │       _userId: store.userId,                                    │
   │     }                                                           │
   │  6. try {                                                       │
   │       const job = await origAdd(name, dataWithCarrier, opts)    │
   │       span.setAttribute('messaging.message.id', job.id)         │
   │       return job                                                │
   │     } catch (err) {                                             │
   │       span.recordException(err)                                 │
   │       span.setStatus({ code: SpanStatusCode.ERROR })            │
   │       throw err                                                 │
   │     } finally {                                                 │
   │       span.end()                                                │
   │     }                                                           │
   └────────────────────────────┬────────────────────────────────────┘
                                │  payload + _otel + _requestId persisted in Redis
                                ▼
                  ┌──────────────────────────────────┐
                  │ Redis (BullMQ) holds job.data    │
                  └──────────────┬───────────────────┘
                                 │
                                 ▼
       ┌─────────────────────────────────────────────────────────┐
       │ Worker.processJob → invokes wrapProcessorWithAls(proc) │
       │   in packages/queue/src/index.ts                        │
       └──────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ wrapProcessorWithAls (extended for Phase 20):                   │
   │  1. const carrierIn = (job.data as any)?._otel ?? {}            │
   │  2. const parentCtx = propagation.extract(ROOT_CONTEXT,         │
   │                                            carrierIn)           │
   │  3. const consumerSpan = context.with(parentCtx, () =>          │
   │       trace.getTracer('baseworks.queue').startSpan(             │
   │         `${job.queueName} process`,                             │
   │         { kind: SpanKind.CONSUMER, attributes: {...,            │
   │            'messaging.bullmq.attempt': job.attemptsMade + 1 }   │
   │         }))                                                     │
   │  4. const sc = consumerSpan.spanContext()                       │
   │     const jobCtx: ObservabilityContext = {                      │
   │       requestId: job.data._requestId ?? crypto.randomUUID(),    │
   │       traceId: sc.traceId, // inherited from producer when      │
   │                            // carrier present, else fresh       │
   │       spanId: sc.spanId,   // always fresh per attempt          │
   │       tenantId: job.data._tenantId ?? null,                     │
   │       userId: job.data._userId ?? null,                         │
   │       locale: defaultLocale,                                    │
   │     }                                                           │
   │  5. return context.with(trace.setSpan(parentCtx, consumerSpan), │
   │       () => obsContext.run(jobCtx, async () => {                │
   │         try { return await processor(job, token) }              │
   │         catch (err) {                                           │
   │           consumerSpan.recordException(err);                    │
   │           consumerSpan.setStatus({ code: SpanStatusCode.ERROR });│
   │           throw err;                                            │
   │         } finally { consumerSpan.end() }                        │
   │       }))                                                       │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
            Pino mixin (Phase 19) auto-stamps log lines with
            traceId/spanId/requestId/tenantId/userId from obsContext
```

### Recommended Project Structure

```
packages/
├── queue/
│   └── src/
│       ├── index.ts                          # MODIFIED: createQueue wraps Queue; wrapProcessorWithAls extended
│       └── __tests__/
│           ├── create-worker-als.test.ts     # EXTEND: add carrier-extract assertions (Test 7+)
│           └── carrier-roundtrip.test.ts     # NEW (D-07b): 5-test smoke suite
└── observability/
    └── src/
        └── wrappers/
            ├── wrap-cqrs-bus.ts              # existing pattern (Phase 18)
            ├── wrap-event-bus.ts             # existing pattern (Phase 19)
            └── wrap-queue.ts                 # NEW (optional, Claude's Discretion): producer wrapper
apps/
└── api/
    └── __tests__/
        └── observability-bullmq-trace.test.ts  # NEW (D-08): in-process API→worker assertion
```

### Pattern 1: `propagation.inject` Idiom

**What:** Open a producer span, set it as active in a child context, then inject — so `traceparent` references the producer span (not the parent HTTP span).

**When to use:** Every messaging-system producer wrapper.

**Example:**
```typescript
// Source: @opentelemetry/api 1.9.1 docs + W3CTraceContextPropagator.js verified
import { context, propagation, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { ATTR_MESSAGING_SYSTEM, ATTR_MESSAGING_DESTINATION_NAME, ATTR_MESSAGING_OPERATION, ATTR_MESSAGING_MESSAGE_ID } from '@opentelemetry/semantic-conventions/incubating';

const tracer = trace.getTracer('baseworks.queue');
const span = tracer.startSpan(`${queueName} publish`, {
  kind: SpanKind.PRODUCER,
  attributes: {
    [ATTR_MESSAGING_SYSTEM]: 'bullmq',
    [ATTR_MESSAGING_DESTINATION_NAME]: queueName,
    [ATTR_MESSAGING_OPERATION]: 'publish',
  },
});

const carrier: Record<string, string> = {};
// trace.setSpan returns a fresh Context with `span` as the active span,
// so propagation.inject will encode `span`'s spanContext as the traceparent.
propagation.inject(trace.setSpan(context.active(), span), carrier);
// carrier now: { traceparent: '00-<32hex>-<16hex>-<2hex>', tracestate?: '...' }

try {
  const job = await origAdd(name, { ...data, _otel: carrier, _requestId, _tenantId, _userId }, opts);
  if (job.id) span.setAttribute(ATTR_MESSAGING_MESSAGE_ID, String(job.id));
  return job;
} catch (err) {
  span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR });
  throw err;
} finally {
  span.end();
}
```

[VERIFIED: `node_modules/.bun/@opentelemetry+api@1.9.1/.../api/propagation.d.ts:29` — `inject<Carrier>(context, carrier, setter?)`; default setter writes via direct property assignment — `defaultTextMapSetter`]
[VERIFIED: `W3CTraceContextPropagator.js:55-57` — writes `tracestate` automatically when `spanContext.traceState` is set]

### Pattern 2: `propagation.extract` + `context.with` Idiom

**What:** Reconstruct the producer's context as a parent, then open a child span inside `context.with(parentCtx, …)` so the child inherits traceId.

**When to use:** Every messaging-system consumer wrapper.

**Example:**
```typescript
// Source: @opentelemetry/api 1.9.1 — extract returns a new Context inheriting from the input
import { context, propagation, trace, SpanKind, ROOT_CONTEXT } from '@opentelemetry/api';

const carrierIn = (job.data as any)?._otel ?? {};
// extract reads 'traceparent' (+ 'tracestate'); if absent, returns the input context unchanged.
const parentCtx = propagation.extract(ROOT_CONTEXT, carrierIn);

// Open the consumer span inside the parent context. The new span inherits
// the producer's traceId; spanId is fresh; parentSpanId references producer.
const tracer = trace.getTracer('baseworks.queue');
return context.with(parentCtx, async () => {
  const span = tracer.startSpan(`${job.queueName} process`, {
    kind: SpanKind.CONSUMER,
    attributes: {
      [ATTR_MESSAGING_SYSTEM]: 'bullmq',
      [ATTR_MESSAGING_DESTINATION_NAME]: job.queueName,
      [ATTR_MESSAGING_OPERATION]: 'process',
      [ATTR_MESSAGING_MESSAGE_ID]: String(job.id ?? ''),
      'messaging.bullmq.attempt': (job.attemptsMade ?? 0) + 1,
    },
  });
  // Make the consumer span active for the processor body so any downstream
  // CQRS/EventBus span opens as a grandchild of producer.
  return context.with(trace.setSpan(parentCtx, span), async () => {
    try {
      return await obsContext.run(jobCtx, () => processor(job, token));
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
});
```

[VERIFIED: `propagation.d.ts:37` — `extract<Carrier>(context, carrier, getter?): Context` (returns a new Context, does not mutate input)]
[VERIFIED: `trace/context-utils.d.ts:20` — `setSpan(context, span): Context` returns a new Context]

### Pattern 3: Wrapped Queue via `Object.assign`

**What:** Wrap a single method on the live Queue instance without subclassing.

**When to use:** When the API is small (1-2 methods) and you want to preserve TypeScript inference of all generic parameters and overloads.

**Example:**
```typescript
// Source: pattern derived from packages/observability/src/wrappers/wrap-cqrs-bus.ts:62-66
import { Queue } from 'bullmq';

export function createQueue(name: string, redisUrl: string): Queue {
  const connection = getRedisConnection(redisUrl);
  const queue = new Queue(name, { connection, defaultJobOptions: { /* ... */ } });

  const origAdd = queue.add.bind(queue);
  const origAddBulk = queue.addBulk.bind(queue);

  // Override only the methods we instrument; everything else (close, pause,
  // getJobs, …) flows through the original instance — type inference for
  // Queue<DataType, ResultType, NameType> is preserved structurally.
  queue.add = (async (jobName: string, data: any, opts?: any) => {
    return wrapAdd(name, origAdd, jobName, data, opts);
  }) as typeof queue.add;

  queue.addBulk = (async (jobs: Array<{ name: string; data: any; opts?: any }>) => {
    const wrappedJobs = jobs.map((j) => ({
      ...j,
      data: injectCarrierIntoData(j.data, name),
    }));
    return origAddBulk(wrappedJobs);
  }) as typeof queue.addBulk;

  return queue;
}
```

**Why not Proxy:** [VERIFIED: `bullmq@5.73.0/.../classes/queue.d.ts:101`] `Queue` extends `QueueGetters` extends `QueueBase` extends `EventEmitter` — there is heavy `this`-bound mutable state. Proxy traps with bound methods are subtle to get right; method-replacement is simpler and matches Phase 18's `wrapCqrsBus` precedent (`bus.execute = ...; bus.query = ...;` — see `packages/observability/src/wrappers/wrap-cqrs-bus.ts:65,108`).

**Why not subclass:** subclassing requires re-declaring the multi-overload `add(name, data, opts?)` with full generic signature `<DataType, ResultType, NameType>`. Type inference on call sites would degrade. `Object.assign`-style override leaves the prototype chain alone.

### Anti-Patterns to Avoid

- **Forgetting `await` on `Queue.add`:** if the producer span is `end()`-ed inside a `finally` after a non-awaited `add`, the span ends before the enqueue actually happens — duration metric is wrong, and exception path can race. Always `await origAdd(...)`.
- **Using port `getTracer()` for the producer span:** [VERIFIED in §Architectural Responsibility Map] NoopTracer's NoopSpan has no SpanContext; `propagation.inject` produces empty carrier. Use `trace.getTracer('baseworks.queue')` from `@opentelemetry/api` directly.
- **Reusing the carrier object across enqueues:** if you allocate `const carrier = {}` once at module scope and reuse, parallel `Queue.add` calls overwrite each other's `traceparent`. **Allocate a fresh `carrier` object per call.** [VERIFIED: `propagation.inject` mutates the carrier in place via the setter — `W3CTraceContextPropagator.js:54`]
- **Mutating `job.data` in the user processor before `wrapProcessorWithAls` reads `_otel`:** the wrap reads `job.data._otel` at the start of the wrapped function — before user code runs — so this is structurally safe in Phase 20. But if a future contributor moves the read inside the user's processor, they'd hit it. Keep the carrier read at the wrap entry.
- **Calling `obsContext.run` inside `context.with` in the wrong order:** `context.with(parentCtx, () => obsContext.run(jobCtx, fn))` is correct. Reversing — `obsContext.run(jobCtx, () => context.with(parentCtx, fn))` — also works for log fields but means OTEL's active context is established AFTER ALS, which can confuse async flows that read `trace.getActiveSpan()` before processor body. Use the form in Pattern 2 above.
- **Double-wrapping `createQueue`:** if a test calls `createQueue` and then somewhere wraps the returned queue again, `add` becomes `wrap(wrap(origAdd))` — two producer spans per enqueue, two carrier injects (the second overwrites the first; final traceparent references the inner span). Single-wrap discipline; `createQueue` is the only wrap site.
- **Closing producer span on rejection without `recordException`:** Phase 18 pattern verified — `recordException(err) + setStatus({ code: 'error' })` then `end()` (or rely on `finally`). Don't omit recordException; without it, Tempo shows a failed span with no exception payload. [VERIFIED: `wrap-cqrs-bus.ts:80-81` and `wrap-event-bus.ts:99-101`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| W3C traceparent string formatting | Manual `00-${traceId}-${spanId}-01` template | `propagation.inject` via `W3CTraceContextPropagator` | Spec has version-byte rules, flag bytes, `tracestate` merging. Errors silent. [VERIFIED: 6 lines of code in `W3CTraceContextPropagator.js:50-58` cover the whole encode] |
| Trace context restoration | Manual `SpanContext` construction from carrier | `propagation.extract` | Must validate format, handle `tracestate` arrays, reject `00ff` version, handle `isRemote=true`. Hand-rolling produces invalid contexts that downstream OTEL collectors reject silently. [VERIFIED: `W3CTraceContextPropagator.js:64-86`] |
| Active context plumbing for async work | Storing parent context in a closure variable | `context.with(parentCtx, fn)` | OTEL's context manager (registered by NodeSDK) handles AsyncLocalStorage propagation across `await` boundaries. Manual closure + `getActiveSpan` will leak across worker concurrency boundaries (Pitfall 3 territory). |
| OTEL semantic attribute keys | String literals like `'messaging.system'` | `ATTR_MESSAGING_SYSTEM` from `@opentelemetry/semantic-conventions/incubating` | One typo silently breaks Grafana dashboards in Phase 21. Constants are zero-cost (`as const` strings). |
| Wrapping `Queue` to preserve types | Hand-typed proxy + manual cast | `Object.assign`-on-instance method override (Pattern 3) | Subclass requires re-declaring the multi-overload generic signature; Proxy with EventEmitter ancestor has subtle `this`-binding traps. Method override on the live instance preserves all generics structurally. |
| Per-attempt span creation timing | Open span once outside processor, end after final attempt | Open/close inside `wrapProcessorWithAls` per invocation (D-10) | BullMQ invokes the processor function once per attempt. Tempo's UI handles N sibling consumer spans under one producer span natively. Reusing one span loses per-attempt timing. |

**Key insight:** OTEL's propagation API is the world's most-tested W3C-trace-context implementation; every "I'll just inject the header myself" path silently breaks `tracestate`, version-byte validation, and the OTEL collector's correlation engine. Hand-rolling literally rebuilds bugs that are already fixed upstream.

## Runtime State Inventory

This is not a rename/refactor phase. Phase 20 adds wrapper code in two files (`packages/queue/src/index.ts` and optionally `packages/observability/src/wrappers/wrap-queue.ts`) and adds two test files. No string renames, no migrations.

The closest concern: **Redis-stored job data shape.** Existing in-flight jobs (queued before Phase 20 ships) will not have `_otel`/`_requestId`/`_tenantId`/`_userId` fields. The consumer extension is graceful — `(job.data as any)?._otel ?? {}` and `?? null` patterns mean Phase 19's fresh-fallback path runs verbatim for these jobs. No migration needed; legacy in-flight jobs become orphan-from-producer traces (D-09 path). Verified safe by inspection of the proposed wrap and Phase 19's existing fresh-fallback behavior at `packages/queue/src/index.ts:60-66`.

## Common Pitfalls

### Pitfall 1: Smoke test runs without a registered global propagator

**What goes wrong:** `propagation.inject` is a no-op; carrier-roundtrip Test 1 sees `_otel: {}` (no `traceparent`). Test fails confusingly because the code "looks right" but the OTEL global has its NoopTextMapPropagator default. [VERIFIED: `node_modules/.bun/@opentelemetry+api@1.9.1/.../api/propagation.js:78` — `_getGlobalPropagator() || NOOP_TEXT_MAP_PROPAGATOR`]

**Why it happens:** `apps/api/src/telemetry.ts` registers W3CTraceContextPropagator via `NodeSDK.start()`. The smoke test at `packages/queue/src/__tests__/carrier-roundtrip.test.ts` lives in the queue package and does NOT (and SHOULD not) import telemetry.ts — so it boots without a registered propagator.

**How to avoid:** At the top of `carrier-roundtrip.test.ts`:
```typescript
import { propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

beforeAll(() => {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});
afterAll(() => {
  propagation.disable();
});
```
This makes the test self-contained and reproducible. The same applies to `apps/api/__tests__/observability-bullmq-trace.test.ts` (D-08) if it does not import telemetry.ts.

**Warning signs:** `_otel.traceparent` is undefined despite the producer span existing; `propagation.fields()` returns `[]`.

### Pitfall 2: Producer wrapper opens span outside the active HTTP span context

**What goes wrong:** Trace tree shows `{queue} publish` as a top-level root span instead of a child of `POST /api/auth/forgot-password`. Operator can't follow API → enqueue visually in Tempo.

**Why it happens:** If the producer wrapper does `tracer.startSpan(...)` without first reading the active context, the new span inherits whatever `context.active()` returns — but if the wrapper accidentally runs inside `ROOT_CONTEXT` (e.g., the `await` chain breaks ALS), the producer becomes a root.

**How to avoid:** `tracer.startSpan(name, options)` automatically uses `context.active()` as parent unless `root: true` is passed in options. Do NOT pass `root: true`. The HTTP span (Phase 19) is in `context.active()` thanks to OTEL's AsyncLocalStorage context manager. Verify with D-07b Test 5 (parent inheritance) — but also: **always run the smoke test inside the imagined HTTP context boundary** so any future regression in OTEL context plumbing surfaces here, not in production.

**Warning signs:** `producerSpan.spanContext().traceId` does not equal `getActiveSpan()?.spanContext().traceId` from the surrounding HTTP middleware.

### Pitfall 3: `obsContext.run` opens a fresh ALS frame *inside* `context.with`, breaking traceId source-of-truth

**What goes wrong:** Worker logs show `traceId === sc.traceId` (consumer span) but downstream code (CQRS handler in the job) sees `getObsContext()?.traceId` and thinks that's the active OTEL traceId. If anything writes a new span via `getTracer()` from the port (NoopTracer ignores) or via `trace.getTracer().startSpan()` (uses real OTEL active span), the two diverge under real-exporter mode in Phase 21.

**Why it happens:** Phase 19's pino mixin reads `traceId` from `obsContext`, NOT from `trace.getActiveSpan()`. Phase 20 must ensure the value seeded into `jobCtx.traceId` matches the active OTEL span — which it does naturally if seeded from `consumerSpan.spanContext().traceId`. But if a future contributor seeds from `parentCtx`'s extracted traceId without opening the consumer span first, the two paths drift.

**How to avoid:** Seed `jobCtx.traceId` and `jobCtx.spanId` from `consumerSpan.spanContext()` AFTER `tracer.startSpan` returns. Pattern 2 above shows this. The OTEL active span and ALS-stored ids are the same value at all times.

**Warning signs:** Test that asserts `pino-captured-log.traceId === activeSpan.spanContext().traceId` fails.

### Pitfall 4: AsyncLocalStorage propagation across `await Queue.add(...)` 

**What goes wrong:** producer wrapper reads `obsContext.getStore()` BEFORE awaiting `origAdd(name, dataWithCarrier, opts)`, but if the read happens after the await for some reason (e.g., refactored to inject inside a `then` callback), Bun's ALS preserves the store across awaits — but only if the await is in the same async chain.

**Why it happens:** ALS semantics in Bun ≥ 1.0 mirror Node's: `getStore()` reads from the current async context, which propagates across `await`. But helpers passed to `Promise.all`, `setImmediate`, or unhandled callbacks can drop the context.

**How to avoid:** Read the store ONCE at the very top of `wrappedAdd`, before any `await`. Pass the captured value into helpers explicitly. The pattern in Pattern 1 above already does this.

**Warning signs:** `_requestId` is `undefined` in the carrier even though the request frame is active. Inspect: was `getStore()` called inside an `await`-then-callback rather than at function entry?

### Pitfall 5: Producer span ended before `Queue.add` resolves (forgotten await)

**What goes wrong:** `span.end()` runs in `finally` but `origAdd(...)` is not awaited — the span ends synchronously while the enqueue is still in-flight. Span duration ≈ 0; if `origAdd` rejects, the rejection happens AFTER `finally` and the catch arm never fires.

**How to avoid:** `await origAdd(...)`; never return the bare promise without awaiting. Same discipline as `wrap-cqrs-bus.ts:75` (`return await origExecute(...)`).

**Warning signs:** Producer span p99 latency in Tempo is microseconds; consumer span starts before producer span ends.

### Pitfall 6: Re-entrant `Queue.add` from a custom adapter / Job lifecycle hook

**What goes wrong:** A handler that runs inside another job calls `wrappedQueue.add(...)` — the producer wrapper opens a span as child of the *consumer* span (correct), but the carrier injected references the new producer span, not the original API request. Trace tree: API → enqueue (Job A) → process Job A → enqueue (Job B) → process Job B. This is the expected behavior, not a bug — but tests that assume linear shape might fail.

**How to avoid:** Document this as expected. Tempo handles multi-hop trace trees natively. D-07b Test 5 should not assume single-hop.

## Code Examples

### Producer wrapper (skeleton)

```typescript
// File: packages/observability/src/wrappers/wrap-queue.ts (NEW, optional location)
// Source: pattern from packages/observability/src/wrappers/wrap-cqrs-bus.ts (Phase 18)
//         + propagation.inject idiom verified against W3CTraceContextPropagator.js

import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import {
  ATTR_MESSAGING_SYSTEM,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_OPERATION,
  ATTR_MESSAGING_MESSAGE_ID,
} from '@opentelemetry/semantic-conventions/incubating';
import type { Queue, JobsOptions } from 'bullmq';
import { obsContext } from '../context';

const TRACER_NAME = 'baseworks.queue';

export function wrapQueue<Q extends Queue>(queue: Q): Q {
  const queueName = queue.name;
  const origAdd = queue.add.bind(queue);
  const origAddBulk = queue.addBulk.bind(queue);

  const injectCarrier = (data: any): any => {
    const store = obsContext.getStore();
    if (!store) return data; // D-09
    return {
      ...data,
      _requestId: store.requestId,
      _tenantId: store.tenantId,
      _userId: store.userId,
    };
  };

  (queue as any).add = async (jobName: string, data: any, opts?: JobsOptions) => {
    const store = obsContext.getStore();
    if (!store) return origAdd(jobName, data, opts); // D-09 — orphan path

    const tracer = trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan(`${queueName} publish`, {
      kind: SpanKind.PRODUCER,
      attributes: {
        [ATTR_MESSAGING_SYSTEM]: 'bullmq',
        [ATTR_MESSAGING_DESTINATION_NAME]: queueName,
        [ATTR_MESSAGING_OPERATION]: 'publish',
      },
    });

    const carrier: Record<string, string> = {};
    propagation.inject(trace.setSpan(context.active(), span), carrier);

    const dataWithCarrier = {
      ...injectCarrier(data),
      _otel: carrier,
    };

    try {
      const job = await origAdd(jobName, dataWithCarrier, opts);
      if (job?.id) span.setAttribute(ATTR_MESSAGING_MESSAGE_ID, String(job.id));
      return job;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  };

  // addBulk: same pattern, looped (one span per item or one umbrella span — planner decides).
  // Recommended: one umbrella span per addBulk call, with messaging.batch.message_count attribute.

  return queue;
}
```

### Consumer extension (in-place edit to `wrapProcessorWithAls`)

```typescript
// File: packages/queue/src/index.ts — extends Phase 19 D-05 wrapper
// Source: synthesized from Phase 19 wrapProcessorWithAls + Pattern 2 above

import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  ROOT_CONTEXT,
} from '@opentelemetry/api';
import {
  ATTR_MESSAGING_SYSTEM,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_OPERATION,
  ATTR_MESSAGING_MESSAGE_ID,
} from '@opentelemetry/semantic-conventions/incubating';

export function wrapProcessorWithAls(processor: Processor): Processor {
  return async (job, token) => {
    const carrierIn = (job.data as any)?._otel ?? {};
    const parentCtx = propagation.extract(ROOT_CONTEXT, carrierIn);
    const tracer = trace.getTracer('baseworks.queue');

    return context.with(parentCtx, async () => {
      const span = tracer.startSpan(`${job.queueName ?? 'unknown'} process`, {
        kind: SpanKind.CONSUMER,
        attributes: {
          [ATTR_MESSAGING_SYSTEM]: 'bullmq',
          [ATTR_MESSAGING_DESTINATION_NAME]: job.queueName ?? 'unknown',
          [ATTR_MESSAGING_OPERATION]: 'process',
          [ATTR_MESSAGING_MESSAGE_ID]: String(job.id ?? ''),
          'messaging.bullmq.attempt': (job.attemptsMade ?? 0) + 1,
        },
      });

      const sc = span.spanContext();
      const jobCtx: ObservabilityContext = {
        requestId: (job.data as any)?._requestId ?? crypto.randomUUID(),
        traceId: sc.traceId, // inherits producer trace when carrier present
        spanId: sc.spanId,   // fresh per attempt (D-10)
        tenantId: (job.data as any)?._tenantId ?? null,
        userId: (job.data as any)?._userId ?? null,
        locale: defaultLocale,
      };

      return context.with(trace.setSpan(parentCtx, span), async () => {
        try {
          return await obsContext.run(jobCtx, () => processor(job, token));
        } catch (err) {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      });
    });
  };
}
```

Note: the `job.queueName` field is available on real BullMQ Job instances. For `fakeJob` test shape, the smoke test should set it explicitly (`{ id, name, data, queueName: 'test-queue' }`).

### Smoke test entry pattern (D-07b)

```typescript
// File: packages/queue/src/__tests__/carrier-roundtrip.test.ts (NEW)
// Source: derived from packages/queue/src/__tests__/create-worker-als.test.ts shape

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { obsContext, type ObservabilityContext } from '@baseworks/observability';
import { defaultLocale } from '@baseworks/i18n';

beforeAll(() => {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});
afterAll(() => {
  propagation.disable();
});

const fakeJob = (data: any = {}, attemptsMade = 0) => ({
  id: 'fake-id',
  name: 'fake-name',
  queueName: 'test-queue',
  data,
  attemptsMade,
}) as any;

// Test 1 — carrier injected from ALS frame
test('producer injects traceparent into _otel when ALS frame active', async () => {
  // ... mock origAdd to capture; assert recorded.data._otel.traceparent matches /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/
});

// Test 2 — round-trip traceId equality
test('worker reconstitutes producer traceId via wrapProcessorWithAls', async () => {
  // ... build fakeJob with carrier from Test 1; pass to wrapProcessorWithAls(processor)(fakeJob); capture inner ALS via getObsContext()
});

// Test 3 — D-09 no-ALS-frame skip
test('skips carrier when obsContext.getStore() is undefined', async () => {
  // ... call wrappedQueue.add OUTSIDE obsContext.run; assert recorded.data._otel === undefined
});

// Test 4 — tracestate forwarding
test('forwards tracestate from active span context when present', async () => {
  // ... open a span with tracestate; call wrappedQueue.add inside; assert recorded.data._otel.tracestate is set
});

// Test 5 — retry attempt parent inheritance
test('per-attempt consumer spans share producer parent', async () => {
  // ... build fakeJob with carrier; call wrapProcessorWithAls twice (attemptsMade=0 then 1);
  //     capture both inner spanIds + traceIds; assert traceIds equal, spanIds differ
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `messaging.operation` (free string) | `messaging.operation.type` (enum) + `messaging.operation.name` | OTEL semconv v1.27 (2024) | OTEL JS 1.40 ships both old + new keys. `ATTR_MESSAGING_OPERATION` ("messaging.operation") is still exported but D-07 calls for it. Phase 21 may migrate to the new pair. [VERIFIED: experimental_attributes.d.ts shows both] |
| Auto-instrumented BullMQ via `@appsignal/...` | Hand-rolled propagation per D-01 | Phase 17 D-12 deferred install | Phase 20 confirms hand-roll. Less prototype patching = better Bun safety. |
| `tracestate` deferred (Phase 19) | `tracestate` forwarded automatically (D-04) | Phase 20 | Operators with vendor-aware exporters keep vendor context across producer→consumer hop. Cost negligible. |
| Producer span = HTTP request span (worker becomes child of HTTP) | Producer span = `{queue} publish` (worker becomes child of publish) | D-06 | Cleaner trace tree; explicit messaging hop visible in Tempo. |

**Deprecated/outdated:**
- `messaging.kafka.message.offset` and other system-specific attributes documented under stable conventions — for BullMQ there is no registered system name (free-form `messaging.system="bullmq"`). [VERIFIED: experimental_attributes.d.ts has `MESSAGING_SYSTEM_VALUE_KAFKA` etc. but no `_BULLMQ`]
- `messaging.servicebus.message.delivery_count` is the only registered "delivery count" attribute (Azure Service Bus-specific). For BullMQ retries, **use `messaging.bullmq.attempt`** as a system-specific extension following the same pattern. Document this clearly. [VERIFIED: experimental_attributes.d.ts:`ATTR_MESSAGING_SERVICEBUS_MESSAGE_DELIVERY_COUNT`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `propagation.inject` mutates the carrier in place via the default object setter (no return value) | Pattern 1, Don't Hand-Roll | LOW — verified at `propagation.js:53` and `W3CTraceContextPropagator.js:54` |
| A2 | `messaging.bullmq.attempt` is the conventional shape for system-namespaced attempt count | D-07 / §State of the Art | LOW — semconv allows free `messaging.{system}.{attr}` per W3C/OTEL spec; not a registered key but conforms to convention. Planner can choose `messaging.message.delivery_count` (unregistered for non-Service-Bus) if preferred. [CITED: OTEL semconv 1.27 messaging.md] |
| A3 | NodeSDK auto-registers W3CTraceContextPropagator at `sdk.start()` time | §Summary, §Pitfall 1 | LOW — `@opentelemetry/sdk-node` documented behavior. Confirmed indirectly by Phase 17 telemetry.ts working without explicit propagator setup. The smoke test pitfall above is the verified consequence. |
| A4 | `job.queueName` is set on real BullMQ Job instances at processor invocation | Pattern 2, Code Examples | LOW — BullMQ Job class exposes `queueName: string`. Test fakeJob must set it explicitly (already noted). [VERIFIED: Job class in `bullmq` types] |
| A5 | `Object.assign`-style method override on `Queue` instance preserves TypeScript inference for `<DataType, ResultType, NameType>` generics across call sites | §Standard Stack Alternatives, Pattern 3 | MEDIUM — preserves runtime behavior; for TS, the `as typeof queue.add` cast is required. Call sites that pass typed payloads (e.g., `EmailJobData`) keep their types because the wrapper does not change the signature, only the implementation. Subclass would have re-declared the signature; method override doesn't. Validate via `tsc --noEmit` over the four call sites. |
| A6 | The default `defaultTextMapSetter` writes via direct property assignment on plain objects (no Map semantics) | Pattern 1 | LOW — verified at `propagation.js:53` (default fallback). For `Record<string,string>` carriers no custom setter is needed. |

**If this table is empty:** N/A — 6 assumptions documented above. None are blocking, but A5 is the planner's most material call (wrapper mechanism). A2 is the highest-touch attribute-naming question and should be confirmed during plan-phase.

## Open Questions

1. **Wrapper location: `packages/queue/src/index.ts` inline vs `packages/observability/src/wrappers/wrap-queue.ts`?**
   - What we know: Phase 18/19 precedent is `packages/observability/src/wrappers/` (`wrap-cqrs-bus.ts`, `wrap-event-bus.ts`). `packages/queue` already imports `@baseworks/observability`.
   - What's unclear: planner trade-off between consolidation (observability owns all wrappers) vs minimal cross-package wiring (queue owns its own wrapper).
   - Recommendation: **Match the Phase 18/19 precedent — extract `wrapQueue` to `packages/observability/src/wrappers/wrap-queue.ts`.** `createQueue` calls it: `return wrapQueue(new Queue(name, { ... }))`. Centralizes "we wrap external libs in OTEL spans" to one place. Keeps `packages/queue` thin.

2. **One umbrella span per `addBulk` or one span per item?**
   - What we know: OTEL messaging conventions support `messaging.batch.message_count` for batch operations. `addBulk` accepts `Array<{ name, data, opts? }>`.
   - What's unclear: per-item spans give per-job carrier independence (each job's `_otel` references its own span); umbrella span is simpler.
   - Recommendation: **Per-item carrier injection (each item gets its own `_otel.traceparent`), single umbrella producer span with `messaging.batch.message_count` attribute.** Each item's `traceparent` references the umbrella span; consumers become siblings under one publish span. Matches OTEL messaging conventions for batch publishers.

3. **Should `_otel` be removed from `job.data` before invoking the user processor?**
   - What we know: `wrapProcessorWithAls` reads `_otel` then calls user `processor(job, token)`. User code may mutate `job.data` or log it.
   - What's unclear: defensive purity (strip `_otel`/`_requestId`/`_tenantId`/`_userId`) vs simplicity (leave them in).
   - Recommendation: **Leave them in** (matches Phase 19 behavior — `_requestId` already stays on `job.data`). Stripping requires either cloning `job.data` (allocation cost on every job) or mutating the job (BullMQ may persist the change back to Redis). Document the convention in `wrapProcessorWithAls` JSDoc.

4. **Is `@opentelemetry/api` reachable as a transitive dep at compile time in `packages/queue`, or does it need to be added explicitly?**
   - What we know: `@baseworks/observability` declares `@opentelemetry/api ^1.9.1` directly. `packages/queue` declares `@baseworks/observability` as a workspace dep.
   - What's unclear: TypeScript path resolution may not surface transitive types depending on package boundaries; Bun workspace resolution likely does.
   - Recommendation: **Add `@opentelemetry/api ^1.9.1` as an explicit dep in `packages/queue/package.json`.** Cost: zero (already on disk via observability). Benefit: explicit dependency graph; no surprise TS errors during build. This is what Phase 18 Plan 04 did for pino: "had it transitively but Bun's workspace resolution did not expose it to the observability package's module graph" (per STATE.md).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@opentelemetry/api` | wrap-queue + wrapProcessorWithAls | ✓ | 1.9.1 (installed) | — |
| `@opentelemetry/semantic-conventions` | Producer + consumer span attributes | ✓ | 1.40.0 (installed) | hardcoded string literals (not recommended) |
| `@opentelemetry/core` (W3CTraceContextPropagator) | Smoke test propagator registration | ✓ | 2.6.1 (installed transitively via sdk-node) | — |
| `bullmq` | Producer wrapper + Queue type | ✓ | 5.73.0 (installed) | — |
| Bun runtime | Test execution | ✓ | (project default) | — |
| Redis | NOT required for tests | — | — | tests stub `Queue.add` (no Redis) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (built-in test runner) |
| Config file | None — Bun test runner auto-discovers `*.test.ts` |
| Quick run command | `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` |
| Full suite command | `bun test packages/queue/ apps/api/__tests__/` |
| Phase gate | Full queue + apps/api suite green before `/gsd-verify-work` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTX-04 | Producer injects `_otel.traceparent` + `_requestId`/`_tenantId`/`_userId` from ALS | unit | `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` | ❌ Wave 0 (NEW per D-07b) |
| CTX-04 | Worker reconstitutes ALS via `obsContext.run` from carrier | unit | `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` (Test 2) | ❌ Wave 0 |
| CTX-04 | API request → enqueue → worker shows single `traceId` across producer + consumer logs | integration (in-process) | `bun test apps/api/__tests__/observability-bullmq-trace.test.ts` | ❌ Wave 0 (NEW per D-08) |
| TRC-03 | Hand-rolled W3C propagator emits valid `traceparent` format | unit | `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` (Test 1 — regex match) | ❌ Wave 0 |
| TRC-03 | `tracestate` forwarded when active context carries it | unit | `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` (Test 4) | ❌ Wave 0 |
| TRC-03 | Per-attempt fresh consumer spans, shared producer parent (D-10) | unit | `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` (Test 5) | ❌ Wave 0 |
| TRC-03 | Smoke test gates merge | merge gate | `bun test packages/queue/` runs in pre-commit / future ci.yml | ❌ Wave 0 |
| (regression) | Phase 19 fresh-fallback path remains green when `_otel` absent | unit | `bun test packages/queue/src/__tests__/create-worker-als.test.ts` | ✅ exists (extend Test 7+) |

### Sampling Rate

- **Per task commit:** `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` (< 2 seconds)
- **Per wave merge:** `bun test packages/queue/ apps/api/__tests__/observability-bullmq-trace.test.ts` (< 5 seconds)
- **Phase gate:** `bun test packages/queue/ apps/api/__tests__/ packages/observability/` — full Phase 19+20 surface, ensures no regression in CqrsBus/EventBus wrappers

### Wave 0 Gaps

- [ ] `packages/queue/src/__tests__/carrier-roundtrip.test.ts` — covers CTX-04 + TRC-03 (5 tests per D-07b)
- [ ] `apps/api/__tests__/observability-bullmq-trace.test.ts` — covers CTX-04 SC#2 in-process assertion (D-08)
- [ ] Test infrastructure: `propagation.setGlobalPropagator(new W3CTraceContextPropagator())` setup in both new files
- [ ] Test fakeJob shape extension: add `queueName: 'test-queue'` field (Phase 19 fakeJob did not include it)
- [ ] (optional) `packages/queue/src/__tests__/create-worker-als.test.ts` extension — Test 7+ asserting carrier-extract path inherits producer traceId

No framework install needed — `bun test` is built in. Reuse Phase 19's pino-test-transport pattern at `apps/api/__tests__/observability-context-bleed.test.ts` for D-08's log-line capture.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 20 does not touch auth surfaces |
| V3 Session Management | no | No session handling |
| V4 Access Control | no | No new endpoints; carrier injection is internal |
| V5 Input Validation | yes (limited) | Worker MUST treat `job.data._otel` as untrusted — `propagation.extract` validates W3C format and rejects malformed input (returns context unchanged). [VERIFIED: `W3CTraceContextPropagator.js:64-71` returns `context` if no header or invalid format] |
| V6 Cryptography | no | traceparent is not cryptographic; not PII |
| V7 Error Handling | yes | Producer wrapper must `recordException` + `setStatus({ code: 'error' })` then rethrow. Phase 18 capture wiring at `apps/api/src/worker.ts:70` handles error tracking. |
| V14 Configuration | no | No new env vars |

### Known Threat Patterns for Bun + BullMQ + OTEL

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious `_otel.traceparent` value (e.g., from a compromised upstream service) injecting a chosen traceId into the worker's trace tree | Spoofing | `propagation.extract` validates the W3C format (regex `^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})`); invalid values are silently ignored. Worker traceId then comes from a fresh-trace path. No code action needed. [VERIFIED: `W3CTraceContextPropagator.js:25-40`] |
| Carrier-as-side-channel (large `_otel` payload) bloating Redis | DoS | `traceparent` is fixed at 55 bytes; `tracestate` is bounded by W3C spec to 512 chars. Carrier shape is `{traceparent, tracestate?}` only — no other keys propagated. Negligible footprint per job. |
| `_requestId`/`_tenantId`/`_userId` carrying PII into Redis | Information Disclosure | These are already used today by Phase 19 (`_requestId` in job.data). `_tenantId`/`_userId` are opaque IDs (UUIDs/strings), not raw PII. They live in Redis no longer than `removeOnComplete: 3 days` / `removeOnFail: 7 days` (existing `defaultJobOptions` at `packages/queue/src/index.ts:21-23`). Phase 18 ERR-04 PII scrubbing already runs on captured errors; this is documented data flow, not a new exposure surface. |
| Tenant-A's traceId leaking into Tenant-B's worker logs via stale ALS | Information Disclosure (cross-tenant bleed) | Phase 19 D-05 + D-24 (enterWith ban) already prevents this. Phase 20's wrapProcessorWithAls strictly opens a fresh `obsContext.run` per attempt; no enterWith introduced. Verified by extending Phase 19's `create-worker-als.test.ts` Test 8 (no frame bleed across concurrent jobs). |

**No new env vars introduced.** No DSN, no token. Phase 17's `validateObservabilityEnv()` continues to gate startup; Phase 20 adds nothing to its responsibilities.

## Project Constraints (from CLAUDE.md)

| Constraint | Phase 20 Compliance |
|------------|---------------------|
| **Bun runtime** | All wrapper code uses Bun-compatible APIs (`crypto.randomUUID`, plain `async`/`await`, `AsyncLocalStorage`). No Node-only modules. `@opentelemetry/api` is header-only. ✓ |
| **No Prisma; Drizzle only** | No DB code in Phase 20. ✓ |
| **`bun test` for backend tests** | Both new test files use `import { describe, test, expect } from 'bun:test'`. ✓ |
| **No `dotenv`; Bun loads `.env` natively** | No env vars introduced. ✓ |
| **Biome as linter/formatter** | All new files must pass `bun run lint` (existing config). ✓ |
| **No `pg` (use postgres.js)** | Not applicable to Phase 20. |
| **better-auth (not NextAuth)** | Not applicable. |
| **Stripe-only payments** | Not applicable. |
| **modular backend / no edits to `apps/api/src/core`** | Phase 20 wraps externally (D-02); zero edits to `apps/api/src/core/cqrs.ts`, `event-bus.ts`, or any handler. ✓ |

**GSD Workflow Enforcement:** Phase 20 work goes through `/gsd-execute-phase`. ✓

## Sources

### Primary (HIGH confidence)
- `node_modules/.bun/@opentelemetry+api@1.9.1/node_modules/@opentelemetry/api/build/src/api/propagation.d.ts` and `.js` — `propagation.inject`/`extract` signatures + runtime behavior (default Noop fallback)
- `node_modules/.bun/@opentelemetry+api@1.9.1/.../trace/context-utils.d.ts` — `setSpan(context, span): Context`
- `node_modules/.bun/@opentelemetry+api@1.9.1/.../trace/span_kind.d.ts` — `SpanKind` enum (PRODUCER=3, CONSUMER=4)
- `node_modules/.bun/@opentelemetry+core@2.6.1+.../trace/W3CTraceContextPropagator.js` — `traceparent`/`tracestate` encoding/decoding source
- `node_modules/.bun/@opentelemetry+semantic-conventions@1.40.0/.../experimental_attributes.d.ts` — `ATTR_MESSAGING_*` constants
- `node_modules/.bun/bullmq@5.73.0/.../classes/queue.d.ts` — `Queue.add` and `Queue.addBulk` overload signatures with generics `<DataType, ResultType, NameType>`
- `packages/observability/src/context.ts`, `factory.ts`, `ports/tracer.ts`, `ports/types.ts` — Phase 17/19 ALS + tracer port
- `packages/observability/src/wrappers/wrap-cqrs-bus.ts`, `wrap-event-bus.ts` — Phase 18/19 wrapper precedent
- `packages/queue/src/index.ts` — Phase 19 wrapProcessorWithAls + createWorker
- `packages/queue/src/__tests__/create-worker-als.test.ts` — Phase 19 fakeJob test shape
- `apps/api/src/telemetry.ts` — Phase 17 NodeSDK bootstrap (auto-registers W3C propagator)
- `.planning/phases/19-context-logging-http-cqrs-tracing/19-07-SUMMARY.md` — Phase 19 handoff notes for Phase 20
- `.planning/phases/20-bullmq-trace-propagation/20-CONTEXT.md` — locked decisions D-01..D-10
- `.planning/REQUIREMENTS.md` — CTX-04, TRC-03 acceptance text

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` §"Pitfall 2: BullMQ trace context not injected" — playbook this phase implements
- `.planning/research/STACK.md` — BullMQ instrumentation rows (AppSignal lib MEDIUM Bun-compat risk; D-01 elects hand-roll)
- `.planning/research/ARCHITECTURE.md` §874 — hand-rolled wrappers stance
- W3C Trace Context spec — `traceparent` format and `tracestate` opaque list (referenced by W3CTraceContextPropagator.js verbatim)
- OTEL messaging semantic conventions v1.27 — `messaging.system`, `messaging.operation`, `messaging.message.id` (verified against installed semconv 1.40.0)

### Tertiary (LOW confidence)
- None — every load-bearing claim verified against installed source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified against `node_modules` install dir; signatures verified against `.d.ts` files
- Architecture: HIGH — Phase 19 wrapper pattern is the model; OTEL `propagation.inject`/`extract` semantics verified against propagator source
- Pitfalls: HIGH — propagator-not-registered pitfall verified by reading `propagation.js` runtime; producer-as-orphan pitfall verified by `tracer.startSpan` default-active-context behavior

**Research date:** 2026-04-25
**Valid until:** 2026-05-25 (30 days; OTEL JS API and BullMQ are stable; semconv messaging definitions stabilized in 1.27)
