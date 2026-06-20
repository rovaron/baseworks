---
phase: 24-foundation-storage-port-files-schema-moduledefinition-extens
plan: 06
subsystem: infra
tags: [storage, drizzle, postgres, migration, module-registry, env-validation, bun]

# Dependency graph
requires:
  - phase: 24-02
    provides: "0002_v14_file_storage migration (files + tenant_storage_usage tables, CHECK constraint, partial index)"
  - phase: 24-03
    provides: "FileRelation type + ModuleDefinition.fileRelations? extension"
  - phase: 24-04
    provides: "validateStorageEnv() with D-13/D-14 enforcement"
  - phase: 24-05
    provides: "fileRelationsRegistry singleton + collectFileRelations collector"
provides:
  - "@baseworks/storage wired as workspace dependency of apps/api"
  - "validateStorageEnv() called in both apps/api index.ts and worker.ts boot preludes (after observability, before module registry)"
  - "ModuleRegistry.loadAll() collects each module's fileRelations into the singleton after the health block (D-09)"
  - "Live DB schema: files + tenant_storage_usage tables applied to Postgres with CHECK + partial index"
  - ".env.example documents all six storage env vars"
affects: [25-storage-adapters, 26-files-module, 27-quota-cleanup, 28-image-transforms]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Boot-prelude env validation: validateStorageEnv() crashes process before module mount on bad env (mirrors validateObservabilityEnv)"
    - "Registry collection block: fileRelations gathered into a process-wide singleton during loadAll, guarded by if (def.fileRelations)"

key-files:
  created: []
  modified:
    - apps/api/package.json
    - apps/api/src/index.ts
    - apps/api/src/worker.ts
    - apps/api/src/core/registry.ts
    - .env.example

key-decisions:
  - "bun run db:migrate applied BOTH pending migrations (0002_v14_file_storage AND 0003_audit_indexes) in one run — drizzle applies all pending tags; migration count went 1 -> 3, not the 1 -> 2 the plan's stale acceptance assumed."
  - "tsc --noEmit failure (132 repo-wide TS6059 rootDir errors) and 9 bun-test failures are pre-existing/audit-era, not caused by this plan — logged to deferred-items.md, not fixed (scope boundary)."

patterns-established:
  - "Storage env validated at boot in both API and worker entrypoints"
  - "Module fileRelations collected into fileRelationsRegistry singleton at registry load"

requirements-completed: [FILE-01, MOD-01]

# Metrics
duration: 12min
completed: 2026-06-11
---

# Phase 24 Plan 06: Storage Wire-Up + Migration Apply Summary

**Wired `@baseworks/storage` into apps/api (validateStorageEnv at boot in index.ts + worker.ts, fileRelations collection in ModuleRegistry.loadAll per D-09), documented storage env vars, and applied migration `0002_v14_file_storage` to the live Postgres DB — Phase 24 is now real on disk and in the database.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-06-11
- **Tasks:** 4 (3 wire-up tasks pre-committed by an earlier run; this run executed the BLOCKING migration apply + full verification)
- **Files modified:** 5 source files (pre-committed) + DB schema state

## Accomplishments
- Migration `0002_v14_file_storage` applied to live Postgres: `files` (17 columns) and `tenant_storage_usage` (5 columns) created with the `files_status_check` CHECK constraint and `files_pending_status_idx` partial index (`WHERE deleted_at IS NULL`).
- Verified `@baseworks/storage` is a declared workspace dep of apps/api; `validateStorageEnv()` runs at boot in both `index.ts` and `worker.ts` after `validateObservabilityEnv()` and before module-registry creation.
- Verified `ModuleRegistry.loadAll()` collects `def.fileRelations` into `fileRelationsRegistry` immediately after the health block, before `this.loaded.set` (D-09), with `moduleImportMap` untouched (D-18).
- Verified `.env.example` documents all six storage env vars with dev-friendly defaults and commented S3/AWS placeholders.
- Confirmed boot wire-up correctness: `STORAGE_PROVIDER=s3` without credentials crashes naming `AWS_ACCESS_KEY_ID`; default env passes.
- Confirmed `bun run db:migrate` is idempotent (second run exits 0, no re-apply).

## Task Commits

Tasks 24-06-01..03 were committed atomically by an earlier execution run (all ancestors of HEAD); Task 24-06-04 applies the migration to the live DB and produces no source-file change (its result is `__drizzle_migrations` table state).

1. **Task 24-06-01: Add @baseworks/storage dep + wire validateStorageEnv() into boot preludes** - `b91bbd9` (feat)
2. **Task 24-06-02: Wire collectFileRelations into ModuleRegistry.loadAll() (D-09)** - `66a5c3f` (feat)
3. **Task 24-06-03: Document storage env vars in .env.example** - `63d3ab7` (docs)
4. **Task 24-06-04: [BLOCKING] Apply migration 0002_v14_file_storage + verify DB state** - no source commit (DB-state-only; migration applied via `bun run db:migrate`)

