---
phase: 03-billing-background-jobs
plan: 01
subsystem: infra
tags: [bullmq, redis, ioredis, queue, worker, background-jobs]

# Dependency graph
requires:
  - phase: 01-foundation-core-infrastructure
    provides: module registry, CQRS bus, config/env validation, worker entrypoint scaffold
provides:
  - "@baseworks/queue package with createQueue, createWorker, getRedisConnection"
  - "Worker entrypoint iterating module jobs and starting BullMQ Workers"
  - "assertRedisUrl env validation helper"
  - "Stripe and Resend env var declarations"
affects: [03-02, 03-03, 04-admin-dashboard]

# Tech tracking
tech-stack:
  added: [bullmq, ioredis]
  patterns: [inline-processor-only, singleton-redis-connection, module-job-iteration]

key-files:
  created:
    - packages/queue/package.json
    - packages/queue/tsconfig.json
    - packages/queue/src/connection.ts
    - packages/queue/src/types.ts
    - packages/queue/src/index.ts
    - packages/queue/src/__tests__/queue.test.ts
  modified:
    - packages/config/src/env.ts
    - apps/api/src/worker.ts
    - apps/api/src/core/registry.ts
    - apps/api/package.json

key-decisions:
  - "Inline processors only -- no useWorkerThreads due to Bun incompatibility with sandboxed BullMQ processors"
  - "Singleton Redis connection pattern with maxRetriesPerRequest: null as required by BullMQ"
  - "assertRedisUrl as post-validation helper due to t3-env limitation with cross-field validation"

patterns-established:
  - "Queue package as shared service (like packages/db), not a module"
  - "Module jobs iterated via registry.getLoaded() with inline BullMQ Workers"
  - "Graceful shutdown closes all workers then Redis connection"

requirements-completed: [JOBS-01, JOBS-02, JOBS-03]

# Metrics
duration: 3min
completed: 2026-04-06
---

# Phase 3 Plan 1: BullMQ Queue Infrastructure Summary

**BullMQ queue package with Redis connection factory, queue/worker factories, and wired worker entrypoint iterating module-registered jobs**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-06T10:03:49Z
- **Completed:** 2026-04-06T10:06:49Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments
- Created @baseworks/queue shared package with createQueue (3-day retention, exponential backoff) and createWorker (inline-only, concurrency 5)
- Worker entrypoint iterates all loaded module jobs and starts BullMQ Workers with graceful shutdown
- REDIS_URL enforced for worker/all roles via assertRedisUrl helper
- 14 unit tests covering connection singleton, queue defaults, and worker configuration

## Task Commits

Each task was committed atomically:

1. **Task 1: Create packages/queue shared package** - `04c2465` (feat)
2. **Task 2: Wire worker entrypoint and update env** - `106640b` (feat)
3. **Task 3: Unit tests for queue infrastructure** - `03a5296` (test)

## Files Created/Modified
- `packages/queue/package.json` - @baseworks/queue package definition with bullmq + ioredis deps
- `packages/queue/tsconfig.json` - TypeScript config extending root
- `packages/queue/src/connection.ts` - Singleton Redis connection factory with maxRetriesPerRequest: null
- `packages/queue/src/types.ts` - QueueConfig, WorkerConfig, EmailJobData interfaces
- `packages/queue/src/index.ts` - createQueue and createWorker factory functions
- `packages/queue/src/__tests__/queue.test.ts` - 14 unit tests with mocked ioredis/bullmq
- `packages/config/src/env.ts` - Added STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, assertRedisUrl
- `apps/api/src/worker.ts` - Full BullMQ worker entrypoint with module job iteration and graceful shutdown
- `apps/api/src/core/registry.ts` - Added billing to moduleImportMap
- `apps/api/package.json` - Added @baseworks/queue workspace dependency

## Decisions Made
- Inline processors only (no useWorkerThreads) because BullMQ sandboxed processors are broken on Bun runtime
- Singleton Redis connection with maxRetriesPerRequest: null as required by BullMQ documentation
- assertRedisUrl as a post-validation function (not Zod superRefine) due to t3-env limitation with cross-field validation
- Default concurrency of 5 for workers, configurable per-worker

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Mock IORedis constructor with bun:test mock() was returning the function itself instead of unique instances -- fixed by using a class-based mock instead of mock(function) pattern

## User Setup Required

**External services require manual configuration:**
- `REDIS_URL` environment variable must be set when running the worker (`INSTANCE_ROLE=worker` or `INSTANCE_ROLE=all`)
- Local development: `redis://localhost:6379` via docker-compose Redis

## Next Phase Readiness
- Queue infrastructure ready for billing webhook processing (03-02) and email delivery jobs
- Billing module registered in import map, awaiting module implementation
- All queue tests passing, worker entrypoint builds cleanly

## Self-Check: PASSED

All 10 files verified present. All 3 commit hashes verified in git log.

---
*Phase: 03-billing-background-jobs*
*Completed: 2026-04-06*
