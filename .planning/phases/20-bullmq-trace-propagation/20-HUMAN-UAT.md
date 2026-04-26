---
status: partial
phase: 20-bullmq-trace-propagation
source: [20-VERIFICATION.md]
started: 2026-04-26T00:00:00Z
updated: 2026-04-26T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Tempo visual confirmation — SC#2 literal wording
expected: A single trace tree in Tempo showing HTTP server span → BullMQ publish PRODUCER span → BullMQ process CONSUMER span, all sharing one traceId. The worker span must appear as a child/descendant of the enqueue span.
how_to_run: Start the API + worker against a real Redis. Trigger an HTTP request that enqueues a job. Wait for the worker to process it. Open Grafana/Tempo and inspect the trace tree. (Phase 21 ships `docker-compose.observability.yml` and the four pre-provisioned Grafana dashboards needed for this check.)
why_human: Requires a real OTEL exporter + Tempo backend + live Redis/BullMQ round-trip. The in-process D-08 E2E test (`apps/api/__tests__/observability-bullmq-trace.test.ts`) satisfies the trace-data assertion programmatically (producer log `traceId === consumer log `traceId`), but the visual Tempo rendering requires the full observability stack which Phase 21 will provide.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
