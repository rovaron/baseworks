---
phase: 20-bullmq-trace-propagation
reviewed: 2026-04-26T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - apps/api/__tests__/logger-callsite-invariance.test.ts
  - apps/api/__tests__/observability-bullmq-trace.test.ts
  - apps/api/package.json
  - packages/observability/package.json
  - packages/observability/src/index.ts
  - packages/observability/src/wrappers/wrap-queue.ts
  - packages/queue/package.json
  - packages/queue/src/__tests__/carrier-roundtrip.test.ts
  - packages/queue/src/__tests__/create-worker-als.test.ts
  - packages/queue/src/__tests__/queue.test.ts
  - packages/queue/src/index.ts
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-04-26
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 20 introduces W3C trace-context propagation between BullMQ producers and consumers via two cooperating wrappers — `wrapQueue` in `@baseworks/observability` (carrier inject on the producer side) and the extended `wrapProcessorWithAls` in `@baseworks/queue` (carrier extract on the consumer side). The implementation is well-documented, the design rationale is captured inline, and the test surface is comprehensive (carrier round-trip, ALS seed invariants, single-trace API → worker assertion, call-site invariance gate).

The code is correct on the happy path, but a few correctness and robustness issues are worth addressing before this lands in production:

- **Job-data field collisions** with the carrier reserved keys (`_otel`, `_requestId`, `_tenantId`, `_userId`) are silently overwritten by the wrapper, which can confuse callers whose payloads happen to use those names. There is also no guard against a malicious/badly-shaped carrier coming from Redis on the consumer side.
- **`addBulk` opens a single producer span** but generates a fresh carrier per job using the same span — that is consistent with the design, but the per-item carriers are emitted *before* the span has a `messaging.message.id`, meaning consumer spans inherit the parent span's id, not the job's. This is by design but the span attribute `messaging.batch.message_count` is the only batch evidence; per-item message ids are never attached.
- **The carrier-extract path on the consumer trusts arbitrary job data** as a propagation getter input. `propagation.extract` is robust to garbage, but if `data._otel` is non-object (e.g. a string injected by a malicious producer reaching Redis), behaviour is implementation-dependent.

No critical security or correctness bugs were found. All issues are either defensive-hardening warnings or minor info-level cleanups.

## Warnings

### WR-01: Carrier reserved-key collisions silently clobber user payload fields

**File:** `packages/observability/src/wrappers/wrap-queue.ts:77-83, 128-137`
**Issue:** The producer wrapper builds `dataWithCarrier` by spreading `data` *first* and then writing `_otel`, `_requestId`, `_tenantId`, `_userId` on top:

```ts
const dataWithCarrier = {
  ...data,
  _otel: carrier,
  _requestId: store.requestId,
  _tenantId: store.tenantId,
  _userId: store.userId,
};
```

If a caller's job payload already contains any of these reserved keys (legitimately or by accident — e.g. an `_otel` boolean flag, a `_userId` string they treat as application data), the wrapper silently overwrites it. There is no warning, no error, no namespace-collision guard. Conversely, on the consumer side `wrapProcessorWithAls` reads the same names back, so a producer payload with a pre-existing `_userId` would round-trip the wrapper's value, *not* the caller's intent — but if the caller bypasses the wrapper (D-09 path or non-wrapped queue) the consumer would seed ALS from caller-controlled data.

This is also a forward-compatibility hazard: the field names are documented in `wrapProcessorWithAls`, but nothing prevents user payloads from shadowing them.

**Fix:** Either (a) namespace under a single envelope key (e.g. `_baseworks: { otel, requestId, tenantId, userId }`) so only one well-known key needs to be reserved, or (b) at minimum log a warning when the spread overwrites an existing reserved key:

```ts
const reserved = ["_otel", "_requestId", "_tenantId", "_userId"];
for (const k of reserved) {
  if (k in (data ?? {})) {
    // Pino warn via observability logger or a debug breadcrumb; do not throw.
    // Reserved keys are part of the public wrapper contract.
  }
}
```

Option (a) is the cleaner long-term fix and only requires changing both sides of the wrapper plus the tests.

---

### WR-02: Consumer carrier extract trusts arbitrary `job.data._otel` shape without validation

