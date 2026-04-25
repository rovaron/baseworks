# Phase 20: BullMQ Trace Propagation - Pattern Map

**Mapped:** 2026-04-25
**Files analyzed:** 5 (2 modified, 3 new)
**Analogs found:** 5 / 5 (100% coverage — Phase 19/18 wrapper precedents are direct mirrors)

## File Classification

| New/Modified File | Status | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|--------|------|-----------|----------------|---------------|
| `packages/queue/src/index.ts` | MODIFIED | infrastructure factory + processor wrapper | event-driven (producer-side inject + consumer-side extract) | Self (Phase 19 `wrapProcessorWithAls`) + `packages/observability/src/wrappers/wrap-event-bus.ts` | exact (extension-in-place) |
| `packages/observability/src/wrappers/wrap-queue.ts` | NEW (optional, D-02 Discretion) | wrapper module | event-driven (pub-side) | `packages/observability/src/wrappers/wrap-cqrs-bus.ts` + `wrap-event-bus.ts` | exact (sibling file in same directory) |
| `packages/queue/src/__tests__/carrier-roundtrip.test.ts` | NEW (D-07b) | test (smoke / merge gate) | request-response (inject → assert → extract → assert) | `packages/queue/src/__tests__/create-worker-als.test.ts` | exact (same `fakeJob` shape, same describe/test layout) |
| `packages/queue/src/__tests__/create-worker-als.test.ts` | EXTEND (Test 7+) | test | event-driven (consumer extract assertions) | Self — append carrier-extract tests after existing Phase 19 Test 1–9 block | exact (same file extended) |
| `apps/api/__tests__/observability-bullmq-trace.test.ts` | NEW (D-08) | test (E2E in-process) | request-response → event-driven (HTTP→producer→consumer) | `apps/api/__tests__/observability-context-bleed.test.ts` (Phase 19) | exact (pino capture stream + Elysia probe app pattern) |

---

## Pattern Assignments

### `packages/queue/src/index.ts` (MODIFIED) — `createQueue` producer wrap + `wrapProcessorWithAls` consumer extension

**Primary analog A (consumer side):** Phase 19 `wrapProcessorWithAls` already lives in this file. Phase 20 extends in place — signature locked, body grows.

**Primary analog B (producer side, wrapper idiom):** `packages/observability/src/wrappers/wrap-cqrs-bus.ts` and `wrap-event-bus.ts` — same pattern: `Object.assign`-style method override, `bind(bus)` to capture original, read ALS via `obsContext.getStore()`, open span via factory tracer, `recordException + setStatus` on throw.

#### Producer-wrap idiom (D-02, D-06) — copy from `wrap-cqrs-bus.ts:62-66, 65-106`

```typescript
// packages/observability/src/wrappers/wrap-cqrs-bus.ts:61-106
const tracer = getTracer();
const origExecute = bus.execute.bind(bus);
const origQuery = bus.query.bind(bus);

(bus as BusLike).execute = async (
  command: string,
  input: unknown,
  ctx: unknown,
) => {
  const store = obsContext.getStore();
  return tracer.withSpan(
    "cqrs.command",
    async (span) => {
      try {
        return await origExecute(command, input, ctx);
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: "error" });
        tracker.captureException(err, { /* ... */ });
        throw err;
      }
    },
    { attributes: { /* ... */ } },
  );
};
```

**Differences Phase 20 must encode in `createQueue`:**

1. **Use `@opentelemetry/api` directly, not the `Tracer` port** — RESEARCH §"Anti-Patterns to Avoid" line 382 is explicit:
   - `getTracer()` (port) returns `NoopTracer` whose span has no real `SpanContext`; `propagation.inject` would write an empty `traceparent`. Use `trace.getTracer('baseworks.queue')` from `@opentelemetry/api` directly so the W3C propagator has a real span context to encode.
   - This is a deliberate deviation from `wrap-cqrs-bus.ts` (which uses the port). Document it inline in the wrapper.
