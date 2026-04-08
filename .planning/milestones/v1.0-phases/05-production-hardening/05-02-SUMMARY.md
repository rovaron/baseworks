---
phase: 05-production-hardening
plan: 02
subsystem: api, infra
tags: [health-check, pino, request-tracing, observability, bullmq, bun-serve]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Elysia API server, module registry, worker entrypoint"
  - phase: 03-backend-services
    provides: "BullMQ queue/worker infrastructure, Redis connection"
provides:
  - "Enhanced /health endpoint with database and Redis dependency checks"
  - "Worker HTTP health server via Bun.serve on configurable port"
  - "Request tracing middleware with per-request UUID and structured pino logging"
  - "Request ID propagation from API to BullMQ jobs for log correlation"
affects: [docker, deployment, monitoring, debugging]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Health check pattern: liveness (responds) + readiness (dependency checks) in single endpoint"
    - "Request tracing via Elysia derive + onAfterResponse with pino child logger"
    - "Job correlation via _requestId convention in event bus data"

key-files:
  created:
    - "apps/api/src/core/middleware/request-trace.ts"
  modified:
    - "apps/api/src/index.ts"
    - "apps/api/src/worker.ts"
    - "apps/api/src/lib/logger.ts"
    - "packages/config/src/env.ts"
    - ".env.example"

key-decisions:
  - "Health endpoint uses generic error messages ('Failed to connect') to avoid leaking connection strings (T-05-05)"
  - "Combined liveness/readiness in single /health response body rather than separate endpoints (D-07)"
  - "Request ID propagation uses _requestId convention in event data rather than AsyncLocalStorage"

patterns-established:
  - "Health check pattern: return {status, checks, uptime} with per-dependency latency"
  - "Request tracing: derive requestId + child logger, log on afterResponse"
  - "Job correlation: _requestId in event data carried through to worker logs"

requirements-completed: [OPS-03, OPS-04]

# Metrics
duration: 3min
completed: 2026-04-08
---

# Phase 05 Plan 02: Health Checks & Request Tracing Summary

**Health check endpoints with database/Redis dependency probes and per-request structured logging with job correlation IDs**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-08T02:57:33Z
- **Completed:** 2026-04-08T03:00:44Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- API /health now reports database and Redis connectivity with latency measurements, returning ok/degraded status
- Worker process exposes HTTP /health endpoint via Bun.serve with queue status and Redis check
- Every API request gets a unique request ID logged with method, path, status code, and duration
- X-Request-Id response header set on all API responses for client correlation
- BullMQ jobs carry originating request ID for cross-service log correlation

## Task Commits

Each task was committed atomically:

1. **Task 1: Enhanced health check endpoints for API and worker** - `48509a8` (feat)
2. **Task 2: Request tracing middleware and structured logging enhancement** - `bab521d` (feat)

## Files Created/Modified
- `apps/api/src/core/middleware/request-trace.ts` - Request tracing middleware with UUID generation and pino child logger
- `apps/api/src/index.ts` - Enhanced /health with dependency checks, wired request trace middleware, requestId in emit
- `apps/api/src/worker.ts` - Bun.serve health server, job handler with _requestId extraction for correlated logging
- `apps/api/src/lib/logger.ts` - Added createRequestLogger factory for request-scoped child loggers
- `packages/config/src/env.ts` - Added WORKER_HEALTH_PORT with default 3001
- `.env.example` - Added WORKER_HEALTH_PORT documentation

## Decisions Made
- Health endpoint error messages are generic ("Failed to connect") to prevent information disclosure per T-05-05
- Combined liveness and readiness into a single /health response rather than separate /live and /ready endpoints
- Used _requestId convention in event bus data for job correlation rather than AsyncLocalStorage (simpler, explicit)
- Worker health server uses process.env directly for WORKER_HEALTH_PORT instead of validated env to avoid circular dependency

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. WORKER_HEALTH_PORT defaults to 3001.

## Next Phase Readiness
- Health endpoints ready for Docker HEALTHCHECK directives
- Structured logging ready for log aggregation (JSON in production, pretty in development)
- Request tracing foundation in place for distributed tracing extensions

---
*Phase: 05-production-hardening*
*Completed: 2026-04-08*