**Plan metadata:** see final docs commit (SUMMARY + STATE + ROADMAP + REQUIREMENTS + deferred-items).

## Files Created/Modified
- `apps/api/package.json` - `@baseworks/storage: workspace:*` dependency (pre-committed)
- `apps/api/src/index.ts` - `validateStorageEnv` import + call after observability validator (pre-committed)
- `apps/api/src/worker.ts` - `validateStorageEnv` import + call in worker boot prelude (pre-committed)
- `apps/api/src/core/registry.ts` - `fileRelationsRegistry` import + collection block after health block (pre-committed)
- `.env.example` - storage env-var documentation block (pre-committed)
- Live Postgres DB - `files` + `tenant_storage_usage` tables applied (this run)

## Decisions Made
- **`db:migrate` applied two pending migrations.** The DB had only `0000_red_lester` applied (count = 1). `bun run db:migrate` applied all pending tags — `0002_v14_file_storage` AND the audit-branch `0003_audit_indexes` — bringing the count to 3. The plan's acceptance text assumed a 1 -> 2 increase; the real, verified acceptance is "0002_v14_file_storage recorded and both storage tables exist," which holds. Drizzle applying all pending migrations in one invocation is expected behavior.

## Deviations from Plan

This run found Tasks 24-06-01/02/03 already implemented and committed by an earlier execution (commits `b91bbd9`, `66a5c3f`, `63d3ab7`, all ancestors of HEAD). Their acceptance criteria were re-verified rather than re-executed (no duplicate commits). The only remaining work — the BLOCKING migration apply (24-06-04) — was executed and verified.

### Out-of-scope discoveries (logged, NOT fixed)

**1. [Scope boundary] `bun --cwd apps/api tsc --noEmit` reports 132 repo-wide errors**
- **Found during:** Task 24-06-04 verification.
- **Issue:** Pre-existing `TS6059` rootDir errors for every workspace import (db, config, queue, observability, i18n, all modules, and storage), plus Elysia type drift and `ioredis`/`bullmq` `TS2307` missing-module errors. The storage import contributes exactly 1 of the 132 lines — the same systemic rootDir misconfiguration (`rootDir: ./src` + root `declaration: true`).
- **Action:** Logged to `deferred-items.md`. Not fixed — repo-wide tsconfig restructure is architectural scope and the migration task caused none of it. The monorepo uses Bun runtime resolution + per-package `bun test`, not project-wide `tsc`.

**2. [Scope boundary] 9 `bun test apps/api` failures (mock-pollution + audit-era export drift)**
- **Found during:** Task 24-06-04 verification.
- **Issue:** 176 pass / 9 fail. The `ModuleRegistry loadAll collects def.health` failure passes 4/0 **in isolation** (full-suite bun `mock.module` pollution — documented v1.2 behavior); its fixture has no `fileRelations` so the 24-06-02 block is never entered for it. The other 8 are audit-era (`auth` export drift, ioredis missing, Elysia type drift) in files this plan never touched.
- **Action:** Logged to `deferred-items.md`. Not fixed — none involve the migration, storage package, or fileRelations block.

---

**Total deviations:** 0 auto-fixes; 2 out-of-scope discoveries logged.
**Impact on plan:** None on plan goal. All storage-specific verification passes (90/0 storage tests, migration applied + introspected, boot smoke tests, idempotency). Out-of-scope items are pre-existing repo-wide conditions deferred for a future tooling task.

## Issues Encountered
- One-shot `bun -e` introspection scripts needed `postgres` package resolution — run from `packages/db` (which has the driver) while still reaching the same DB via `DATABASE_URL`.

## User Setup Required
None - no external service configuration required. New env vars ship with working dev defaults (`STORAGE_PROVIDER=local`).

## Next Phase Readiness
- Phase 24 success criteria #1 (migration applied, both tables real), #3 (boot crashes on bad storage env naming the var), and #4 (ModuleRegistry collects fileRelations into the singleton) are satisfied. #2 satisfied by Plan 24-01; #5 by Plan 24-07.
- DB schema is live and idempotent; Phase 25 (storage adapters + conformance suite) can build against real tables.
- Pre-existing repo-wide `tsc` rootDir state and 9 audit-era test failures are tracked in `deferred-items.md` for a future tooling cleanup — they do not block Phase 25.

## Self-Check: PASSED

- `24-06-SUMMARY.md` exists.
- Task commits `b91bbd9`, `66a5c3f`, `63d3ab7` exist in history (ancestors of HEAD).
- Live DB tables `files` and `tenant_storage_usage` present in Postgres.

---
*Phase: 24-foundation-storage-port-files-schema-moduledefinition-extens*
*Completed: 2026-06-11*