2. **D-09 short-circuit** — call `origAdd(name, data, opts)` unwrapped when `obsContext.getStore()` is `undefined`; do not open a span and do not write `_otel`. `wrap-cqrs-bus.ts` always opens a span (CQRS dispatches are always inside a request frame); the queue wrapper must not (repeatable jobs / error-capture jobs run outside any frame).
3. **Carrier injection step** — between `startSpan` and `origAdd`:
   ```typescript
   const carrier: Record<string, string> = {}; // fresh per call (anti-pattern §383)
   propagation.inject(trace.setSpan(context.active(), span), carrier);
   const dataWithCarrier = {
     ...data,
     _otel: carrier,
     _requestId: store.requestId,
     _tenantId: store.tenantId,
     _userId: store.userId,
   };
   ```
4. **OTEL semconv attributes** (D-07) — `messaging.system='bullmq'`, `messaging.destination.name=queueName`, `messaging.operation='publish'`, `messaging.message.id=job.id` (set after `await origAdd` returns). Use the `ATTR_MESSAGING_*` re-exports from `@opentelemetry/semantic-conventions/incubating` (RESEARCH line 256, 497) — consistent with the rest of `packages/observability` already importing from this package.
5. **`addBulk` extension** — `wrap-cqrs-bus.ts` only has two methods; queue has `add` + `addBulk`. Both must be wrapped. RESEARCH line 554 recommends one umbrella span per `addBulk` call (with `messaging.batch.message_count`); planner confirms.
6. **Async vs sync** — `wrap-event-bus.ts:60-79` shows the sync `emit` path (fire-and-forget `void tracer.withSpan(...)`); `wrap-cqrs-bus.ts:65` is async. `Queue.add` returns a `Promise<Job>` — use the async pattern from `wrap-cqrs-bus.ts`. Producer span MUST be `await`-ed to end inside the `finally` so duration measures the actual enqueue (RESEARCH anti-pattern §381).

#### Imports pattern — copy from `wrap-cqrs-bus.ts:32-34`

```typescript
import type { ErrorTracker } from "../ports/error-tracker";
import { obsContext } from "../context";
import { getTracer } from "../factory";
```

**Phase 20 imports the wrapper needs (in `packages/queue/src/index.ts`):**

```typescript
import { Queue, Worker } from "bullmq";
import type { Processor, JobsOptions } from "bullmq";
import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  ROOT_CONTEXT,
} from "@opentelemetry/api";
import {
  ATTR_MESSAGING_SYSTEM,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_OPERATION,
  ATTR_MESSAGING_MESSAGE_ID,
} from "@opentelemetry/semantic-conventions/incubating";
import { getRedisConnection } from "./connection";
import type { WorkerConfig } from "./types";
import { obsContext, type ObservabilityContext } from "@baseworks/observability";
import { defaultLocale } from "@baseworks/i18n";
```

Both `@opentelemetry/api` and `@opentelemetry/semantic-conventions` are direct deps of `@baseworks/observability` (`packages/observability/package.json:10,14`). Planner confirms whether they need to be added as direct deps in `packages/queue/package.json` or are reachable transitively.

#### Consumer extension (D-05) — extend Phase 19 `wrapProcessorWithAls` body in place

**Current code to preserve byte-for-byte (Phase 19 fresh-fallback):** `packages/queue/src/index.ts:57-69`

```typescript
export function wrapProcessorWithAls(processor: Processor): Processor {
  return (job, token) => {
    const jobCtx: ObservabilityContext = {
      requestId: (job.data as any)?._requestId ?? crypto.randomUUID(),
      traceId: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
      spanId: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      locale: defaultLocale,
      tenantId: null,
      userId: null,
    };
    return obsContext.run(jobCtx, () => processor(job, token));
  };
}
```

**Phase 20 extends to (synthesized from RESEARCH §561-624 + Pattern 2):**

