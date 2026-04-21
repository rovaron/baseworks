---
phase: 14-unit-tests
plan: 02
subsystem: core-infrastructure-tests
tags: [unit-tests, edge-cases, cqrs, event-bus, registry, scoped-db, config]
dependency_graph:
  requires: []
  provides: [core-edge-case-tests, scoped-db-edge-case-tests, config-validation-tests]
  affects: [apps/api/src/core/__tests__, packages/db/src/__tests__, packages/config/src/__tests__]
tech_stack:
  added: []
  patterns: [subprocess-isolation-testing, mock-db-unit-tests]
key_files:
  created: []
  modified:
    - apps/api/src/core/__tests__/cqrs.test.ts
    - apps/api/src/core/__tests__/event-bus.test.ts
    - apps/api/src/core/__tests__/registry.test.ts
    - packages/db/src/__tests__/scoped-db.test.ts
    - packages/config/src/__tests__/env.test.ts
    - packages/config/src/index.ts
decisions:
  - Re-export assertRedisUrl from @baseworks/config index for subprocess test access
metrics:
  duration: 461s
  completed: "2026-04-17T02:40:16Z"
  tasks_completed: 3
  tasks_total: 3
  tests_added: 27
  files_modified: 6
---

# Phase 14 Plan 02: Core Infrastructure Edge Case Tests Summary

Expanded 5 existing test files with 27 new edge case tests covering CqrsBus, EventBus, ModuleRegistry, scopedDb, and config env validation.

## One-liner

Edge case tests for CQRS bus (handler throws, duplicate registration, concurrency), event bus (multi-subscriber isolation, no-subscriber emit), registry (duplicate module, worker role), scoped-db (raw access, empty tenantId), and config validation (payment provider env, Redis URL assertion).

## Task Results

### Task 1: Expand CqrsBus, EventBus, and Registry edge case tests
**Commit:** 8223a8f
**Files:** `apps/api/src/core/__tests__/cqrs.test.ts`, `event-bus.test.ts`, `registry.test.ts`

Added 15 new edge case tests:
- **CqrsBus (6 tests):** handler throws propagates rejection, query handler throws, duplicate command registration overwrites, duplicate query registration overwrites, concurrent command execution, hasCommand/hasQuery accuracy
- **EventBus (4 tests):** multiple subscribers receive same event, no-subscriber emit is no-op, subscriber error isolation (second handler runs when first throws), off() wrapping behavior documented
- **Registry (5 tests):** empty commands module loads without crash, duplicate module name overwrites in Map, getLoadedNames returns all modules, getEventBus exposes bus instance, worker role skips route attachment

### Task 2: Expand scoped-db edge case tests
**Commit:** 6d0fb42
**Files:** `packages/db/src/__tests__/scoped-db.test.ts`

Added 5 new edge case tests (unit tests, no DB required):
- raw property returns underlying db instance
- tenantId accessor returns correct value
- empty string tenantId handled without throwing
- independent scoped instances have separate tenantId values
- nonexistent tenant returns empty results (integration, DB-dependent)

### Task 3: Expand config/env validation tests
**Commit:** 82942ac
**Files:** `packages/config/src/__tests__/env.test.ts`, `packages/config/src/index.ts`

Added 8 new tests via subprocess isolation:
- **validatePaymentProviderEnv (4 tests):** pagarme without key throws in dev, stripe without key throws in dev, test env warns but does not throw, valid keys pass
- **assertRedisUrl (4 tests):** worker role throws without REDIS_URL, all role throws without REDIS_URL, api role does not throw, any role passes when REDIS_URL present

Also re-exported `assertRedisUrl` from `@baseworks/config` index for clean subprocess imports.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Re-exported assertRedisUrl from config package index**
- **Found during:** Task 3
- **Issue:** `assertRedisUrl` was exported from `env.ts` but not from the package index (`index.ts`). Subprocess tests using `bun -e` cannot resolve relative imports, requiring the `@baseworks/config` package import which only re-exported `env` and `validatePaymentProviderEnv`.
- **Fix:** Added `assertRedisUrl` to the re-export list in `packages/config/src/index.ts`
- **Files modified:** `packages/config/src/index.ts`
- **Commit:** 82942ac

## Verification

All 45 tests pass across 5 files:
```
bun test apps/api/src/core/__tests__/cqrs.test.ts apps/api/src/core/__tests__/event-bus.test.ts apps/api/src/core/__tests__/registry.test.ts packages/db/src/__tests__/scoped-db.test.ts packages/config/src/__tests__/env.test.ts
-- 45 pass, 0 fail, 93 expect() calls
```
