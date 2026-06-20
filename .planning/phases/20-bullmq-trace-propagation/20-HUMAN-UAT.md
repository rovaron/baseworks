---
status: partial
phase: 20-bullmq-trace-propagation
source: [20-VERIFICATION.md]
started: 2026-04-26T00:00:00Z
updated: 2026-05-05T00:00:00Z
---

## Current Test

[testing paused — Test 1 blocked on Phase 21 (deferred to v1.4+)]

## Tests

### 1. Tempo visual confirmation — SC#2 literal wording
expected: A single trace tree in Tempo showing HTTP server span → BullMQ publish PRODUCER span → BullMQ process CONSUMER span, all sharing one traceId. The worker span must appear as a child/descendant of the enqueue span.
how_to_run: Start the API + worker against a real Redis. Trigger an HTTP request that enqueues a job. Wait for the worker to process it. Open Grafana/Tempo and inspect the trace tree. (Phase 21 ships `docker-compose.observability.yml` and the four pre-provisioned Grafana dashboards needed for this check.)
why_human: Requires a real OTEL exporter + Tempo backend + live Redis/BullMQ round-trip. The in-process D-08 E2E test (`apps/api/__tests__/observability-bullmq-trace.test.ts`) satisfies the trace-data assertion programmatically (producer log `traceId === consumer log `traceId`), but the visual Tempo rendering requires the full observability stack which Phase 21 will provide.
result: blocked
blocked_by: prior-phase
reason: Phase 21 (OTEL Adapters + Grafana/Tempo stack) DEFERRED to v1.4+. Programmatic equivalent already verified by D-08 E2E test and Test 2 log-level confirmation. Resume when Phase 21 ships and Tempo is available.

### 2. Live producer→consumer carrier flow — log-level verification
expected: Trigger an HTTP request that enqueues a job. Worker log line for the resulting job carries an OTel-inherited traceId derived from the producer's _otel carrier (i.e., NOT a fresh random root traceId), plus identical requestId and tenantId from job.data._requestId/_tenantId. Phase 20's W3C carrier injection on .add() and propagation.extract on the consumer side both fire end-to-end.
result: pass
notes: |
  Verified live 2026-04-26 during v1.3 milestone UAT:
    1. POST /examples (authenticated) → on-example-created hook fires →
       getFollowupQueue().add("example-process-followup", {...})
    2. wrapQueue.add intercepts: builds carrier via
       propagation.inject(trace.setSpan(context.active(), span), carrier),
       spreads {_otel: carrier, _requestId, _tenantId, _userId} into job data.
    3. wrapProcessorWithAls extracts: parentCtx =
       propagation.extract(ROOT_CONTEXT, data._otel), opens consumer span
       under parent, seeds obsContext with sc.traceId.
  Result observed in worker log:
    requestId: "dcf13589-41d4-47f6-a65f-050a22e147bc" (matches producer)
    tenantId: "qrsJLGpkacR1N2YYSXqNqRV8oDKnHUOr" (matches producer)
    traceId: "0c6c737ce9b3327b8e94876c8994d2aa" (OTel-derived from carrier;
            distinct from API obsContext "cd1f4290..." — see boundary gap todo)
    jobId: 1, queue: "example-process-followup"
  Conclusion: W3C traceparent IS flowing through Redis as designed (Phase 20
  CTX-04 / D-02 / D-05 all wired). The traceId visible to log-correlation
  tools is the OTel-side identity (correct per Phase 21 plan), not the
  obsContext-side identity used for HTTP request log lines — a separate
  boundary gap captured in
  .planning/todos/pending/2026-04-26-bridge-obscontext-traceid-to-otel-server-span.md.

## Summary

total: 2
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 1

## Gaps