```typescript
export function wrapProcessorWithAls(processor: Processor): Processor {
  return async (job, token) => {
    const carrierIn = (job.data as any)?._otel ?? {};
    const parentCtx = propagation.extract(ROOT_CONTEXT, carrierIn);
    const tracer = trace.getTracer("baseworks.queue");

    return context.with(parentCtx, async () => {
      const span = tracer.startSpan(`${job.queueName ?? "unknown"} process`, {
        kind: SpanKind.CONSUMER,
        attributes: {
          [ATTR_MESSAGING_SYSTEM]: "bullmq",
          [ATTR_MESSAGING_DESTINATION_NAME]: job.queueName ?? "unknown",
          [ATTR_MESSAGING_OPERATION]: "process",
          [ATTR_MESSAGING_MESSAGE_ID]: String(job.id ?? ""),
          "messaging.bullmq.attempt": (job.attemptsMade ?? 0) + 1,
        },
      });

      const sc = span.spanContext();
      const jobCtx: ObservabilityContext = {
        requestId: (job.data as any)?._requestId ?? crypto.randomUUID(),
        traceId: sc.traceId,           // inherits producer trace when carrier present
        spanId: sc.spanId,             // fresh per attempt (D-10)
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

**Critical invariants (regression boundaries):**

- The fresh-fallback path — when `carrierIn` is `{}`, `propagation.extract(ROOT_CONTEXT, {})` returns a context with no active span; `tracer.startSpan` then opens a NEW root span; `sc.traceId`/`sc.spanId` are fresh — **identical observable behavior to Phase 19**. Test 3 + Test 4 in `create-worker-als.test.ts` (lines 49–82) MUST stay green.
- `obsContext.run(jobCtx, ...)` is invoked inside `context.with(trace.setSpan(parentCtx, span), ...)`. RESEARCH anti-pattern §385 spells out the order: OTEL active context FIRST, then ALS. Reversing breaks `trace.getActiveSpan()` reads inside the processor body.
- Outer `obsContext.run` semantics — Test 9 (line 145) verifies inner frame seed wins over outer; the new code preserves this since `obsContext.run(jobCtx, ...)` is still a fresh frame.
- **Locale** — Phase 20 D-05 keeps `defaultLocale` (carrier-locale forwarding deferred per CONTEXT.md). Don't forward `_locale` from carrier in this phase.

---

### `packages/observability/src/wrappers/wrap-queue.ts` (NEW, optional — Claude's Discretion)

**Analog:** `packages/observability/src/wrappers/wrap-cqrs-bus.ts` and `wrap-event-bus.ts` (sibling files in same directory).

**Decision criterion (CONTEXT.md line 113-114):** if planner extracts the producer wrapper here, `packages/queue/src/index.ts` imports `wrapQueue` from `@baseworks/observability` and calls it inside `createQueue` to wrap the freshly-constructed `Queue`. Otherwise the producer wrap inlines in `packages/queue/src/index.ts` and this file is not created.

**File-header docstring template — copy structure from `wrap-event-bus.ts:1-26`:**

```typescript
/**
 * External Queue producer wrapper (CTX-04 / TRC-03 / Phase 20 D-02, D-06).
 *
 * Wraps `queue.add` and `queue.addBulk` so every enqueue opens a
 * `{queue.name} publish` span (kind=producer) and writes a W3C `traceparent`
 * (+ optional `tracestate`, D-04) into `job.data._otel`. ALS-derived fields
 * (`requestId`, `tenantId`, `userId`) land flat at top level for back-compat
 * with Phase 19 `wrapProcessorWithAls`.
 *
 * No edits to the four queue.add call sites in auth/billing/example/observability;
 * this wrapper attaches inside packages/queue/src/index.ts:createQueue().
 *
 * Design rules (mirror wrap-cqrs-bus.ts + wrap-event-bus.ts):
 * - `wrapQueue<Q extends Queue>(queue: Q): Q` — bus mutated in place and returned.
 * - D-09 short-circuit: when obsContext.getStore() is undefined, call origAdd
 *   unmodified (no span, no carrier, no _requestId/_tenantId/_userId). Worker
 *   side falls through to Phase 19 fresh-trace path.
 * - Uses `trace.getTracer('baseworks.queue')` from @opentelemetry/api directly,
 *   NOT the Tracer port — Pitfall verified in RESEARCH.md anti-pattern §382:
 *   NoopSpan has no real SpanContext, propagation.inject would emit an empty
 *   traceparent. Phase 21 OtelTracer adoption is independent.
 * - On throw: span.recordException + setStatus({ code: SpanStatusCode.ERROR })
 *   inside finally-end; rethrow original error unchanged. Mirrors wrap-cqrs-bus.ts:80-94.
 */