**File:** `packages/queue/src/index.ts:88-90`
**Issue:**

```ts
const data = (job.data as any) ?? {};
const carrierIn: Record<string, string> = data._otel ?? {};
const parentCtx = propagation.extract(ROOT_CONTEXT, carrierIn);
```

`data._otel` is typed as `Record<string, string>` but is never validated. A producer that bypasses `wrapQueue` (or a malicious actor with Redis access) could enqueue:

- `_otel: "not-an-object"` — `propagation.extract` will iterate string indices, behaviour is OTEL-implementation-defined (likely silently no-ops, but not contractually).
- `_otel: { traceparent: 12345 }` — non-string value; `W3CTraceContextPropagator` parses with `String(value)` defensively, but other propagators may throw.
- `_otel: null` — `?? {}` rescues this case, good.
- `_otel: { __proto__: { ... } }` — prototype pollution vector if the propagator iterates with `for...in`.

The same applies to `data._requestId`, `data._tenantId`, `data._userId` flowing into `jobCtx` (lines 109-114). They are seeded as ALS values and emitted into every log line + span attribute. A non-string `_tenantId` would propagate through `pino` and span attribute serialization unchanged.

**Fix:** Add a defensive shape check before treating the carrier as trusted:

```ts
const rawOtel = data._otel;
const carrierIn: Record<string, string> =
  rawOtel && typeof rawOtel === "object" && !Array.isArray(rawOtel)
    ? (rawOtel as Record<string, string>)
    : {};
```

For the flat ALS fields, narrow at seed time:

```ts
const jobCtx: ObservabilityContext = {
  requestId: typeof data._requestId === "string" ? data._requestId : crypto.randomUUID(),
  // ...
  tenantId: typeof data._tenantId === "string" ? data._tenantId : null,
  userId: typeof data._userId === "string" ? data._userId : null,
};
```

This is defense-in-depth; even if Redis is trusted, untyped boundaries deserve type narrowing.

---

### WR-03: `addBulk` per-item carriers all share the same producer span context — `messaging.message.id` is never set

**File:** `packages/observability/src/wrappers/wrap-queue.ts:101-150`
**Issue:** Two related correctness concerns in the bulk path:

1. **All bulk items share one parent span.** The wrapper opens *one* `${queueName} publish` span before the loop, then injects from that span into every item's carrier (line 127). That is consistent with the W3C semantics for a batch publish, but the resulting consumer spans for all `N` jobs will have the *same* parent spanId. This is the intended fan-in, but it is worth verifying the Tempo/exporter UX matches expectations — for high-fanout batches, the parent span only ends *after* the awaited `origAddBulk` settles, so trace timelines may look strange.
2. **No per-item `messaging.message.id` is ever recorded.** Compare to the `add` path (lines 87-89), which sets `ATTR_MESSAGING_MESSAGE_ID` from the returned job. The `addBulk` path receives `result` (an array of jobs with ids) but discards it without setting any message-id attribute. For a 100-job batch, the exporter sees only `messaging.batch.message_count: 100` and no way to correlate the parent span to individual job ids.

**Fix:** After awaiting `origAddBulk`, capture the returned job ids on the parent span as an array attribute (OTEL spec allows `string[]` for attribute values):

```ts
const result = await origAddBulk(wrappedJobs);
const ids = (result ?? []).map((j: any) => j?.id).filter(Boolean).map(String);
if (ids.length > 0) {
  span.setAttribute("messaging.message.ids", ids);
}
return result;
```

If the array gets large, consider truncating to the first N ids and recording total count separately. The current behaviour is not buggy, just thin on observability for the bulk path.

## Info

### IN-01: Cast through `any` to mutate `Queue.add` / `Queue.addBulk` is fragile

**File:** `packages/observability/src/wrappers/wrap-queue.ts:49, 101`
**Issue:** The wrapper mutates the original Queue instance in place by replacing `.add` and `.addBulk` via `(queue as any).add = ...`. This works, but:

