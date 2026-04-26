---
created: 2026-04-26T15:55:00.000Z
title: Bridge obsContext.traceId to OTel server-span trace_id
area: api
files:
  - apps/api/src/index.ts
  - apps/api/src/lib/inbound-trace.ts
  - packages/observability/src/wrappers/wrap-queue.ts
  - packages/queue/src/index.ts
---

## Problem

API log lines and BullMQ-worker log lines for the **same logical request** show **different `traceId` values**, defeating log-only correlation across the producer/consumer boundary.

Discovered 2026-04-26 during v1.3 milestone Phase 20 UAT:

```
API log:    traceId: "cd1f429028924094b5f5a8ee0aaaa873"
            requestId: "dcf13589-41d4-47f6-a65f-050a22e147bc"
            method: "POST", path: "/examples", status: 200

Worker log: traceId: "0c6c737ce9b3327b8e94876c8994d2aa"   ← different
            requestId: "dcf13589-41d4-47f6-a65f-050a22e147bc"   ← matches
            tenantId: "qrsJLGpkacR1N2YYSXqNqRV8oDKnHUOr"        ← matches
            jobId: 1, queue: "example-process-followup"
```

## Root cause

Two independent trace systems run in parallel inside this codebase:

1. **`obsContext.traceId`** (ALS-based, manually managed)
   - Seeded on the Bun.serve fetch wrapper via `decideInboundTrace(req, remoteAddr)`
     at `apps/api/src/index.ts:173`.
   - Generates a fresh server-side UUID (or adopts the inbound `traceparent`
     when the source is in `OBS_TRUST_TRACEPARENT_FROM`).
   - This is what the pino mixin reads → appears as `traceId` in API log lines.

2. **OTel SDK trace context** (auto-instrumented)
   - Lives inside `@opentelemetry/api` `context.active()` and the per-span
     `spanContext().traceId`.
   - The HTTP server span (created by `@opentelemetry/instrumentation-http` or
     by manual instrumentation) has its own trace_id, distinct from
     obsContext.traceId.
   - This is what `propagation.inject` writes into the BullMQ carrier
     (`packages/observability/src/wrappers/wrap-queue.ts:75`).

On the **consumer side**, `wrapProcessorWithAls`
(`packages/queue/src/index.ts:110`) seeds `obsContext.traceId = sc.traceId`
(the OTel-derived value) — which is why worker log lines show the OTel-side
identity. So the mismatch exists only on the **API side**, and it's a
deliberate-but-unfinished design boundary.

## Why this matters

A user grep'ing logs for `traceId=cd1f4290...` will find ONLY the producing
HTTP request. They cannot follow the chain into BullMQ, nor into any
downstream HTTP fan-out, because every span/job/event uses OTel's traceId
for propagation while the API log writes obsContext's.

For Tempo / Grafana users this is fine — OTel exporters carry the OTel
trace_id end-to-end and Tempo will render the full tree (Phase 21 stands
this stack up). For everyone else (anyone reading raw log files, anyone
running grep against a log aggregator without OTel ingest), this is broken
correlation.

## Solution

TBD — preferred direction:

**Option A (recommended): Seed obsContext.traceId from the OTel server span**
- In `apps/api/src/index.ts` Bun.serve fetch wrapper, AFTER OTel's HTTP
  instrumentation has created the server span, read `trace.getActiveSpan()
  ?.spanContext().traceId` and seed `obsContext.run({ traceId: <that>, ... })`.
- Drop or repurpose `decideInboundTrace` — its trust gate already feeds the
  underlying OTel context (via `traceparent` header which OTel HTTP
  instrumentation respects). The trust gate just shouldn't ALSO mint a
  separate ALS-only traceId.
- After this change, API log `traceId` would match worker/job/downstream
  `traceId` end-to-end, and the observed Phase 20 mismatch disappears.

**Option B: Remove obsContext.traceId entirely; have the pino mixin read
`trace.getActiveSpan()` directly each log call**
- Cleaner long-term but a bigger change. ALS frame becomes thinner; the OTel
  context is the single source of truth.

**Option C: Document the duality and accept it**
- Cheapest but worst — guarantees a continuous source of confusion every
  time a developer wonders why their grep doesn't find the worker side.

Pick A unless we discover a reason `decideInboundTrace`'s independence is
load-bearing.

## Test that must pass after fix

In `apps/api/__tests__/observability-bullmq-trace.test.ts` (or a new test):
1. Make an authenticated request that enqueues a job.
2. Capture the API log's `traceId` field.
3. Wait for worker to process the job.
4. Assert the worker log's `traceId` field equals the API's.

(Today this test would fail; it's the regression guard.)

## Related

- Phase 20 verification report: `.planning/phases/20-bullmq-trace-propagation/20-VERIFICATION.md`
- Phase 20 human UAT: `.planning/phases/20-bullmq-trace-propagation/20-HUMAN-UAT.md` (test #2 marks this as a known boundary gap)
- Phase 19 obsContext design: `.planning/phases/19-context-logging-http-cqrs-tracing/19-CONTEXT.md`
- Phase 21 will ship the Tempo stack which makes this less painful operationally — but the duality remains worth fixing.