```

**Type narrowing pattern — copy from `wrap-event-bus.ts:36-40`:**

```typescript
// Imported directly because BullMQ Queue is the actual library type and
// already used in packages/queue/src/index.ts. No structural narrowing needed.
import type { Queue, JobsOptions } from "bullmq";

export function wrapQueue<Q extends Queue>(queue: Q): Q { /* ... */ }
```

Unlike `BusLike` / `EventBusLike` (which exist to break cross-package type cycles with apps/api), `Queue` is the upstream BullMQ type — `@baseworks/observability` already depends on `@opentelemetry/api`, and adding a peer-dep on `bullmq` is acceptable (or use `import type` only — bullmq types are zero-runtime).

---

### `packages/queue/src/__tests__/carrier-roundtrip.test.ts` (NEW — D-07b smoke gate)

**Analog:** `packages/queue/src/__tests__/create-worker-als.test.ts` (sibling file).

**Imports + describe shell — copy from `create-worker-als.test.ts:1-21`:**

```typescript
import { describe, test, expect } from "bun:test";
import type { Processor } from "bullmq";
import {
  obsContext,
  getObsContext,
  type ObservabilityContext,
} from "@baseworks/observability";
import { defaultLocale } from "@baseworks/i18n";
import { wrapProcessorWithAls } from "../index";

const fakeJob = (data: any = {}) => ({ id: "fake-id", name: "fake-name", data }) as any;
```

**Phase 20 must add (per RESEARCH §634-642):**

```typescript
import { propagation } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

beforeAll(() => {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});
afterAll(() => {
  propagation.disable();
});