- It mutates the BullMQ-allocated object, so `queue` after wrapping is no longer a true `Queue` — its prototype methods now diverge from the class.
- A future BullMQ release that adds an internal call to `this.add(...)` from another method (e.g. some retry-helper) would invoke the wrapped path unexpectedly, possibly inside non-ALS contexts.
- TypeScript users get the wrapped behaviour structurally but no longer through `Queue<DataType>` type inference for the `data` parameter — the cast erases generics.

**Fix:** Consider returning a Proxy instead of mutating the underlying object; preserves the type identity and prevents accidental internal-call surprises. Lower priority than the warnings above; current approach is documented.

---

### IN-02: Empty observability span attributes when ALS fields are null

**File:** `packages/observability/src/wrappers/wrap-queue.ts:68-70, 118-120`
**Issue:**

```ts
"tenant.id": store.tenantId ?? "",
"user.id": store.userId ?? "",
"request.id": store.requestId ?? "",
```

Setting span attributes to empty strings `""` pollutes the trace backend with no-information attributes that look semantically valid (the attribute is *present* with an empty value). OTEL semantic conventions recommend omitting attributes whose value is unknown rather than emitting empty strings.

**Fix:** Only set the attribute when the value is truthy:

```ts
const attrs: Record<string, string | number> = {
  [ATTR_MESSAGING_SYSTEM]: SYSTEM_BULLMQ,
  [ATTR_MESSAGING_DESTINATION_NAME]: queueName,
  [ATTR_MESSAGING_OPERATION]: "publish",
};
if (store.tenantId) attrs["tenant.id"] = store.tenantId;
if (store.userId) attrs["user.id"] = store.userId;
if (store.requestId) attrs["request.id"] = store.requestId;
const span = tracer.startSpan(`${queueName} publish`, {
  kind: SpanKind.PRODUCER,
  attributes: attrs,
});
```

---

### IN-03: Span-recordException path missing in `wrapQueue` constructor failures

**File:** `packages/observability/src/wrappers/wrap-queue.ts:74-75, 126-127`
**Issue:** `propagation.inject(...)` and `tracer.startSpan(...)` are called *before* the `try` block. If either throws (extremely unlikely with a valid global propagator/tracer registered, but possible if a custom propagator is installed), the span is leaked (`span.end()` never called) and the exception surfaces unwrapped to the caller. The `try/catch/finally` should encompass span acquisition or, alternatively, the span should be created lazily inside the try.

**Fix:** Move `tracer.startSpan(...)` outside try (it's the source of `span` for `finally`), but wrap `propagation.inject` and any pre-await work in the try block. Lower priority — these calls don't realistically throw.

---

### IN-04: Test file `observability-bullmq-trace.test.ts` lacks afterEach cleanup of OTEL globals

**File:** `apps/api/__tests__/observability-bullmq-trace.test.ts:49-58`
**Issue:** The `beforeAll` registers a global propagator + tracer provider + context manager, and `afterAll` disables them. If any other test file in the same Bun test run also calls `propagation.setGlobalPropagator(...)` or `trace.setGlobalTracerProvider(...)`, ordering could leave globals in inconsistent states. The same pattern is repeated in `carrier-roundtrip.test.ts` and `create-worker-als.test.ts`. There is no guard against test file interleaving.

**Fix:** Test file isolation in Bun is module-level, so the current setup is generally safe. Consider extracting the OTEL test-bootstrap into a shared helper (`packages/observability/src/test-utils/otel-bootstrap.ts`) so all three test files share a single, audited setup/teardown pair. Reduces duplication and lowers the chance of drift.

---

### IN-05: Allow-list entry comment for `wrap-queue.ts` slightly inaccurate

**File:** `apps/api/__tests__/logger-callsite-invariance.test.ts:48`
**Issue:** The allow-list comment for `wrap-queue.ts` reads:

```ts
"packages/observability/src/wrappers/wrap-queue.ts", // Phase 20 D-02 — producer carrier inject from ALS
```

But `wrap-queue.ts` reads `obsContext.getStore()` — not `getObsContext()`. The grep regex covers both, so the gate works correctly. The comment is accurate as-is but worth noting that the file uses the lower-level method directly, consistent with the other wrapper allow-list entries.

**Fix:** No code change needed. Optional: align the comment style — most other entries reference a decision id (D-XX). This one already does; just confirming completeness.

---

_Reviewed: 2026-04-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