const fakeJob = (data: any = {}, attemptsMade = 0) => ({
  id: "fake-id",
  name: "fake-name",
  queueName: "test-queue",
  data,
  attemptsMade,
}) as any;
```

**Differences from the analog:**

1. **`fakeJob` gets two new fields** — `queueName` (consumed by the new consumer-span name template `${job.queueName} process`) and `attemptsMade` (consumed by `messaging.bullmq.attempt`).
2. **Global propagator setup in `beforeAll`** — without `setGlobalPropagator`, `propagation.inject` is a no-op (default global propagator is a `NoopTextMapPropagator`). RESEARCH §641 verified.
3. **`@opentelemetry/core`** (where `W3CTraceContextPropagator` lives) is a transitive dep of `@opentelemetry/api`/sdk-node — confirm at planning time the import resolves; otherwise add as devDep on `packages/queue`.
4. **Mocking `Queue.add`** — Test 1 needs a way to capture the recorded payload without a real Redis. Either:
   - Construct a stubbed `Queue`-shaped object and pass through the wrapper directly (preferred — matches `fakeJob` philosophy); OR
   - Use `bun:test`'s `mock.module` to stub `bullmq`.
5. **Five tests vs Phase 19's nine** — D-07b enumerates exact tests:

| Test # | Assertion | CONTEXT.md ref |
|--------|-----------|----------------|
| 1 | Producer injects valid `_otel.traceparent` matching `/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/`; `_requestId/_tenantId/_userId` set | D-07b Test 1 (line 95) |
| 2 | Round-trip — feed Test 1's recorded payload into `wrapProcessorWithAls`; assert inner ALS `traceId === KNOWN_TRACE_ID` | D-07b Test 2 (line 96) |
| 3 | D-09 — call wrapper outside `obsContext.run`; assert no `_otel`, no `_requestId/_tenantId/_userId`; downstream `wrapProcessorWithAls` falls to fresh path | D-07b Test 3 (line 97) |
| 4 | D-04 — open a span with `tracestate` set on the active span context; assert `_otel.tracestate` is present in recorded payload | D-07b Test 4 (line 98) |
| 5 | D-10 — invoke `wrapProcessorWithAls` twice with same fakeJob carrier (mutate `attemptsMade` 0→1); assert two distinct `spanId`s but same `traceId` (parent inheritance) | D-07b Test 5 (line 99) |

**Capture pattern for inner ALS (copy from `create-worker-als.test.ts:23-35`):**

```typescript
let captured: ObservabilityContext | undefined;
const processor: Processor = async (_job) => {
  captured = getObsContext();
};
const wrapped = wrapProcessorWithAls(processor);
await wrapped(fakeJob({ _requestId: "from-api-request" }), "fake-token");
expect(captured?.requestId).toBe("from-api-request");
```

---

### `packages/queue/src/__tests__/create-worker-als.test.ts` (EXTEND)

**Analog:** itself — extend in place.

**Existing 9 tests (lines 22–176) must stay green byte-for-byte.** They cover the Phase 19 fresh-fallback path, which Phase 20 preserves structurally.

**New tests Phase 20 appends (per CONTEXT.md line 174 — "Test 7+: when `job.data._otel` present, ALS frame inherits producer traceId"):**

```typescript
// Test 10 — carrier-extract path inherits producer traceId
test("Test 10: producer carrier in job.data._otel seeds inner ALS traceId", async () => {
  // Build a known carrier via propagation.inject inside an outer span.
  // Pass a fakeJob with that carrier through wrapProcessorWithAls.
  // Assert captured.traceId === <traceId encoded in the carrier>.
});

// Test 11 — _tenantId / _userId carrier fields propagate
test("Test 11: _tenantId and _userId from job.data seed inner ALS frame", async () => {
  // fakeJob({ _tenantId: 'T-123', _userId: 'U-456', _requestId: 'R-789' })
  // Assert captured.tenantId === 'T-123', captured.userId === 'U-456'.
});

// Test 12 — fresh-fallback regression — _otel absent → behavior identical to Phase 19
test("Test 12: absent _otel falls back to Phase 19 fresh-trace path", async () => {
  // fakeJob({}) — no _otel, no _tenantId
  // Assert captured.traceId matches /^[0-9a-f]{32}$/ (fresh) and is not "0".repeat(32).
});
```

**Note:** The `fakeJob` helper at line 20 needs `queueName` added to support the new span-name template. Either widen the helper or add `queueName: "test-queue"` to each new fakeJob call.

**Setup requirement:** Tests 10–12 need the global propagator registered (mirror `carrier-roundtrip.test.ts` `beforeAll`). Add a top-level `beforeAll/afterAll` block at the file scope, or a module-scoped one inside the describe. Be mindful: existing Tests 1–9 ran without the propagator and must still run cleanly with it set (the propagator only activates when `propagation.inject/extract` is called — calling neither in Tests 1–9 means zero observable impact).

---

### `apps/api/__tests__/observability-bullmq-trace.test.ts` (NEW — D-08 single-trace E2E)

**Analog:** `apps/api/__tests__/observability-context-bleed.test.ts` (Phase 19).

#### Pino capture pattern — copy from `observability-context-bleed.test.ts:46-56`

```typescript
type Captured = Record<string, unknown>;

function buildProbeApp(captured: Captured[]): Elysia {
  const stream = {
    write: (chunk: string) => {
      captured.push(JSON.parse(chunk));
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: pino destination type.
  const testLogger = pino(
    { level: "info", mixin: () => obsContext.getStore() ?? {} },
    stream as any,
  );
  return new Elysia().get("/probe", ({ request }) => { /* ... */ });
}
```

#### Seed-then-handle pattern — copy from `observability-context-bleed.test.ts:72-101`

```typescript
async function handle(app: Elysia, /* ... */): Promise<{ /* ... */ }> {
  const requestId = `r-${Math.random().toString(36).slice(2, 10)}`;
  const req = new Request("http://localhost/probe", {
    headers: { "x-request-id": requestId },
  });
  const seed = {
    requestId,
    traceId: "t".repeat(32),
    spanId: "s".repeat(16),
    locale: "en" as const,
    tenantId: null,
    userId: null,
  };
  const res = await obsContext.run(seed, () => app.handle(req));
  // ...
}
```

#### Phase 20 differences

1. **Probe endpoint enqueues via wrapped queue.** The route inside `buildProbeApp` calls `wrappedQueue.add(...)` (where `wrappedQueue` is the result of `createQueue` — Phase 20's upgrade). The handler also emits `testLogger.info({ at: "producer-side" }, "...")` so the captured stream records a producer-side log line.
2. **Stub `Queue.add` to capture carrier (no Redis).** The test must avoid a live Redis. Two approaches:
   - Call `setTracer(...)` is irrelevant here (we want the real `@opentelemetry/api` tracer, not the port). Instead, build a stub Queue object that `wrapQueue` accepts, OR:
   - Construct a real `Queue` with a fake connection and override `queue.add` at construction time before wrapping.
   - Recommended: lift the producer wrap into a free function `wrapAddInto(queueName, origAdd, name, data, opts)` and call it directly in the test with a fake `origAdd`. This sidesteps Redis entirely and matches `wrapProcessorWithAls`'s testability shape.
3. **Replay the captured carrier through `wrapProcessorWithAls`.** Build a `fakeJob` with `data` = the recorded enqueue payload; run `wrapProcessorWithAls(workerProcessor)(fakeJob, "token")`; the worker processor calls `testLogger.info({ at: "consumer-side" }, "...")`.
4. **Single-trace assertion (SC#2 sans Tempo, deferred to Phase 21).** Filter `captured` by `at`:
   ```typescript
   const producerLog = captured.find((l) => l.at === "producer-side");
   const consumerLog = captured.find((l) => l.at === "consumer-side");
   expect(producerLog?.traceId).toBe(consumerLog?.traceId);
   expect(producerLog?.requestId).toBe(consumerLog?.requestId);
   expect(producerLog?.tenantId).toBe(consumerLog?.tenantId);
   ```
5. **Global propagator setup** — same `beforeAll(() => propagation.setGlobalPropagator(new W3CTraceContextPropagator()))` as `carrier-roundtrip.test.ts`.

**File location:** `apps/api/__tests__/` (sibling of `observability-context-bleed.test.ts`). No `apps/api/__tests__/` subdirectory restructuring needed.

---

## Shared Patterns

### S1. Wrapper-as-method-override idiom (cross-cutting)

**Source:** `packages/observability/src/wrappers/wrap-cqrs-bus.ts:62-66` and `wrap-event-bus.ts:57-58`

**Apply to:** `wrap-queue.ts` (or inline in `createQueue`)

```typescript
const origAdd = queue.add.bind(queue);
const origAddBulk = queue.addBulk.bind(queue);

(queue as Queue).add = async (jobName, data, opts) => {
  // wrapper body
};
```

**Why this pattern over Proxy or subclass** (RESEARCH §375-377): preserves TypeScript inference of generic overloads (`Queue<DataType, ResultType, NameType>`), avoids subtle Proxy/this-bound-method bugs in `EventEmitter` ancestors, and matches the existing Phase 18/19 wrapper precedent. Single-wrap discipline (RESEARCH anti-pattern §386): `createQueue` is the only wrap site.

### S2. Span error path — record-then-rethrow

**Source:** `wrap-cqrs-bus.ts:80-94` and `wrap-event-bus.ts:97-101`

**Apply to:** Both producer span (in `wrap-queue.ts` / `createQueue`) and consumer span (in `wrapProcessorWithAls`).

```typescript
} catch (err) {
  span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR }); // (or "error" string in port shape)
  throw err;
} finally {
  span.end();
}
```

**Note:** Phase 20 uses `@opentelemetry/api`'s `SpanStatusCode.ERROR` (enum), NOT the port's `"error"` string literal. Port and OTEL API both work — pick OTEL because Phase 20 imports OTEL types directly.

### S3. ALS-frame-as-source-of-truth at producer side

**Source:** `wrap-cqrs-bus.ts:70` (`const store = obsContext.getStore()`) — same line in `wrap-event-bus.ts:61`

**Apply to:** Producer wrapper. Read once at the top of the wrapped method; cascade `store.requestId`/`store.tenantId`/`store.userId` into both span attributes (D-07: `tenant.id`, `user.id`, `request.id`) AND the carrier flat fields (`_requestId`, `_tenantId`, `_userId`).

```typescript
const store = obsContext.getStore();
if (!store) return origAdd(jobName, data, opts); // D-09 short-circuit (Phase 20-specific)
// else proceed with span + carrier injection
```

**Phase 20-specific:** The `if (!store) return origAdd(...)` short-circuit is unique to the queue wrapper — `wrap-cqrs-bus.ts` and `wrap-event-bus.ts` always proceed (CQRS dispatches and event emits are always inside a request frame today). The queue is uniquely exposed to scheduler-driven and error-handler-driven enqueues outside any frame.

### S4. Test transport for capturing pino lines

**Source:** `apps/api/__tests__/observability-context-bleed.test.ts:46-56`

**Apply to:** `apps/api/__tests__/observability-bullmq-trace.test.ts`

```typescript
const captured: Record<string, unknown>[] = [];
const stream = { write: (chunk: string) => { captured.push(JSON.parse(chunk)); } };
const testLogger = pino(
  { level: "info", mixin: () => obsContext.getStore() ?? {} },
  stream as any,
);
```

This pattern auto-stamps `traceId/spanId/requestId/tenantId/userId` on every log line via the Phase 19 mixin — exactly what the SC#2 single-trace assertion needs.

### S5. Fake-job test shape

**Source:** `packages/queue/src/__tests__/create-worker-als.test.ts:20`

**Apply to:** `carrier-roundtrip.test.ts` and the new tests appended to `create-worker-als.test.ts`.

```typescript
const fakeJob = (data: any = {}) => ({ id: "fake-id", name: "fake-name", data }) as any;
```

**Phase 20 widening:** Add `queueName: "test-queue"` and optional `attemptsMade: number` so the new wrapper code reads them without `?.` cascades. RESEARCH note line 626 calls this out explicitly.

---

## No Analog Found

None. Every Phase 20 file has a strong precedent in Phase 18 / Phase 19 — this phase is a deliberate symmetric extension of the wrapper pattern to the queue subsystem.

---

## Metadata

**Analog search scope:**
- `packages/observability/src/wrappers/` (3 files — `wrap-cqrs-bus.ts`, `wrap-event-bus.ts`, plus 2 supporting types)
- `packages/queue/src/` (4 files — `index.ts`, `connection.ts`, `types.ts`, `__tests__/`)
- `packages/queue/src/__tests__/create-worker-als.test.ts` (Phase 19 D-05 test shape)
- `apps/api/__tests__/observability-context-bleed.test.ts` (Phase 19 pino-capture E2E shape)
- `packages/observability/src/factory.ts` + `ports/tracer.ts` (port surface confirmed; Phase 20 bypasses port for OTEL API directly per RESEARCH §382)
- `packages/observability/package.json` (confirms `@opentelemetry/api` ^1.9.1 and `@opentelemetry/semantic-conventions` ^1.40.0 are direct deps)
- `packages/queue/package.json` (confirms `@opentelemetry/api` is NOT yet a direct dep — planner decision)

**Files scanned:** ~12 (early-stop at 5 strong analogs + 4 dependency-confirmation reads)
**Pattern extraction date:** 2026-04-25

---

*Phase: 20-bullmq-trace-propagation*
